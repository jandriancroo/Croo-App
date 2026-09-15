// RECIPE INTEGRITY SCAN — "is any active dish missing an ingredient?"
//
// For every ACTIVE recipe item at a location, checks that every ingredient it
// uses is currently is_active at that same location. Any that aren't are written
// to recipe_integrity_alerts, keyed (location, recipe, ingredient), so one
// missing product surfaces against EVERY dish that uses it — not just the first.
//
// LOCKED RULE (Sep 15 2026): FLAG ONLY. This never touches is_active on anything,
// never disables a recipe, never edits an ingredient list. It only reports.
//
// Runs:
//   - right after the deploy Phase 2 activation sweep (vendor-price-chase)
//   - nightly, as the vendor_recipe_integrity stage of vendor-sync-nightly

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";
import { isExcludedLocation } from "../_shared/inventoryGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface BrokenLink {
  recipe_item_id: string;
  recipe_name: string;
  ingredient_item_id: string;
  ingredient_name: string;
}

export interface ScanResult {
  location_id: string;
  recipes_scanned: number;
  broken_recipes: number;
  missing_ingredients: number;
  opened: number;
  still_open: number;
  resolved: number;
  /** Grouped for reporting: one missing product → every dish it breaks. */
  by_ingredient: { ingredient: string; dishes: string[] }[];
  error?: string;
}

/** One location's scan. Exported so the nightly stage can call it in-process. */
export async function scanLocation(supabase: any, locationId: string): Promise<ScanResult> {
  const empty: ScanResult = {
    location_id: locationId,
    recipes_scanned: 0,
    broken_recipes: 0,
    missing_ingredients: 0,
    opened: 0,
    still_open: 0,
    resolved: 0,
    by_ingredient: [],
  };

  const { data: loc } = await supabase
    .from("locations")
    .select("brand_id")
    .eq("id", locationId)
    .maybeSingle();

  // Active recipes at this store.
  const { data: recipeRows, error: recipeErr } = await supabase
    .from("inventory_items")
    .select("id, name")
    .eq("location_id", locationId)
    .eq("is_recipe", true)
    .eq("is_active", true);
  if (recipeErr) return { ...empty, error: recipeErr.message };

  const recipes = (recipeRows || []) as { id: string; name: string }[];
  empty.recipes_scanned = recipes.length;
  if (recipes.length === 0) {
    await closeMissing(supabase, locationId, new Set<string>());
    return { ...empty, resolved: 0 };
  }

  const recipeNameById = new Map(recipes.map((r) => [r.id, r.name]));

  // Their ingredient links.
  const links: { recipe_item_id: string; ingredient_item_id: string }[] = [];
  const CHUNK = 200;
  const recipeIds = recipes.map((r) => r.id);
  for (let i = 0; i < recipeIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("inventory_recipe_ingredients")
      .select("recipe_item_id, ingredient_item_id")
      .in("recipe_item_id", recipeIds.slice(i, i + CHUNK));
    if (error) return { ...empty, error: error.message };
    links.push(...((data || []) as any[]));
  }
  if (links.length === 0) {
    await closeMissing(supabase, locationId, new Set<string>());
    return empty;
  }

  // Status of every ingredient referenced.
  const ingredientIds = [...new Set(links.map((l) => l.ingredient_item_id))];
  const ingredient = new Map<string, { name: string; active: boolean }>();
  for (let i = 0; i < ingredientIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id, name, is_active")
      .in("id", ingredientIds.slice(i, i + CHUNK));
    if (error) return { ...empty, error: error.message };
    for (const r of (data || []) as any[]) {
      ingredient.set(r.id, { name: r.name, active: r.is_active === true });
    }
  }

  const broken: BrokenLink[] = [];
  for (const l of links) {
    const ing = ingredient.get(l.ingredient_item_id);
    // A link pointing at a row we can't read is broken too — report it plainly.
    if (ing && ing.active) continue;
    broken.push({
      recipe_item_id: l.recipe_item_id,
      recipe_name: recipeNameById.get(l.recipe_item_id) ?? "(unnamed recipe)",
      ingredient_item_id: l.ingredient_item_id,
      ingredient_name: ing?.name ?? "(missing product)",
    });
  }

  // Upsert the open set; the unique key makes repeat nights idempotent.
  const nowIso = new Date().toISOString();
  let opened = 0;
  let stillOpen = 0;
  const keys = new Set<string>();
  for (const b of broken) {
    keys.add(`${b.recipe_item_id}|${b.ingredient_item_id}`);
    const { data: existing } = await supabase
      .from("recipe_integrity_alerts")
      .select("id, status")
      .eq("location_id", locationId)
      .eq("recipe_item_id", b.recipe_item_id)
      .eq("ingredient_item_id", b.ingredient_item_id)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("recipe_integrity_alerts")
        .update({
          status: "open",
          resolved_at: null,
          last_seen_at: nowIso,
          recipe_name: b.recipe_name,
          ingredient_name: b.ingredient_name,
        })
        .eq("id", existing.id);
      if (existing.status === "open") stillOpen++;
      else opened++;
    } else {
      const { error } = await supabase.from("recipe_integrity_alerts").insert({
        location_id: locationId,
        brand_id: loc?.brand_id ?? null,
        recipe_item_id: b.recipe_item_id,
        recipe_name: b.recipe_name,
        ingredient_item_id: b.ingredient_item_id,
        ingredient_name: b.ingredient_name,
        status: "open",
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      });
      if (!error) opened++;
    }
  }

  const resolved = await closeMissing(supabase, locationId, keys);

  // Group for the report: missing product → every dish affected.
  const grouped = new Map<string, Set<string>>();
  for (const b of broken) {
    const set = grouped.get(b.ingredient_name) ?? new Set<string>();
    set.add(b.recipe_name);
    grouped.set(b.ingredient_name, set);
  }

  return {
    location_id: locationId,
    recipes_scanned: recipes.length,
    broken_recipes: new Set(broken.map((b) => b.recipe_item_id)).size,
    missing_ingredients: new Set(broken.map((b) => b.ingredient_item_id)).size,
    opened,
    still_open: stillOpen,
    resolved,
    by_ingredient: [...grouped.entries()]
      .map(([ing, dishes]) => ({ ingredient: ing, dishes: [...dishes].sort() }))
      .sort((a, b) => b.dishes.length - a.dishes.length),
  };
}

