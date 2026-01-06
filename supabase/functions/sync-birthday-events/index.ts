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

    // Get all active profiles with birthdays AND their location assignments
    const { data: profiles, error: profilesError } = await supabaseClient
      .from('profiles')
      .select('id, full_name, birthday')
      .eq('is_active', true)
      .not('birthday', 'is', null);

    if (profilesError) throw profilesError;

    // Get user_locations to know which locations each user belongs to
    const { data: userLocations, error: userLocationsError } = await supabaseClient
      .from('user_locations')
      .select('user_id, location_id');

    if (userLocationsError) throw userLocationsError;

    // Build a map of user_id -> location_ids
    const userLocationMap = new Map<string, string[]>();
    for (const ul of userLocations || []) {
      if (!userLocationMap.has(ul.user_id)) {
        userLocationMap.set(ul.user_id, []);
      }
      userLocationMap.get(ul.user_id)!.push(ul.location_id);
    }

    // Build a set of expected (user_id, location_id) combos for active birthday holidays
    const expectedCombos = new Set<string>();
    const birthdayHolidays = [];
    const today = new Date();
    
    for (const profile of profiles || []) {
      if (!profile.birthday) continue;

      // Get month and day from birthday
      const [year, month, day] = profile.birthday.split('-').map(Number);
      
      // Create date for this year (holidays table stores actual dates)
      const thisYearBirthday = new Date(today.getFullYear(), month - 1, day);
      const holidayDate = thisYearBirthday.toISOString().split('T')[0];

      // Get this user's locations
      const locationIds = userLocationMap.get(profile.id) || [];

      if (locationIds.length === 0) {
        continue;
      }

      // Create a birthday holiday for EACH location the user is assigned to
      for (const locationId of locationIds) {
        const comboKey = `${profile.id}:${locationId}`;
        expectedCombos.add(comboKey);
        
        birthdayHolidays.push({
          holiday_name: `🎂 ${profile.full_name}'s Birthday`,
          holiday_date: holidayDate,
          holiday_type: 'birthday',
          user_id: profile.id,
          location_id: locationId,
          is_recurring: true
        });
      }
    }

    // Get existing birthday holidays
    const { data: existingHolidays, error: existingError } = await supabaseClient
      .from('holidays')
      .select('id, user_id, location_id')
      .eq('holiday_type', 'birthday');

    if (existingError) throw existingError;

    // Find holidays to delete (no longer valid - user removed, location removed, etc.)
    // Also find duplicates to delete (keep only first one per user/location combo)
    const seenCombos = new Map<string, string>(); // combo -> first holiday id
    const toDelete: string[] = [];
    
    for (const h of existingHolidays || []) {
      const comboKey = `${h.user_id}:${h.location_id}`;
      
      if (!expectedCombos.has(comboKey)) {
        // This holiday is no longer valid (user/location combo not expected)
        toDelete.push(h.id);
      } else if (seenCombos.has(comboKey)) {
        // Duplicate! Delete this one
        toDelete.push(h.id);
      } else {
        // First occurrence of this combo
        seenCombos.set(comboKey, h.id);
      }
    }

    // Delete invalid/duplicate holidays
    if (toDelete.length > 0) {
      const { error: deleteError } = await supabaseClient
        .from('holidays')
        .delete()
        .in('id', toDelete);

      if (deleteError) throw deleteError;
    }

    // Find new holidays to insert (not already in DB)
    const toInsert = birthdayHolidays.filter(h => {
      const comboKey = `${h.user_id}:${h.location_id}`;
      return !seenCombos.has(comboKey);
    });

    // Insert new birthday holidays
    if (toInsert.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('holidays')
        .insert(toInsert);

      if (insertError) throw insertError;
    }

    // Update existing holidays with correct date/name (in case birthday changed)
    for (const h of birthdayHolidays) {
      const comboKey = `${h.user_id}:${h.location_id}`;
      const existingId = seenCombos.get(comboKey);
      
      if (existingId) {
        const { error: updateError } = await supabaseClient
          .from('holidays')
          .update({
            holiday_name: h.holiday_name,
            holiday_date: h.holiday_date,
          })
          .eq('id', existingId);

        if (updateError) {
          console.error('Error updating holiday:', updateError);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        message: `Synced birthday holidays: ${toInsert.length} added, ${toDelete.length} removed`,
        added: toInsert.length,
        removed: toDelete.length,
        total: birthdayHolidays.length
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
