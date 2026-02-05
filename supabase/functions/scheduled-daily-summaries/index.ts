import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Parse time string (HH:MM or HH:MM:SS) to minutes since midnight
function parseTimeToMinutes(timeStr: string | null): number {
  if (!timeStr) return 21 * 60; // Default 9 PM
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0] || '21', 10);
  const minutes = parseInt(parts[1] || '0', 10);
  return hours * 60 + minutes;
}

// Get current time in minutes for a timezone
function getCurrentMinutesInTimezone(timezone: string): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  return hour * 60 + minute;
}

// Get today's date in a timezone
function getTodayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase credentials");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse optional parameters
    let forceLocationId: string | null = null;
    let forceDate: string | null = null;
    
    try {
      const body = await req.json();
      forceLocationId = body.location_id || null;
      forceDate = body.entry_date || null;
    } catch {
      // No body is fine for cron triggers
    }

    console.log('[scheduled-daily-summaries] Starting check...');
    
    // Fetch all active locations with their settings and hours
    const { data: locationsRaw, error: locError } = await supabase
      .from('locations')
      .select('id, name');

    if (locError) {
      throw new Error(`Failed to fetch locations: ${locError.message}`);
    }

    // Fetch location settings for timezone
    const { data: settingsData } = await supabase
      .from('location_settings')
      .select('location_id, timezone');

    // Fetch location hours for close_time (Sunday = 0 for default)
    const { data: hoursData } = await supabase
      .from('location_hours')
      .select('location_id, day_of_week, close_time');

    // Build lookup maps
    const settingsMap = new Map((settingsData || []).map(s => [s.location_id, s.timezone]));
    const hoursMap = new Map<string, string>();
    for (const h of hoursData || []) {
      // Use day 1 (Monday) or 0 (Sunday) as default close time
      if (h.day_of_week === 1 || !hoursMap.has(h.location_id)) {
        hoursMap.set(h.location_id, h.close_time);
      }
    }

    // Combine into locations with close_time and timezone
    const locations = (locationsRaw || []).map(loc => ({
      id: loc.id,
      name: loc.name,
      close_time: hoursMap.get(loc.id) || '21:00',
      timezone: settingsMap.get(loc.id) || 'America/Los_Angeles',
    }));

    console.log(`[scheduled-daily-summaries] Found ${locations?.length || 0} active locations`);

    const results: { location: string; status: string; reason?: string }[] = [];
    const HOURS_AFTER_CLOSE = 2; // Send summary 2 hours after close

    for (const location of locations || []) {
      const timezone = location.timezone || 'America/Los_Angeles';
      const todayStr = forceDate || getTodayInTimezone(timezone);
      
      // Skip if not the target location (when forcing)
      if (forceLocationId && location.id !== forceLocationId) {
        continue;
      }

      console.log(`\n[${location.name}] Checking...`);
      
      // Check if already sent
      const { data: existingLog } = await supabase
        .from('daily_summary_logs')
        .select('id')
        .eq('location_id', location.id)
        .eq('summary_date', todayStr)
        .maybeSingle();

      if (existingLog && !forceLocationId) {
        console.log(`[${location.name}] Already sent for ${todayStr}`);
        results.push({ location: location.name, status: 'skipped', reason: 'already_sent' });
        continue;
      }

      // Check if it's 2+ hours after close
      const closeMinutes = parseTimeToMinutes(location.close_time);
      const currentMinutes = getCurrentMinutesInTimezone(timezone);
      const sendAfterMinutes = closeMinutes + (HOURS_AFTER_CLOSE * 60);
      
      // Handle midnight wrap-around
      let shouldSend = false;
      if (sendAfterMinutes >= 24 * 60) {
        // Send time is after midnight - check if we're past midnight and before the wrapped time
        const wrappedMinutes = sendAfterMinutes - (24 * 60);
        shouldSend = currentMinutes >= wrappedMinutes && currentMinutes < closeMinutes;
      } else {
        shouldSend = currentMinutes >= sendAfterMinutes;
      }

      if (!shouldSend && !forceLocationId) {
        console.log(`[${location.name}] Not yet time (close: ${location.close_time}, need ${HOURS_AFTER_CLOSE}h after)`);
        results.push({ location: location.name, status: 'skipped', reason: 'not_time_yet' });
        continue;
      }

      // No longer require PM safe count or drawer count - send summary regardless
      // This ensures managers get the summary even if staff forgot to complete counts

      // Call the existing send-daily-logbook-summary function
      console.log(`[${location.name}] Sending summary for ${todayStr}...`);
      
      const response = await fetch(`${supabaseUrl}/functions/v1/send-daily-logbook-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          location_id: location.id,
          entry_date: todayStr,
        }),
      });

      const result = await response.json();
      
      if (response.ok && result.success) {
        // Log successful send
        await supabase
          .from('daily_summary_logs')
          .upsert({
            location_id: location.id,
            summary_date: todayStr,
            recipient_count: result.recipientCount || 0,
          }, { onConflict: 'location_id,summary_date' });

        console.log(`[${location.name}] ✓ Summary sent to ${result.recipientCount} recipients`);
        results.push({ location: location.name, status: 'sent' });
      } else {
        console.error(`[${location.name}] Failed:`, result.error || 'Unknown error');
        results.push({ location: location.name, status: 'failed', reason: result.error });
      }
    }

    console.log('\n[scheduled-daily-summaries] Complete');
    console.log('Results:', JSON.stringify(results, null, 2));

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[scheduled-daily-summaries] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
