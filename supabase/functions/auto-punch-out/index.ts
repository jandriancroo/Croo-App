import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DateTime } from 'https://esm.sh/luxon@3.5.0';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Business day cutoff is close_time + 3 hours
const BUSINESS_DAY_BUFFER_HOURS = 3;

/**
 * Calculate the auto-punch-out time based on close_time + buffer
 * This creates a unified "business day cutoff" across the entire system
 */
function calculateAutoPunchTime(closeTime: string): { hour: number; minute: number } {
  const [closeHour, closeMinute] = closeTime.split(':').map(Number);
  
  // Add buffer hours to close time
  let autoPunchHour = closeHour + BUSINESS_DAY_BUFFER_HOURS;
  
  // Handle overflow past 24 hours (next day)
  if (autoPunchHour >= 24) {
    autoPunchHour = autoPunchHour - 24;
  }
  
  return { hour: autoPunchHour, minute: closeMinute };
}

// This function runs every minute via cron to auto-clock out employees
// who are still clocked in past their location's business day cutoff (close_time + 3 hours).
// It also catches missed auto-punches from previous days.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all locations that have business hours configured
    const { data: locations, error: locationsError } = await supabase
      .from('locations')
      .select('id, name');

    if (locationsError) {
      console.error('Error fetching locations:', locationsError);
      throw locationsError;
    }

    if (!locations || locations.length === 0) {
      return new Response(JSON.stringify({ message: 'No locations found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalAutoPunched = 0;

    for (const location of locations) {
      // Get location timezone
      const { data: locationSettings } = await supabase
        .from('location_settings')
        .select('timezone')
        .eq('location_id', location.id)
        .single();

      const timezone = locationSettings?.timezone || 'America/Los_Angeles';

      // Get current time in location's timezone (reliably)
      const localNow = DateTime.utc().setZone(timezone);
      const currentHour = localNow.hour;
      const currentMinute = localNow.minute;
      const currentDayOfWeek = localNow.weekday % 7; // Luxon: 1=Mon..7=Sun → 0=Sun

      // Get business hours for today
      const { data: todayHours } = await supabase
        .from('location_hours')
        .select('close_time, is_closed')
        .eq('location_id', location.id)
        .eq('day_of_week', currentDayOfWeek)
        .single();

      if (!todayHours || todayHours.is_closed || !todayHours.close_time) {
        // No business hours configured for today, skip
        continue;
      }

      // Calculate the business-day cutoff time (close_time + buffer) as a concrete timestamp
      const [closeHour, closeMinute] = todayHours.close_time.split(':').map(Number);
      let closeDt = DateTime.fromISO(localNow.toISODate() ?? localNow.toFormat('yyyy-MM-dd'), { zone: timezone }).set({
        hour: closeHour,
        minute: closeMinute,
        second: 0,
        millisecond: 0,
      });

      // If the store "closes" after midnight (00:00–05:59), that close belongs to the next calendar day
      if (closeHour < 6) {
        closeDt = closeDt.plus({ days: 1 });
      }

      const autoPunchDt = closeDt.plus({ hours: BUSINESS_DAY_BUFFER_HOURS });
      const isPastAutoPunchTime = localNow >= autoPunchDt;

      // Keep hour/minute values for business-date logic below
      const autoPunchHour = autoPunchDt.hour;
      const autoPunchMinute = autoPunchDt.minute;

      // Get meal break hours from labor rules for break violation check
      const { data: laborRule } = await supabase
        .from('labor_rules')
        .select('meal_break_hours')
        .eq('location_id', location.id)
        .single();

      const mealBreakHours = laborRule?.meal_break_hours;
      // Look back up to 7 days (168 hours) to catch overnight shifts and any missed days
      const lookbackTimeIso = DateTime.utc().minus({ hours: 168 }).toISO()!;
      
      const { data: openPunches, error: punchError } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_time, shift_id')
        .eq('location_id', location.id)
        .eq('punch_type', 'clock_in')
        .gte('punch_time', lookbackTimeIso)
        .order('punch_time', { ascending: true });

      if (punchError) {
        console.error('Error fetching open punches:', punchError);
        continue;
      }

      for (const clockIn of openPunches || []) {
        // Check if there's already a clock_out for this clock_in (including auto-punch-outs)
        // This prevents duplicate auto-punch-outs from being created
        let clockOutQuery = supabase
          .from('time_punches')
          .select('id, punch_time, is_auto_punched_out')
          .eq('user_id', clockIn.user_id)
          .eq('location_id', location.id)
          .eq('punch_type', 'clock_out');

        // Prefer matching by shift_id when present (more reliable than time ranges)
        if (clockIn.shift_id) {
          clockOutQuery = clockOutQuery.eq('shift_id', clockIn.shift_id);
        }

        const { data: clockOuts, error: clockOutError } = await clockOutQuery
          .gte('punch_time', clockIn.punch_time)
          .order('punch_time', { ascending: true })
          .limit(1);

        if (clockOutError) {
          console.error('Error checking for existing clock_out:', clockOutError);
          continue;
        }

        if (clockOuts && clockOuts.length > 0) {
          // Already has a clock_out after this clock_in, skip
          console.log(`Skipping user ${clockIn.user_id} - already has clock_out at ${clockOuts[0].punch_time}`);
          continue;
        }

        // Convert clock_in to local time to determine its date
        const clockInTimeUtc = DateTime.fromISO(clockIn.punch_time, { zone: 'utc' });
        const clockInLocal = clockInTimeUtc.setZone(timezone);
        const clockInHour = clockInLocal.hour;

        // Determine the "business date" for this clock-in
        // If someone clocked in after midnight but before the cutoff, their business date is the previous calendar day
        let businessDate = clockInLocal;
        if (clockInHour < autoPunchHour && clockInHour < 6) {
          businessDate = businessDate.minus({ days: 1 });
        }
        const businessDateStr = businessDate.toISODate()!;

        // Get today's business date
        let todayBusinessDate = localNow;
        if (currentHour < autoPunchHour && currentHour < 6) {
          todayBusinessDate = todayBusinessDate.minus({ days: 1 });
        }
        const todayBusinessDateStr = todayBusinessDate.toISODate()!;

        // Determine when this shift should be auto-punched out
        let autoPunchTimeUtc: DateTime | null = null;

        if (businessDateStr < todayBusinessDateStr) {
          // Shift is from a previous business day - it was missed
          // Get the close time for the business day they clocked in
          const clockInDayOfWeek = businessDate.weekday % 7;
          const { data: clockInDayHours } = await supabase
            .from('location_hours')
            .select('close_time')
            .eq('location_id', location.id)
            .eq('day_of_week', clockInDayOfWeek)
            .single();

          if (!clockInDayHours?.close_time) {
            continue; // No hours for that day
          }

          const [shiftCloseHour, shiftCloseMinute] = clockInDayHours.close_time.split(':').map(Number);
          let shiftCloseDt = DateTime.fromISO(businessDateStr, { zone: timezone }).set({
            hour: shiftCloseHour,
            minute: shiftCloseMinute,
            second: 0,
            millisecond: 0,
          });
          if (shiftCloseHour < 6) {
            shiftCloseDt = shiftCloseDt.plus({ days: 1 });
          }

          autoPunchTimeUtc = shiftCloseDt.plus({ hours: BUSINESS_DAY_BUFFER_HOURS }).toUTC();
          console.log(`Found missed shift from ${businessDateStr} for user ${clockIn.user_id} at ${location.name}`);
        } else if (businessDateStr === todayBusinessDateStr && isPastAutoPunchTime) {
          // Shift is from today's business day and we're past auto-punch time
          autoPunchTimeUtc = autoPunchDt.toUTC();
        }

        if (!autoPunchTimeUtc) {
          continue;
        }

        // Guardrail: never create an auto clock_out at/before clock_in (prevents "clocked out after 1 hour" bugs)
        if (autoPunchTimeUtc <= clockInTimeUtc) {
          console.warn(
            `Skipping auto-punch for user ${clockIn.user_id} at ${location.name} - cutoff (${autoPunchTimeUtc.toISO()}) is <= clock_in (${clockInTimeUtc.toISO()})`
          );
          continue;
        }

        // Calculate shift hours to check for break violation
        const shiftHours = autoPunchTimeUtc.diff(clockInTimeUtc, 'hours').hours;

        // Sanity check: don't create punches for unreasonably long shifts (>16 hours means something is wrong)
        if (shiftHours > 16) {
          console.warn(`Skipping auto-punch for user ${clockIn.user_id} - shift would be ${shiftHours.toFixed(1)} hours`);
          continue;
        }

        const hasBreakViolation = mealBreakHours ? shiftHours > mealBreakHours : shiftHours > 5;

        // Check for an existing meal break
        const { data: breaks } = await supabase
          .from('time_punches')
          .select('id')
          .eq('user_id', clockIn.user_id)
          .eq('location_id', location.id)
          .eq('punch_type', 'break_start')
          .gte('punch_time', clockIn.punch_time)
          .lte('punch_time', autoPunchTimeUtc.toISO()!);

        const actualBreakViolation = hasBreakViolation && (!breaks || breaks.length === 0);

        const { error: insertError } = await supabase
          .from('time_punches')
          .insert({
            user_id: clockIn.user_id,
            location_id: location.id,
            shift_id: clockIn.shift_id,
            punch_type: 'clock_out',
            punch_time: autoPunchTimeUtc.toISO()!,
            notes: 'Auto clocked out by system',
            is_auto_punched_out: true,
            has_break_violation: actualBreakViolation,
          });

        if (insertError) {
          console.error('Error creating auto punch-out:', insertError);
        } else {
          totalAutoPunched++;
          console.log(`Auto punched out user ${clockIn.user_id} at ${location.name} (business date ${businessDateStr})`);
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      autoPunchedCount: totalAutoPunched 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Auto punch-out error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
