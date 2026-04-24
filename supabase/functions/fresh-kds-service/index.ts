import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FRESH_AUTH_URL = 'https://user-api.ftservices.cloud/auth';
const FRESH_KDS_BASE = 'https://kds-api.ftservices.cloud/metrics/orders';

// ============================================================================
// AUTH - Get Fresh KDS Bearer token
// ============================================================================

async function getFreshToken(): Promise<string> {
  const username = Deno.env.get('FRESH_KDS_USERNAME');
  const password = Deno.env.get('FRESH_KDS_PASSWORD');

  if (!username || !password) {
    throw new Error('FRESH_KDS_USERNAME or FRESH_KDS_PASSWORD not configured');
  }

  const res = await fetch(FRESH_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience: 'fresh-tools-web', username, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fresh KDS auth failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  if (!data.token) throw new Error('Fresh KDS auth response missing token');
  return data.token;
}

// ============================================================================
// API HELPERS
// ============================================================================

function buildMetricUrl(endpoint: string, kdsLocationId: string, dateFrom: string, dateTo: string): string {
  const url = new URL(`${FRESH_KDS_BASE}/${endpoint}`);
  url.searchParams.set('locationId', kdsLocationId);
  url.searchParams.set('dateFrom', `${dateFrom}T08:00:00.000Z`);
  url.searchParams.set('dateTo', `${dateTo}T07:59:59.999Z`);
  return url.toString();
}

async function fetchMetric(token: string, brandId: string, endpoint: string, kdsLocationId: string, dateFrom: string, dateTo: string) {
  const res = await fetch(buildMetricUrl(endpoint, kdsLocationId, dateFrom, dateTo), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-brand-id': brandId,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fresh KDS ${endpoint} failed: ${res.status} - ${text}`);
  }
  return await res.json();
}

// ============================================================================
// DATE HELPERS
// ============================================================================

function getDateStringForTimezone(date: Date, timezone: string): string {
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const year = tzDate.getFullYear();
  const month = String(tzDate.getMonth() + 1).padStart(2, '0');
  const day = String(tzDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Aggregate hourly results into daily totals by date
function aggregateCountsByDate(countsData: { fast: any[], medium: any[], slow: any[] }): Record<string, { fast: number, medium: number, slow: number }> {
  const daily: Record<string, { fast: number, medium: number, slow: number }> = {};
  
  for (const bucket of ['fast', 'medium', 'slow'] as const) {
    for (const entry of countsData[bucket] || []) {
      const dateKey = entry.time.split('T')[0];
      if (!daily[dateKey]) daily[dateKey] = { fast: 0, medium: 0, slow: 0 };
      daily[dateKey][bucket] += entry.value || 0;
    }
  }
  return daily;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const brandId = Deno.env.get('FRESH_KDS_BRAND_ID') || '';

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const { action, locationId } = await req.json();

    // For user-initiated actions, verify auth. Cron (sync-all-kds-locations) skips user auth.
    if (action !== 'sync-all-kds-locations') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const anonClient = createClient(supabaseUrl, supabaseAnon, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser();
      if (authError || !authUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ======================================================================
    // ACTION: sync-kds-data (replaces old sync-ticket-times)
    // Fetches BOTH average-times and counts for a location
    // ======================================================================
    if (action === 'sync-ticket-times' || action === 'sync-kds-data') {
      if (!locationId) {
        return new Response(JSON.stringify({ error: 'locationId required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: location, error: locError } = await serviceClient
        .from('locations')
        .select('id, fresh_kds_location_id')
        .eq('id', locationId)
        .single();

      if (locError || !location) {
        return new Response(JSON.stringify({ error: 'Location not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!location.fresh_kds_location_id) {
        return new Response(JSON.stringify({ error: 'Fresh KDS not configured for this location', needsSetup: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const timezone = 'America/Los_Angeles';
      const now = new Date();
      const today = getDateStringForTimezone(now, timezone);
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fromDate = getDateStringForTimezone(sevenDaysAgo, timezone);

      const token = await getFreshToken();
      const kdsLocId = location.fresh_kds_location_id;

      // Fetch both endpoints in parallel
      const [avgTimesData, countsData] = await Promise.all([
        fetchMetric(token, brandId, 'average-times/', kdsLocId, fromDate, today),
        fetchMetric(token, brandId, 'counts/', kdsLocId, fromDate, today),
      ]);

      // Process average times (hourly → daily avg)
      const avgTimeResults: { time: string; value: number }[] = avgTimesData.results || [];
      const dailyAvgTimes: Record<string, { sum: number; count: number }> = {};
      for (const r of avgTimeResults) {
        const dateKey = r.time.split('T')[0];
        if (r.value > 0) {
          if (!dailyAvgTimes[dateKey]) dailyAvgTimes[dateKey] = { sum: 0, count: 0 };
          dailyAvgTimes[dateKey].sum += r.value;
          dailyAvgTimes[dateKey].count += 1;
        }
      }

      // Process counts (hourly → daily totals)
      const dailyCounts = aggregateCountsByDate(countsData.results || { fast: [], medium: [], slow: [] });

      // Merge into upsert rows
      const allDates = new Set([...Object.keys(dailyAvgTimes), ...Object.keys(dailyCounts)]);
      const rows = Array.from(allDates).map(dateKey => {
        const avg = dailyAvgTimes[dateKey];
        const counts = dailyCounts[dateKey] || { fast: 0, medium: 0, slow: 0 };
        const total = counts.fast + counts.medium + counts.slow;
        return {
          location_id: locationId,
          metric_date: dateKey,
          avg_ticket_time: avg ? Math.round((avg.sum / avg.count) * 100) / 100 : 0,
          orders_fast: counts.fast,
          orders_medium: counts.medium,
          orders_slow: counts.slow,
          orders_total: total,
          fetched_at: new Date().toISOString(),
        };
      });

      if (rows.length > 0) {
        const { error: upsertError } = await serviceClient
          .from('kds_cache')
          .upsert(rows, { onConflict: 'location_id,metric_date' });

        if (upsertError) {
          console.error('KDS cache upsert error:', upsertError);
          return new Response(JSON.stringify({ error: 'Failed to cache KDS data', detail: upsertError.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        synced: rows.length,
        dateRange: { from: fromDate, to: today },
        sample: rows.length > 0 ? rows[rows.length - 1] : null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ======================================================================
    // ACTION: sync-all-kds-locations
    // Syncs all locations that have fresh_kds_location_id configured
    // ======================================================================
    if (action === 'sync-all-kds-locations') {
      const { data: locations, error: locsErr } = await serviceClient
        .from('locations')
        .select('id, name, fresh_kds_location_id')
        .not('fresh_kds_location_id', 'is', null);

      if (locsErr || !locations || locations.length === 0) {
        return new Response(JSON.stringify({ error: 'No KDS-enabled locations found' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const timezone = 'America/Los_Angeles';
      const now = new Date();
      const today = getDateStringForTimezone(now, timezone);
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fromDate = getDateStringForTimezone(sevenDaysAgo, timezone);

      const token = await getFreshToken();
      const results: { locationId: string; name: string; synced: number; error?: string }[] = [];

      for (const loc of locations) {
        try {
          const [avgTimesData, countsData] = await Promise.all([
            fetchMetric(token, brandId, 'average-times/', loc.fresh_kds_location_id, fromDate, today),
            fetchMetric(token, brandId, 'counts/', loc.fresh_kds_location_id, fromDate, today),
          ]);

          const avgTimeResults = avgTimesData.results || [];
          const dailyAvgTimes: Record<string, { sum: number; count: number }> = {};
          for (const r of avgTimeResults) {
            const dateKey = r.time.split('T')[0];
            if (r.value > 0) {
              if (!dailyAvgTimes[dateKey]) dailyAvgTimes[dateKey] = { sum: 0, count: 0 };
              dailyAvgTimes[dateKey].sum += r.value;
              dailyAvgTimes[dateKey].count += 1;
            }
          }

          const dailyCounts = aggregateCountsByDate(countsData.results || { fast: [], medium: [], slow: [] });
          const allDates = new Set([...Object.keys(dailyAvgTimes), ...Object.keys(dailyCounts)]);

          const rows = Array.from(allDates).map(dateKey => {
            const avg = dailyAvgTimes[dateKey];
            const counts = dailyCounts[dateKey] || { fast: 0, medium: 0, slow: 0 };
            return {
              location_id: loc.id,
              metric_date: dateKey,
              avg_ticket_time: avg ? Math.round((avg.sum / avg.count) * 100) / 100 : 0,
              orders_fast: counts.fast,
              orders_medium: counts.medium,
              orders_slow: counts.slow,
              orders_total: counts.fast + counts.medium + counts.slow,
              fetched_at: new Date().toISOString(),
            };
          });

          if (rows.length > 0) {
            await serviceClient.from('kds_cache').upsert(rows, { onConflict: 'location_id,metric_date' });
          }
          results.push({ locationId: loc.id, name: loc.name, synced: rows.length });
        } catch (e: any) {
          console.error(`KDS sync failed for ${loc.name}:`, e);
          results.push({ locationId: loc.id, name: loc.name, synced: 0, error: e?.message ?? String(e) });
        }
      }

      return new Response(JSON.stringify({ success: true, locations: results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('Fresh KDS service error:', err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
