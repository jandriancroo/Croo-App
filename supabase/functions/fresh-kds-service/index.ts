import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FRESH_AUTH_URL = 'https://user-api.ftservices.cloud/auth';
const FRESH_KDS_METRICS_URL = 'https://kds-api.ftservices.cloud/metrics/orders/average-times/';

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
    body: JSON.stringify({
      audience: 'fresh-tools-web',
      username,
      password,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fresh KDS auth failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error('Fresh KDS auth response missing token');
  }

  return data.token;
}

// ============================================================================
// FETCH AVERAGE TICKET TIMES
// ============================================================================

interface TicketTimeResult {
  time: string;
  value: number;
}

async function fetchAverageTicketTimes(
  token: string,
  brandId: string,
  kdsLocationId: string,
  dateFrom: string,
  dateTo: string
): Promise<TicketTimeResult[]> {
  const url = new URL(FRESH_KDS_METRICS_URL);
  url.searchParams.set('locationId', kdsLocationId);
  url.searchParams.set('dateFrom', `${dateFrom}T08:00:00.000Z`);
  url.searchParams.set('dateTo', `${dateTo}T07:59:59.999Z`);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-brand-id': brandId,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fresh KDS metrics failed: ${res.status} - ${text}`);
  }

  const data = await res.json();
  return data.results || [];
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

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const brandId = Deno.env.get('FRESH_KDS_BRAND_ID') || '';

    // Verify user auth
    const anonClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser();
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service client for DB writes
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { action, locationId } = await req.json();

    // ======================================================================
    // ACTION: sync-ticket-times
    // ======================================================================
    if (action === 'sync-ticket-times') {
      if (!locationId) {
        return new Response(JSON.stringify({ error: 'locationId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get the location's Fresh KDS ID
      const { data: location, error: locError } = await serviceClient
        .from('locations')
        .select('id, fresh_kds_location_id')
        .eq('id', locationId)
        .single();

      if (locError || !location) {
        return new Response(JSON.stringify({ error: 'Location not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!location.fresh_kds_location_id) {
        return new Response(JSON.stringify({ error: 'Fresh KDS not configured for this location', needsSetup: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const timezone = 'America/Los_Angeles';
      const now = new Date();
      const today = getDateStringForTimezone(now, timezone);
      
      // Fetch last 7 days
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fromDate = getDateStringForTimezone(sevenDaysAgo, timezone);

      // Get Fresh KDS token
      const token = await getFreshToken();

      // Fetch metrics
      const results = await fetchAverageTicketTimes(
        token,
        brandId,
        location.fresh_kds_location_id,
        fromDate,
        today
      );

      // Upsert into kds_cache
      if (results.length > 0) {
        const rows = results.map((r) => ({
          location_id: locationId,
          metric_date: r.time.split('T')[0],
          avg_ticket_time: r.value,
          fetched_at: new Date().toISOString(),
        }));

        const { error: upsertError } = await serviceClient
          .from('kds_cache')
          .upsert(rows, { onConflict: 'location_id,metric_date' });

        if (upsertError) {
          console.error('KDS cache upsert error:', upsertError);
          return new Response(JSON.stringify({ error: 'Failed to cache KDS data', detail: upsertError.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        synced: results.length,
        dateRange: { from: fromDate, to: today },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ======================================================================
    // ACTION: probe-metrics - discover available API endpoints
    // ======================================================================
    if (action === 'probe-metrics') {
      const token = await getFreshToken();
      const kdsLocationId = req.headers.get('x-kds-location-id') || '';
      const probeDateFrom = '2026-02-24';
      const probeDateTo = '2026-02-25';
      
      const probeEndpoints = [
        'average-times/',
        'counts/',
        'counts/late/',
        'counts/on-time/',
        'counts/caution/',
        'average-times/bumped/',
        'average-times/total/',
        'percentages/',
        'percentages/late/',
        'percentages/on-time/',
        'late/',
        'on-time/',
        'caution/',
      ];

      const results: Record<string, any> = {};
      
      for (const ep of probeEndpoints) {
        try {
          const url = new URL(`https://kds-api.ftservices.cloud/metrics/orders/${ep}`);
          if (kdsLocationId) url.searchParams.set('locationId', kdsLocationId);
          url.searchParams.set('dateFrom', `${probeDateFrom}T08:00:00.000Z`);
          url.searchParams.set('dateTo', `${probeDateTo}T07:59:59.999Z`);
          
          const res = await fetch(url.toString(), {
            headers: {
              'Authorization': `Bearer ${token}`,
              'x-brand-id': brandId,
              'Accept': 'application/json',
            },
          });
          results[ep] = { status: res.status, data: res.ok ? await res.json() : await res.text() };
        } catch (e) {
          results[ep] = { status: 'error', data: e.message };
        }
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ======================================================================
    // ACTION: discover-locations  
    // ======================================================================
    if (action === 'discover-locations') {
      const token = await getFreshToken();
      
      // Fetch brands
      const brandsRes = await fetch('https://user-api.ftservices.cloud/brands', {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });
      if (!brandsRes.ok) {
        return new Response(JSON.stringify({ error: 'Failed to fetch brands' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const brands = await brandsRes.json();
      
      // Try multiple location endpoints
      const fetchBrandId = brandId || brands?.results?.[0]?.id;
      const locationResults: Record<string, any> = {};
      if (fetchBrandId) {
        const paths = [
          `https://user-api.ftservices.cloud/brands/${fetchBrandId}/locations`,
          `https://kds-api.ftservices.cloud/brands/${fetchBrandId}/locations`,
          `https://user-api.ftservices.cloud/locations`,
          `https://kds-api.ftservices.cloud/locations`,
          `https://kds-api.ftservices.cloud/locations?brandId=${fetchBrandId}`,
        ];
        for (const p of paths) {
          try {
            const r = await fetch(p, {
              headers: { 'Authorization': `Bearer ${token}`, 'x-brand-id': fetchBrandId, 'Accept': 'application/json' },
            });
            locationResults[p] = { status: r.status, data: r.ok ? await r.json() : await r.text() };
          } catch (e) {
            locationResults[p] = { error: e.message };
          }
        }
      }
      
      return new Response(JSON.stringify({ brands, locationResults }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Fresh KDS service error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
