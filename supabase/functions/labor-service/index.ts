import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TYPES
// ============================================================================

interface PunchRecord {
  id: string;
  user_id: string;
  punch_type: string;
  punch_time: string;
  notes: string | null;
}

interface WageHistoryRecord {
  user_id: string;
  hourly_wage: number;
  effective_date: string;
}

interface ProfileWithWage {
  id: string;
  hourly_wage: number | null;
}

// ============================================================================
// SHARED UTILITIES
// ============================================================================

function getDateStringForTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

function getDateRange(startDate: string, endDate: string): string[] {
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
}

function calculateTimeDifferenceHours(startTime: Date, endTime: Date): number {
  let hours = (endTime.getTime() - startTime.getTime()) / 3600000;
  if (hours < 0) hours += 24;
  return hours;
}

function sortPunches(punches: PunchRecord[]): PunchRecord[] {
  const priority: Record<string, number> = {
    clock_in: 0,
    break_start: 1,
    break_end: 2,
    clock_out: 3,
  };

  return [...punches].sort((a, b) => {
    const t = new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime();
    if (t !== 0) return t;
    const pa = priority[a.punch_type] ?? 99;
    const pb = priority[b.punch_type] ?? 99;
    if (pa !== pb) return pa - pb;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

function calculateDayHours(dayPunches: PunchRecord[]): number {
  const sortedPunches = sortPunches(dayPunches);
  if (sortedPunches.length === 0) return 0;
  
  const shiftStartClockIns: PunchRecord[] = [];
  
  sortedPunches.forEach((punch, idx) => {
    if (punch.punch_type !== 'clock_in') return;
    if (idx === 0) {
      shiftStartClockIns.push(punch);
      return;
    }
    const prevPunch = sortedPunches[idx - 1];
    if (prevPunch.punch_type === 'clock_out') {
      shiftStartClockIns.push(punch);
    }
  });
  
  const clockOuts = sortedPunches.filter(p => p.punch_type === 'clock_out');
  if (shiftStartClockIns.length === 0) return 0;
  
  let totalHours = 0;
  const usedClockOutIds = new Set<string>();
  
  const earliestClockInTime = shiftStartClockIns.length > 0 
    ? new Date(shiftStartClockIns[0].punch_time).getTime() 
    : Infinity;
  
  shiftStartClockIns.forEach((clockIn, index) => {
    const clockInTime = new Date(clockIn.punch_time).getTime();
    const nextShiftStart = shiftStartClockIns[index + 1];
    const nextShiftStartTime = nextShiftStart ? new Date(nextShiftStart.punch_time).getTime() : Infinity;
    
    const shiftClockOuts = clockOuts.filter(co => {
      const coTime = new Date(co.punch_time).getTime();
      return coTime > clockInTime && coTime < nextShiftStartTime && !usedClockOutIds.has(co.id) && coTime > earliestClockInTime;
    });
    const clockOut = shiftClockOuts.length > 0 ? shiftClockOuts[shiftClockOuts.length - 1] : null;

    const lastPunchInWindow = sortedPunches
      .filter(p => {
        const t = new Date(p.punch_time).getTime();
        return t >= clockInTime && t < nextShiftStartTime;
      })
      .at(-1);

    const endTime = clockOut
      ? new Date(clockOut.punch_time)
      : (lastPunchInWindow ? new Date(lastPunchInWindow.punch_time) : null);
    
    if (!endTime) return;
    if (clockOut) usedClockOutIds.add(clockOut.id);
    
    let hours = calculateTimeDifferenceHours(new Date(clockIn.punch_time), endTime);
    
    const clockOutTime = endTime.getTime();
    const shiftBreaks = sortedPunches.filter(p => 
      p.punch_type === 'break_start' && 
      p.notes?.includes('30 minute') &&
      new Date(p.punch_time).getTime() > clockInTime &&
      new Date(p.punch_time).getTime() < clockOutTime
    );
    
    shiftBreaks.forEach(breakStart => {
      const breakStartTime = new Date(breakStart.punch_time).getTime();
      
      const breakEnd = sortedPunches.find(p => {
        const pTime = new Date(p.punch_time).getTime();
        // Match a break_end that follows this break_start (notes check not required —
        // the break_start already confirmed it's a 30-min unpaid break)
        if (p.punch_type === 'break_end') {
          return pTime > breakStartTime && pTime < clockOutTime;
        }
        if (p.punch_type === 'clock_in' && pTime > breakStartTime && pTime < clockOutTime) {
          const nextPunchAfterBreak = sortedPunches.find(np => 
            new Date(np.punch_time).getTime() > breakStartTime
          );
          return nextPunchAfterBreak?.id === p.id;
        }
        return false;
      });
      
      if (breakEnd) {
        const breakHours = calculateTimeDifferenceHours(
          new Date(breakStart.punch_time), 
          new Date(breakEnd.punch_time)
        );
        hours -= breakHours;
      }
    });
    
    totalHours += hours;
  });
  
  return totalHours;
}

function getHourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  });
  return parseInt(formatter.format(date), 10);
}

