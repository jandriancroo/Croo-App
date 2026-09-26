import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireCaller } from '../_shared/callerAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Pack 2A: all labor math lives in the database (labor_day_totals /
// labor_day_user_totals). This job only writes closed punch_clock days.
// Virginia St is on its legacy path and is never written here.
const EXCLUDED_LOCATION_ID = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Pure yyyy-MM-dd arithmetic (noon-UTC anchor, no timezone involvement).
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function getDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

async function getCutoff(supabase: any): Promise<string> {
  const { data, error } = await supabase.rpc('labor_new_rule_start');
  if (error || !data) throw new Error(`labor_new_rule_start failed: ${error?.message}`);
  return String(data);
}

// ============================================================================
// ACTION: backfill
// ============================================================================

async function handleBackfill(req: Request, supabase: any): Promise<Response> {
  const { locationId, daysBack = 90, startDate: inputStartDate, endDate: inputEndDate, forceRefresh = false } = await req.json();

  if (!locationId) return json({ error: 'locationId is required' }, 400);

  if (locationId === EXCLUDED_LOCATION_ID) {
    return json({ success: true, message: 'Location excluded (legacy path)', processed: 0, skipped: 0 });
  }

  console.log(`[labor-service] backfill: location=${locationId}, daysBack=${daysBack}`);

  const { data: locationData } = await supabase.from('locations').select('name').eq('id', locationId).single();
  const locationName = locationData?.name || 'Unknown';

  const { data: todayData, error: todayErr } = await supabase.rpc('business_date', { _location_id: locationId });
  if (todayErr || !todayData) throw new Error(`business_date failed: ${todayErr?.message}`);
  const todayStr = String(todayData);
  const cutoff = await getCutoff(supabase);

  let startDateStr: string;
  let endDateStr: string;
  if (inputStartDate && inputEndDate) {
    startDateStr = inputStartDate;
    endDateStr = inputEndDate;
  } else {
    startDateStr = addDays(todayStr, -Number(daysBack));
    endDateStr = todayStr;
  }
  // Triggers send calendar dates; also recompute the previous business date.
  startDateStr = addDays(startDateStr, -1);

  const allDates = getDateRange(startDateStr, endDateStr)
    .filter((d) => d !== todayStr && d < todayStr && d >= cutoff);

  let datesToProcess = allDates;
  if (!forceRefresh && allDates.length > 0) {
    const { data: existing } = await supabase
      .from('labor_cache')
      .select('labor_date')
      .eq('location_id', locationId)
      .eq('source', 'punch_clock')
      .gte('labor_date', allDates[0])
      .lte('labor_date', allDates[allDates.length - 1]);
    const have = new Set((existing || []).map((r: { labor_date: string }) => r.labor_date));
    datesToProcess = allDates.filter((d) => !have.has(d));
  }

  if (datesToProcess.length === 0) {
    return json({ success: true, message: 'All punch labor already cached', processed: 0, skipped: allDates.length });
  }

  let processed = 0;
  let errors = 0;
  let totalHours = 0;
  let totalCost = 0;

  for (const dateStr of datesToProcess) {
    const [{ data: tot, error: totErr }, { data: users, error: usersErr }] = await Promise.all([
      supabase.rpc('labor_day_totals', { _location_id: locationId, _date: dateStr, _live: false }),
      supabase.rpc('labor_day_user_totals', { _location_id: locationId, _date: dateStr, _live: false }),
    ]);
    if (totErr || usersErr) {
      console.error(`[labor-service] calc failed ${dateStr}:`, totErr?.message || usersErr?.message);
      errors++;
      continue;
    }
    const t = (tot && tot[0]) || { hours: 0, cost: 0 };
    const breakdown = (users || [])
      .filter((u: any) => Number(u.paid_hours) > 0)
      .map((u: any) => ({
        user_id: u.user_id,
        hours: Number(u.paid_hours),
        wage: Number(u.wage),
        cost: Number(u.cost),
      }));
    const hours = Number(t.hours) || 0;
    const cost = Number(t.cost) || 0;
    const now = new Date().toISOString();

    // hourly_breakdown intentionally omitted so the existing value is untouched.
    const { error: upErr } = await supabase.from('labor_cache').upsert({
      location_id: locationId,
      labor_date: dateStr,
      source: 'punch_clock',
      labor_cost: cost,
      labor_hours: hours,
      regular_hours: hours,
      overtime_hours: 0,
      double_time_hours: 0,
      employee_breakdown: breakdown,
      fetched_at: now,
      is_stale: false,
      last_validated_at: now,
    }, { onConflict: 'location_id,labor_date,source' });

    if (upErr) {
      errors++;
    } else {
      processed++;
      totalHours += hours;
      totalCost += cost;
    }
  }

  return json({
    success: true,
    location: locationName,
    processed,
    errors,
    skipped: allDates.length - datesToProcess.length,
    totalHours: Math.round(totalHours * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    dateRange: { start: datesToProcess[0], end: datesToProcess[datesToProcess.length - 1] },
  });
}

// ============================================================================
// ACTION: refresh-stale
// ============================================================================

async function handleRefreshStale(supabase: any): Promise<Response> {
  console.log('[labor-service] refresh-stale: Starting...');
  const cutoff = await getCutoff(supabase);

  const { data: staleRecords, error: staleError } = await supabase
    .from('labor_cache')
    .select('location_id, labor_date')
    .eq('is_stale', true)
    .eq('source', 'punch_clock')
    .gte('labor_date', cutoff)
    .neq('location_id', EXCLUDED_LOCATION_ID);

  if (staleError) throw new Error(`Failed to fetch stale records: ${staleError.message}`);

  if (!staleRecords || staleRecords.length === 0) {
    return json({ success: true, message: 'No stale records to refresh', refreshed: 0 });
  }

  const byLocation = new Map<string, string[]>();
  for (const r of staleRecords) {
    if (!byLocation.has(r.location_id)) byLocation.set(r.location_id, []);
    byLocation.get(r.location_id)!.push(r.labor_date);
  }

  let totalRefreshed = 0;
  const results: { location: string; dates: number }[] = [];
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  for (const [locationId, dates] of byLocation) {
    const sorted = dates.sort();
    const response = await fetch(`${supabaseUrl}/functions/v1/labor-service?action=backfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseServiceKey}` },
      body: JSON.stringify({ locationId, startDate: sorted[0], endDate: sorted[sorted.length - 1], forceRefresh: true }),
    });
    if (response.ok) {
      const result = await response.json();
      totalRefreshed += result.processed || 0;
      results.push({ location: result.location || locationId, dates: result.processed || 0 });
    } else {
      console.error(`[labor-service] refresh-stale: Failed for ${locationId}: ${response.status}`);
    }
  }

  return json({ success: true, refreshed: totalRefreshed, locations: results });
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authed = await requireCaller(req, corsHeaders);
  if ('response' in authed) return authed.response;

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const url = new URL(req.url);
    let bodyAction: string | null = null;
    try {
      const peeked = await req.clone().json();
      if (peeked && typeof peeked.action === 'string') bodyAction = peeked.action;
    } catch { /* no/invalid JSON body */ }
    const action = url.searchParams.get('action') || bodyAction || 'backfill';
    console.log(`[labor-service] Action: ${action}`);

    switch (action) {
      case 'backfill':
        return await handleBackfill(req, supabase);
      case 'refresh-stale':
        return await handleRefreshStale(supabase);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    console.error('[labor-service] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
