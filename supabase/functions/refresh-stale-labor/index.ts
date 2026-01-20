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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[REFRESH-STALE] Starting stale labor cache refresh...');

    // Get all stale records grouped by location
    const { data: staleRecords, error: staleError } = await supabase
      .from('labor_cache')
      .select('location_id, labor_date')
      .eq('is_stale', true)
      .eq('source', 'punch_clock');

    if (staleError) {
      throw new Error(`Failed to fetch stale records: ${staleError.message}`);
    }

    if (!staleRecords || staleRecords.length === 0) {
      console.log('[REFRESH-STALE] No stale records found');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No stale records to refresh',
        refreshed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[REFRESH-STALE] Found ${staleRecords.length} stale records`);

    // Group by location
    const byLocation = new Map<string, string[]>();
    for (const record of staleRecords) {
      if (!byLocation.has(record.location_id)) {
        byLocation.set(record.location_id, []);
      }
      byLocation.get(record.location_id)!.push(record.labor_date);
    }

    let totalRefreshed = 0;
    const results: { location: string; dates: number }[] = [];

    // Call backfill for each location's stale dates
    for (const [locationId, dates] of byLocation) {
      const sortedDates = dates.sort();
      const startDate = sortedDates[0];
      const endDate = sortedDates[sortedDates.length - 1];

      console.log(`[REFRESH-STALE] Refreshing ${locationId}: ${startDate} to ${endDate} (${dates.length} days)`);

      // Call the backfill function
      const response = await fetch(`${supabaseUrl}/functions/v1/backfill-punch-labor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({
          locationId,
          startDate,
          endDate,
          forceRefresh: true
        })
      });

      if (response.ok) {
        const result = await response.json();
        totalRefreshed += result.processed || 0;
        results.push({ location: result.location || locationId, dates: result.processed || 0 });
        console.log(`[REFRESH-STALE] ✓ ${result.location}: ${result.processed} days refreshed`);
      } else {
        console.error(`[REFRESH-STALE] Failed for ${locationId}: ${response.status}`);
      }
    }

    console.log(`[REFRESH-STALE] Complete: ${totalRefreshed} total records refreshed`);

    return new Response(JSON.stringify({ 
      success: true, 
      refreshed: totalRefreshed,
      locations: results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[REFRESH-STALE] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
