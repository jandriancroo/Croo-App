import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const POST_CLOSE_BUFFER_HOURS = 3;
const SCHEDULED_END_BUFFER_HOURS = 1; // Auto-punch at scheduled_end + 1hr
const PROCESSING_WINDOW_MINUTES = 59; // Window for cron to fire within
const MAX_SHIFT_HOURS = 18; // Sanity guard

interface AutoPunchResult {
  location_id: string;
  location_name: string;
  employee_name: string;
  user_id: string;
  clock_in_time: string;
  auto_punch_time: string;
  shift_hours: number;
  reason: string;
  status: 'punched' | 'skipped' | 'error';
  detail?: string;
}

// ============================================================
// TIMEZONE UTILITIES (DST-safe)
// ============================================================

/** Get the date string (YYYY-MM-DD) for "now" in a given timezone */
function getDateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

/** Get day of week (0=Sun, 6=Sat) for a date string interpreted as local */
function getDayOfWeekForDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Use UTC to avoid local-tz drift; the date itself has no tz
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Convert a "wall clock" date+time in a given timezone to a UTC Date.
 * DST-safe: uses Intl to discover the actual UTC offset at that moment.
 */
function wallTimeToUTC(dateStr: string, timeStr: string, timezone: string): Date {
  // dateStr: "2026-04-18", timeStr: "22:00" (or "22:00:00")
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);

  // First guess: treat the wall time as if it were UTC
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));

  // Discover the offset that timezone has at that guessed moment
  // We do this by formatting `guess` in the target tz and seeing what wall time appears
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(guess);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
  const tzWall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'));
  const offsetMs = tzWall - guess.getTime();

  // Adjust: real UTC = guess - offset
  return new Date(guess.getTime() - offsetMs);
}

/**
 * Compute the close-time UTC moment for a given business date in a tz.
 * Handles midnight closes (00:00) by treating them as the next day's 00:00.
 */
function computeCloseUTC(businessDateStr: string, closeTimeStr: string, timezone: string): Date {
  const [h, m] = closeTimeStr.split(':').map(Number);
  // Midnight close = next calendar day at 00:00 local
  if (h === 0 && m === 0) {
    const [y, mo, d] = businessDateStr.split('-').map(Number);
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    const nextStr = next.toISOString().slice(0, 10);
    return wallTimeToUTC(nextStr, '00:00', timezone);
  }
  // Otherwise, close happens on the business date itself
  return wallTimeToUTC(businessDateStr, closeTimeStr, timezone);
}

// ============================================================
// QUERY RETRY HELPER (transient PostgREST error mitigation)
// ============================================================

async function queryWithRetry<T>(
  queryFn: () => PromiseLike<{ data: T | null; error: unknown }>,
  label: string,
  retries = 1,
  delayMs = 500
): Promise<{ data: T | null; error: unknown }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await queryFn();
    if (!error) return { data, error: null };
    console.warn(`[Auto-Punch] ${label}: attempt ${attempt + 1} failed — ${JSON.stringify(error)}`);
    if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
  }
  return { data: null, error: new Error(`${label}: all retries exhausted`) };
}

