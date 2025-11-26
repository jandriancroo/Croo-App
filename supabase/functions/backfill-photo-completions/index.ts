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

    console.log('Starting backfill of photo completions...');

    // Find all responses with photos but no completed_by
    const { data: responses, error: fetchError } = await supabaseClient
      .from('checklist_responses')
      .select('id, submission_id, response_image_url')
      .not('response_image_url', 'is', null)
      .is('completed_by', null);

    if (fetchError) {
      console.error('Error fetching responses:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${responses?.length || 0} photo responses without completed_by`);

    if (!responses || responses.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No photo responses need backfilling',
          updated: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Get unique submission IDs
    const submissionIds = [...new Set(responses.map(r => r.submission_id))];
    
    // Fetch all related submissions
    const { data: submissions, error: submissionsError } = await supabaseClient
      .from('checklist_submissions')
      .select('id, submitted_by')
      .in('id', submissionIds);

    if (submissionsError) {
      console.error('Error fetching submissions:', submissionsError);
      throw submissionsError;
    }

    // Create a map of submission_id -> submitted_by
    const submissionMap = new Map(
      submissions?.map(s => [s.id, s.submitted_by]) || []
    );

    // Update each response
    let updated = 0;
    let failed = 0;

    for (const response of responses) {
      const submittedBy = submissionMap.get(response.submission_id);
      
      if (!submittedBy) {
        console.warn(`No submitted_by found for submission ${response.submission_id}`);
        failed++;
        continue;
      }

      const { error: updateError } = await supabaseClient
        .from('checklist_responses')
        .update({ completed_by: submittedBy })
        .eq('id', response.id);

      if (updateError) {
        console.error(`Error updating response ${response.id}:`, updateError);
        failed++;
      } else {
        updated++;
      }
    }

    console.log(`Backfill complete: ${updated} updated, ${failed} failed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Backfill complete`,
        updated,
        failed,
        total: responses.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Backfill error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
