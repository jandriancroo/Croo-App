import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BID_LIST_WINDOW_DAYS = 30;
const REAPPEARED_TAG_PREFIX = "Back on";

interface SweepResult {
  brandId: string;
  brandName: string;
  healthRowsEvaluated: number;
  healthRowsUpdated: number;
  inventoryItemsUpdated: number;
  newlyUnavailable60Plus: number;
  reappeared: number;
  errors: string[];
}

// ──────────────────────────────────────────────────────────────────
// 1. Bid list builders — read pfg_orders / pa_orders for last 30d
//    Returns: Map<territory, Set<vendor_sku>>
// ──────────────────────────────────────────────────────────────────
async function buildPfgBidList(
  supabase: SupabaseClient,
  locationIds: string[],
  territoryMap: Map<string, string>,
): Promise<Map<string, Set<string>>> {
  // TODO: query pfg_orders, group by territory → set of item_numbers
  return new Map();
}

async function buildPaBidList(
  supabase: SupabaseClient,
  locationIds: string[],
  territoryMap: Map<string, string>,
): Promise<Map<string, Set<string>>> {
  // TODO: query pa_orders, group by territory → set of pa_item_ids
  return new Map();
}

// ──────────────────────────────────────────────────────────────────
// 2. Health row evaluator — pure function, no I/O
//    Returns the patch to apply (or null = no change)
// ──────────────────────────────────────────────────────────────────
interface HealthPatch {
  last_seen_on_bid_list: string | null;
  days_not_seen: number;
  available_since: string | null;
}

function evaluateHealthRow(
  row: {
    vendor_source: string;
    vendor_sku: string;
    vendor_territory: string;
    last_seen_on_bid_list: string | null;
    days_not_seen: number;
    available_since: string | null;
  },
  bidList: Map<string, Set<string>>,
  vendorLabel: string,
  nowIso: string,
  todayLabel: string,
): HealthPatch | null {
  // TODO:
  // - onList = bidList.get(territory)?.has(sku)
  // - if onList && days_not_seen > 0 → reappear branch
  // - if onList && days_not_seen === 0 → just refresh last_seen
  // - if !onList → increment, clear available_since on 0→1 transition
  // - return null if patch === current state
  return null;
}

// ──────────────────────────────────────────────────────────────────
// 3. Inventory items writer — join health → mapping → template → item
// ──────────────────────────────────────────────────────────────────
async function syncToInventoryItems(
  supabase: SupabaseClient,
  brandId: string,
  updatedHealthKeys: string[], // "vendor|sku|territory"
): Promise<number> {
  // TODO: resolve brand_vendor_mappings.brand_template_id for each (vendor, vendor_sku),
  //       then update inventory_items WHERE brand_item_id = template_id AND location matches territory
  return 0;
}

// ──────────────────────────────────────────────────────────────────
// 4. Per-brand sweep
// ──────────────────────────────────────────────────────────────────
async function sweepBrand(
  supabase: SupabaseClient,
  brand: { id: string; name: string },
): Promise<SweepResult> {
  const result: SweepResult = {
    brandId: brand.id,
    brandName: brand.name,
    healthRowsEvaluated: 0,
    healthRowsUpdated: 0,
    inventoryItemsUpdated: 0,
    newlyUnavailable60Plus: 0,
    reappeared: 0,
    errors: [],
  };

  try {
    // TODO:
    // a. Load locations + build territoryMap (mirror vendor-sku-health-sync)
    // b. Build PFG + PA bid lists
    // c. Load vendor_sku_health rows for this brand WHERE manager_deactivated_override = false
    // d. For each row → evaluateHealthRow → collect patches
    // e. Batch upsert patches to vendor_sku_health
    // f. syncToInventoryItems for changed keys
    // g. Tally newlyUnavailable60Plus / reappeared from patches
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[inventory-availability-sweep] Brand ${brand.name} failed:`, msg);
    result.errors.push(msg);
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional: accept { brand_id } in body to sweep just one brand (for chained calls)
    let targetBrandId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.brand_id && typeof body.brand_id === "string") {
          targetBrandId = body.brand_id;
        }
      } catch { /* no body is fine */ }
    }

    let brandsQuery = supabase.from("brands").select("id, name").eq("is_active", true);
    if (targetBrandId) brandsQuery = brandsQuery.eq("id", targetBrandId);

    const { data: brands, error: brandsErr } = await brandsQuery;
    if (brandsErr) throw brandsErr;
    if (!brands?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No active brands", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: SweepResult[] = [];
    for (const brand of brands) {
      results.push(await sweepBrand(supabase, brand));
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `[inventory-availability-sweep] Complete in ${durationMs}ms:`,
      JSON.stringify(results),
    );

    return new Response(
      JSON.stringify({ success: true, durationMs, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[inventory-availability-sweep] Fatal:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
