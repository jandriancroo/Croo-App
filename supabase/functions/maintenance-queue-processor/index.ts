// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const BATCH_SIZE = 5;
const MAX_RETRIES = 3;
// Stop pulling new work before the edge runtime kills the worker, so the tick
// ends cleanly and the rest of the queue rolls over to the next cron run.
const TIME_BUDGET_MS = 100_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron / service-to-service only.
  const denied = requireInternalCaller(req, corsHeaders);
  if (denied) return denied;



  // Acknowledge the cron tick immediately; drain the queue in the background.
  // Doing the drain inline made long batches exceed the wall-clock limit, which
  // the edge surfaced as a 502 on every scheduled invocation.
  const work = drainQueue();
  // @ts-ignore — EdgeRuntime.waitUntil is available in the Supabase edge runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  }

  return new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function drainQueue() {
  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Grab pending or retryable tasks (oldest first)
    const { data: tasks, error: fetchError } = await supabase
      .from("maintenance_queue")
      .select("*")
      .in("status", ["pending", "error"])
      .lt("retry_count", MAX_RETRIES)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;

    if (!tasks || tasks.length === 0) {
      return;
    }

    console.log(`[QUEUE] Processing ${tasks.length} tasks`);
    const results: { id: string; task_type: string; status: string; error?: string }[] = [];

    for (const task of tasks) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        console.log(`[QUEUE] Time budget reached — deferring ${tasks.length - results.length} task(s) to next tick`);
        break;
      }

      // Mark as processing
      await supabase
        .from("maintenance_queue")
        .update({ status: "processing", started_at: new Date().toISOString() })
        .eq("id", task.id);

      try {
        await processTask(supabase, supabaseUrl, supabaseKey, task);

        await supabase
          .from("maintenance_queue")
          .update({ status: "done", completed_at: new Date().toISOString() })
          .eq("id", task.id);

        results.push({ id: task.id, task_type: task.task_type, status: "done" });
        console.log(`[QUEUE] ✓ ${task.task_type} for location ${task.location_id}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const newRetry = (task.retry_count || 0) + 1;

        await supabase
          .from("maintenance_queue")
          .update({
            status: newRetry >= MAX_RETRIES ? "error" : "pending",
            error_message: errorMsg,
            retry_count: newRetry,
            started_at: null,
          })
          .eq("id", task.id);

        results.push({ id: task.id, task_type: task.task_type, status: "error", error: errorMsg });
        console.error(`[QUEUE] ✗ ${task.task_type} for location ${task.location_id}: ${errorMsg}`);

        // If PFG token refresh permanently failed, auto-create a support ticket
        if (task.task_type === "refresh_pfg_token" && newRetry >= MAX_RETRIES) {
          await createSystemSupportTicket(supabase, supabaseUrl, supabaseKey, task.location_id, errorMsg);
        }
      }
    }

    console.log(`[QUEUE] Done: processed ${results.length}`);
  } catch (error) {
    console.error("[QUEUE] Fatal error:", error);
  }
}

// ============================================================================
// TASK ROUTER
// ============================================================================
async function processTask(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string,
  task: any
) {
  switch (task.task_type) {
    case "daily_summary":
      return await processDailySummary(supabaseUrl, supabaseKey, task);
    case "backfill_labor":
      return await processBackfillLabor(supabaseUrl, supabaseKey, task);
    case "weekly_summary":
      return await processWeeklySummary(supabaseUrl, supabaseKey, task);
    case "refresh_pfg_token":
      return await processRefreshPfgToken(supabaseUrl, supabaseKey, task);
    case "sync_pfg_orders":
      return await processSyncPfgOrders(supabaseUrl, supabaseKey, task);
    case "sync_pfg_invoices":
      return await processSyncPfgInvoices(supabaseUrl, supabaseKey, task);
    case "labor_intelligence":
      return await processLaborIntelligence(supabaseUrl, supabaseKey, task);
    case "backfill_sales":
      return await processBackfillSales(supabase, supabaseUrl, supabaseKey, task);
    case "backfill_clover_sales":
      return await processBackfillCloverSales(supabase, supabaseUrl, supabaseKey, task);
    case "backfill_aloha_sales":
      return await processBackfillAlohaSales(supabase, supabaseUrl, supabaseKey, task);
    case "opus_bulk_extract":
      return await processOpusBulkExtract(supabaseUrl, supabaseKey, task);
    default:
      throw new Error(`Unknown task type: ${task.task_type}`);
  }
}


// ============================================================================
// DAILY SUMMARY — calls support-email-service
// ============================================================================
async function processDailySummary(supabaseUrl: string, supabaseKey: string, task: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/support-email-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({
      action: "send_daily_logbook_summary",
      payload: { location_id: task.location_id, entry_date: task.target_date },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result;
}

// ============================================================================
// BACKFILL LABOR — calls labor-service
// ============================================================================
async function processBackfillLabor(supabaseUrl: string, supabaseKey: string, task: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/labor-service?action=backfill`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({
      locationId: task.location_id,
      startDate: task.target_date,
      endDate: task.target_date,
      forceRefresh: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return await response.json();
}

// ============================================================================
// WEEKLY SUMMARY — calls maintenance-service generate-weekly-summary
// ============================================================================
async function processWeeklySummary(supabaseUrl: string, supabaseKey: string, task: any) {
  // target_date is Sunday (yesterday when queued on Monday) = week_end.
  // week_start is the Monday 6 days earlier — same window the weekly email uses.
  const weekEnd = new Date(task.target_date + "T12:00:00");
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekStartStr = fmt(weekStart);
  const weekEndStr = fmt(weekEnd);


  const response = await fetch(`${supabaseUrl}/functions/v1/maintenance-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({
      action: "generate-weekly-summary",
      payload: {
        location_id: task.location_id,
        week_start: weekStartStr,
        week_end: weekEndStr,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return await response.json();
}

// ============================================================================
// REFRESH PFG TOKEN — calls pfg-service keep-alive
// ============================================================================
async function processRefreshPfgToken(supabaseUrl: string, supabaseKey: string, task: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/pfg-service?action=refresh_keep_alive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({ locationId: task.location_id }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }

  // Check response body for silent failures
  if (result.success === false || (result.failed && result.failed > 0)) {
    const detail = result.error || result.message || JSON.stringify(result).slice(0, 300);
    console.error(`[QUEUE] PFG refresh returned success:false for location ${task.location_id}: ${detail}`);
    throw new Error(`PFG refresh failed (response body): ${detail}`);
  }

  console.log(`[QUEUE] PFG refresh OK for location ${task.location_id}:`, 
    result.grantIssued ? `grant issued=${result.grantIssued}, expires=${result.grantExpiration}` : 'token refreshed');

  return result;
}

// ============================================================================
// SYNC PFG ORDERS — calls pfg-service action=sync_orders for one location.
// Same handler the manual sync button uses; writes cost_per_unit back to
// inventory_items inside the vendor-gap-detection block (pfg-service:~2689).
// ============================================================================
async function processSyncPfgOrders(supabaseUrl: string, supabaseKey: string, task: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/pfg-service?action=sync_orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({ locationId: task.location_id, daysBack: 14 }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  let result;
  try { result = JSON.parse(text); } catch { throw new Error(`Invalid JSON: ${text.slice(0, 200)}`); }
  const locResult = (result.results ?? []).find((r: any) => r.locationId === task.location_id);
  if (locResult && locResult.success === false) {
    throw new Error(`sync_orders failed: ${locResult.error || 'unknown'}`);
  }
  console.log(`[QUEUE] PFG sync_orders OK for ${task.location_id}: imported=${locResult?.ordersImported ?? 0}`);
  return result;
}

// ============================================================================
// SYNC PFG INVOICES — calls pfg-service action=sync_invoices for one location.
// Reads pfg_orders.raw_data.Invoices[] (no GetDeliveries call), fetches
// GetInvoiceDetails per invoice, upserts pfg_invoices with novelty diff.
// Depends on sync_pfg_orders having run first (FIFO via created_at offset).
// ============================================================================
async function processSyncPfgInvoices(supabaseUrl: string, supabaseKey: string, task: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/pfg-service?action=sync_invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({ locationId: task.location_id, days: 3 }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  let result;
  try { result = JSON.parse(text); } catch { throw new Error(`Invalid JSON: ${text.slice(0, 200)}`); }
  const locResult = (result.results ?? []).find((r: any) => r.locationId === task.location_id);
  if (locResult && locResult.success === false) {
    throw new Error(`sync_invoices failed: ${locResult.error || 'unknown'}`);
  }
  console.log(
    `[QUEUE] PFG sync_invoices OK for ${task.location_id}: processed=${locResult?.invoicesProcessed ?? 0}, upserted=${locResult?.invoicesUpserted ?? 0}, novel=${locResult?.novelInvoices ?? 0}`,
  );
  return result;
}

// ============================================================================
// LABOR INTELLIGENCE — calls labor-intelligence edge function
// ============================================================================
async function processLaborIntelligence(supabaseUrl: string, supabaseKey: string, task: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/labor-intelligence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({
      action: "analyze",
      location_id: task.location_id,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result;
}

// ============================================================================
// AUTO-CREATE SUPPORT TICKET ON PERMANENT PFG FAILURE
// ============================================================================
async function createSystemSupportTicket(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string,
  locationId: string,
  errorMsg: string
) {
  try {
    // Get location name
    const { data: location } = await supabase
      .from("locations")
      .select("name")
      .eq("id", locationId)
      .single();

    const locationName = location?.name || "Unknown";

    // Find the super_admin to assign the ticket to
    const { data: superAdmin } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "super_admin")
      .limit(1)
      .single();

    if (!superAdmin?.user_id) {
      console.error(`[QUEUE] Cannot create support ticket - no super_admin found`);
      return;
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        user_id: superAdmin.user_id,
        category: "data_sync_issues",
        description: `${locationName} - System Alert: PFG integration token has expired and could not be refreshed after ${MAX_RETRIES} attempts. A manager needs to re-authenticate PFG in Settings → Integrations.\n\nError: ${errorMsg}`,
        occurrence_time: new Date().toISOString(),
        is_system: true,
      })
      .select("id, ticket_number")
      .single();

    if (ticketError) {
      console.error(`[QUEUE] Failed to create support ticket:`, ticketError.message);
    } else {
      console.log(`[QUEUE] ⚠️ Auto-created support ticket #SUP-${String(ticket.ticket_number).padStart(3, "0")} for PFG failure at ${locationName}`);

      // Send email notification about the new ticket
      try {
        await fetch(`${supabaseUrl}/functions/v1/support-email-service`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
          body: JSON.stringify({
            action: "support_ticket",
            payload: { ticket_id: ticket.id, event_type: "new_ticket" },
          }),
        });
      } catch (emailErr) {
        console.error(`[QUEUE] Failed to send ticket email notification:`, emailErr);
      }
    }
  } catch (err) {
    console.error(`[QUEUE] Error creating support ticket:`, err);
  }
}

// ============================================================================
// BACKFILL SALES — calls sales-service sync-dates in 7-day batches
// target_date = the END date for this batch (work backward 7 days from it)
// Auto-queues next batch until 371 days (53 weeks) are covered
// ============================================================================
const BACKFILL_BATCH_DAYS = 7;
const BACKFILL_TOTAL_DAYS = 371; // 53 weeks for full YOY projection coverage

async function processBackfillSales(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string,
  task: any
) {
  const locationId = task.location_id;
  const batchEndDate = new Date(task.target_date + "T12:00:00Z");

  // Generate 7 dates ending at target_date, going backward
  const dates: string[] = [];
  for (let i = 0; i < BACKFILL_BATCH_DAYS; i++) {
    const d = new Date(batchEndDate);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  console.log(`[QUEUE] backfill_sales: ${locationId} batch ending ${task.target_date}, ${dates.length} dates`);

  // Call sync-dates (caps at 30 per call, we send 7)
  const response = await fetch(`${supabaseUrl}/functions/v1/sales-service?action=sync-dates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({ locationId, dates }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const result = await response.json();
  console.log(`[QUEUE] backfill_sales batch done: ${result.synced || 0}/${result.total || 0} days synced`);

  // Calculate how many days back we've now gone from today
  const today = new Date();
  const oldestDateInBatch = new Date(batchEndDate);
  oldestDateInBatch.setDate(oldestDateInBatch.getDate() - (BACKFILL_BATCH_DAYS - 1));
  const daysCovered = Math.floor((today.getTime() - oldestDateInBatch.getTime()) / (1000 * 60 * 60 * 24));

  if (daysCovered < BACKFILL_TOTAL_DAYS) {
    // Queue next batch — start from where this batch ended
    const nextEndDate = new Date(oldestDateInBatch);
    nextEndDate.setDate(nextEndDate.getDate() - 1);
    const nextDateStr = nextEndDate.toISOString().slice(0, 10);

    const { error: queueError } = await supabase
      .from("maintenance_queue")
      .insert({
        task_type: "backfill_sales",
        location_id: locationId,
        target_date: nextDateStr,
        status: "pending",
      });

    if (queueError) {
      console.error(`[QUEUE] Failed to queue next backfill batch:`, queueError);
    } else {
      console.log(`[QUEUE] Queued next backfill batch for ${locationId} ending ${nextDateStr} (${daysCovered}/${BACKFILL_TOTAL_DAYS} days covered)`);
    }
  } else {
    console.log(`[QUEUE] ✓ Backfill complete for ${locationId}: ${daysCovered} days covered`);
  }

  return result;
}

// ============================================================================
// OPUS BULK EXTRACT — calls opus-service bulk_extract
// ============================================================================
async function processOpusBulkExtract(supabaseUrl: string, supabaseKey: string, task: any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/opus-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({
      action: "bulk_extract",
      location_id: task.location_id,
      batch_size: 5,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const result = await response.json();
  
  // If there are still remaining items, queue another batch
  if (result.remaining > 0) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from("maintenance_queue").insert({
      task_type: "opus_bulk_extract",
      location_id: task.location_id,
      status: "pending",
    });
    console.log(`[QUEUE] Queued next opus_bulk_extract batch for ${task.location_id}, ${result.remaining} remaining`);
  }

  if (result.error) throw new Error(result.error);
  return result;
}

// ============================================================================
// BACKFILL CLOVER SALES — calls clover-sync sync_dates (Playa Bowls only)
// Mirrors processBackfillSales but routes to the Clover mailroom path.
// ============================================================================
async function processBackfillCloverSales(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string,
  task: any
) {
  const locationId = task.location_id;
  const batchEndDate = new Date(task.target_date + "T12:00:00Z");

  const dates: string[] = [];
  for (let i = 0; i < BACKFILL_BATCH_DAYS; i++) {
    const d = new Date(batchEndDate);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  console.log(`[QUEUE] backfill_clover_sales: ${locationId} batch ending ${task.target_date}, ${dates.length} dates`);

  const response = await fetch(`${supabaseUrl}/functions/v1/clover-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({ action: "sync_dates", locationId, dates }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const result = await response.json();
  const synced = Array.isArray(result?.results) ? result.results.filter((r: any) => !r.error).length : 0;
  console.log(`[QUEUE] backfill_clover_sales batch done: ${synced}/${dates.length} days synced`);

  const today = new Date();
  const oldestDateInBatch = new Date(batchEndDate);
  oldestDateInBatch.setDate(oldestDateInBatch.getDate() - (BACKFILL_BATCH_DAYS - 1));
  const daysCovered = Math.floor((today.getTime() - oldestDateInBatch.getTime()) / (1000 * 60 * 60 * 24));

  if (daysCovered < BACKFILL_TOTAL_DAYS) {
    const nextEndDate = new Date(oldestDateInBatch);
    nextEndDate.setDate(nextEndDate.getDate() - 1);
    const nextDateStr = nextEndDate.toISOString().slice(0, 10);

    const { error: queueError } = await supabase
      .from("maintenance_queue")
      .insert({
        task_type: "backfill_clover_sales",
        location_id: locationId,
        target_date: nextDateStr,
        status: "pending",
      });

    if (queueError) {
      console.error(`[QUEUE] Failed to queue next clover backfill batch:`, queueError);
    } else {
      console.log(`[QUEUE] Queued next clover backfill batch for ${locationId} ending ${nextDateStr} (${daysCovered}/${BACKFILL_TOTAL_DAYS} days covered)`);
    }
  } else {
    console.log(`[QUEUE] ✓ Clover backfill complete for ${locationId}: ${daysCovered} days covered`);
  }

  return { synced, total: dates.length, dates };
}

// ============================================================================
// BACKFILL ALOHA SALES — calls aloha-sync sync_dates (BWW GO only)
// Mirrors processBackfillCloverSales but routes to the Aloha mailroom path.
// ============================================================================
async function processBackfillAlohaSales(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string,
  task: any
) {
  const locationId = task.location_id;
  const batchEndDate = new Date(task.target_date + "T12:00:00Z");

  const dates: string[] = [];
  for (let i = 0; i < BACKFILL_BATCH_DAYS; i++) {
    const d = new Date(batchEndDate);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  console.log(`[QUEUE] backfill_aloha_sales: ${locationId} batch ending ${task.target_date}, ${dates.length} dates`);

  const response = await fetch(`${supabaseUrl}/functions/v1/aloha-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
    body: JSON.stringify({ action: "sync_dates", locationId, dates }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const result = await response.json();
  const synced = Array.isArray(result?.results) ? result.results.filter((r: any) => !r.error).length : 0;
  console.log(`[QUEUE] backfill_aloha_sales batch done: ${synced}/${dates.length} days synced`);

  const today = new Date();
  const oldestDateInBatch = new Date(batchEndDate);
  oldestDateInBatch.setDate(oldestDateInBatch.getDate() - (BACKFILL_BATCH_DAYS - 1));
  const daysCovered = Math.floor((today.getTime() - oldestDateInBatch.getTime()) / (1000 * 60 * 60 * 24));

  if (daysCovered < BACKFILL_TOTAL_DAYS) {
    const nextEndDate = new Date(oldestDateInBatch);
    nextEndDate.setDate(nextEndDate.getDate() - 1);
    const nextDateStr = nextEndDate.toISOString().slice(0, 10);

    const { error: queueError } = await supabase
      .from("maintenance_queue")
      .insert({
        task_type: "backfill_aloha_sales",
        location_id: locationId,
        target_date: nextDateStr,
        status: "pending",
      });

    if (queueError) {
      console.error(`[QUEUE] Failed to queue next aloha backfill batch:`, queueError);
    } else {
      console.log(`[QUEUE] Queued next aloha backfill batch for ${locationId} ending ${nextDateStr} (${daysCovered}/${BACKFILL_TOTAL_DAYS} days covered)`);
    }
  } else {
    console.log(`[QUEUE] ✓ Aloha backfill complete for ${locationId}: ${daysCovered} days covered`);
  }

  return { synced, total: dates.length, dates };
}