function getPreviousDayString(dateStr: string): string {
  const dateAtNoon = new Date(dateStr + 'T12:00:00Z');
  dateAtNoon.setUTCDate(dateAtNoon.getUTCDate() - 1);
  return dateAtNoon.toISOString().slice(0, 10);
}

// ============================================================================
// LABOR CALCULATION ENGINE
// ============================================================================

async function calculateLaborFromPunches(
  supabaseClient: any,
  locationId: string,
  dateStr: string,
  timezone: string,
  wageMap: Map<string, number>,
  cutoffByDayOfWeek: Map<number, number>
): Promise<{ laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; doubleTimeHours: number; employeeBreakdown: any[] } | null> {
  try {
    const startOfDayPST = new Date(`${dateStr}T00:00:00-08:00`);
    const endOfDayPST = new Date(`${dateStr}T23:59:59-08:00`);
    const queryStart = new Date(startOfDayPST.getTime() - 12 * 60 * 60 * 1000);
    const queryEnd = new Date(endOfDayPST.getTime() + 16 * 60 * 60 * 1000);
    
    const { data: punches, error: punchError } = await supabaseClient
      .from('time_punches')
      .select('id, user_id, punch_type, punch_time, notes')
      .eq('location_id', locationId)
      .gte('punch_time', queryStart.toISOString())
      .lte('punch_time', queryEnd.toISOString())
      .order('punch_time', { ascending: true });
    
    if (punchError) {
      console.error(`[labor-service] Error fetching punches for ${dateStr}:`, punchError);
      return null;
    }
    
    const allPunches = (punches || []) as PunchRecord[];
    if (allPunches.length === 0) {
      return { laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0, doubleTimeHours: 0, employeeBreakdown: [] };
    }
    
    const defaultCutoff = 5;
    
    const getCutoffForDate = (dateString: string): number => {
      const d = new Date(dateString + 'T12:00:00Z');
      const prevDayOfWeek = (d.getUTCDay() + 6) % 7;
      return cutoffByDayOfWeek.get(prevDayOfWeek) ?? defaultCutoff;
    };
    
    const punchesByUser = new Map<string, PunchRecord[]>();
    for (const punch of allPunches) {
      if (!punchesByUser.has(punch.user_id)) {
        punchesByUser.set(punch.user_id, []);
      }
      punchesByUser.get(punch.user_id)!.push(punch);
    }
    
    let totalHoursWorked = 0;
    let totalLaborCost = 0;
    const employeeBreakdown: any[] = [];
    
    for (const [userId, userPunches] of punchesByUser) {
      const clockInsByDay = new Map<string, PunchRecord>();
      for (const punch of userPunches) {
        if (punch.punch_type === 'clock_in') {
          const day = getDateStringForTimezone(new Date(punch.punch_time), timezone);
          clockInsByDay.set(day, punch);
        }
      }
      
      const punchesByDay = new Map<string, PunchRecord[]>();
      
      for (const punch of userPunches) {
        const punchTime = new Date(punch.punch_time);
        let day = getDateStringForTimezone(punchTime, timezone);
        const punchHour = getHourInTimezone(punchTime, timezone);
        const cutoffHour = getCutoffForDate(day);
        
        if (punch.punch_type === 'clock_out' || punch.punch_type === 'break_start' || punch.punch_type === 'break_end') {
          if (punchHour <= cutoffHour) {
            const sameDayClockIn = clockInsByDay.get(day);
            const shouldMoveToPrevDay = !sameDayClockIn || 
              new Date(sameDayClockIn.punch_time).getTime() > punchTime.getTime();
            
            if (shouldMoveToPrevDay) {
              const prevDay = getPreviousDayString(day);
              if (clockInsByDay.has(prevDay)) {
                day = prevDay;
              }
            }
          }
        }
        
        if (!punchesByDay.has(day)) {
          punchesByDay.set(day, []);
        }
        punchesByDay.get(day)!.push(punch);
      }
      
      const dayPunches = punchesByDay.get(dateStr) || [];
      if (dayPunches.length === 0) continue;
      
      const wage = wageMap.get(userId) ?? 15;
      const hoursWorked = calculateDayHours(dayPunches);
      
      if (hoursWorked > 0) {
        totalHoursWorked += hoursWorked;
        totalLaborCost += hoursWorked * wage;
        employeeBreakdown.push({ user_id: userId, hours: hoursWorked, wage, cost: hoursWorked * wage });
      }
    }
    
    return {
      laborCost: totalLaborCost,
      hoursWorked: totalHoursWorked,
      regularHours: totalHoursWorked,
      overtimeHours: 0,
      doubleTimeHours: 0,
      employeeBreakdown
    };
  } catch (error) {
    console.error(`[labor-service] Error calculating labor for ${dateStr}:`, error);
    return null;
  }
}

