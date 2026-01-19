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
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const year = tzDate.getFullYear();
  const month = String(tzDate.getMonth() + 1).padStart(2, '0');
  const day = String(tzDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
async function calculateLaborFromPunches(
  supabaseClient: any,
  locationId: string,
  dateStr: string,
  timezone: string,
  wageMap: Map<string, number>
): Promise<{ laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; doubleTimeHours: number; employeeBreakdown: any[] } | null> {
  try {
    const startOfDay = new Date(`${dateStr}T00:00:00`);
    const endOfDay = new Date(`${dateStr}T23:59:59`);
    
    // Convert to UTC for query (fetch wider range to be safe)
    const startUtc = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const endUtc = new Date(endOfDay.getTime() + 24 * 60 * 60 * 1000).toISOString();
    
    const { data: punches, error: punchError } = await supabaseClient
      .from('time_punches')
      .select('id, user_id, punch_type, punch_time')
      .eq('location_id', locationId)
      .gte('punch_time', startUtc)
      .lte('punch_time', endUtc)
      .order('punch_time', { ascending: true });
    
    if (punchError) {
      console.error(`[BACKFILL] Error fetching punches for ${dateStr}:`, punchError);
      return null;
    }
    
    const punchRecords = (punches || []) as PunchRecord[];
    
    if (punchRecords.length === 0) {
      return { laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0, doubleTimeHours: 0, employeeBreakdown: [] };
    }
    
    // Filter punches to only those on the target date in location timezone
    const punchesOnDate = punchRecords.filter(p => {
      const punchDate = new Date(p.punch_time);
      const localDateStr = getDateStringForTimezone(punchDate, timezone);
      return localDateStr === dateStr;
    });
    
    if (punchesOnDate.length === 0) {
      return { laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0, doubleTimeHours: 0, employeeBreakdown: [] };
    }
    
    // Group punches by user
    const punchesByUser = new Map<string, typeof punchesOnDate>();
    for (const punch of punchesOnDate) {
      if (!punchesByUser.has(punch.user_id)) {
        punchesByUser.set(punch.user_id, []);
      }
      punchesByUser.get(punch.user_id)!.push(punch);
    }
    
    let totalHoursWorked = 0;
    let totalLaborCost = 0;
    const employeeBreakdown: any[] = [];
    
    // Calculate hours for each user
    for (const [userId, userPunches] of punchesByUser) {
      const wage = wageMap.get(userId) || 15;
      let clockInTime: Date | null = null;
      let breakStartTime: Date | null = null;
      let hoursWorked = 0;
      let breakMinutes = 0;
      
      for (const punch of userPunches) {
        const punchTime = new Date(punch.punch_time);
        
        switch (punch.punch_type) {
          case 'clock_in':
            if (breakStartTime) {
              const breakMs = punchTime.getTime() - breakStartTime.getTime();
              breakMinutes += breakMs / (1000 * 60);
              breakStartTime = null;
            } else if (!clockInTime) {
              clockInTime = punchTime;
            }
            break;
          case 'clock_out':
            if (clockInTime) {
              const shiftMs = punchTime.getTime() - clockInTime.getTime();
              hoursWorked += shiftMs / (1000 * 60 * 60);
              clockInTime = null;
            }
            break;
          case 'break_start':
            breakStartTime = punchTime;
            break;
          case 'break_end':
            if (breakStartTime) {
              const breakMs = punchTime.getTime() - breakStartTime.getTime();
              breakMinutes += breakMs / (1000 * 60);
              breakStartTime = null;
            }
            break;
        }
      }
      
      // For historical data, we should NOT have open punches, but handle gracefully
      // by NOT adding live hours (this is backfill of completed days)
      
      // Subtract breaks
      const breakHours = breakMinutes / 60;
      const netHours = Math.max(0, hoursWorked - breakHours);
      
      totalHoursWorked += netHours;
      totalLaborCost += netHours * wage;
      
      if (netHours > 0) {
        employeeBreakdown.push({
          user_id: userId,
          hours: netHours,
          wage: wage,
          cost: netHours * wage
        });
      }
    }
    
    return {
      laborCost: totalLaborCost,
      hoursWorked: totalHoursWorked,
      regularHours: totalHoursWorked, // TODO: implement OT calculation based on labor_rules
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

    const { locationId, daysBack = 90, targetDate, forceRecalculate = false } = await req.json();

    if (!locationId) {
      return new Response(JSON.stringify({ error: 'locationId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // If targetDate is provided, only process that specific date (used for recalculation after punch edits)
    if (targetDate) {
      console.log(`[BACKFILL] Recalculating labor for specific date: ${targetDate}, location: ${locationId}, force: ${forceRecalculate}`);
    } else {
      console.log(`[BACKFILL] Starting punch labor backfill for location ${locationId}, ${daysBack} days back`);
    }

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
    let allDates: string[];
    let datesToProcess: string[];
    
    if (targetDate) {
      // Single date mode - used for recalculation after punch edits
      // Always process when targetDate is specified (it's an explicit recalculation request)
      allDates = [targetDate];
      datesToProcess = [targetDate];
      console.log(`[BACKFILL] Single date mode: processing ${targetDate}`);
    } else {
      // Bulk backfill mode - process range of days (exclude today - today is live)
      const today = new Date();
      const todayStr = getDateStringForTimezone(today, timezone);
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - daysBack);
      const startDateStr = getDateStringForTimezone(startDate, timezone);
      allDates = getDateRange(startDateStr, todayStr).filter(d => d !== todayStr);
      
      console.log(`[BACKFILL] Processing ${allDates.length} days from ${startDateStr} to yesterday`);
      
      // Check which dates already have punch labor cached (only in bulk mode)
      const { data: existingLabor } = await supabase
        .from('labor_cache')
        .select('labor_date')
        .eq('location_id', locationId)
        .eq('source', 'punch_clock');
      
      const existingDates = new Set((existingLabor || []).map((l: { labor_date: string }) => l.labor_date));
      
      if (forceRecalculate) {
        datesToProcess = allDates;
        console.log(`[BACKFILL] Force recalculate: processing all ${allDates.length} dates`);
      } else {
        datesToProcess = allDates.filter(d => !existingDates.has(d));
        console.log(`[BACKFILL] ${existingDates.size} dates already cached, ${datesToProcess.length} to process`);
      }
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
