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
import { scanLocation, type ScanResult } from "../_shared/recipeIntegrity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

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
