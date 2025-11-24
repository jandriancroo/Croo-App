import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get the current schedule
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
    
    const { data: schedule, error: scheduleError } = await supabaseClient
      .from('schedules')
      .select('id')
      .eq('week_start_date', startOfWeek.toISOString().split('T')[0])
      .single();

    if (scheduleError || !schedule) {
      console.log('No schedule for current week');
      return new Response(
        JSON.stringify({ message: 'No schedule for current week' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Get all active profiles with birthdays
    const { data: profiles, error: profilesError } = await supabaseClient
      .from('profiles')
      .select('id, full_name, birthday')
      .eq('is_active', true)
      .not('birthday', 'is', null);

    if (profilesError) throw profilesError;

    // Calculate which day of the week each birthday falls on this week
    const birthdayEvents = [];
    
    for (const profile of profiles || []) {
      if (!profile.birthday) continue;

      // Get month and day from birthday
      const [year, month, day] = profile.birthday.split('-').map(Number);
      
      // Create date for this year
      const thisYearBirthday = new Date(today.getFullYear(), month - 1, day);
      
      // Calculate day of week (0 = Monday, 6 = Sunday)
      let dayOfWeek = thisYearBirthday.getDay() - 1;
      if (dayOfWeek < 0) dayOfWeek = 6; // Sunday wraps to 6

      birthdayEvents.push({
        schedule_id: schedule.id,
        event_name: `🎂 ${profile.full_name}'s Birthday`,
        event_time: '00:00',
        day_of_week: dayOfWeek,
        notes: `Happy Birthday ${profile.full_name}!`,
        tagged_roles: null,
        is_recurring: true
      });
    }

    // Delete existing birthday events for this schedule
    await supabaseClient
      .from('schedule_events')
      .delete()
      .eq('schedule_id', schedule.id)
      .like('event_name', '🎂%');

    // Insert new birthday events
    if (birthdayEvents.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('schedule_events')
        .insert(birthdayEvents);

      if (insertError) throw insertError;
    }

    return new Response(
      JSON.stringify({ 
        message: `Synced ${birthdayEvents.length} birthday events`,
        events: birthdayEvents.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('Error syncing birthday events:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});