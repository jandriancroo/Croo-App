import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 5;
const MAX_RETRIES = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[QUEUE] Processing ${tasks.length} tasks`);
    const results: { id: string; task_type: string; status: string; error?: string }[] = [];

    for (const task of tasks) {
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

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[QUEUE] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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
    case "labor_intelligence":
      return await processLaborIntelligence(supabaseUrl, supabaseKey, task);
    case "backfill_sales":
      return await processBackfillSales(supabase, supabaseUrl, supabaseKey, task);
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
  // Calculate week start/end from target_date (which is yesterday = Sunday)
  const targetDate = new Date(task.target_date + "T12:00:00");
  const dayOfWeek = targetDate.getDay();
  
  // Find the Monday of the previous week
  const weekStart = new Date(targetDate);
  weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7) - 7); // Previous Monday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6); // Previous Sunday

  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

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