// ============================================================================
// ACTION: backfill (replaces backfill-punch-labor)
// ============================================================================

async function handleBackfill(req: Request, supabase: any): Promise<Response> {
  const { locationId, daysBack = 90, startDate: inputStartDate, endDate: inputEndDate, forceRefresh = false } = await req.json();

  if (!locationId) {
    return new Response(JSON.stringify({ error: 'locationId is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`[labor-service] backfill: location=${locationId}, daysBack=${daysBack}`);

  const { data: locationSettings } = await supabase
    .from('location_settings')
    .select('timezone')
    .eq('location_id', locationId)
    .single();
  
  const timezone = locationSettings?.timezone || 'America/Los_Angeles';

  const { data: locationData } = await supabase
    .from('locations')
    .select('name')
    .eq('id', locationId)
    .single();
  
  const locationName = locationData?.name || 'Unknown';

  const { data: locationHours } = await supabase
    .from('location_hours')
    .select('day_of_week, close_time')
    .eq('location_id', locationId);
  
  const cutoffByDayOfWeek = new Map<number, number>();
  (locationHours || []).forEach((h: { day_of_week: number; close_time: string | null }) => {
    if (!h.close_time) {
      cutoffByDayOfWeek.set(h.day_of_week, 5);
      return;
    }
    const [hours] = h.close_time.split(':').map(Number);
    const cutoff = Math.min((hours + 3) % 24, 6);
    cutoffByDayOfWeek.set(h.day_of_week, cutoff);
  });

  const today = new Date();
  const todayStr = getDateStringForTimezone(today, timezone);
  
  let startDateStr: string;
  let endDateStr: string;
  
  if (inputStartDate && inputEndDate) {
    startDateStr = inputStartDate;
    endDateStr = inputEndDate;
  } else {
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - daysBack);
    startDateStr = getDateStringForTimezone(startDate, timezone);
    endDateStr = todayStr;
  }
  
  const allDates = getDateRange(startDateStr, endDateStr).filter(d => d !== todayStr);

  let datesToProcess = allDates;
  
  if (!forceRefresh) {
    const { data: existingLabor } = await supabase
      .from('labor_cache')
      .select('labor_date')
      .eq('location_id', locationId)
      .eq('source', 'punch_clock');
    
    const existingDates = new Set((existingLabor || []).map((l: { labor_date: string }) => l.labor_date));
    datesToProcess = allDates.filter(d => !existingDates.has(d));
  }

  if (datesToProcess.length === 0) {
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'All punch labor already cached',
      processed: 0,
      skipped: allDates.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { data: userLocations } = await supabase
    .from('user_locations')
    .select('user_id')
    .eq('location_id', locationId);
  
  const userIds = (userLocations || []).map((ul: { user_id: string }) => ul.user_id);
  
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'No users assigned to location',
      processed: 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const wageMap = new Map<string, number>();
  
  const { data: wageHistoryData } = await supabase
    .from('wage_history')
    .select('user_id, hourly_wage, effective_date')
    .in('user_id', userIds)
    .order('effective_date', { ascending: false });
  
  for (const wh of (wageHistoryData || []) as WageHistoryRecord[]) {
    if (!wageMap.has(wh.user_id)) {
      wageMap.set(wh.user_id, wh.hourly_wage || 15);
    }
  }
  
  const usersWithoutWage = userIds.filter((id: string) => !wageMap.has(id));
  if (usersWithoutWage.length > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, hourly_wage')
      .in('id', usersWithoutWage);
    
    for (const p of (profilesData || []) as ProfileWithWage[]) {
      wageMap.set(p.id, p.hourly_wage || 15);
    }
  }

  const batchSize = 10;
  let processed = 0;
  let errors = 0;
  const results: { date: string; hours: number; cost: number }[] = [];

  for (let i = 0; i < datesToProcess.length; i += batchSize) {
    const batch = datesToProcess.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async (dateStr) => {
        const labor = await calculateLaborFromPunches(supabase, locationId, dateStr, timezone, wageMap, cutoffByDayOfWeek);
        return { dateStr, labor };
      })
    );

    for (const { dateStr, labor } of batchResults) {
      if (labor && (labor.hoursWorked > 0 || labor.laborCost > 0)) {
        const breakdownSum = labor.employeeBreakdown.reduce((sum: number, e: any) => sum + (e.hours || 0), 0);
        const hoursDiff = Math.abs(labor.hoursWorked - breakdownSum);
        
        if (hoursDiff > 0.01) {
          labor.hoursWorked = breakdownSum;
          labor.regularHours = breakdownSum;
        }
        
        const { error: insertError } = await supabase
          .from('labor_cache')
          .upsert({
            location_id: locationId,
            labor_date: dateStr,
            source: 'punch_clock',
            labor_cost: labor.laborCost,
            labor_hours: labor.hoursWorked,
            regular_hours: labor.regularHours,
            overtime_hours: labor.overtimeHours,
            double_time_hours: labor.doubleTimeHours,
            employee_breakdown: labor.employeeBreakdown,
            fetched_at: new Date().toISOString(),
            is_stale: false,
            last_validated_at: new Date().toISOString()
          }, {
            onConflict: 'location_id,labor_date,source'
          });

        if (insertError) {
          errors++;
        } else {
          processed++;
          results.push({ date: dateStr, hours: labor.hoursWorked, cost: labor.laborCost });
        }
      } else if (labor) {
        await supabase
          .from('labor_cache')
          .upsert({
            location_id: locationId,
            labor_date: dateStr,
            source: 'punch_clock',
            labor_cost: 0,
            labor_hours: 0,
            regular_hours: 0,
            overtime_hours: 0,
            double_time_hours: 0,
            employee_breakdown: [],
            fetched_at: new Date().toISOString(),
            is_stale: false,
            last_validated_at: new Date().toISOString()
          }, {
            onConflict: 'location_id,labor_date,source'
          });
        processed++;
      }
    }
  }

  const totalHours = results.reduce((sum, r) => sum + r.hours, 0);
  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);

  return new Response(JSON.stringify({ 
    success: true, 
    location: locationName,
    processed,
    errors,
    skipped: allDates.length - datesToProcess.length,
    totalHours: Math.round(totalHours * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    dateRange: datesToProcess.length > 0 ? {
      start: datesToProcess[0],
      end: datesToProcess[datesToProcess.length - 1]
    } : null
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// ACTION: refresh-stale (replaces refresh-stale-labor)
// ============================================================================

async function handleRefreshStale(supabase: any): Promise<Response> {
  console.log('[labor-service] refresh-stale: Starting...');

  const { data: staleRecords, error: staleError } = await supabase
    .from('labor_cache')
    .select('location_id, labor_date')
    .eq('is_stale', true)
    .eq('source', 'punch_clock');

  if (staleError) {
    throw new Error(`Failed to fetch stale records: ${staleError.message}`);
  }

  if (!staleRecords || staleRecords.length === 0) {
    console.log('[labor-service] refresh-stale: No stale records found');
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'No stale records to refresh',
      refreshed: 0 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`[labor-service] refresh-stale: Found ${staleRecords.length} stale records`);

  const byLocation = new Map<string, string[]>();
  for (const record of staleRecords) {
    if (!byLocation.has(record.location_id)) {
      byLocation.set(record.location_id, []);
    }
    byLocation.get(record.location_id)!.push(record.labor_date);
  }

  let totalRefreshed = 0;
  const results: { location: string; dates: number }[] = [];
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  for (const [locationId, dates] of byLocation) {
    const sortedDates = dates.sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];

    console.log(`[labor-service] refresh-stale: Refreshing ${locationId}: ${startDate} to ${endDate}`);

    // Call labor-service backfill action (self-call)
    const response = await fetch(`${supabaseUrl}/functions/v1/labor-service?action=backfill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        locationId,
        startDate,
        endDate,
        forceRefresh: true
      })
    });

    if (response.ok) {
      const result = await response.json();
      totalRefreshed += result.processed || 0;
      results.push({ location: result.location || locationId, dates: result.processed || 0 });
    } else {
      console.error(`[labor-service] refresh-stale: Failed for ${locationId}: ${response.status}`);
    }
  }

  console.log(`[labor-service] refresh-stale: Complete. ${totalRefreshed} records refreshed`);

  return new Response(JSON.stringify({ 
    success: true, 
    refreshed: totalRefreshed,
    locations: results
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Require a real caller: service role (cron/edge-to-edge) or a signature-
  // verified session — a logged-in manager OR a paired punch-clock device.
  const authed = await requireCaller(req, corsHeaders);
  if ('response' in authed) return authed.response;

  try {

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'backfill';

    console.log(`[labor-service] Action: ${action}`);

    switch (action) {
      case 'backfill':
        return await handleBackfill(req, supabase);
      
      case 'refresh-stale':
        return await handleRefreshStale(supabase);
      
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error: unknown) {
    console.error('[labor-service] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
