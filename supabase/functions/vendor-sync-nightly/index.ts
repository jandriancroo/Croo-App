// VENDOR SYNC — ONE NIGHTLY PIPELINE (approved plan, Sep 1 2026)
//
// Replaces: the 8-hour PFG price scrape, the per-store "pinned list" price walk,
// and the duplicated nightly gap scans.
//
// Shape — one vendor at a time, one store at a time, fixed stages. Each stage is
// its own maintenance_queue task, so a single store failing never kills the run,
// and the existing per-minute queue processor gives us retries for free.
//
//   Stage 1  pfg_masters      bid guide per store → pfg_bid_items
//   Stage 2  pfg_activity     14 days orders, then invoices
//   Stage 3  pa_masters       catalog freshness check (catalog itself is scraped
//                             by the headless GitHub Action → save_catalog)
//   Stage 4  pa_activity      recent PA invoices
//   Stage 5  price_fill       master → order → invoice chain, per item
//   Stage 6  gaps             unseen vendor numbers → vendor_gap_alerts (ONCE)
//   Stage 7  pack_configs     only when this run produced NEW gaps
//   Stage 8  report           unpriced / discontinued / ship-in counts
//
// Locked rules:
//   - Never deactivates an item. Tags only.
//   - Every scan updates pricing. Pack configs only run on new gaps.
//   - Stage gating: a stage refuses to run (and retries) until its predecessor
//     for that vendor is done.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chasePrices, CHASE_SELECT, ACTIVITY_WINDOW_DAYS } from "../_shared/vendorPriceChase.ts";
import { filterEnabledLocations } from "../_shared/inventoryGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Ordered stages. Task type = `vendor_${stage}`. */
const STAGES = [
  { stage: "pfg_masters", vendor: "pfg", perLocation: true },
  { stage: "pfg_activity", vendor: "pfg", perLocation: true },
  { stage: "pa_masters", vendor: "pa", perLocation: false },
  { stage: "pa_activity", vendor: "pa", perLocation: false },
  { stage: "price_fill", vendor: "all", perLocation: true },
  { stage: "gaps", vendor: "all", perLocation: false },
  { stage: "pack_configs", vendor: "all", perLocation: false },
  { stage: "report", vendor: "all", perLocation: false },
] as const;

