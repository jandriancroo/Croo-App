// Runs every 8h via pg_cron. Refreshes prices/pack info for mapped PFG items
// across every location with an active PFG integration. Per-location retry
// with exponential backoff so a transient PFG outage on one store doesn't
// blow up the whole run. Server-side mirror of the PFG price-sync block that
// used to live in StartCountDialog.tsx.
//
// Never creates new inventory_items (vendor gate). Skips image backfill and
// gap-alert writes — those belong to the nightly vendor-gap-scan job.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 5_000, 15_000];
const THROTTLE_BETWEEN_LOCATIONS_MS = 750;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface LocationResult {
  location_id: string;
  location_name: string;
  status: "completed" | "failed" | "skipped";
  attempts: number;
  items_updated: number;
  error?: string;
}

async function syncOneLocation(
  supabase: ReturnType<typeof createClient>,
  loc: { id: string; name: string; credentials: any },
): Promise<Omit<LocationResult, "location_id" | "location_name">> {
  const productListHeaderId = loc.credentials?.product_list_header_id;
  const customerId = loc.credentials?.customer_id;

  if (!productListHeaderId || !customerId) {
    return {
      status: "skipped",
      attempts: 0,
      items_updated: 0,
      error: "missing product_list_header_id or customer_id",
    };
  }

  let attempt = 0;
  let lastErr: string | undefined;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    try {
      // Call pfg-service via internal invoke (service-role auth)
      const { data, error } = await supabase.functions.invoke("pfg-service", {
        body: {
          locationId: loc.id,
          action: "categories",
          productListHeaderId,
          customerId,
        },
      });

      if (error) throw new Error(error.message || "pfg-service invoke error");
      if (!data?.authenticated) throw new Error("PFG authentication failed");

      const categories = data?.data?.categories || [];
      if (categories.length === 0) {
        return { status: "completed", attempts: attempt, items_updated: 0 };
      }

      // Pre-fetch PFG brand mappings + local items (same match chain as StartCountDialog)
      const [mappingRes, itemsRes] = await Promise.all([
        supabase
          .from("brand_vendor_mappings")
          .select("vendor_item_id, brand_template_id")
          .eq("vendor", "pfg"),
        supabase
          .from("inventory_items")
          .select("id, item_number, brand_item_id")
          .eq("location_id", loc.id)
          .eq("is_active", true),
      ]);

      const pfgSkuToTemplate = new Map<string, string>();
      for (const m of mappingRes.data || []) {
        if (m.vendor_item_id) pfgSkuToTemplate.set(m.vendor_item_id, m.brand_template_id);
      }
      const byItemNumber = new Map<string, any>();
      const byBrandItemId = new Map<string, any>();
      for (const i of itemsRes.data || []) {
        if (i.item_number) byItemNumber.set(i.item_number, i);
        if (i.brand_item_id) byBrandItemId.set(i.brand_item_id, i);
      }

      let itemsUpdated = 0;
      const now = new Date().toISOString();

      for (const cat of categories) {
        for (const product of cat.products || []) {
          let existing = product.itemNumber
            ? byItemNumber.get(product.itemNumber) || null
            : null;
          if (!existing && product.itemNumber) {
            const tId = pfgSkuToTemplate.get(product.itemNumber);
            if (tId) existing = byBrandItemId.get(tId) || null;
          }
          if (!existing) continue; // vendor gate — do not create; gap-scan handles this

          const price = product.price ? Number(product.price) : null;
          const packQuantity = product.packQuantity ? Number(product.packQuantity) : null;

          const { error: upErr } = await supabase
            .from("inventory_items")
            .update({
              cost_per_unit: price,
              pack_size: product.packSize || null,
              pack_quantity: packQuantity,
              item_number: product.itemNumber || null,
              last_synced_at: now,
            })
            .eq("id", existing.id);
          if (!upErr) itemsUpdated++;
        }
      }

      return { status: "completed", attempts: attempt, items_updated: itemsUpdated };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.error(
        `[pfg-scheduled-price-sync] ${loc.name} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErr}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS[attempt - 1] ?? 15_000);
      }
    }
  }

  return {
    status: "failed",
    attempts: attempt,
    items_updated: 0,
    error: lastErr,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = new Date().toISOString();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // Discover PFG-active locations
    const { data: integrations, error: intErr } = await supabase
      .from("location_integrations")
      .select("location_id, credentials, locations(name)")
      .eq("integration_type", "pfg")
      .eq("is_active", true);

    if (intErr) throw intErr;

    const targets = (integrations || []).map((r: any) => ({
      id: r.location_id,
      name: r.locations?.name || "Unknown",
      credentials: r.credentials || {},
    }));

    const results: LocationResult[] = [];
    for (const loc of targets) {
      const res = await syncOneLocation(supabase, loc);
      results.push({ location_id: loc.id, location_name: loc.name, ...res });

      // Persist per-location log (mirrors StartCountDialog's inventory_sync_logs shape)
      await supabase.from("inventory_sync_logs").insert({
        location_id: loc.id,
        sync_source: "pfg",
        sync_type: "scheduled_price_sync",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        status: res.status === "completed" ? "completed" : res.status,
        items_synced: res.items_updated,
        orders_processed: 0,
        errors: res.error ? [`${res.error} (after ${res.attempts} attempts)`] : [],
      });

      await sleep(THROTTLE_BETWEEN_LOCATIONS_MS);
    }

    const summary = {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      locations: results.length,
      completed: results.filter((r) => r.status === "completed").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      items_updated: results.reduce((s, r) => s + r.items_updated, 0),
      results,
    };

    console.log("[pfg-scheduled-price-sync] summary", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[pfg-scheduled-price-sync] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
