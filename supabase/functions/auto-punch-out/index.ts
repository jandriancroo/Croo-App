import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIMEZONE = 'America/Los_Angeles';
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
    
    // Get current time in PST
    const pstFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const pstParts = pstFormatter.formatToParts(now);
    const getPart = (type: string) => pstParts.find(p => p.type === type)?.value || '';
    
    const currentHour = parseInt(getPart('hour'));
    const _currentMinute = parseInt(getPart('minute'));
    
    // Get yesterday's date in PST (for close time lookup)
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
    const yesterdayStr = yesterdayFormatter.format(yesterday);
    
    // Get day of week for yesterday (0 = Sunday, 6 = Saturday)
    const yesterdayDayOfWeek = new Date(yesterdayStr).getDay();

    console.log(`[Auto-Punch] Running at ${getPart('hour')}:${getPart('minute')} PST`);
    console.log(`[Auto-Punch] Yesterday: ${yesterdayStr} (day ${yesterdayDayOfWeek})`);

    // Fetch all locations with their close times for yesterday
    const { data: locations, error: locError } = await supabase
      .from('locations')
      .select(`
        id,
        name,
        location_hours!inner(close_time, is_closed)
      `)
      .eq('location_hours.day_of_week', yesterdayDayOfWeek);

    if (locError) {
      throw new Error(`Failed to fetch locations: ${locError.message}`);
    }

    console.log(`[Auto-Punch] Found ${locations?.length || 0} locations with hours for day ${yesterdayDayOfWeek}`);

    for (const location of locations || []) {
      const locationHours = (location.location_hours as any[])?.[0];
      
      if (!locationHours || locationHours.is_closed) {
        console.log(`[Auto-Punch] ${location.name}: Closed yesterday, skipping`);
        continue;
      }

      const closeTime = locationHours.close_time;
      if (!closeTime) {
        console.log(`[Auto-Punch] ${location.name}: No close time configured, skipping`);
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
      
      // Only proceed if we're past the cutoff (e.g., 3 AM check for 10 PM + 3 hr = 1 AM cutoff)
      // Since we run at 3 AM, we should always be past a reasonable cutoff
      console.log(`[Auto-Punch] ${location.name}: Close ${closeTime}, cutoff ${Math.floor(cutoffMinutes / 60)}:${String(cutoffMinutes % 60).padStart(2, '0')}`);

      // Find open clock-ins from yesterday at this location
      const yesterdayStart = `${yesterdayStr}T00:00:00`;
      const yesterdayEnd = `${yesterdayStr}T23:59:59`;

      const { data: openPunches, error: punchError } = await supabase
        .from('time_punches')
        .select(`
          id,
          user_id,
          punch_time,
          profiles!inner(full_name)
        `)
        .eq('location_id', location.id)
        .eq('punch_type', 'clock_in')
        .gte('punch_time', yesterdayStart)
        .lte('punch_time', yesterdayEnd);

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
        // For a 10 PM close + 3 hr buffer = 1 AM the next day
        const autoPunchDate = new Date(yesterdayStr + 'T00:00:00');
        autoPunchDate.setMinutes(cutoffMinutes);
        
        // Convert to proper ISO string in PST
        const autoPunchTimeStr = new Date(
          autoPunchDate.getTime() + 
          (autoPunchDate.getTimezoneOffset() * 60 * 1000) + 
          (-8 * 60 * 60 * 1000) // PST offset
        ).toISOString();

        // Insert the auto clock-out
        const { error: insertError } = await supabase
          .from('time_punches')
          .insert({
            user_id: punch.user_id,
            location_id: location.id,
            punch_type: 'clock_out',
            punch_time: autoPunchTimeStr,
            notes: `Auto clocked out by system - ${POST_CLOSE_BUFFER_HOURS} hours post-close (${closeTime})`,
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
      timezone: TIMEZONE,
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
