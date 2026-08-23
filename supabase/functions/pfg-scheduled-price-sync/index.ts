// Runs every 8h via pg_cron. Refreshes prices/pack info for mapped PFG items
// across every location with an active PFG integration.
//
// Best-practice notes:
//  - Concurrency pool (POOL_SIZE): processes multiple locations in parallel
//    while capping simultaneous load on the PFG endpoint.
//  - Per-location jitter: spreads outbound calls across the run window so
//    PFG doesn't see a synchronized burst at t=0.
//  - Retry with exponential backoff + jitter: avoids thundering-herd retries
//    on transient PFG failures.
//  - Idempotency guard: skips a location whose items were freshly synced
//    inside FRESHNESS_WINDOW_MS. Safe if cron overlaps or is triggered
//    manually right after a scheduled run.
//  - Per-location isolation: one location's failure never blocks others.
//  - Never creates new inventory_items. Skips image backfill + gap alerts
//    (those belong to the nightly vendor-gap-scan job).

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const POOL_SIZE = 5;                       // parallel locations per tick
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 5_000, 15_000]; // base backoff per attempt
const JITTER_MAX_MS = 15_000;              // per-location start jitter
const THROTTLE_MIN_MS = 250;               // spacing between pool tasks
const FRESHNESS_WINDOW_MS = 6 * 60 * 60 * 1000; // skip if synced <6h ago

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (max: number) => Math.floor(Math.random() * max);

// Stable hash → deterministic per-location jitter (same store starts at
// roughly the same slot each run, avoiding starvation of any one store).
function hashToMs(id: string, max: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % max;
}

interface LocationResult {
  location_id: string;
  location_name: string;
  status: "completed" | "failed" | "skipped_fresh" | "skipped_config";
  attempts: number;
  items_updated: number;
  duration_ms: number;
  error?: string;
}

async function syncOneLocation(
  supabase: any,
  loc: { id: string; name: string; credentials: any },

): Promise<Omit<LocationResult, "location_id" | "location_name">> {
  const startedAt = Date.now();
  const productListHeaderId = loc.credentials?.product_list_header_id;
  const customerId = loc.credentials?.customer_id;

  if (!productListHeaderId || !customerId) {
    return {
      status: "skipped_config",
      attempts: 0,
      items_updated: 0,
      duration_ms: Date.now() - startedAt,
      error: "missing product_list_header_id or customer_id",
    };
  }

  // Idempotency guard — if any item at this location was updated inside the
  // freshness window, don't hammer PFG again.
  const freshCutoff = new Date(Date.now() - FRESHNESS_WINDOW_MS).toISOString();
  const { data: freshRow } = await supabase
    .from("inventory_items")
    .select("id")
    .eq("location_id", loc.id)
    .gt("last_synced_at", freshCutoff)
    .limit(1)
    .maybeSingle();
  if (freshRow) {
    return {
      status: "skipped_fresh",
      attempts: 0,
      items_updated: 0,
      duration_ms: Date.now() - startedAt,
    };
  }

  // Per-location start jitter so all pool workers don't hit PFG simultaneously.
  await sleep(hashToMs(loc.id, JITTER_MAX_MS));

  let attempt = 0;
  let lastErr: string | undefined;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    try {
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
        return {
          status: "completed",
          attempts: attempt,
          items_updated: 0,
          duration_ms: Date.now() - startedAt,
        };
      }

      // Match chain (same as StartCountDialog): item_number → brand mapping.
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
      for (const m of (mappingRes.data || []) as any[]) {
        if (m.vendor_item_id) pfgSkuToTemplate.set(String(m.vendor_item_id), m.brand_template_id);
      }
      const byItemNumber = new Map<string, any>();
      const byBrandItemId = new Map<string, any>();
      for (const i of (itemsRes.data || []) as any[]) {
        if (i.item_number) byItemNumber.set(String(i.item_number), i);
        if (i.brand_item_id) byBrandItemId.set(String(i.brand_item_id), i);
      }


      let itemsUpdated = 0;
      const now = new Date().toISOString();

      for (const cat of categories) {
        for (const product of cat.products || []) {
          // A PFG division can return several codes for one product
          // (e.g. "104752, EL681") — try each before giving up.
          const codes: string[] = Array.isArray(product.altItemNumbers) && product.altItemNumbers.length
            ? product.altItemNumbers.map((c: unknown) => String(c).trim()).filter(Boolean)
            : product.itemNumber
              ? [String(product.itemNumber).trim()]
              : [];

          let existing: any = null;
          let matchedCode: string | null = null;
          for (const code of codes) {
            const hit = byItemNumber.get(code);
            if (hit) { existing = hit; matchedCode = code; break; }
          }
          if (!existing) {
            for (const code of codes) {
              const tId = pfgSkuToTemplate.get(code);
              const hit = tId ? byBrandItemId.get(tId) : null;
              if (hit) { existing = hit; matchedCode = code; break; }
            }
          }
          if (!existing) continue; // vendor gate — never create locally

          const price = product.price ? Number(product.price) : null;
          const packQuantity = product.packQuantity ? Number(product.packQuantity) : null;

          const { error: upErr } = await supabase
            .from("inventory_items")
            .update({
              cost_per_unit: price,
              pack_size: product.packSize || null,
              pack_quantity: packQuantity,
              item_number: matchedCode || existing.item_number,
              last_synced_at: now,
            })
            .eq("id", existing.id);
          if (!upErr) itemsUpdated++;
        }
      }

      return {
        status: "completed",
        attempts: attempt,
        items_updated: itemsUpdated,
        duration_ms: Date.now() - startedAt,
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.error(
        `[pfg-scheduled-price-sync] ${loc.name} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErr}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        // Backoff + jitter (avoid synchronized retries across the pool)
        const base = BACKOFF_MS[attempt - 1] ?? 15_000;
        await sleep(base + rand(1_000));
      }
    }
  }

  return {
    status: "failed",
    attempts: attempt,
    items_updated: 0,
    duration_ms: Date.now() - startedAt,
    error: lastErr,
  };
}

// Bounded-concurrency worker pool. Each worker grabs the next location off
// the shared queue until drained.
async function runPool<T, R>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
      await sleep(THROTTLE_MIN_MS);
    }
  });
  await Promise.all(runners);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const runStartedAt = new Date().toISOString();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
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

    const results: LocationResult[] = await runPool(
      targets,
      POOL_SIZE,
      async (loc) => {
        const res = await syncOneLocation(supabase, loc);
        const row: LocationResult = {
          location_id: loc.id,
          location_name: loc.name,
          ...res,
        };

        // Write per-location log inside the worker so we don't lose the
        // record if a later location times out the whole function.
        await supabase.from("inventory_sync_logs").insert({
          location_id: loc.id,
          sync_source: "pfg",
          sync_type: "scheduled_price_sync",
          started_at: runStartedAt,
          completed_at: new Date().toISOString(),
          status:
            row.status === "completed"
              ? "completed"
              : row.status === "failed"
                ? "failed"
                : "skipped",
          items_synced: row.items_updated,
          orders_processed: 0,
          errors: row.error
            ? [`${row.error} (after ${row.attempts} attempts)`]
            : [],
        });

        return row;
      },
    );

    const summary = {
      started_at: runStartedAt,
      finished_at: new Date().toISOString(),
      pool_size: POOL_SIZE,
      locations: results.length,
      completed: results.filter((r) => r.status === "completed").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped_fresh: results.filter((r) => r.status === "skipped_fresh").length,
      skipped_config: results.filter((r) => r.status === "skipped_config").length,
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
