import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const defaultChecklistId = '9eaed930-e88a-4874-9045-b4c7fb91e6bd';

    let checklistId = defaultChecklistId;
    try {
      const body = await req.json();
      if (body?.checklist_id) {
        checklistId = body.checklist_id;
      }
    } catch {
      // no body provided, use default
    }

    console.log('Starting Alle photo backfill for checklist:', checklistId);

    // Find Alle Rowe's user id
    const { data: alleProfile, error: alleError } = await supabaseClient
      .from('profiles')
      .select('id, full_name')
      .ilike('full_name', 'alle rowe%')
      .maybeSingle();

    if (alleError) {
      console.error('Error fetching Alle profile:', alleError);
      throw alleError;
    }

    if (!alleProfile) {
      throw new Error('Could not find user with name starting "Alle Rowe"');
    }

    console.log('Using Alle user id:', alleProfile.id);

    // Get all checklist_items for this checklist
    const { data: items, error: itemsError } = await supabaseClient
      .from('checklist_items')
      .select('id')
      .eq('checklist_id', checklistId);

    if (itemsError) {
      console.error('Error fetching checklist items:', itemsError);
      throw itemsError;
    }

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No items found for checklist',
          updated: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const itemIds = items.map((i) => i.id);

    // Find photo responses for these items where completed_by is null
    const { data: responses, error: responsesError } = await supabaseClient
      .from('checklist_responses')
      .select('id, item_id, created_at, response_image_url, completed_by')
      .in('item_id', itemIds)
      .not('response_image_url', 'is', null)
      .is('completed_by', null);

    if (responsesError) {
      console.error('Error fetching responses:', responsesError);
      throw responsesError;
    }

    console.log(`Found ${responses?.length || 0} Alle photo responses to update`);

    if (!responses || responses.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No photo responses need updating for this checklist',
          updated: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    let updated = 0;
    let failed = 0;

    for (const response of responses) {
      const { error: updateError } = await supabaseClient
        .from('checklist_responses')
        .update({ completed_by: alleProfile.id })
        .eq('id', response.id);

      if (updateError) {
        console.error(`Error updating response ${response.id}:`, updateError);
        failed++;
      } else {
        updated++;
      }
    }

    console.log(`Alle backfill complete: ${updated} updated, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Alle photo backfill complete',
        updated,
        failed,
        checklistId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Alle backfill error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
