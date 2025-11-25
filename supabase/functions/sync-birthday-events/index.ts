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

    // Get all active profiles with birthdays
    const { data: profiles, error: profilesError } = await supabaseClient
      .from('profiles')
      .select('id, full_name, birthday')
      .eq('is_active', true)
      .not('birthday', 'is', null);

    if (profilesError) throw profilesError;

    // Delete existing birthday holidays
    await supabaseClient
      .from('holidays')
      .delete()
      .eq('holiday_type', 'birthday');

    // Create birthday holidays for each user
    const birthdayHolidays = [];
    const today = new Date();
    
    for (const profile of profiles || []) {
      if (!profile.birthday) continue;

      // Get month and day from birthday
      const [year, month, day] = profile.birthday.split('-').map(Number);
      
      // Create date for this year (holidays table stores actual dates)
      const thisYearBirthday = new Date(today.getFullYear(), month - 1, day);

      birthdayHolidays.push({
        holiday_name: `🎂 ${profile.full_name}'s Birthday`,
        holiday_date: thisYearBirthday.toISOString().split('T')[0],
        holiday_type: 'birthday',
        user_id: profile.id,
        is_recurring: true
      });
    }

    // Insert new birthday holidays
    if (birthdayHolidays.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('holidays')
        .insert(birthdayHolidays);

      if (insertError) throw insertError;
    }

    return new Response(
      JSON.stringify({ 
        message: `Synced ${birthdayHolidays.length} birthday holidays`,
        count: birthdayHolidays.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('Error syncing birthday holidays:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});