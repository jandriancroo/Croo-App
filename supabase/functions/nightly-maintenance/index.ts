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

    console.log('[NIGHTLY-MAINTENANCE] Starting nightly maintenance tasks...');
    
    const results: { task: string; status: string; details?: any }[] = [];

    // =========================================================================
    // TASK 1: Refresh stale labor cache
    // =========================================================================
    console.log('[NIGHTLY-MAINTENANCE] Task 1: Refreshing stale labor cache...');
    
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/refresh-stale-labor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({})
      });

      if (response.ok) {
        const result = await response.json();
        results.push({ 
          task: 'refresh-stale-labor', 
          status: 'success', 
          details: { refreshed: result.refreshed, locations: result.locations?.length || 0 }
        });
        console.log(`[NIGHTLY-MAINTENANCE] ✓ Stale labor refresh: ${result.refreshed} records`);
      } else {
        results.push({ task: 'refresh-stale-labor', status: 'failed', details: { error: response.status } });
        console.error(`[NIGHTLY-MAINTENANCE] ✗ Stale labor refresh failed: ${response.status}`);
      }
    } catch (err) {
      results.push({ task: 'refresh-stale-labor', status: 'error', details: { error: String(err) } });
      console.error('[NIGHTLY-MAINTENANCE] ✗ Stale labor refresh error:', err);
    }

    // =========================================================================
    // TASK 2: Validate and fix any labor cache discrepancies from last 7 days
    // =========================================================================
    console.log('[NIGHTLY-MAINTENANCE] Task 2: Validating recent labor cache...');
    
    try {
      // Find any records where labor_hours doesn't match employee_breakdown sum
      const { data: discrepancies, error: discError } = await supabase
        .from('labor_cache')
        .select('id, location_id, labor_date, labor_hours, employee_breakdown')
        .eq('source', 'punch_clock')
        .gte('labor_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
        .not('employee_breakdown', 'is', null);

      if (discError) throw discError;

      let fixedCount = 0;
      const locationsToRefresh = new Set<string>();

      for (const record of discrepancies || []) {
        const breakdown = record.employee_breakdown as any[];
        if (!Array.isArray(breakdown)) continue;
        
        const breakdownSum = breakdown.reduce((sum, e) => sum + (e.hours || 0), 0);
        const diff = Math.abs(record.labor_hours - breakdownSum);
        
        if (diff > 0.01) {
          console.log(`[NIGHTLY-MAINTENANCE] Discrepancy found: ${record.labor_date} - cached: ${record.labor_hours.toFixed(2)}, breakdown: ${breakdownSum.toFixed(2)}`);
          locationsToRefresh.add(record.location_id);
          
          // Mark as stale to trigger refresh
          await supabase
            .from('labor_cache')
            .update({ is_stale: true })
            .eq('id', record.id);
          
          fixedCount++;
        }
      }

      // Trigger refresh for affected locations
      if (locationsToRefresh.size > 0) {
        await fetch(`${supabaseUrl}/functions/v1/refresh-stale-labor`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({})
        });
      }

      results.push({ 
        task: 'validate-labor-cache', 
        status: 'success', 
        details: { checked: discrepancies?.length || 0, discrepancies: fixedCount }
      });
      console.log(`[NIGHTLY-MAINTENANCE] ✓ Validated ${discrepancies?.length || 0} records, fixed ${fixedCount} discrepancies`);
      
    } catch (err) {
      results.push({ task: 'validate-labor-cache', status: 'error', details: { error: String(err) } });
      console.error('[NIGHTLY-MAINTENANCE] ✗ Validation error:', err);
    }

    // =========================================================================
    // TASK 3: Auto-punch employees who forgot to clock out
    // =========================================================================
    console.log('[NIGHTLY-MAINTENANCE] Task 3: Auto-punching forgotten clock-outs...');
    
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/auto-punch-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({})
      });

      if (response.ok) {
        const result = await response.json();
        results.push({ 
          task: 'auto-punch-out', 
          status: 'success', 
          details: { 
            punched: result.punched || 0, 
            skipped: result.skipped || 0,
            errors: result.errors || 0
          }
        });
        console.log(`[NIGHTLY-MAINTENANCE] ✓ Auto-punch: ${result.punched} punched, ${result.skipped} skipped`);
      } else {
        results.push({ task: 'auto-punch-out', status: 'failed', details: { error: response.status } });
        console.error(`[NIGHTLY-MAINTENANCE] ✗ Auto-punch failed: ${response.status}`);
      }
    } catch (err) {
      results.push({ task: 'auto-punch-out', status: 'error', details: { error: String(err) } });
      console.error('[NIGHTLY-MAINTENANCE] ✗ Auto-punch error:', err);
    }

    // =========================================================================
    // TASK 4: Backfill yesterday's labor for all locations (catch any missed)
    // =========================================================================
    console.log('[NIGHTLY-MAINTENANCE] Task 4: Backfilling yesterday labor...');
    
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      
      // Get all active locations
      const { data: locations } = await supabase
        .from('locations')
        .select('id, name')
        .eq('is_active', true);

      let backfilledCount = 0;
      
      for (const location of locations || []) {
        // Check if yesterday is already cached and not stale
        const { data: existing } = await supabase
          .from('labor_cache')
          .select('id, is_stale')
          .eq('location_id', location.id)
          .eq('labor_date', yesterday)
          .eq('source', 'punch_clock')
          .maybeSingle();

        if (!existing || existing.is_stale) {
          // Backfill this location for yesterday
          const response = await fetch(`${supabaseUrl}/functions/v1/backfill-punch-labor`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              locationId: location.id,
              startDate: yesterday,
              endDate: yesterday,
              forceRefresh: true
            })
          });

          if (response.ok) {
            backfilledCount++;
          }
        }
      }

      results.push({ 
        task: 'backfill-yesterday', 
        status: 'success', 
        details: { locations: locations?.length || 0, backfilled: backfilledCount }
      });
      console.log(`[NIGHTLY-MAINTENANCE] ✓ Backfilled ${backfilledCount}/${locations?.length || 0} locations for ${yesterday}`);
      
    } catch (err) {
      results.push({ task: 'backfill-yesterday', status: 'error', details: { error: String(err) } });
      console.error('[NIGHTLY-MAINTENANCE] ✗ Backfill error:', err);
    }

    console.log('[NIGHTLY-MAINTENANCE] Complete!');
    console.log('Results:', JSON.stringify(results, null, 2));

    return new Response(JSON.stringify({ 
      success: true, 
      results,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[NIGHTLY-MAINTENANCE] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