// ============================================================
// MAIN
// ============================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Internal-only endpoint (cron / service invokes).
  const denied = requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const now = new Date();
    const results: AutoPunchResult[] = [];

    // ---- MANUAL OVERRIDE SUPPORT ----
    // Allow POST body to target a specific location and/or business_date for backfill
    let forceLocationId: string | null = null;
    let forceBusinessDate: string | null = null;
    let forceMode = false;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        forceLocationId = body?.location_id || null;
        forceBusinessDate = body?.business_date || null;
        forceMode = !!(forceLocationId || forceBusinessDate);
      } catch {
        // empty body is fine
      }
    }

    console.log(
      `[Auto-Punch] Run started at ${now.toISOString()}` +
        (forceMode ? ` [MANUAL: location=${forceLocationId || 'all'}, date=${forceBusinessDate || 'auto'}]` : '')
    );

    // Fetch active locations with hours + timezone (filtered if manual override)
    let locationsQuery = supabase
      .from('locations')
      .select(`
        id,
        name,
        is_active,
        location_settings(timezone),
        location_hours(day_of_week, close_time, is_closed)
      `)
      .eq('is_active', true);

    if (forceLocationId) {
      locationsQuery = locationsQuery.eq('id', forceLocationId);
    }

    const { data: locations, error: locError } = await locationsQuery;

    if (locError) throw new Error(`Failed to fetch locations: ${locError.message}`);

    for (const location of locations || []) {
      const tz = (location.location_settings as any[])?.[0]?.timezone || DEFAULT_TIMEZONE;
      const hours = (location.location_hours as any[]) || [];

      // Skip silently if no hours configured
      if (hours.length === 0) {
        console.log(`[Auto-Punch] ${location.name}: no hours configured, skipping`);
        continue;
      }

      // Determine which "business date(s)" to process.
      // Normal cron: yesterday + today (local) to catch late-night closes.
      // Manual override: only the specified date.
      const todayLocal = getDateInTimezone(now, tz);
      const yesterdayLocal = getDateInTimezone(new Date(now.getTime() - 86400000), tz);
      const datesToProcess = forceBusinessDate ? [forceBusinessDate] : [yesterdayLocal, todayLocal];

      for (const businessDate of datesToProcess) {
        const dow = getDayOfWeekForDate(businessDate);
        const dayHours = hours.find((h: any) => h.day_of_week === dow);

        if (!dayHours || dayHours.is_closed || !dayHours.close_time) continue;

        // Compute close moment + buffer in UTC (DST-safe)
        const closeUTC = computeCloseUTC(businessDate, dayHours.close_time, tz);
        const cutoffUTC = new Date(closeUTC.getTime() + POST_CLOSE_BUFFER_HOURS * 3600 * 1000);
        const windowEndUTC = new Date(cutoffUTC.getTime() + PROCESSING_WINDOW_MINUTES * 60 * 1000);

        // Normal mode: only fire inside the cron window. Manual mode bypasses this.
        if (!forceMode && (now < cutoffUTC || now > windowEndUTC)) continue;

        // ---- IDEMPOTENCY CHECK (skipped in manual mode for backfills) ----
        if (!forceMode) {
          const { data: existingLog } = await supabase
            .from('auto_punch_log')
            .select('id, punches_created')
            .eq('location_id', location.id)
            .eq('processed_date', businessDate)
            .maybeSingle();

          if (existingLog) {
            console.log(`[Auto-Punch] ${location.name} ${businessDate}: already processed, skipping`);
            continue;
          }
        } else {
          console.log(`[Auto-Punch] ${location.name} ${businessDate}: MANUAL run — bypassing idempotency check`);
        }

        console.log(`[Auto-Punch] ${location.name} ${businessDate} (${tz}): processing. Close=${closeUTC.toISOString()}, Cutoff=${cutoffUTC.toISOString()}`);

        // Find open clock-ins (no matching clock-out) for this location/date window
        // Look back to 24h before close to catch normal-day shifts
        const lookbackUTC = new Date(closeUTC.getTime() - 24 * 3600 * 1000);

        const { data: clockIns, error: ciErr } = await supabase
          .from('time_punches')
          .select('id, user_id, punch_time, profiles:user_id(full_name)')
          .eq('location_id', location.id)
          .eq('punch_type', 'clock_in')
          .gte('punch_time', lookbackUTC.toISOString())
          .lte('punch_time', cutoffUTC.toISOString());

        if (ciErr) {
          console.error(`[Auto-Punch] ${location.name}: clock-in fetch error: ${ciErr.message}`);
          continue;
        }

        let punchesCreated = 0;

        for (const ci of clockIns || []) {
          const employeeName = (ci.profiles as any)?.full_name || 'Unknown';

          // Check if there's already a clock_out after this clock_in (with retry on transient errors)
          const { data: existingOut, error: existingOutErr } = await queryWithRetry<Array<{ id: string }>>(
            () => supabase
              .from('time_punches')
              .select('id')
              .eq('user_id', ci.user_id)
              .eq('location_id', location.id)
              .eq('punch_type', 'clock_out')
              .gt('punch_time', ci.punch_time)
              .limit(1),
            `existingOut for ${employeeName}`
          );

          if (existingOutErr) {
            // CRITICAL: never insert an auto-punch when we couldn't verify a real one doesn't exist.
            console.error(`[Auto-Punch] ${employeeName}: existingOut check failed after retries, skipping to avoid duplicate. ${JSON.stringify(existingOutErr)}`);
            results.push({
              location_id: location.id, location_name: location.name, employee_name: employeeName,
              user_id: ci.user_id, clock_in_time: ci.punch_time, auto_punch_time: ci.punch_time,
              shift_hours: 0, reason: 'no_schedule', status: 'skipped',
              detail: `existingOut query failed after retry: ${JSON.stringify(existingOutErr)}`,
            });
            continue;
          }

          if (existingOut && existingOut.length > 0) continue; // already clocked out

          // Look up scheduled shift for that user on the business date
          const { data: schedShifts } = await supabase
            .from('scheduled_shifts')
            .select('end_time, shift_date')
            .eq('user_id', ci.user_id)
            .eq('shift_date', businessDate)
            .eq('is_time_off', false);

          // Determine punch-out time and reason
          let autoPunchUTC: Date;
          let scheduledEndUTC: Date | null = null;
          let reason: 'no_schedule' | 'past_scheduled_end' | 'past_close_buffer';

          if (schedShifts && schedShifts.length > 0) {
            // Use the latest scheduled end of the day
            let latestEnd: { date: string; time: string } | null = null;
            for (const s of schedShifts) {
              if (!s.end_time) continue;
              if (!latestEnd || s.end_time > latestEnd.time) {
                latestEnd = { date: s.shift_date, time: s.end_time };
              }
            }

            if (latestEnd) {
              // Handle scheduled end that crosses midnight (end_time < start_time scenario)
              // For simplicity, assume end_time on shift_date; if end is "02:00" treat as next day
              const [eh] = latestEnd.time.split(':').map(Number);
              let endDateStr = latestEnd.date;
              // Heuristic: if scheduled end is before 6am, it's likely next-day close
              if (eh < 6) {
                const [yy, mm, dd] = latestEnd.date.split('-').map(Number);
                endDateStr = new Date(Date.UTC(yy, mm - 1, dd + 1)).toISOString().slice(0, 10);
              }
              scheduledEndUTC = wallTimeToUTC(endDateStr, latestEnd.time, tz);

              const scheduledPunchUTC = new Date(
                scheduledEndUTC.getTime() + SCHEDULED_END_BUFFER_HOURS * 3600 * 1000
              );

              // Only auto-punch if we're past scheduled_end + buffer
              if (now < scheduledPunchUTC) {
                console.log(`[Auto-Punch] ${employeeName}: scheduled until ${scheduledEndUTC.toISOString()}, not yet at +1hr cutoff, skip`);
                continue;
              }

              autoPunchUTC = scheduledPunchUTC;
              reason = 'past_scheduled_end';
            } else {
              autoPunchUTC = cutoffUTC;
              reason = 'no_schedule';
            }
          } else {
            // No scheduled shift → use close + buffer
            autoPunchUTC = cutoffUTC;
            reason = 'no_schedule';
          }

          // Sanity: cap shift length
          const clockInTime = new Date(ci.punch_time);
          const shiftHours = (autoPunchUTC.getTime() - clockInTime.getTime()) / 3600000;

          if (shiftHours <= 0 || shiftHours > MAX_SHIFT_HOURS) {
            results.push({
              location_id: location.id,
              location_name: location.name,
              employee_name: employeeName,
              user_id: ci.user_id,
              clock_in_time: ci.punch_time,
              auto_punch_time: autoPunchUTC.toISOString(),
              shift_hours: Math.round(shiftHours * 100) / 100,
              reason,
              status: 'skipped',
              detail: `Invalid shift duration: ${shiftHours.toFixed(2)}h`,
            });
            continue;
          }

          // If reason is no_schedule but we're past close buffer, label appropriately
          if (reason === 'no_schedule' && now >= cutoffUTC) {
            reason = 'past_close_buffer';
          }

          // FINAL guard: re-check immediately before insert (race-safe)
          const { data: lastSecondCheck, error: lastSecondErr } = await supabase
            .from('time_punches')
            .select('id')
            .eq('user_id', ci.user_id)
            .eq('location_id', location.id)
            .eq('punch_type', 'clock_out')
            .gt('punch_time', ci.punch_time)
            .limit(1);
          if (lastSecondErr || (lastSecondCheck && lastSecondCheck.length > 0)) {
            console.log(`[Auto-Punch] ${employeeName}: clock_out appeared during processing, skipping insert.`);
            continue;
          }

          // Insert auto clock-out
          const { data: inserted, error: insErr } = await supabase
            .from('time_punches')
            .insert({
              user_id: ci.user_id,
              location_id: location.id,
              punch_type: 'clock_out',
              punch_time: autoPunchUTC.toISOString(),
              is_auto_punched_out: true,
              has_break_violation: shiftHours > 5,
              notes: `Auto-punched: ${reason} (close ${dayHours.close_time} ${tz})`,
            })
            .select('id')
            .single();

          if (insErr) {
            results.push({
              location_id: location.id,
              location_name: location.name,
              employee_name: employeeName,
              user_id: ci.user_id,
              clock_in_time: ci.punch_time,
              auto_punch_time: autoPunchUTC.toISOString(),
              shift_hours: Math.round(shiftHours * 100) / 100,
              reason,
              status: 'error',
              detail: insErr.message,
            });
            continue;
          }

          // Audit event
          await supabase.from('auto_punch_events').insert({
            user_id: ci.user_id,
            location_id: location.id,
            time_punch_id: inserted?.id,
            clock_in_punch_id: ci.id,
            punched_out_at: autoPunchUTC.toISOString(),
            scheduled_shift_end: scheduledEndUTC?.toISOString() || null,
            store_close_time: closeUTC.toISOString(),
            reason,
            shift_hours: Math.round(shiftHours * 100) / 100,
          });

          // Mark labor cache stale
          await supabase
            .from('labor_cache')
            .update({ is_stale: true })
            .eq('location_id', location.id)
            .eq('labor_date', businessDate)
            .eq('source', 'punch_clock');

          punchesCreated++;
          results.push({
            location_id: location.id,
            location_name: location.name,
            employee_name: employeeName,
            user_id: ci.user_id,
            clock_in_time: ci.punch_time,
            auto_punch_time: autoPunchUTC.toISOString(),
            shift_hours: Math.round(shiftHours * 100) / 100,
            reason,
            status: 'punched',
          });

          console.log(`[Auto-Punch] ✅ ${employeeName} @ ${location.name}: ${reason}, ${shiftHours.toFixed(2)}h`);
        }

        // Record idempotency log (skip in manual mode so future cron runs aren't blocked)
        if (!forceMode) {
          await supabase.from('auto_punch_log').insert({
            location_id: location.id,
            processed_date: businessDate,
            cron_run_at: now.toISOString(),
            punches_created: punchesCreated,
            notes: `tz=${tz}, close=${dayHours.close_time}, cutoff=${cutoffUTC.toISOString()}`,
          });
        }
      }
    }

    const summary = {
      run_at: now.toISOString(),
      mode: forceMode ? 'manual' : 'cron',
      manual_filters: forceMode ? { location_id: forceLocationId, business_date: forceBusinessDate } : null,
      total: results.length,
      punched: results.filter(r => r.status === 'punched').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
      results,
    };

    console.log(`[Auto-Punch] Done: ${summary.punched} punched / ${summary.skipped} skipped / ${summary.errors} errors`);
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    console.error('[Auto-Punch] Fatal:', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
