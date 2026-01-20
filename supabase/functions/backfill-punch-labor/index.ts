import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PunchRecord {
  id: string;
  user_id: string;
  punch_type: string;
  punch_time: string;
  notes: string | null;
}

function isUnpaidBreak(notes: string | null): boolean {
  if (!notes) return false;
  const lower = notes.toLowerCase();
  return lower.includes('30 minute') || lower.includes('meal') || lower.includes('unpaid');
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

function getDateStringForTimezone(date: Date, timezone: string): string {
  // Use Intl.DateTimeFormat for reliable timezone conversion
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  // en-CA format is YYYY-MM-DD
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

// Calculate labor from time_punches for a specific date
// Uses business date logic: shifts are attributed to the date they START on (clock_in)
// CRITICAL: For overnight shifts, we must find clock_outs that occur on the NEXT day
async function calculateLaborFromPunches(
  supabaseClient: any,
  locationId: string,
  dateStr: string,
  timezone: string,
  wageMap: Map<string, number>
): Promise<{ laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; doubleTimeHours: number; employeeBreakdown: any[] } | null> {
  try {
    // Parse date as PST/PDT for consistent timezone handling
    // The dateStr is in format YYYY-MM-DD representing local (PST) date
    const [year, month, day] = dateStr.split('-').map(Number);
    
    // Create start of day in PST (use offset -08:00 for PST, -07:00 for PDT)
    // For simplicity, use -08:00 and the query range is wide enough to capture all cases
    const startOfDayPST = new Date(`${dateStr}T00:00:00-08:00`);
    const lookBackStart = new Date(startOfDayPST.getTime() - 8 * 60 * 60 * 1000); // -8 hours for safety
    const lookAheadEnd = new Date(startOfDayPST.getTime() + 48 * 60 * 60 * 1000); // +48 hours
    
    const { data: punches, error: punchError } = await supabaseClient
      .from('time_punches')
      .select('id, user_id, punch_type, punch_time, notes')
      .eq('location_id', locationId)
      .gte('punch_time', lookBackStart.toISOString())
      .lte('punch_time', lookAheadEnd.toISOString())
      .order('punch_time', { ascending: true });
    
    if (punchError) {
      console.error(`[BACKFILL] Error fetching punches for ${dateStr}:`, punchError);
      return null;
    }
    
    const punchRecords = (punches || []) as PunchRecord[];
    
    if (punchRecords.length === 0) {
      return { laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0, doubleTimeHours: 0, employeeBreakdown: [] };
    }
    
    // Group ALL punches by user
    const allPunchesByUser = new Map<string, PunchRecord[]>();
    for (const punch of punchRecords) {
      if (!allPunchesByUser.has(punch.user_id)) {
        allPunchesByUser.set(punch.user_id, []);
      }
      allPunchesByUser.get(punch.user_id)!.push(punch);
    }
    
    let totalHoursWorked = 0;
    let totalLaborCost = 0;
    const employeeBreakdown: any[] = [];
    
    // Calculate hours for each user
    for (const [userId, userPunches] of allPunchesByUser) {
      const wage = wageMap.get(userId) || 15;
      let hoursWorked = 0;
      
      // Sort punches by time
      userPunches.sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());
      
      // Find all clock_in punches that occurred on the target date
      // Then find their matching clock_out (which may be on next day)
      let i = 0;
      while (i < userPunches.length) {
        const punch = userPunches[i];
        const punchTime = new Date(punch.punch_time);
        const punchDateStr = getDateStringForTimezone(punchTime, timezone);
        
        if (punch.punch_type === 'clock_in' && punchDateStr === dateStr) {
          const clockInTime = punchTime;
          let clockOutTime: Date | null = null;
          let unpaidBreakMinutes = 0;
          let currentBreakStart: { time: Date; notes: string | null } | null = null;
          
          // Look forward for clock_out and breaks
          for (let j = i + 1; j < userPunches.length; j++) {
            const nextPunch = userPunches[j];
            const nextPunchTime = new Date(nextPunch.punch_time);
            
            if (nextPunch.punch_type === 'clock_out') {
              clockOutTime = nextPunchTime;
              break; // Found the matching clock_out
            } else if (nextPunch.punch_type === 'break_start') {
              currentBreakStart = { time: nextPunchTime, notes: nextPunch.notes };
            } else if (nextPunch.punch_type === 'break_end' && currentBreakStart) {
              if (isUnpaidBreak(currentBreakStart.notes)) {
                unpaidBreakMinutes += (nextPunchTime.getTime() - currentBreakStart.time.getTime()) / (1000 * 60);
              }
              currentBreakStart = null;
            } else if (nextPunch.punch_type === 'clock_in') {
              // Hit another clock_in without finding clock_out - shift was not closed
              break;
            }
          }
          
          if (clockOutTime) {
            const shiftHours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
            const netHours = Math.max(0, shiftHours - (unpaidBreakMinutes / 60));
            hoursWorked += netHours;
          }
        }
        i++;
      }
      
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
    console.error(`[BACKFILL] Error calculating labor for ${dateStr}:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { locationId, daysBack = 90, startDate: inputStartDate, endDate: inputEndDate, forceRefresh = false } = await req.json();

    if (!locationId) {
      return new Response(JSON.stringify({ error: 'locationId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[BACKFILL] Starting punch labor backfill for location ${locationId}, ${daysBack} days back`);

    // Get location settings for timezone
    const { data: locationSettings } = await supabase
      .from('location_settings')
      .select('timezone')
      .eq('location_id', locationId)
      .single();
    
    const timezone = locationSettings?.timezone || 'America/Los_Angeles';
    console.log(`[BACKFILL] Using timezone: ${timezone}`);

    // Get location name for logging
    const { data: locationData } = await supabase
      .from('locations')
      .select('name')
      .eq('id', locationId)
      .single();
    
    const locationName = locationData?.name || 'Unknown';
    console.log(`[BACKFILL] Location: ${locationName}`);

    // Calculate date range
    const today = new Date();
    const todayStr = getDateStringForTimezone(today, timezone);
    
    let startDateStr: string;
    let endDateStr: string;
    
    if (inputStartDate && inputEndDate) {
      // Use provided date range
      startDateStr = inputStartDate;
      endDateStr = inputEndDate;
      console.log(`[BACKFILL] Using provided date range: ${startDateStr} to ${endDateStr}`);
    } else {
      // Calculate from daysBack
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - daysBack);
      startDateStr = getDateStringForTimezone(startDate, timezone);
      endDateStr = todayStr;
    }
    
    // Get all dates to process (exclude today if it's in the range - today is live)
    const allDates = getDateRange(startDateStr, endDateStr).filter(d => d !== todayStr);
    console.log(`[BACKFILL] Processing ${allDates.length} days from ${startDateStr} to ${endDateStr}`);

    // Check which dates already have punch labor cached (unless forceRefresh)
    let datesToProcess = allDates;
    
    if (!forceRefresh) {
      const { data: existingLabor } = await supabase
        .from('labor_cache')
        .select('labor_date')
        .eq('location_id', locationId)
        .eq('source', 'punch_clock');
      
      const existingDates = new Set((existingLabor || []).map((l: { labor_date: string }) => l.labor_date));
      datesToProcess = allDates.filter(d => !existingDates.has(d));
      
      console.log(`[BACKFILL] ${existingDates.size} dates already cached, ${datesToProcess.length} to process`);
    } else {
      console.log(`[BACKFILL] Force refresh enabled, processing all ${datesToProcess.length} dates`);
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

    // Get all users assigned to this location
    const { data: userLocations } = await supabase
      .from('user_locations')
      .select('user_id')
      .eq('location_id', locationId);
    
    const userIds = (userLocations || []).map((ul: { user_id: string }) => ul.user_id);
    
    if (userIds.length === 0) {
      console.log('[BACKFILL] No users assigned to location');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No users assigned to location',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch all wage history for these users
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
    
    // Fallback to profiles for users without wage history
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

    console.log(`[BACKFILL] Loaded wages for ${wageMap.size} users`);

    // Process dates in batches
    const batchSize = 10;
    let processed = 0;
    let errors = 0;
    const results: { date: string; hours: number; cost: number }[] = [];

    for (let i = 0; i < datesToProcess.length; i += batchSize) {
      const batch = datesToProcess.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(async (dateStr) => {
          const labor = await calculateLaborFromPunches(supabase, locationId, dateStr, timezone, wageMap);
          return { dateStr, labor };
        })
      );

      // Insert results into labor_cache
      for (const { dateStr, labor } of batchResults) {
        if (labor && (labor.hoursWorked > 0 || labor.laborCost > 0)) {
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
              fetched_at: new Date().toISOString()
            }, {
              onConflict: 'location_id,labor_date,source'
            });

          if (insertError) {
            console.error(`[BACKFILL] Error inserting ${dateStr}:`, insertError);
            errors++;
          } else {
            processed++;
            results.push({ date: dateStr, hours: labor.hoursWorked, cost: labor.laborCost });
            console.log(`[BACKFILL] ${dateStr}: ${labor.hoursWorked.toFixed(2)}h, $${labor.laborCost.toFixed(2)}`);
          }
        } else if (labor) {
          // Zero labor for this day - still cache it to avoid re-processing
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
              fetched_at: new Date().toISOString()
            }, {
              onConflict: 'location_id,labor_date,source'
            });
          processed++;
        }
      }

      console.log(`[BACKFILL] Progress: ${Math.min(i + batchSize, datesToProcess.length)}/${datesToProcess.length} dates`);
    }

    // Calculate totals
    const totalHours = results.reduce((sum, r) => sum + r.hours, 0);
    const totalCost = results.reduce((sum, r) => sum + r.cost, 0);

    console.log(`[BACKFILL] Complete: ${processed} days processed, ${errors} errors`);
    console.log(`[BACKFILL] Total: ${totalHours.toFixed(2)} hours, $${totalCost.toFixed(2)} cost`);

    return new Response(JSON.stringify({ 
      success: true, 
      location: locationName,
      processed,
      errors,
      skipped: allDates.length - datesToProcess.length,
      totalHours: Math.round(totalHours * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      dateRange: {
        start: datesToProcess[0],
        end: datesToProcess[datesToProcess.length - 1]
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[BACKFILL] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
