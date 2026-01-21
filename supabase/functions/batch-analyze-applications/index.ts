import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { locationId, limit = 50 } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Build query for unanalyzed applications
    let query = supabase
      .from('job_applications')
      .select('id, full_name, resume_url')
      .is('ai_analyzed_at', null)
      .order('submitted_at', { ascending: false })
      .limit(limit);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data: applications, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching applications:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch applications' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${applications?.length || 0} unanalyzed applications`);

    const results: Array<{ id: string; name: string; success: boolean; isMatch?: boolean; error?: string }> = [];

    // Process each application sequentially to avoid rate limits
    for (const app of applications || []) {
      console.log(`Analyzing: ${app.full_name} (${app.id})`);
      
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/analyze-application`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ applicationId: app.id }),
        });

        if (response.ok) {
          const data = await response.json();
          results.push({
            id: app.id,
            name: app.full_name,
            success: true,
            isMatch: data.isMatch,
          });
        } else {
          const errorText = await response.text();
          results.push({
            id: app.id,
            name: app.full_name,
            success: false,
            error: errorText,
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({
          id: app.id,
          name: app.full_name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const matchCount = results.filter(r => r.isMatch).length;

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      successful: successCount,
      matches: matchCount,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in batch-analyze-applications:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
