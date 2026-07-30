// One-shot backfill: fill NULL inner_pack_quantity_at_count on submitted/locked
// inventory_count_items rows using the lens's inner_qty (approved
// brand_pack_configs). Heals the writer omission that inflated valuations
// (e.g. Palm Springs May 2026 by ~$190k) without ever touching pq, cost,
// quantity, or entered_* fields.
//
// Identity that makes this universally safe:
//   pq_snap × ipq_snap = lens.outer_qty × lens.inner_qty = lens.count_units_per_case
//   - 3-tier rows already store pq_snap = outer_qty → ipq=inner_qty completes the case
//   - flat-case rows store pq_snap = 1            → ipq=inner_qty completes the case
//
// Dry-run: ?dry_run=true → returns counts + per-location breakdown, writes nothing.
// Live:    no query param → updates + logs to snapshot_backfill_log
//                                     source = 'inner_pack_qty_backfill_2026_06'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireInternalCaller } from "../_shared/callerAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Internal-only endpoint (cron / service invokes).
  const denied = requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // 1. Lens map: brand_template_id → inner_qty (approved + positive only)
    const { data: lensRows, error: lensErr } = await supabase
      .from("brand_pack_configs")
      .select("brand_template_id, inner_qty")
      .eq("status", "approved")
      .gt("inner_qty", 0);
    if (lensErr) throw lensErr;
    const lensMap = new Map<string, number>();
    for (const r of lensRows ?? []) {
      if (r.brand_template_id && r.inner_qty != null) {
        lensMap.set(r.brand_template_id, Number(r.inner_qty));
      }
    }

    // 2. Completed counts (= not in_progress)
    const { data: completedCounts, error: countsErr } = await supabase
      .from("inventory_counts")
      .select("id, location_id")
      .neq("status", "in_progress");
    if (countsErr) throw countsErr;
    const countIds = (completedCounts ?? []).map((c) => c.id);
    const countLocMap = new Map<string, string>(
      (completedCounts ?? []).map((c) => [c.id, c.location_id]),
    );
    if (countIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, dry_run: dryRun, eligible: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Paginate NULL-ipq rows on those counts, with item.brand_item_id joined in
    const eligible: Array<{
      id: string;
      count_id: string;
      item_id: string;
      new_ipq: number;
      location_id: string;
    }> = [];
    const pageSize = 1000;
    // Pull eligible rows in chunks of countIds to keep .in() lists small
    for (let i = 0; i < countIds.length; i += 50) {
      const idSlice = countIds.slice(i, i + 50);
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("inventory_count_items")
          .select(
            "id, count_id, item_id, quantity, entered_inner_packs, inventory_items!inner(brand_item_id)",
          )
          .in("count_id", idSlice)
          .is("inner_pack_quantity_at_count", null)
          .or("entered_inner_packs.gt.0,quantity.gt.0")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data as any[]) {
          const bid = row.inventory_items?.brand_item_id;
          if (!bid) continue;
          const ipq = lensMap.get(bid);
          if (ipq == null || !(ipq > 0)) continue;
          eligible.push({
            id: row.id,
            count_id: row.count_id,
            item_id: row.item_id,
            new_ipq: ipq,
            location_id: countLocMap.get(row.count_id) ?? "unknown",
          });
        }
        if (data.length < pageSize) break;
      }
    }

    // 4. Per-location summary (always returned)
    const perLocation: Record<string, number> = {};
    for (const e of eligible) {
      perLocation[e.location_id] = (perLocation[e.location_id] ?? 0) + 1;
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: true,
          eligible: eligible.length,
          per_location: perLocation,
          sample: eligible.slice(0, 10),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 5. Live writes — one row at a time, log every change.
    let updated = 0;
    let failed = 0;
    for (const row of eligible) {
      const { error: upErr } = await supabase
        .from("inventory_count_items")
        .update({ inner_pack_quantity_at_count: row.new_ipq })
        .eq("id", row.id)
        .is("inner_pack_quantity_at_count", null); // double-guard: never overwrite
      if (upErr) {
        failed++;
        console.error("ipq update failed", row.id, upErr.message);
        continue;
      }
      await supabase.from("snapshot_backfill_log").insert({
        count_id: row.count_id,
        item_id: row.item_id,
        location_id: row.location_id,
        old_pack_qty: null,
        new_pack_qty: null,
        old_cost: null,
        new_cost: null,
        source: "inner_pack_backfill_systemwide_2026_06_01",
      });
      updated++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: false,
        eligible: eligible.length,
        updated,
        failed,
        per_location: perLocation,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("inner-pack-backfill error", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
