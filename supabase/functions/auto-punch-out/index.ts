import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This function runs every minute via cron to auto-clock out employees
// who are still clocked in past their location's auto_punch_out_time
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
      const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

      // Parse auto punch out time (format: HH:MM:SS)
      const autoPunchOutTime = rule.auto_punch_out_time.substring(0, 5);

      // Check if current time matches or has passed auto punch-out time (within 1 minute window)
      if (currentTimeStr !== autoPunchOutTime) {
        continue;
      }

      // Find all employees at this location who are still clocked in
      // (have a clock_in without a matching clock_out today)
      const todayStart = new Date(localTime);
      todayStart.setHours(0, 0, 0, 0);
      
      const { data: openPunches, error: punchError } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_time')
        .eq('location_id', rule.location_id)
        .eq('punch_type', 'clock_in')
        .gte('punch_time', todayStart.toISOString())
        .is('approved_at', null);

      if (punchError) {
        console.error('Error fetching open punches:', punchError);
        continue;
      }

      for (const clockIn of openPunches || []) {
        // Check if there's already a clock_out for this user today
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

        // Create auto clock-out at the auto_punch_out_time
        const autoClockOutTime = new Date(localTime);
        const [hours, minutes] = autoPunchOutTime.split(':').map(Number);
        autoClockOutTime.setHours(hours, minutes, 0, 0);

        // Calculate shift hours to check for break violation
        const clockInTime = new Date(clockIn.punch_time);
        const shiftHours = (autoClockOutTime.getTime() - clockInTime.getTime()) / 3600000;
        const hasBreakViolation = rule.meal_break_hours 
          ? shiftHours > rule.meal_break_hours 
          : shiftHours > 5;

        const { error: insertError } = await supabase
          .from('time_punches')
          .insert({
            user_id: clockIn.user_id,
            location_id: rule.location_id,
            punch_type: 'clock_out',
            punch_time: autoClockOutTime.toISOString(),
            notes: 'Auto clocked out by system',
            is_auto_punched_out: true,
            has_break_violation: hasBreakViolation,
          });

        if (insertError) {
          console.error('Error creating auto punch-out:', insertError);
        } else {
          totalAutoPunched++;
          console.log(`Auto punched out user ${clockIn.user_id} at location ${rule.location_id}`);
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
