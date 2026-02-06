import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get yesterday's date in America/Los_Angeles timezone
function getYesterdayInLA(): string {
  const now = new Date();
  const laTime = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  
  // Parse the LA date and subtract 1 day
  const [year, month, day] = laTime.split('-').map(Number);
  const laDate = new Date(year, month - 1, day);
  laDate.setDate(laDate.getDate() - 1);
  
  return laDate.toISOString().slice(0, 10);
}

// Get current day of week in LA (0 = Sunday)
function getCurrentDayOfWeekInLA(): number {
  const now = new Date();
  const laWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  }).format(now);
  
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return dayMap[laWeekday] ?? 0;
}

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
    
    // Get yesterday's date for daily summaries
    const yesterday = getYesterdayInLA();
    const currentDayOfWeek = getCurrentDayOfWeekInLA();
    
    console.log(`[NIGHTLY-MAINTENANCE] Yesterday (LA): ${yesterday}, Current day: ${currentDayOfWeek} (0=Sun)`);
    
    // Get all active locations for processing
    const { data: allLocations } = await supabase
      .from('locations')
      .select('id, name')
      .eq('is_active', true);
    
    console.log(`[NIGHTLY-MAINTENANCE] Found ${allLocations?.length || 0} active locations`);

    // =========================================================================
    // TASK 1: Refresh stale labor cache
    // =========================================================================
    console.log('[NIGHTLY-MAINTENANCE] Task 1: Refreshing stale labor cache...');
    
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/labor-service?action=refresh-stale`, {
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
        await fetch(`${supabaseUrl}/functions/v1/labor-service?action=refresh-stale`, {
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

    // =========================================================================
    // TASK 5: Send daily logbook summaries for yesterday (no longer dependent on safe count)
    // =========================================================================
    console.log('[NIGHTLY-MAINTENANCE] Task 5: Sending daily logbook summaries...');
    
    try {
      let sentCount = 0;
      let skippedCount = 0;
      
      for (const location of allLocations || []) {
        // Check if summary already sent for this location/date
        const { data: existingLog } = await supabase
          .from('daily_summary_logs')
          .select('id')
          .eq('location_id', location.id)
          .eq('summary_date', yesterday)
          .maybeSingle();
        
        if (existingLog) {
          console.log(`[NIGHTLY-MAINTENANCE] Daily summary already sent for ${location.name} on ${yesterday}`);
          skippedCount++;
          continue;
        }
        
        // Send the daily logbook summary
        const response = await fetch(`${supabaseUrl}/functions/v1/send-daily-logbook-summary`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            location_id: location.id,
            entry_date: yesterday
          })
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            sentCount++;
            console.log(`[NIGHTLY-MAINTENANCE] ✓ Daily summary sent for ${location.name}`);
          } else {
            console.log(`[NIGHTLY-MAINTENANCE] ○ Skipped ${location.name}: ${result.message || 'unknown reason'}`);
            skippedCount++;
          }
        } else {
          console.error(`[NIGHTLY-MAINTENANCE] ✗ Daily summary failed for ${location.name}: ${response.status}`);
          skippedCount++;
        }
      }
      
      results.push({ 
        task: 'daily-logbook-summaries', 
        status: 'success', 
        details: { sent: sentCount, skipped: skippedCount }
      });
      console.log(`[NIGHTLY-MAINTENANCE] ✓ Daily summaries: ${sentCount} sent, ${skippedCount} skipped`);
      
    } catch (err) {
      results.push({ task: 'daily-logbook-summaries', status: 'error', details: { error: String(err) } });
      console.error('[NIGHTLY-MAINTENANCE] ✗ Daily summaries error:', err);
    }

    // =========================================================================
    // TASK 6: Send weekly schedule emails (only on Monday morning at 3 AM)
    // =========================================================================
    console.log('[NIGHTLY-MAINTENANCE] Task 6: Checking if weekly schedule emails should be sent...');
    
    try {
      // Only run on Monday (day 1)
      if (currentDayOfWeek === 1) {
        console.log('[NIGHTLY-MAINTENANCE] It is Monday - sending weekly schedule emails');
        
        let sentLocations = 0;
        
        for (const location of allLocations || []) {
          // Get the current week's schedule for this location
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date());
          
          const { data: schedule } = await supabase
            .from('schedules')
            .select('id, week_start_date, week_end_date')
            .eq('location_id', location.id)
            .lte('week_start_date', today)
            .gte('week_end_date', today)
            .maybeSingle();
          
          if (!schedule) {
            console.log(`[NIGHTLY-MAINTENANCE] No current schedule for ${location.name}`);
            continue;
          }
          
          // Send weekly schedule emails
          const response = await fetch(`${supabaseUrl}/functions/v1/send-weekly-schedule-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              schedule_id: schedule.id,
              location_id: location.id
            })
          });
          
          if (response.ok) {
            const result = await response.json();
            sentLocations++;
            console.log(`[NIGHTLY-MAINTENANCE] ✓ Weekly emails sent for ${location.name}: ${result.sent_count || 0} emails`);
          } else {
            console.error(`[NIGHTLY-MAINTENANCE] ✗ Weekly emails failed for ${location.name}: ${response.status}`);
          }
        }
        
        results.push({ 
          task: 'weekly-schedule-emails', 
          status: 'success', 
          details: { locations: sentLocations, day: 'Monday' }
        });
      } else {
        console.log(`[NIGHTLY-MAINTENANCE] Skipping weekly emails (not Monday, current day: ${currentDayOfWeek})`);
        results.push({ 
          task: 'weekly-schedule-emails', 
          status: 'skipped', 
          details: { reason: 'not Monday', currentDayOfWeek }
        });
      }
      
    } catch (err) {
      results.push({ task: 'weekly-schedule-emails', status: 'error', details: { error: String(err) } });
      console.error('[NIGHTLY-MAINTENANCE] ✗ Weekly emails error:', err);
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
