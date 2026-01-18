import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

      // Get current time in location's timezone
      const now = new Date();
      const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const currentHour = localTime.getHours();
      const currentMinute = localTime.getMinutes();
      const currentDayOfWeek = localTime.getDay(); // 0 = Sunday

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

      // Calculate auto-punch time from close_time + buffer
      const { hour: autoPunchHour, minute: autoPunchMinute } = calculateAutoPunchTime(todayHours.close_time);

      // Get meal break hours from labor rules for break violation check
      const { data: laborRule } = await supabase
        .from('labor_rules')
        .select('meal_break_hours')
        .eq('location_id', location.id)
        .single();

      const mealBreakHours = laborRule?.meal_break_hours;

      // Determine if close time is past midnight (e.g., 00:00 or 01:00)
      const [closeHour] = todayHours.close_time.split(':').map(Number);
      const closeIsAfterMidnight = closeHour < 6; // Close times like 00:00, 01:00, 02:00 are "next day"

      // Check if we're currently past the auto-punch time
      // For midnight-crossing stores: auto-punch hour will be like 3 (3 AM)
      // We need to be careful about when "today" actually is
      let isPastAutoPunchTime: boolean;
      
      if (closeIsAfterMidnight) {
        // Store closes after midnight (e.g., 12 AM = 00:00, auto-punch at 3 AM)
        // We're past auto-punch if current hour >= auto-punch hour AND current hour < opening hour
        isPastAutoPunchTime = currentHour >= autoPunchHour && currentHour < 6;
      } else if (autoPunchHour < closeHour) {
        // Auto-punch time wraps to next day (e.g., close at 11 PM, auto-punch at 2 AM)
        isPastAutoPunchTime = currentHour >= autoPunchHour && currentHour < 6;
      } else {
        // Normal case: auto-punch is on the same day
        isPastAutoPunchTime = 
          currentHour > autoPunchHour || 
          (currentHour === autoPunchHour && currentMinute >= autoPunchMinute);
      }

      // Find all employees at this location who are still clocked in
      // Look back up to 7 days (168 hours) to catch overnight shifts and any missed days
      const lookbackTime = new Date(now.getTime() - 168 * 60 * 60 * 1000);
      
      const { data: openPunches, error: punchError } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_time, shift_id')
        .eq('location_id', location.id)
        .eq('punch_type', 'clock_in')
        .gte('punch_time', lookbackTime.toISOString())
        .order('punch_time', { ascending: true });

      if (punchError) {
        console.error('Error fetching open punches:', punchError);
        continue;
      }

      for (const clockIn of openPunches || []) {
        // Check if there's already a clock_out for this clock_in (including auto-punch-outs)
        // This prevents duplicate auto-punch-outs from being created
        const { data: clockOuts, error: clockOutError } = await supabase
          .from('time_punches')
          .select('id, punch_time, is_auto_punched_out')
          .eq('user_id', clockIn.user_id)
          .eq('location_id', location.id)
          .eq('punch_type', 'clock_out')
          .gte('punch_time', clockIn.punch_time)
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
        const clockInTime = new Date(clockIn.punch_time);
        const clockInLocal = new Date(clockInTime.toLocaleString('en-US', { timeZone: timezone }));
        const clockInHour = clockInLocal.getHours();
        
        // Determine the "business date" for this clock-in
        // If someone clocked in after midnight but before the cutoff, 
        // their business date is actually the previous calendar day
        let businessDate = new Date(clockInLocal);
        if (clockInHour < autoPunchHour && clockInHour < 6) {
          // Clock in was in the early morning (after midnight, before cutoff)
          // This belongs to the previous business day
          businessDate.setDate(businessDate.getDate() - 1);
        }
        const businessDateStr = businessDate.toISOString().slice(0, 10);
        
        // Get today's business date
        let todayBusinessDate = new Date(localTime);
        if (currentHour < autoPunchHour && currentHour < 6) {
          todayBusinessDate.setDate(todayBusinessDate.getDate() - 1);
        }
        const todayBusinessDateStr = todayBusinessDate.toISOString().slice(0, 10);

        // Determine when this shift should be auto-punched out
        let shouldAutoPunch = false;
        let autoPunchTime: Date;

        if (businessDateStr < todayBusinessDateStr) {
          // Shift is from a previous business day - it was missed
          // Get the close time for the day they clocked in
          const clockInDayOfWeek = businessDate.getDay();
          const { data: clockInDayHours } = await supabase
            .from('location_hours')
            .select('close_time')
            .eq('location_id', location.id)
            .eq('day_of_week', clockInDayOfWeek)
            .single();

          if (!clockInDayHours?.close_time) {
            continue; // No hours for that day
          }

          const { hour: shiftAutoPunchHour, minute: shiftAutoPunchMinute } = calculateAutoPunchTime(clockInDayHours.close_time);
          
          // Set the punch time to the auto-punch time on the appropriate day
          const [shiftCloseHour] = clockInDayHours.close_time.split(':').map(Number);
          autoPunchTime = new Date(businessDate);
          
          if (shiftCloseHour < 6 || shiftAutoPunchHour < shiftCloseHour) {
            // Close time is after midnight or auto-punch wraps to next day
            autoPunchTime.setDate(autoPunchTime.getDate() + 1);
          }
          autoPunchTime.setHours(shiftAutoPunchHour, shiftAutoPunchMinute, 0, 0);
          
          shouldAutoPunch = true;
          console.log(`Found missed shift from ${businessDateStr} for user ${clockIn.user_id} at ${location.name}`);
        } else if (businessDateStr === todayBusinessDateStr && isPastAutoPunchTime) {
          // Shift is from today's business day and we're past auto-punch time
          autoPunchTime = new Date(localTime);
          
          // If auto-punch time is after midnight, might be "tomorrow" calendar-wise
          if (autoPunchHour < 6) {
            // Auto-punch is early morning, so if we're currently in early morning, same day
            // If we're currently late night, auto-punch would be next calendar day
            if (currentHour >= 18) {
              autoPunchTime.setDate(autoPunchTime.getDate() + 1);
            }
          }
          autoPunchTime.setHours(autoPunchHour, autoPunchMinute, 0, 0);
          
          // Only auto-punch if clock_in was before auto-punch time
          if (clockInTime < autoPunchTime) {
            shouldAutoPunch = true;
          }
        }

        if (!shouldAutoPunch) {
          continue;
        }

        // Calculate shift hours to check for break violation
        const shiftHours = (autoPunchTime!.getTime() - clockInTime.getTime()) / 3600000;
        
        // Sanity check: don't create punches for unreasonably long shifts (>16 hours means something is wrong)
        if (shiftHours > 16) {
          console.warn(`Skipping auto-punch for user ${clockIn.user_id} - shift would be ${shiftHours.toFixed(1)} hours`);
          continue;
        }

        const hasBreakViolation = mealBreakHours 
          ? shiftHours > mealBreakHours 
          : shiftHours > 5;

        // Check for an existing meal break
        const { data: breaks } = await supabase
          .from('time_punches')
          .select('id')
          .eq('user_id', clockIn.user_id)
          .eq('location_id', location.id)
          .eq('punch_type', 'break_start')
          .gte('punch_time', clockIn.punch_time)
          .lte('punch_time', autoPunchTime!.toISOString());

        const actualBreakViolation = hasBreakViolation && (!breaks || breaks.length === 0);

        const { error: insertError } = await supabase
          .from('time_punches')
          .insert({
            user_id: clockIn.user_id,
            location_id: location.id,
            shift_id: clockIn.shift_id,
            punch_type: 'clock_out',
            punch_time: autoPunchTime!.toISOString(),
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