/** Anything open at this location that tonight's scan did NOT see has healed. */
async function closeMissing(supabase: any, locationId: string, keepKeys: Set<string>) {
  const { data: open } = await supabase
    .from("recipe_integrity_alerts")
    .select("id, recipe_item_id, ingredient_item_id")
    .eq("location_id", locationId)
    .eq("status", "open");

  const stale = ((open || []) as any[]).filter(
    (r) => !keepKeys.has(`${r.recipe_item_id}|${r.ingredient_item_id}`),
  );
  if (stale.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const CHUNK = 200;
  for (let i = 0; i < stale.length; i += CHUNK) {
    await supabase
      .from("recipe_integrity_alerts")
      .update({ status: "resolved", resolved_at: nowIso })
      .in("id", stale.slice(i, i + CHUNK).map((r) => r.id));
  }
  return stale.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const denied = await requireAuthorizedCaller(req, corsHeaders, { minRole: "manager" });
  if (denied) return denied;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const locationId: string | null = body?.locationId ?? null;

    let locationIds: string[] = [];
    if (locationId) {
      locationIds = [locationId];
    } else {
      const { data } = await supabase
        .from("locations")
        .select("id")
        .eq("inventory_enabled", true)
        .eq("is_test_location", false);
      locationIds = ((data || []) as any[]).map((r) => r.id);
    }
    locationIds = locationIds.filter((id) => !isExcludedLocation(id));

    // FAIL-SOFT across stores too: one store's problem never ends the scan.
    const results: ScanResult[] = [];
    for (const id of locationIds) {
      try {
        results.push(await scanLocation(supabase, id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[recipe-integrity-scan]", id, msg);
        results.push({
          location_id: id,
          recipes_scanned: 0,
          broken_recipes: 0,
          missing_ingredients: 0,
          opened: 0,
          still_open: 0,
          resolved: 0,
          by_ingredient: [],
          error: msg,
        });
      }
    }

    return new Response(
      JSON.stringify({
        locations: results.length,
        broken_recipes: results.reduce((s, r) => s + r.broken_recipes, 0),
        missing_ingredients: results.reduce((s, r) => s + r.missing_ingredients, 0),
        opened: results.reduce((s, r) => s + r.opened, 0),
        resolved: results.reduce((s, r) => s + r.resolved, 0),
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[recipe-integrity-scan]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
