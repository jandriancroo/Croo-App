import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This function runs every minute via cron to auto-clock out employees
// who are still clocked in past their location's auto_punch_out_time.
// It also catches missed auto-punches from previous days.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all locations with auto_punch_out_time configured
    const { data: laborRules, error: rulesError } = await supabase
      .from('labor_rules')
      .select('location_id, auto_punch_out_time, meal_break_hours')
      .not('auto_punch_out_time', 'is', null);

    if (rulesError) {
      console.error('Error fetching labor rules:', rulesError);
      throw rulesError;
    }

    if (!laborRules || laborRules.length === 0) {
      return new Response(JSON.stringify({ message: 'No auto punch-out rules configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalAutoPunched = 0;

    for (const rule of laborRules) {
      // Get location timezone
      const { data: locationSettings } = await supabase
        .from('location_settings')
        .select('timezone')
        .eq('location_id', rule.location_id)
        .single();

      const timezone = locationSettings?.timezone || 'America/Los_Angeles';

      // Get current time in location's timezone
      const now = new Date();
      const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const currentHour = localTime.getHours();
      const currentMinute = localTime.getMinutes();

      // Parse auto punch out time (format: HH:MM:SS)
      const [autoPunchHour, autoPunchMinute] = rule.auto_punch_out_time.split(':').map(Number);

      // Check if we're currently past the auto-punch time today
      const isPastAutoPunchTime = 
        currentHour > autoPunchHour || 
        (currentHour === autoPunchHour && currentMinute >= autoPunchMinute);

      // Find all employees at this location who are still clocked in
      // Look back up to 48 hours to catch overnight shifts and missed days
      const lookbackTime = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      
      const { data: openPunches, error: punchError } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_time, shift_id')
        .eq('location_id', rule.location_id)
        .eq('punch_type', 'clock_in')
        .gte('punch_time', lookbackTime.toISOString())
        .order('punch_time', { ascending: true });

      if (punchError) {
        console.error('Error fetching open punches:', punchError);
        continue;
      }

      for (const clockIn of openPunches || []) {
        // Check if there's already a clock_out for this clock_in
        const { data: clockOuts } = await supabase
          .from('time_punches')
          .select('id')
          .eq('user_id', clockIn.user_id)
          .eq('location_id', rule.location_id)
          .eq('punch_type', 'clock_out')
          .gte('punch_time', clockIn.punch_time);

        if (clockOuts && clockOuts.length > 0) {
          continue; // Already clocked out
        }

        // Convert clock_in to local time to determine its date
        const clockInTime = new Date(clockIn.punch_time);
        const clockInLocal = new Date(clockInTime.toLocaleString('en-US', { timeZone: timezone }));
        const clockInLocalDate = clockInLocal.toISOString().slice(0, 10);
        const todayLocalDate = localTime.toISOString().slice(0, 10);

        // Determine when this shift should be auto-punched out:
        // If shift is from a previous day, it should have been punched at auto_punch_out_time that day
        // If shift is from today and we're past auto_punch_out_time, punch now

        let shouldAutoPunch = false;
        let autoPunchTime: Date;

        if (clockInLocalDate < todayLocalDate) {
          // Shift is from a previous day - it was missed, auto-punch now
          // Set the punch time to the auto_punch_out_time on the day AFTER clock_in
          // (since overnight shifts should end after midnight)
          const nextDay = new Date(clockInLocal);
          nextDay.setDate(nextDay.getDate() + 1);
          nextDay.setHours(autoPunchHour, autoPunchMinute, 0, 0);
          autoPunchTime = nextDay;
          shouldAutoPunch = true;
          console.log(`Found missed shift from ${clockInLocalDate} for user ${clockIn.user_id}`);
        } else if (clockInLocalDate === todayLocalDate && isPastAutoPunchTime) {
          // Shift is from today and we're past auto-punch time
          autoPunchTime = new Date(localTime);
          autoPunchTime.setHours(autoPunchHour, autoPunchMinute, 0, 0);
          
          // Only auto-punch if clock_in was before auto-punch time
          if (clockInLocal < autoPunchTime) {
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

        const hasBreakViolation = rule.meal_break_hours 
          ? shiftHours > rule.meal_break_hours 
          : shiftHours > 5;

        // Check for an existing meal break
        const { data: breaks } = await supabase
          .from('time_punches')
          .select('id')
          .eq('user_id', clockIn.user_id)
          .eq('location_id', rule.location_id)
          .eq('punch_type', 'break_start')
          .gte('punch_time', clockIn.punch_time)
          .lte('punch_time', autoPunchTime!.toISOString());

        const actualBreakViolation = hasBreakViolation && (!breaks || breaks.length === 0);

        const { error: insertError } = await supabase
          .from('time_punches')
          .insert({
            user_id: clockIn.user_id,
            location_id: rule.location_id,
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
          console.log(`Auto punched out user ${clockIn.user_id} at location ${rule.location_id} (shift from ${clockInLocalDate})`);
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