type StageName = typeof STAGES[number]["stage"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function callFn(path: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return parsed ?? {};
}

async function upsertRun(
  supabase: any,
  row: {
    run_date: string; vendor: string; stage: string; location_id: string | null;
    status: string; [k: string]: unknown;
  },
) {
  const { data: existing } = await supabase
    .from("vendor_sync_runs")
    .select("id")
    .eq("run_date", row.run_date)
    .eq("vendor", row.vendor)
    .eq("stage", row.stage)
    .is("location_id", row.location_id === null ? null : undefined as any)
    .maybeSingle();

  // location-scoped lookup needs an eq, not an is-null
  let id = existing?.id ?? null;
  if (!id && row.location_id) {
    const { data } = await supabase
      .from("vendor_sync_runs")
      .select("id")
      .eq("run_date", row.run_date)
      .eq("vendor", row.vendor)
      .eq("stage", row.stage)
      .eq("location_id", row.location_id)
      .maybeSingle();
    id = data?.id ?? null;
  }

  if (id) {
    await supabase.from("vendor_sync_runs").update(row).eq("id", id);
    return id;
  }
  const { data } = await supabase.from("vendor_sync_runs").insert(row).select("id").maybeSingle();
  return data?.id ?? null;
}

/** True when every run row for the previous stage of this vendor is finished. */
async function predecessorDone(supabase: any, runDate: string, stage: StageName) {
  const idx = STAGES.findIndex((s) => s.stage === stage);
  if (idx <= 0) return true;
  const prev = STAGES[idx - 1];
  const { data } = await supabase
    .from("vendor_sync_runs")
    .select("status")
    .eq("run_date", runDate)
    .eq("stage", prev.stage);
  if (!data || data.length === 0) return false;
  return (data as any[]).every((r) => r.status === "completed" || r.status === "skipped" || r.status === "failed");
}

// ---------------------------------------------------------------------------
// START — build the night's plan and enqueue it
// ---------------------------------------------------------------------------
async function handleStart(supabase: any, body: any) {
  const runDate = body?.runDate || todayLA();

  // Single-flight: if the night already has rows, don't double-enqueue.
  const { data: existingRun } = await supabase
    .from("vendor_sync_runs")
    .select("id")
    .eq("run_date", runDate)
    .limit(1)
    .maybeSingle();
  if (existingRun && body?.force !== true) {
    return json({ skipped: "already_started", run_date: runDate });
  }

  const { data: integrations } = await supabase
    .from("location_integrations")
    .select("location_id, integration_type")
    .in("integration_type", ["pfg", "produce_alliance"])
    .eq("is_active", true);

  const allIds = [...new Set((integrations || []).map((r: any) => r.location_id))];
  const enabled = await filterEnabledLocations(supabase, allIds as string[]);

  const pfgLocs = [...new Set(
    (integrations || [])
      .filter((r: any) => r.integration_type === "pfg" && enabled.has(r.location_id))
      .map((r: any) => r.location_id),
  )];
  const priceLocs = [...new Set(
    (integrations || [])
      .filter((r: any) => enabled.has(r.location_id))
      .map((r: any) => r.location_id),
  )];

  const tasks: { task_type: string; location_id: string | null; target_date: string }[] = [];

  for (const s of STAGES) {
    const locs = !s.perLocation
      ? [null]
      : s.stage.startsWith("pfg_")
        ? pfgLocs
        : priceLocs;
    for (const loc of locs) {
      await upsertRun(supabase, {
        run_date: runDate,
        vendor: s.vendor,
        stage: s.stage,
        location_id: loc as string | null,
        status: "pending",
      });
      tasks.push({ task_type: `vendor_${s.stage}`, location_id: loc as string | null, target_date: runDate });
    }
  }

  // Enqueue in stage order — the queue processor is FIFO on created_at, and each
  // stage additionally refuses to run before its predecessor is done.
  for (const t of tasks) {
    const { error: qErr } = await supabase
      .from("maintenance_queue")
      .insert({ ...t, status: "pending" });
    if (qErr) {
      // A stage that never lands in the queue would stall the whole night, so
      // fail loudly instead of silently dropping it.
      console.error("[vendor-sync-nightly] failed to queue", t.task_type, qErr.message);
      throw new Error(`could not queue ${t.task_type}: ${qErr.message}`);
    }
  }


  return json({
    run_date: runDate,
    pfg_locations: pfgLocs.length,
    price_locations: priceLocs.length,
    tasks_queued: tasks.length,
  });
}

// ---------------------------------------------------------------------------
// STAGE RUNNERS
// ---------------------------------------------------------------------------
async function runStage(supabase: any, stage: StageName, locationId: string | null, runDate: string) {
  const meta = STAGES.find((s) => s.stage === stage)!;

  if (!(await predecessorDone(supabase, runDate, stage))) {
    // Throwing makes the queue retry this task later — that IS the gate.
    throw new Error(`stage ${stage} waiting on predecessor`);
  }

  await upsertRun(supabase, {
    run_date: runDate, vendor: meta.vendor, stage, location_id: locationId,
    status: "running", started_at: new Date().toISOString(), error: null,
  });

  const counters: Record<string, number> = {};
  let detail: Record<string, unknown> = {};

  switch (stage) {
    case "pfg_masters": {
      const res = await callFn("pfg-service?action=scrape_bid_all_locations", { locationId, action: "scrape_bid_all_locations" });
      const r = (res.results || []).find((x: any) => x.locationId === locationId) || res.results?.[0];
      if (r && r.success === false) throw new Error(r.error || "bid scrape failed");
      counters.items_seen = r?.itemsUpserted ?? 0;
      detail = { guidesScraped: r?.guidesScraped ?? 0 };
      break;
    }
    case "pfg_activity": {
      const orders = await callFn("pfg-service?action=sync_orders", {
        action: "sync_orders", locationId, daysBack: ACTIVITY_WINDOW_DAYS,
      });
      const or = (orders.results || []).find((x: any) => x.locationId === locationId);
      if (or && or.success === false) throw new Error(or.error || "sync_orders failed");

      const invoices = await callFn("pfg-service?action=sync_invoices", {
        action: "sync_invoices", locationId, days: ACTIVITY_WINDOW_DAYS,
      });
      const ir = (invoices.results || []).find((x: any) => x.locationId === locationId);
      if (ir && ir.success === false) throw new Error(ir.error || "sync_invoices failed");

      detail = {
        ordersImported: or?.ordersImported ?? 0,
        invoicesUpserted: ir?.invoicesUpserted ?? 0,
        novelInvoices: ir?.novelInvoices ?? 0,
      };
      break;
    }
    case "pa_masters": {
      // The PA catalog is scraped out-of-band by the headless GitHub Action
      // (pa-headless-scraper → save_catalog). Here we only assert freshness so a
      // stale catalog shows up as a run problem instead of silent bad pricing.
      const { data: rows } = await supabase
        .from("pa_catalog_items")
        .select("location_id, last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1);
      const newest = rows?.[0]?.last_seen_at ?? null;
      const ageDays = newest ? Math.floor((Date.now() - new Date(newest).getTime()) / 86_400_000) : null;
      detail = { newest_catalog_seen: newest, age_days: ageDays, source: "headless_scraper" };
      if (ageDays != null && ageDays > 10) {
        detail.warning = "PA catalog is stale — headless scraper may be failing";
      }
      break;
    }
    case "pa_activity": {
      const res = await callFn("produce-alliance-service", { action: "nightly_invoice_sync" });
      detail = { locations: (res.results || []).length };
      break;
    }
    case "price_fill": {
      // Freshness gate. The bid scrape returns before its last writes land, and a
      // chase against a half-written master falsely tags hundreds of items as
      // "needs price". Wait until this store's master is newer than tonight's run.
      const { data: masterRun } = await supabase
        .from("vendor_sync_runs")
        .select("started_at")
        .eq("run_date", runDate)
        .eq("stage", "pfg_masters")
        .eq("location_id", locationId)
        .maybeSingle();
      if (masterRun?.started_at) {
        const { data: newest } = await supabase
          .from("pfg_bid_items")
          .select("last_seen_at")
          .eq("location_id", locationId)
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const seenAt = newest?.last_seen_at ? new Date(newest.last_seen_at).getTime() : 0;
        const quietFor = Date.now() - seenAt;
        if (seenAt < new Date(masterRun.started_at).getTime() || quietFor < 120_000) {
          throw new Error("stage price_fill waiting on predecessor (master still writing)");
        }
      }


      const { data: items } = await supabase
        .from("inventory_items")
        .select(CHASE_SELECT)
        .eq("location_id", locationId)
        .eq("is_active", true);
      const summary = await chasePrices(supabase, locationId!, (items || []) as any[]);
      counters.items_seen = (items || []).length;
      counters.items_priced = summary.priced;
      counters.items_unpriced = summary.unpriced;
      detail = {
        shipIns: summary.shipIns,
        discontinued: summary.discontinued,
        unpricedNames: summary.results.filter((r) => r.unpriced).slice(0, 40).map((r) => r.name),
      };
      break;
    }
    case "gaps": {
      const res = await callFn("vendor-gap-scan", {});
      const newItems = (res.results || []).reduce((s: number, r: any) => s + (r.newItems ?? 0), 0);
      counters.gaps_raised = newItems;
      detail = { brands: (res.results || []).length };
      break;
    }
    case "pack_configs": {
      // ONLY on new gaps. A real vendor pack change arrives as a new item number
      // (pack is part of the SKU), so it always surfaces as a gap first.
      const { data: gapRows } = await supabase
        .from("vendor_sync_runs")
        .select("gaps_raised")
        .eq("run_date", runDate)
        .eq("stage", "gaps");
      const newGaps = (gapRows || []).reduce((s: number, r: any) => s + (r.gaps_raised ?? 0), 0);
      if (newGaps === 0) {
        detail = { skipped: "no_new_gaps" };
        await upsertRun(supabase, {
          run_date: runDate, vendor: meta.vendor, stage, location_id: locationId,
          status: "skipped", completed_at: new Date().toISOString(), detail,
        });
        return { stage, status: "skipped", detail };
      }
      const res = await callFn("pack-config-seeder?dry_run=false", { trigger: "vendor-sync-nightly" });
      counters.pack_configs_queued = res?.proposed ?? res?.inserted ?? 0;
      detail = { newGaps, seeder: res?.run_id ?? null };
      break;
    }
    case "report": {
      const { data: unpriced } = await supabase
        .from("inventory_items")
        .select("location_id, name, unpriced_since, discontinued_at, ship_in_only")
        .not("unpriced_since", "is", null)
        .eq("is_active", true);
      const byLocation: Record<string, number> = {};
      for (const r of (unpriced || []) as any[]) {
        byLocation[r.location_id] = (byLocation[r.location_id] ?? 0) + 1;
      }
      const { data: failures } = await supabase
        .from("vendor_sync_runs")
        .select("stage, location_id, error")
        .eq("run_date", runDate)
        .eq("status", "failed");
      counters.items_unpriced = (unpriced || []).length;
      detail = {
        unpriced_by_location: byLocation,
        newly_discontinued: (unpriced || []).filter((r: any) => r.discontinued_at).length,
        failures: failures || [],
      };
      break;
    }
  }

  await upsertRun(supabase, {
    run_date: runDate, vendor: meta.vendor, stage, location_id: locationId,
    status: "completed", completed_at: new Date().toISOString(), detail, ...counters,
  });

  return { stage, status: "completed", ...counters, detail };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const action = url.searchParams.get("action") || body?.action || "start";

  try {
    if (action === "start") return json(await handleStart(supabase, body));

    if (action === "stage") {
      const stage = (body?.stage || "") as StageName;
      if (!STAGES.some((s) => s.stage === stage)) return json({ error: `unknown stage: ${stage}` }, 400);
      const runDate = body?.runDate || todayLA();
      const locationId = body?.locationId ?? null;
      try {
        return json(await runStage(supabase, stage, locationId, runDate));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const meta = STAGES.find((s) => s.stage === stage)!;
        await upsertRun(supabase, {
          run_date: runDate, vendor: meta.vendor, stage, location_id: locationId,
          status: msg.includes("waiting on predecessor") ? "pending" : "failed",
          error: msg, completed_at: new Date().toISOString(),
        });
        throw e;
      }
    }

    if (action === "status") {
      const runDate = body?.runDate || url.searchParams.get("runDate") || todayLA();
      const { data } = await supabase
        .from("vendor_sync_runs")
        .select("vendor, stage, location_id, status, items_seen, items_priced, items_unpriced, gaps_raised, pack_configs_queued, error")
        .eq("run_date", runDate);
      return json({ run_date: runDate, rows: data || [] });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[vendor-sync-nightly]", action, msg);
    return json({ error: msg }, 500);
  }
});
