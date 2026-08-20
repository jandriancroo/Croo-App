// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// ============================================================================
// CONSOLIDATED MAINTENANCE SERVICE
// Actions: nightly, cleanup-images, backfill-photo-completions, 
//          backfill-alle-photos, backfill-croo-cash
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Service role / CRON_SECRET, or an admin-level signed-in user.
  const denied = await requireAuthorizedCaller(req, corsHeaders, { minRole: "admin" });
  if (denied) return denied;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse action from URL or body
    const url = new URL(req.url);
    let action = url.searchParams.get("action") || "nightly";
    let payload: Record<string, any> = {};

    try {
      const body = await req.json();
      action = body.action || action;
      payload = body.payload || body;
    } catch {
      // No body or invalid JSON
    }

    console.log(`[MAINTENANCE-SERVICE] Action: ${action}`);

    switch (action) {
      case "nightly":
        return await handleNightlyMaintenance(supabase, supabaseUrl, supabaseKey);
      
      case "cleanup-images":
        return await handleCleanupImages(supabase, supabaseUrl, payload);

      case "archive-checklist-photos":
        return await handleArchiveChecklistPhotos(supabase, supabaseUrl, payload);

      case "retention-janitor":
        return await handleRetentionJanitor(supabase, payload);
      
      case "backfill-photo-completions":
        return await handleBackfillPhotoCompletions(supabase);
      
      case "backfill-alle-photos":
        return await handleBackfillAllePhotos(supabase, payload);
      
      case "backfill-croo-cash":
        // Validate cron secret for this action
        const cronSecret = req.headers.get("x-cron-secret");
        const expectedSecret = Deno.env.get("CRON_SECRET");
        if (!expectedSecret || cronSecret !== expectedSecret) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return await handleBackfillCrooCash(supabase);
      
      case "generate-weekly-summary":
        return await handleGenerateWeeklySummary(supabase, supabaseUrl, supabaseKey, payload);
      
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("[MAINTENANCE-SERVICE] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================================
// NIGHTLY MAINTENANCE (runs at 3 AM PST daily)
// ============================================================================
async function handleNightlyMaintenance(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string
) {
  console.log("[NIGHTLY] Starting nightly maintenance tasks...");
  const results: { task: string; status: string; details?: any }[] = [];

  const yesterday = getYesterdayInLA();
  const currentDayOfWeek = getCurrentDayOfWeekInLA();
  const runDate = getTodayInLA();
  console.log(`[NIGHTLY] Yesterday (LA): ${yesterday}, Current day: ${currentDayOfWeek}, Run date: ${runDate}`);

  // Load already-completed tasks for this run date (resumability)
  const { data: completedTasks } = await supabase
    .from("maintenance_task_logs")
    .select("task_name")
    .eq("run_date", runDate)
    .eq("status", "success");

  const completedSet = new Set((completedTasks || []).map((t: any) => t.task_name));
  console.log(`[NIGHTLY] Already completed: ${completedSet.size} tasks (${[...completedSet].join(", ") || "none"})`);

  // Get all active locations
  const { data: allLocations } = await supabase
    .from("locations")
    .select("id, name")
    .eq("is_active", true);

  console.log(`[NIGHTLY] Found ${allLocations?.length || 0} active locations`);

  // Task 1: Refresh stale labor cache
  results.push(await runResumableTask(supabase, runDate, completedSet, "refresh-stale-labor", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/labor-service?action=refresh-stale`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    return { refreshed: result.refreshed, locations: result.locations?.length || 0 };
  }));

  // Task 2: Validate recent labor cache
  results.push(await runResumableTask(supabase, runDate, completedSet, "validate-labor-cache", async () => {
    const { data: discrepancies } = await supabase
      .from("labor_cache")
      .select("id, location_id, labor_date, labor_hours, employee_breakdown")
      .eq("source", "punch_clock")
      .gte("labor_date", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .not("employee_breakdown", "is", null);

    let fixedCount = 0;
    const locationsToRefresh = new Set<string>();

    for (const record of discrepancies || []) {
      const breakdown = record.employee_breakdown as any[];
      if (!Array.isArray(breakdown)) continue;
      const breakdownSum = breakdown.reduce((sum, e) => sum + (e.hours || 0), 0);
      if (Math.abs(record.labor_hours - breakdownSum) > 0.01) {
        locationsToRefresh.add(record.location_id);
        await supabase.from("labor_cache").update({ is_stale: true }).eq("id", record.id);
        fixedCount++;
      }
    }

    if (locationsToRefresh.size > 0) {
      await fetch(`${supabaseUrl}/functions/v1/labor-service?action=refresh-stale`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({}),
      });
    }

    return { checked: discrepancies?.length || 0, discrepancies: fixedCount };
  }));

  // Task 3: Auto-punch forgotten clock-outs
  results.push(await runResumableTask(supabase, runDate, completedSet, "auto-punch-out", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/auto-punch-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    return { punched: result.punched || 0, skipped: result.skipped || 0 };
  }));

  // Task 4: Backfill yesterday's labor
  results.push(await runResumableTask(supabase, runDate, completedSet, "backfill-yesterday", async () => {
    const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let backfilledCount = 0;

    for (const location of allLocations || []) {
      const { data: existing } = await supabase
        .from("labor_cache")
        .select("id, is_stale")
        .eq("location_id", location.id)
        .eq("labor_date", yesterdayStr)
        .eq("source", "punch_clock")
        .maybeSingle();

      if (!existing || existing.is_stale) {
        const response = await fetch(`${supabaseUrl}/functions/v1/labor-service?action=backfill`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
          body: JSON.stringify({
            locationId: location.id,
            startDate: yesterdayStr,
            endDate: yesterdayStr,
            forceRefresh: true,
          }),
        });
        if (response.ok) backfilledCount++;
      }
    }

    return { locations: allLocations?.length || 0, backfilled: backfilledCount };
  }));

  // Task 5: Sync yesterday's sales (product_mix, payments, YOY)
  results.push(await runResumableTask(supabase, runDate, completedSet, "sync-yesterday-sales", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/sales-service?action=sync-yesterday`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    return { synced: result.synced || 0, results: result.results?.length || 0 };
  }));

  // Task 6: Send daily logbook summaries
  results.push(await runResumableTask(supabase, runDate, completedSet, "daily-logbook-summaries", async () => {
    let sentCount = 0, skippedCount = 0;

    for (const location of allLocations || []) {
      const { data: existingLog } = await supabase
        .from("daily_summary_logs")
        .select("id")
        .eq("location_id", location.id)
        .eq("summary_date", yesterday)
        .maybeSingle();

      if (existingLog) {
        skippedCount++;
        continue;
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/support-email-service`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({
          action: "send_daily_logbook_summary",
          payload: { location_id: location.id, entry_date: yesterday },
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) sentCount++;
        else skippedCount++;
      } else {
        skippedCount++;
      }
    }

    return { sent: sentCount, skipped: skippedCount };
  }));

  // Task 6: Weekly schedule emails (Monday only)
  results.push(await runResumableTask(supabase, runDate, completedSet, "weekly-schedule-emails", async () => {
    if (currentDayOfWeek !== 1) {
      return { status: "skipped", reason: "not Monday", currentDayOfWeek };
    }

    let sentLocations = 0;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    for (const location of allLocations || []) {
      const { data: schedule } = await supabase
        .from("schedules")
        .select("id")
        .eq("location_id", location.id)
        .lte("week_start_date", today)
        .gte("week_end_date", today)
        .maybeSingle();

      if (!schedule) continue;

      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/maintenance-service`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
          body: JSON.stringify({
            action: "generate-weekly-summary",
            payload: { schedule_id: schedule.id, location_id: location.id },
          }),
        });

        if (response.ok) sentLocations++;
        else console.error(`[NIGHTLY] Weekly summary failed for ${location.name}: HTTP ${response.status}`);
      } catch (e) {
        console.error(`[NIGHTLY] Weekly summary error for ${location.name}:`, e);
      }
    }

    return { locations: sentLocations, day: "Monday" };
  }));

  // Task 7: Generate Labor Intelligence insights
  results.push(await runResumableTask(supabase, runDate, completedSet, "labor-intelligence", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/labor-intelligence?action=analyze-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    return { analyzed: result.analyzed || 0, skipped: result.skipped || 0 };
  }));

  // Task 9: Retention janitor — prune stale rows across 6 tables
  results.push(await runResumableTask(supabase, runDate, completedSet, "retention-janitor", async () => {
    const prunes: Record<string, number> = {};
    const tasks: Array<[string, string, number]> = [
      ["alert_queue", "prune_alert_queue", 30],
      ["email_queue", "prune_email_queue", 30],
      ["inventory_count_audit_log", "prune_inventory_count_audit_log", 90],
      ["pfg_refresh_audit", "prune_pfg_refresh_audit", 30],
      ["punch_clock_attempts", "prune_punch_clock_attempts", 7],
      ["checklist_notification_logs", "prune_checklist_notification_logs", 30],
    ];
    for (const [name, fn, days] of tasks) {
      const { data, error } = await supabase.rpc(fn, { days_to_keep: days });
      if (error) {
        prunes[name] = -1;
        console.error(`[RETENTION] ${fn} failed:`, error.message);
      } else {
        prunes[name] = data ?? 0;
      }
    }
    return prunes;
  }));

  // Task 10: Archive checklist photos (thumbnail at 180d, delete at 366d)
  results.push(await runResumableTask(supabase, runDate, completedSet, "archive-checklist-photos", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/maintenance-service?action=archive-checklist-photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({ batchLimit: 200 }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    return { thumbnailed: result.thumbnailed || 0, deleted: result.deleted || 0, savedMB: result.savedMB || 0 };
  }));

  const completedCount = results.filter(r => r.status === "success").length;
  const skippedCount = results.filter(r => r.status === "skipped_already_done").length;
  const errorCount = results.filter(r => r.status === "error").length;
  console.log(`[NIGHTLY] Complete! ${completedCount} ran, ${skippedCount} already done, ${errorCount} errors`);

  return new Response(
    JSON.stringify({ success: true, results, resumable: true, timestamp: new Date().toISOString() }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// CLEANUP CHECKLIST IMAGES
// ============================================================================
async function handleCleanupImages(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  options: Record<string, any>
) {
  const mode = options.mode || "process";
  const dryRun = options.dryRun !== false;
  const limit = Math.min(options.limit || 10, 50);
  const minSizeKb = options.minSizeKb || 500;

  console.log(`[CLEANUP] Mode: ${mode}, dryRun: ${dryRun}, limit: ${limit}, minSizeKb: ${minSizeKb}`);

  // Collect all image files
  const allFiles: { path: string; size: number }[] = [];
  let folderOffset = 0;

  while (true) {
    const { data: folders, error } = await supabase.storage
      .from("checklist-images")
      .list("", { limit: 100, offset: folderOffset });

    if (error || !folders || folders.length === 0) break;

    for (const folder of folders) {
      if (folder.metadata) continue;

      let fileOffset = 0;
      while (true) {
        const { data: files } = await supabase.storage
          .from("checklist-images")
          .list(folder.name, { limit: 1000, offset: fileOffset });

        if (!files || files.length === 0) break;

        for (const file of files) {
          if (file.metadata) {
            const size = (file.metadata as any).size || 0;
            const mimetype = (file.metadata as any).mimetype || "";
            if (mimetype.startsWith("image/")) {
              allFiles.push({ path: `${folder.name}/${file.name}`, size });
            }
          }
        }

        if (files.length < 1000) break;
        fileOffset += 1000;
      }
    }

    if (folders.length < 100) break;
    folderOffset += 100;
  }

  console.log(`[CLEANUP] Found ${allFiles.length} total image files`);

  // COUNT MODE
  if (mode === "count") {
    const thresholds = [500, 600, 700, 1000, 2000, 3000];
    const counts: Record<string, number> = {};
    const totalSizes: Record<string, number> = {};

    for (const threshold of thresholds) {
      const matching = allFiles.filter((f) => f.size > threshold * 1024);
      counts[`>${threshold}KB`] = matching.length;
      totalSizes[`>${threshold}KB_MB`] = Math.round(matching.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024);
    }

    return new Response(
      JSON.stringify({
        totalFiles: allFiles.length,
        totalStorageMB: Math.round(allFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024),
        counts,
        totalSizes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // PROCESS MODE
  const filesToProcess = allFiles
    .filter((f) => f.size > minSizeKb * 1024)
    .sort((a, b) => b.size - a.size)
    .slice(0, limit);

  const results: { file: string; originalSize: number; newSize?: number; status: string }[] = [];
  let totalSaved = 0;

  for (const file of filesToProcess) {
    if (dryRun) {
      const estimatedNewSize = Math.min(file.size * 0.1, 350 * 1024);
      results.push({
        file: file.path,
        originalSize: file.size,
        newSize: Math.round(estimatedNewSize),
        status: "would_compress",
      });
      continue;
    }

    try {
      const { data: transformedData, error } = await supabase.storage
        .from("checklist-images")
        .download(file.path, { transform: { width: 1200, quality: 75, format: "origin" } });

      if (error || !transformedData) {
        results.push({ file: file.path, originalSize: file.size, status: `transform_failed` });
        continue;
      }

      const newSize = transformedData.size;
      const savings = ((file.size - newSize) / file.size) * 100;

      if (savings < 20) {
        results.push({ file: file.path, originalSize: file.size, newSize, status: "skipped_already_optimized" });
        continue;
      }

      await supabase.storage.from("checklist-images").remove([file.path]);

      const newPath = file.path.replace(/\.(png|jpeg|jpg)$/i, ".jpg");
      await supabase.storage.from("checklist-images").upload(newPath, transformedData, {
        contentType: "image/jpeg",
        upsert: true,
      });

      if (newPath !== file.path) {
        const oldUrl = `${supabaseUrl}/storage/v1/object/public/checklist-images/${file.path}`;
        const newUrl = `${supabaseUrl}/storage/v1/object/public/checklist-images/${newPath}`;
        await supabase.from("checklist_responses").update({ response_image_url: newUrl }).eq("response_image_url", oldUrl);
      }

      totalSaved += file.size - newSize;
      results.push({ file: file.path, originalSize: file.size, newSize, status: "compressed" });
    } catch (err) {
      results.push({ file: file.path, originalSize: file.size, status: `error: ${err}` });
    }
  }

  return new Response(
    JSON.stringify({
      summary: {
        dryRun,
        filesProcessed: results.length,
        totalSavedMB: (totalSaved / 1024 / 1024).toFixed(2),
        compressedCount: results.filter((r) => r.status === "compressed").length,
      },
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// BACKFILL PHOTO COMPLETIONS
// ============================================================================
async function handleBackfillPhotoCompletions(supabase: ReturnType<typeof createClient>) {
  console.log("[BACKFILL] Starting photo completions backfill...");

  const { data: responses, error: fetchError } = await supabase
    .from("checklist_responses")
    .select("id, submission_id, response_image_url")
    .not("response_image_url", "is", null)
    .is("completed_by", null);

  if (fetchError) throw fetchError;

  console.log(`[BACKFILL] Found ${responses?.length || 0} photo responses without completed_by`);

  if (!responses || responses.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No photo responses need backfilling", updated: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const submissionIds = [...new Set(responses.map((r) => r.submission_id))];
  const { data: submissions } = await supabase.from("checklist_submissions").select("id, submitted_by").in("id", submissionIds);
  const submissionMap = new Map(submissions?.map((s) => [s.id, s.submitted_by]) || []);

  let updated = 0, failed = 0;

  for (const response of responses) {
    const submittedBy = submissionMap.get(response.submission_id);
    if (!submittedBy) {
      failed++;
      continue;
    }

    const { error } = await supabase.from("checklist_responses").update({ completed_by: submittedBy }).eq("id", response.id);
    if (error) failed++;
    else updated++;
  }

  return new Response(
    JSON.stringify({ success: true, message: "Backfill complete", updated, failed, total: responses.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// BACKFILL ALLE PHOTOS (specific checklist)
// ============================================================================
async function handleBackfillAllePhotos(supabase: ReturnType<typeof createClient>, payload: Record<string, any>) {
  const checklistId = payload.checklist_id || "9eaed930-e88a-4874-9045-b4c7fb91e6bd";
  console.log("[BACKFILL-ALLE] Starting for checklist:", checklistId);

  const { data: alleProfile, error: alleError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .ilike("full_name", "alle rowe%")
    .maybeSingle();

  if (alleError) throw alleError;
  if (!alleProfile) throw new Error('Could not find user with name starting "Alle Rowe"');

  const { data: items } = await supabase.from("checklist_items").select("id").eq("checklist_id", checklistId);

  if (!items || items.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No items found for checklist", updated: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: responses } = await supabase
    .from("checklist_responses")
    .select("id")
    .in("item_id", items.map((i) => i.id))
    .not("response_image_url", "is", null)
    .is("completed_by", null);

  if (!responses || responses.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: "No photo responses need updating", updated: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let updated = 0, failed = 0;

  for (const response of responses) {
    const { error } = await supabase.from("checklist_responses").update({ completed_by: alleProfile.id }).eq("id", response.id);
    if (error) failed++;
    else updated++;
  }

  return new Response(
    JSON.stringify({ success: true, message: "Alle photo backfill complete", updated, failed, checklistId }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// BACKFILL CROO CASH TRANSACTIONS
// ============================================================================
async function handleBackfillCrooCash(supabase: ReturnType<typeof createClient>) {
  console.log("[BACKFILL-CROO-CASH] Starting transaction backfill...");

  const { data: users, error: usersError } = await supabase
    .from("profiles")
    .select("id, full_name, croo_cash_balance")
    .neq("croo_cash_balance", 0);

  if (usersError) throw usersError;

  console.log(`[BACKFILL-CROO-CASH] Found ${users?.length || 0} users with balances`);

  const transactionsToCreate: any[] = [];
  const today = new Date();

  for (const user of users || []) {
    const balance = user.croo_cash_balance;
    const transactionsNeeded = Math.ceil(Math.abs(balance) / 25);
    let runningTotal = 0;

    for (let i = 0; i < transactionsNeeded && runningTotal !== balance; i++) {
      const daysAgo = Math.floor(Math.random() * 30);
      const transactionDate = new Date(today);
      transactionDate.setDate(transactionDate.getDate() - daysAgo);
      const dateStr = transactionDate.toISOString().split("T")[0];
      const isWeekend = transactionDate.getDay() === 0 || transactionDate.getDay() === 6;

      let amount = 0;
      let transactionType = "";
      let notes = "";

      if (balance > 0) {
        if (Math.random() > 0.3) {
          amount = 25;
          transactionType = Math.random() > 0.5 ? "take_shift" : "checklist_completion";
          notes = `${transactionType === "take_shift" ? "Claimed shift" : "Completed checklist"} on ${transactionDate.toLocaleDateString()}`;
        } else {
          amount = -25;
          transactionType = "offer_shift";
          notes = `Offered shift on ${transactionDate.toLocaleDateString()}`;
        }
      } else {
        if (Math.random() > 0.3) {
          amount = -25;
          transactionType = Math.random() > 0.5 ? "offer_shift" : "checklist_incomplete";
          notes = `${transactionType === "offer_shift" ? "Offered shift" : "Incomplete checklist"} on ${transactionDate.toLocaleDateString()}`;
        } else {
          amount = 25;
          transactionType = "take_shift";
          notes = `Claimed shift on ${transactionDate.toLocaleDateString()}`;
        }
      }

      if ((runningTotal + amount > balance && balance > 0) || (runningTotal + amount < balance && balance < 0)) {
        amount = balance - runningTotal;
      }

      runningTotal += amount;

      transactionsToCreate.push({
        user_id: user.id,
        amount,
        transaction_type: transactionType,
        shift_date: dateStr,
        is_weekend: isWeekend,
        notes,
        created_at: new Date(transactionDate.getTime() + Math.random() * 86400000).toISOString(),
      });
    }
  }

  if (transactionsToCreate.length > 0) {
    const { error: insertError } = await supabase.from("croo_cash_transactions").insert(transactionsToCreate);
    if (insertError) throw insertError;
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: `Backfilled ${transactionsToCreate.length} transactions for ${users?.length || 0} users`,
      usersProcessed: users?.length || 0,
      transactionsCreated: transactionsToCreate.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// GENERATE WEEKLY SUMMARY
// ============================================================================
async function handleGenerateWeeklySummary(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string,
  payload: Record<string, any>
) {
  const { location_id, week_start, week_end, user_id } = payload;
  
  if (!location_id || !week_start || !week_end) {
    return new Response(
      JSON.stringify({ error: "location_id, week_start, and week_end are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  
  console.log('Generating weekly summary for location:', location_id, 'week:', week_start, 'to', week_end);

  // Helper to get array of date strings between two dates
  const getDateRange = (startDate: string, endDate: string): string[] => {
    const dates: string[] = [];
    const start = new Date(startDate + 'T12:00:00');
    const end = new Date(endDate + 'T12:00:00');
    const current = new Date(start);
    
    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  // 1. Get all drawer counts for the week to calculate over/short
  const { data: drawerEntries } = await supabase
    .from('logbook_entries')
    .select(`*, logbook_entry_values(*), logbook_categories(name)`)
    .eq('location_id', location_id)
    .gte('entry_date', week_start)
    .lte('entry_date', week_end);

  let totalOverShort = 0;
  let drawerCountDays = 0;
  const dailyOverShort: { date: string; amount: number }[] = [];

  drawerEntries?.forEach((entry: any) => {
    if (entry.logbook_categories?.name?.toLowerCase() === 'drawer count') {
      entry.logbook_entry_values?.forEach((val: any) => {
        try {
          const data = JSON.parse(val.value_text || '{}');
          // Audited (physically counted) amount is the number of record once a
          // bank deposit audit has been performed for that day.
          const varianceAmount = data.audit
            ? (data.auditedVariance ?? ((data.variance ?? 0) + ((data.audit.countedAmount ?? 0) - (data.actualDeposit ?? 0))))
            : (data.variance ?? data.overUnder ?? null);
          if (varianceAmount !== null && varianceAmount !== undefined) {
            totalOverShort += varianceAmount;
            drawerCountDays++;
            dailyOverShort.push({ date: entry.entry_date, amount: varianceAmount });
          }
        } catch {}
      });
    }
  });

  // 2. Get sales data
  let totalSales = 0;
  const dailySales: { date: string; sales: number }[] = [];
  const salesByDayOfWeek: Record<string, number> = {};

  try {
    const salesResponse = await supabase.functions.invoke('fetch-qubeyond-sales', {
      body: { locationId: location_id, targetDate: week_end }
    });

    if (salesResponse.data && !salesResponse.error) {
      totalSales = salesResponse.data.weekly || 0;
      const weekDates = getDateRange(week_start, week_end);
      for (const dateStr of weekDates) {
        const dayName = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
        salesByDayOfWeek[dayName] = 0;
      }
    }
  } catch (e) {
    console.error('Error fetching sales:', e);
  }

  // 3. Get task completion stats
  const { data: checklists } = await supabase
    .from('checklists')
    .select(`id, title, frequency, assigned_day_of_week, checklist_items(id, days_of_week)`)
    .eq('location_id', location_id)
    .eq('is_active', true)
    .neq('frequency', 'monthly');

  const { data: submissions } = await supabase
    .from('checklist_submissions')
    .select(`*, checklist_responses(*), checklists(id, title, frequency)`)
    .eq('location_id', location_id)
    .gte('submitted_at', week_start)
    .lte('submitted_at', week_end + 'T23:59:59');

  let totalTasksExpected = 0;
  let totalTasksCompleted = 0;
  const weekDates = getDateRange(week_start, week_end);
  
  for (const dateStr of weekDates) {
    const date = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = date.getDay();
    
    for (const checklist of (checklists || [])) {
      let isExpected = false;
      if (checklist.frequency === 'daily') {
        isExpected = true;
      } else if (checklist.frequency === 'weekly') {
        if (checklist.assigned_day_of_week === null || checklist.assigned_day_of_week === dayOfWeek) {
          isExpected = true;
        }
      }
      
      if (!isExpected) continue;
      
      const applicableItems = checklist.checklist_items?.filter((item: any) => {
        if (!item.days_of_week || item.days_of_week.length === 0) {
          return checklist.frequency === 'daily';
        }
        return item.days_of_week.includes(dayOfWeek);
      }) || [];
      
      const expectedItems = applicableItems.length;
      if (expectedItems === 0) continue;
      
      totalTasksExpected += expectedItems;
      
      const daySubmissions = submissions?.filter((sub: any) => {
        const subDate = new Date(sub.submitted_at).toISOString().split('T')[0];
        return sub.checklists?.id === checklist.id && subDate === dateStr;
      }) || [];
      
      if (daySubmissions.length > 0) {
        const bestSubmission = daySubmissions.reduce((best: any, current: any) => {
          const bestCount = best?.checklist_responses?.length || 0;
          const currentCount = current?.checklist_responses?.length || 0;
          return currentCount > bestCount ? current : best;
        }, daySubmissions[0]);
        
        totalTasksCompleted += bestSubmission.checklist_responses?.length || 0;
      }
    }
  }

  const taskCompletionRate = totalTasksExpected > 0 
    ? Math.round((totalTasksCompleted / totalTasksExpected) * 100) 
    : 0;

  // 4. Generate summary
  let aiSummary = "Weekly sales data unavailable.";
  if (totalSales > 0) {
    aiSummary = `Total weekly sales: $${totalSales.toLocaleString()}.`;
  }

  // 5. Create/update weekly summary category and entry
  let { data: summaryCategory } = await supabase
    .from('logbook_categories')
    .select('id')
    .eq('location_id', location_id)
    .eq('name', 'Weekly Summary')
    .maybeSingle();

  if (!summaryCategory) {
    const { data: newCategory } = await supabase
      .from('logbook_categories')
      .insert({
        name: 'Weekly Summary',
        location_id: location_id,
        is_active: true,
        alert_enabled: false,
        display_order: 999,
      })
      .select()
      .single();
    summaryCategory = newCategory;
  }

  if (!summaryCategory) {
    return new Response(
      JSON.stringify({ error: 'Failed to create Weekly Summary category' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let { data: summaryField } = await supabase
    .from('logbook_fields')
    .select('id')
    .eq('category_id', summaryCategory.id)
    .eq('field_name', 'summary_data')
    .maybeSingle();

  if (!summaryField) {
    const { data: newField } = await supabase
      .from('logbook_fields')
      .insert({
        category_id: summaryCategory.id,
        field_name: 'summary_data',
        field_type: 'text',
        is_required: false,
        display_order: 0,
      })
      .select()
      .single();
    summaryField = newField;
  }

  if (!summaryField) {
    return new Response(
      JSON.stringify({ error: 'Failed to create summary field' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Delete existing summary for this week
  const { data: existingSummaries } = await supabase
    .from('logbook_entries')
    .select('id')
    .eq('category_id', summaryCategory.id)
    .eq('entry_date', week_end)
    .eq('location_id', location_id);

  if (existingSummaries && existingSummaries.length > 0) {
    for (const existing of existingSummaries) {
      await supabase.from('logbook_entry_values').delete().eq('entry_id', existing.id);
      await supabase.from('logbook_entries').delete().eq('id', existing.id);
    }
  }

  // Create entry
  const { data: entryData, error: entryError } = await supabase
    .from('logbook_entries')
    .insert({
      category_id: summaryCategory.id,
      entry_date: week_end,
      created_by: user_id,
      location_id: location_id,
    })
    .select()
    .single();

  if (entryError) {
    return new Response(
      JSON.stringify({ error: entryError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const summaryData = {
    type: 'weekly_summary',
    week_start,
    week_end,
    total_sales: totalSales,
    daily_sales: dailySales,
    total_over_short: totalOverShort,
    daily_over_short: dailyOverShort,
    task_completion_rate: taskCompletionRate,
    tasks_completed: totalTasksCompleted,
    tasks_expected: totalTasksExpected,
    ai_summary: aiSummary,
    generated_at: new Date().toISOString(),
  };

  await supabase
    .from('logbook_entry_values')
    .insert({
      entry_id: entryData.id,
      field_id: summaryField.id,
      value_text: JSON.stringify(summaryData),
    });

  console.log('Weekly summary generated successfully');

  return new Response(
    JSON.stringify({ success: true, data: summaryData }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================================================
// HELPERS
// ============================================================================
function getYesterdayInLA(): string {
  const now = new Date();
  const laTime = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = laTime.split("-").map(Number);
  const laDate = new Date(year, month - 1, day);
  laDate.setDate(laDate.getDate() - 1);
  return laDate.toISOString().slice(0, 10);
}

function getTodayInLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getCurrentDayOfWeekInLA(): number {
  const now = new Date();
  const laWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
  }).format(now);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return dayMap[laWeekday] ?? 0;
}

async function runResumableTask(
  supabase: ReturnType<typeof createClient>,
  runDate: string,
  completedSet: Set<string>,
  name: string,
  fn: () => Promise<any>
): Promise<{ task: string; status: string; details?: any }> {
  // Skip if already completed for this run date
  if (completedSet.has(name)) {
    console.log(`[NIGHTLY] ⏭ ${name}: already completed for ${runDate}`);
    return { task: name, status: "skipped_already_done", details: { run_date: runDate } };
  }

  try {
    const details = await fn();
    console.log(`[NIGHTLY] ✓ ${name}:`, details);

    // Record successful completion (upsert to handle race conditions)
    await supabase.from("maintenance_task_logs").upsert(
      { run_date: runDate, task_name: name, status: "success", details },
      { onConflict: "run_date,task_name" }
    );

    return { task: name, status: "success", details };
  } catch (err) {
    console.error(`[NIGHTLY] ✗ ${name}:`, err);

    // Record failure (so we know it was attempted but don't skip on retry)
    await supabase.from("maintenance_task_logs").upsert(
      { run_date: runDate, task_name: name, status: "error", details: { error: String(err) } },
      { onConflict: "run_date,task_name" }
    ).catch(() => {}); // Don't let logging failure mask the real error

    return { task: name, status: "error", details: { error: String(err) } };
  }
}

// ============================================================================
// RETENTION JANITOR (manual trigger — also runs inside nightly Task 9)
// ============================================================================
async function handleRetentionJanitor(
  supabase: ReturnType<typeof createClient>,
  options: Record<string, any>
) {
  const overrides = options.overrides || {};
  const tasks: Array<[string, string, number]> = [
    ["alert_queue", "prune_alert_queue", overrides.alert_queue ?? 30],
    ["email_queue", "prune_email_queue", overrides.email_queue ?? 30],
    ["inventory_count_audit_log", "prune_inventory_count_audit_log", overrides.inventory_count_audit_log ?? 90],
    ["pfg_refresh_audit", "prune_pfg_refresh_audit", overrides.pfg_refresh_audit ?? 30],
    ["punch_clock_attempts", "prune_punch_clock_attempts", overrides.punch_clock_attempts ?? 7],
    ["checklist_notification_logs", "prune_checklist_notification_logs", overrides.checklist_notification_logs ?? 30],
  ];

  const results: Record<string, { deleted: number; days: number; error?: string }> = {};
  for (const [name, fn, days] of tasks) {
    const { data, error } = await supabase.rpc(fn, { days_to_keep: days });
    results[name] = error
      ? { deleted: 0, days, error: error.message }
      : { deleted: data ?? 0, days };
  }

  // Bank verification photos (deposit slips + bank receipts): keep 1 year
  let bankPhotosDeleted = 0;
  try {
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const { data: folders } = await supabase.storage
      .from("bank-verification")
      .list("", { limit: 1000 });

    for (const folder of folders || []) {
      const { data: files } = await supabase.storage
        .from("bank-verification")
        .list(folder.name, { limit: 1000 });
      const stale = (files || [])
        .filter((f: any) => f.created_at && new Date(f.created_at).getTime() < cutoff)
        .map((f: any) => `${folder.name}/${f.name}`);
      if (stale.length > 0) {
        const { error } = await supabase.storage.from("bank-verification").remove(stale);
        if (!error) bankPhotosDeleted += stale.length;
      }
    }
    console.log(`[RETENTION] Removed ${bankPhotosDeleted} bank verification photos older than 1 year`);
  } catch (e) {
    console.error("[RETENTION] bank-verification prune failed:", e);
  }
  results["bank_verification_photos"] = { deleted: bankPhotosDeleted, days: 365 };

  const totalDeleted = Object.values(results).reduce((s, r) => s + r.deleted, 0);
  console.log(`[RETENTION] Pruned ${totalDeleted} rows/files`);


  return new Response(
    JSON.stringify({ success: true, totalDeleted, results, timestamp: new Date().toISOString() }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// ARCHIVE CHECKLIST PHOTOS
// At 180+ days: replace original with 400px thumbnail (~20 KB)
// At 366+ days: delete entirely (full year of thumbnails preserved)
// ============================================================================
async function handleArchiveChecklistPhotos(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  options: Record<string, any>
) {
  const batchLimit = Math.min(options.batchLimit || 200, 500);
  const dryRun = options.dryRun === true;
  const thumbnailDays = options.thumbnailDays || 180;
  const deleteDays = options.deleteDays || 366;

  console.log(`[ARCHIVE] dryRun=${dryRun} batch=${batchLimit} thumb>=${thumbnailDays}d delete>=${deleteDays}d`);

  const now = Date.now();
  const thumbnailCutoff = new Date(now - thumbnailDays * 86400 * 1000);
  const deleteCutoff = new Date(now - deleteDays * 86400 * 1000);

  // Walk the bucket and collect candidates by created_at age
  const allFiles: { path: string; size: number; created_at: string }[] = [];
  let folderOffset = 0;

  while (true) {
    const { data: folders, error } = await supabase.storage
      .from("checklist-images")
      .list("", { limit: 100, offset: folderOffset });

    if (error || !folders || folders.length === 0) break;

    for (const folder of folders) {
      if (folder.metadata) continue;
      let fileOffset = 0;
      while (true) {
        const { data: files } = await supabase.storage
          .from("checklist-images")
          .list(folder.name, { limit: 1000, offset: fileOffset });

        if (!files || files.length === 0) break;

        for (const file of files) {
          if (!file.metadata || !file.created_at) continue;
          const size = (file.metadata as any).size || 0;
          const mimetype = (file.metadata as any).mimetype || "";
          if (!mimetype.startsWith("image/")) continue;
          allFiles.push({
            path: `${folder.name}/${file.name}`,
            size,
            created_at: file.created_at,
          });
        }

        if (files.length < 1000) break;
        fileOffset += 1000;
      }
    }

    if (folders.length < 100) break;
    folderOffset += 100;
  }

  // Pull already-processed paths so we skip them
  const { data: processedRows } = await supabase
    .from("checklist_photo_archive_log")
    .select("storage_path, action");
  const thumbnailedPaths = new Set(
    (processedRows || []).filter((r: any) => r.action === "thumbnailed").map((r: any) => r.storage_path)
  );

  // Bucket files into delete vs thumbnail
  const toDelete: typeof allFiles = [];
  const toThumbnail: typeof allFiles = [];

  for (const f of allFiles) {
    const created = new Date(f.created_at);
    if (created < deleteCutoff) {
      toDelete.push(f);
    } else if (created < thumbnailCutoff && !thumbnailedPaths.has(f.path)) {
      toThumbnail.push(f);
    }
  }

  console.log(`[ARCHIVE] candidates: ${toThumbnail.length} thumb, ${toDelete.length} delete`);

  if (dryRun) {
    return new Response(
      JSON.stringify({
        dryRun: true,
        candidates: { thumbnail: toThumbnail.length, delete: toDelete.length },
        sampleThumb: toThumbnail.slice(0, 5),
        sampleDelete: toDelete.slice(0, 5),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let thumbnailed = 0;
  let deleted = 0;
  let savedBytes = 0;

  // DELETE old thumbnails (cheap, do first)
  const deleteBatch = toDelete.slice(0, batchLimit);
  if (deleteBatch.length > 0) {
    const paths = deleteBatch.map((f) => f.path);
    const { error: delErr } = await supabase.storage.from("checklist-images").remove(paths);
    if (!delErr) {
      deleted = deleteBatch.length;
      savedBytes += deleteBatch.reduce((s, f) => s + f.size, 0);
      // Log each deletion
      const logRows = deleteBatch.map((f) => ({
        storage_path: f.path,
        action: "deleted",
        original_size_bytes: f.size,
        new_size_bytes: 0,
      }));
      await supabase.from("checklist_photo_archive_log").insert(logRows);
    } else {
      console.error("[ARCHIVE] bulk delete failed:", delErr.message);
    }
  }

  // THUMBNAIL: download at 400px, replace in-place
  const thumbBatch = toThumbnail.slice(0, batchLimit - deleted);
  for (const f of thumbBatch) {
    try {
      const { data: thumbData, error: dlErr } = await supabase.storage
        .from("checklist-images")
        .download(f.path, { transform: { width: 400, quality: 70, format: "origin" } });

      if (dlErr || !thumbData) continue;

      const newSize = thumbData.size;
      // Don't bother if savings under 30%
      if (newSize > f.size * 0.7) {
        await supabase.from("checklist_photo_archive_log").insert({
          storage_path: f.path,
          action: "thumbnailed",
          original_size_bytes: f.size,
          new_size_bytes: f.size,
        });
        continue;
      }

      const { error: upErr } = await supabase.storage
        .from("checklist-images")
        .upload(f.path, thumbData, { contentType: "image/jpeg", upsert: true });

      if (upErr) continue;

      await supabase.from("checklist_photo_archive_log").insert({
        storage_path: f.path,
        action: "thumbnailed",
        original_size_bytes: f.size,
        new_size_bytes: newSize,
      });

      thumbnailed++;
      savedBytes += f.size - newSize;
    } catch (err) {
      console.error(`[ARCHIVE] thumbnail failed for ${f.path}:`, err);
    }
  }

  const savedMB = +(savedBytes / 1024 / 1024).toFixed(2);
  console.log(`[ARCHIVE] thumbnailed=${thumbnailed} deleted=${deleted} savedMB=${savedMB}`);

  return new Response(
    JSON.stringify({
      success: true,
      thumbnailed,
      deleted,
      savedMB,
      remaining: { thumbnail: toThumbnail.length - thumbnailed, delete: toDelete.length - deleted },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
