import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const POST_CLOSE_BUFFER_HOURS = 3; // Hours after close to trigger auto-punch
const MIN_SHIFT_HOURS = 4; // Minimum hours worked to qualify for auto-punch
const MAX_SHIFT_HOURS = 16; // Skip if shift would be longer (likely data error)

interface AutoPunchResult {
  location_id: string;
  location_name: string;
  employee_name: string;
  user_id: string;
  clock_in_time: string;
  auto_punch_time: string;
  shift_hours: number;
  status: 'punched' | 'skipped' | 'error';
  reason?: string;
}

// Helper to get timezone offset hours (accounts for DST)
function getTimezoneOffsetHours(timezone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(date);
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
  // Parse "GMT-8" or "GMT-7" format
  const match = offsetPart.match(/GMT([+-]\d+)/);
  return match ? parseInt(match[1]) : -8; // Default to -8 (PST)
}

// Get "yesterday" date string in a specific timezone
function getYesterdayInTimezone(now: Date, timezone: string): string {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(yesterday);
}

// Get "today" date string in a specific timezone
function getTodayInTimezone(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

// Get current hour in a specific timezone
function getCurrentHourInTimezone(now: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  });
  return parseInt(formatter.format(now));
}

// Calculate UTC time range for a business day in a specific timezone
function getBusinessDayUTCRange(yesterdayStr: string, todayStr: string, offsetHours: number): { start: string; end: string } {
  // Convert offset to positive hours to add to local midnight to get UTC
  // e.g., PST is UTC-8, so midnight PST = 08:00 UTC
  const utcOffsetHours = Math.abs(offsetHours);
  const startHour = String(utcOffsetHours).padStart(2, '0');
  
  return {
    start: `${yesterdayStr}T${startHour}:00:00Z`, // midnight local = X:00 UTC
    end: `${todayStr}T${String(utcOffsetHours - 1).padStart(2, '0')}:59:59Z`, // 11:59:59 PM local
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const results: AutoPunchResult[] = [];
    const now = new Date();

    console.log(`[Auto-Punch] Running at ${now.toISOString()}`);

    // Fetch all locations with their close times and timezone settings
    const { data: locations, error: locError } = await supabase
      .from('locations')
      .select(`
        id,
        name,
        location_settings(timezone),
        location_hours(day_of_week, close_time, is_closed)
      `);

    if (locError) {
      throw new Error(`Failed to fetch locations: ${locError.message}`);
    }

    console.log(`[Auto-Punch] Found ${locations?.length || 0} locations to process`);

    for (const location of locations || []) {
      // Get location's timezone (fall back to default)
      const locationSettings = (location.location_settings as any[])?.[0];
      const timezone = locationSettings?.timezone || DEFAULT_TIMEZONE;
      
      // Calculate dates in location's timezone
      const yesterdayStr = getYesterdayInTimezone(now, timezone);
      const todayStr = getTodayInTimezone(now, timezone);
      const currentHour = getCurrentHourInTimezone(now, timezone);
      
      // Get day of week for yesterday in location's timezone
      const [yYear, yMonth, yDay] = yesterdayStr.split('-').map(Number);
      const yesterdayDayOfWeek = new Date(yYear, yMonth - 1, yDay).getDay();
      
      // Find hours for yesterday
      const locationHours = (location.location_hours as any[])?.find(
        h => h.day_of_week === yesterdayDayOfWeek
      );
      
      if (!locationHours || locationHours.is_closed) {
        console.log(`[Auto-Punch] ${location.name} (${timezone}): Closed yesterday, skipping`);
        continue;
      }

      const closeTime = locationHours.close_time;
      if (!closeTime) {
        console.log(`[Auto-Punch] ${location.name} (${timezone}): No close time configured, skipping`);
        continue;
      }

      // Parse close time (e.g., "22:00" or "00:00" for midnight)
      const [closeHour, closeMinute] = closeTime.split(':').map(Number);
      let closeTimeMinutes = closeHour * 60 + closeMinute;
      
      // Handle midnight (00:00) as 24:00 (end of day)
      if (closeTimeMinutes === 0) {
        closeTimeMinutes = 24 * 60;
      }
      
      // Calculate cutoff: close_time + buffer hours
      const cutoffMinutes = closeTimeMinutes + (POST_CLOSE_BUFFER_HOURS * 60);
      
      console.log(`[Auto-Punch] ${location.name} (${timezone}): Yesterday=${yesterdayStr}, Close=${closeTime}, Cutoff=${Math.floor(cutoffMinutes / 60)}:${String(cutoffMinutes % 60).padStart(2, '0')}`);

      // Calculate UTC time range for the location's business day
      const offsetHours = getTimezoneOffsetHours(timezone, now);
      const { start: yesterdayStartUTC, end: yesterdayEndUTC } = getBusinessDayUTCRange(yesterdayStr, todayStr, offsetHours);
      
      console.log(`[Auto-Punch] ${location.name}: Query window ${yesterdayStartUTC} to ${yesterdayEndUTC}`);

      // Find open clock-ins from yesterday at this location
      const { data: openPunches, error: punchError } = await supabase
        .from('time_punches')
        .select(`
          id,
          user_id,
          punch_time,
          profiles:user_id!inner(full_name)
        `)
        .eq('location_id', location.id)
        .eq('punch_type', 'clock_in')
        .gte('punch_time', yesterdayStartUTC)
        .lte('punch_time', yesterdayEndUTC);

      if (punchError) {
        console.error(`[Auto-Punch] ${location.name}: Error fetching punches: ${punchError.message}`);
        continue;
      }

      console.log(`[Auto-Punch] ${location.name}: Found ${openPunches?.length || 0} clock-ins from yesterday`);

      for (const punch of openPunches || []) {
        const employeeName = (punch.profiles as any)?.full_name || 'Unknown';
        
        // Check if there's already a clock_out after this clock_in
        const { data: clockOuts, error: coError } = await supabase
          .from('time_punches')
          .select('id')
          .eq('user_id', punch.user_id)
          .eq('location_id', location.id)
          .eq('punch_type', 'clock_out')
          .gt('punch_time', punch.punch_time)
          .limit(1);

        if (coError) {
          results.push({
            location_id: location.id,
            location_name: location.name,
            employee_name: employeeName,
            user_id: punch.user_id,
            clock_in_time: punch.punch_time,
            auto_punch_time: '',
            shift_hours: 0,
            status: 'error',
            reason: `Error checking clock-outs: ${coError.message}`,
          });
          continue;
        }

        if (clockOuts && clockOuts.length > 0) {
          // Already has a clock-out, skip
          continue;
        }

        // Calculate shift duration from clock-in to now
        const clockInTime = new Date(punch.punch_time);
        const shiftHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

        // Validate shift duration
        if (shiftHours < MIN_SHIFT_HOURS) {
          results.push({
            location_id: location.id,
            location_name: location.name,
            employee_name: employeeName,
            user_id: punch.user_id,
            clock_in_time: punch.punch_time,
            auto_punch_time: '',
            shift_hours: Math.round(shiftHours * 100) / 100,
            status: 'skipped',
            reason: `Shift too short (${shiftHours.toFixed(1)} hrs < ${MIN_SHIFT_HOURS} hrs minimum)`,
          });
          continue;
        }

        if (shiftHours > MAX_SHIFT_HOURS) {
          results.push({
            location_id: location.id,
            location_name: location.name,
            employee_name: employeeName,
            user_id: punch.user_id,
            clock_in_time: punch.punch_time,
            auto_punch_time: '',
            shift_hours: Math.round(shiftHours * 100) / 100,
            status: 'skipped',
            reason: `Shift too long (${shiftHours.toFixed(1)} hrs > ${MAX_SHIFT_HOURS} hrs max) - likely data error`,
          });
          continue;
        }

        // Calculate auto-punch time: close_time + buffer on the close day
        // We need to create a timestamp in the location's timezone, then convert to UTC
        const autoPunchDate = new Date(yesterdayStr + 'T00:00:00');
        autoPunchDate.setMinutes(cutoffMinutes);
        
        // Convert to UTC by applying the timezone offset
        const autoPunchUTC = new Date(
          autoPunchDate.getTime() + 
          (autoPunchDate.getTimezoneOffset() * 60 * 1000) + 
          (offsetHours * 60 * 60 * 1000 * -1) // Negate because offset is already negative for west
        );
        const autoPunchTimeStr = autoPunchUTC.toISOString();

        // Insert the auto clock-out
        const { error: insertError } = await supabase
          .from('time_punches')
          .insert({
            user_id: punch.user_id,
            location_id: location.id,
            punch_type: 'clock_out',
            punch_time: autoPunchTimeStr,
            notes: `Auto clocked out by system - ${POST_CLOSE_BUFFER_HOURS} hours post-close (${closeTime} ${timezone})`,
            is_auto_punched_out: true,
            has_break_violation: shiftHours > 5, // If worked > 5 hrs without break
          });

        if (insertError) {
          results.push({
            location_id: location.id,
            location_name: location.name,
            employee_name: employeeName,
            user_id: punch.user_id,
            clock_in_time: punch.punch_time,
            auto_punch_time: autoPunchTimeStr,
            shift_hours: Math.round(shiftHours * 100) / 100,
            status: 'error',
            reason: `Failed to insert: ${insertError.message}`,
          });
          continue;
        }

        // Mark labor cache as stale for this date
        await supabase
          .from('labor_cache')
          .update({ is_stale: true })
          .eq('location_id', location.id)
          .eq('labor_date', yesterdayStr)
          .eq('source', 'punch_clock');

        results.push({
          location_id: location.id,
          location_name: location.name,
          employee_name: employeeName,
          user_id: punch.user_id,
          clock_in_time: punch.punch_time,
          auto_punch_time: autoPunchTimeStr,
          shift_hours: Math.round(shiftHours * 100) / 100,
          status: 'punched',
        });

        console.log(`[Auto-Punch] ✅ ${employeeName} at ${location.name}: Auto-punched at ${autoPunchTimeStr} (${shiftHours.toFixed(1)} hrs)`);
      }
    }

    const summary = {
      run_at: now.toISOString(),
      total_processed: results.length,
      punched: results.filter(r => r.status === 'punched').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
      results,
    };

    console.log(`[Auto-Punch] Complete: ${summary.punched} punched, ${summary.skipped} skipped, ${summary.errors} errors`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[Auto-Punch] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
