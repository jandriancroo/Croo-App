import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FRESH_AUTH_URL = 'https://user-api.ftservices.cloud/auth';

async function getFreshToken(): Promise<string> {
  const username = Deno.env.get('FRESH_KDS_USERNAME');
  const password = Deno.env.get('FRESH_KDS_PASSWORD');
  if (!username || !password) throw new Error('Credentials not configured');
  const res = await fetch(FRESH_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience: 'fresh-tools-web', username, password }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const token = await getFreshToken();
    const brandId = Deno.env.get('FRESH_KDS_BRAND_ID') || '';
    const locationId = 'a49a6059-e5c2-4992-aa0f-48bdbc35f860';
    
    const commonHeaders = {
      'Authorization': `Bearer ${token}`,
      'x-brand-id': brandId,
      'Accept': 'application/json',
    };

    // The Fresh KDS web app is a React SPA. It likely calls an API to get Explo config.
    // Let's probe various patterns that SPA analytics dashboards use
    const tests = [
      // Explo embed token endpoints on brand-api
      { name: 'explo-token', url: `https://brand-api.ftservices.cloud/explo/token`, headers: commonHeaders },
      { name: 'explo-embed-token', url: `https://brand-api.ftservices.cloud/explo/embed-token`, headers: commonHeaders },
      { name: 'embed-token', url: `https://brand-api.ftservices.cloud/embed/token`, headers: commonHeaders },
      { name: 'analytics-token', url: `https://brand-api.ftservices.cloud/analytics/token`, headers: commonHeaders },
      
      // Maybe under a different API host
      { name: 'kds-explo', url: `https://kds-api.ftservices.cloud/explo/token`, headers: commonHeaders },
      { name: 'kds-embed', url: `https://kds-api.ftservices.cloud/embed/token`, headers: commonHeaders },
      
      // Maybe it's a POST to get the token
      { name: 'brand-explo-post', url: `https://brand-api.ftservices.cloud/explo/token`, method: 'POST', body: JSON.stringify({ brandId, locationId }), headers: { ...commonHeaders, 'Content-Type': 'application/json' } },
      
      // Try fido-api since Explo mentioned "fido-key"
      { name: 'fido-api', url: `https://fido-api.ftservices.cloud/`, headers: commonHeaders },
      { name: 'fido-api-token', url: `https://fido-api.ftservices.cloud/token`, headers: commonHeaders },
      
      // Try reporting-api
      { name: 'reporting-api', url: `https://reporting-api.ftservices.cloud/`, headers: commonHeaders },
      
      // Try data-api
      { name: 'data-api', url: `https://data-api.ftservices.cloud/`, headers: commonHeaders },
      
      // The Explo namespace URL suggests "fido" might be the internal name
      // Try Explo's own JWT endpoint
      { name: 'explo-jwt', url: `https://us-east-1.data.explo.co/v1/namespaces/bbe60577-a294-416b-a11e-010d29dabe46/jwt`, headers: commonHeaders },
      
      // The KDS metrics API already works - try more metric endpoints
      { name: 'kds-metrics-orders-list', url: `https://kds-api.ftservices.cloud/metrics/orders/?locationId=${locationId}&dateFrom=2026-04-09T08:00:00.000Z&dateTo=2026-04-09T23:59:59.999Z`, headers: commonHeaders },
      { name: 'kds-metrics-orders-details', url: `https://kds-api.ftservices.cloud/metrics/orders/details/?locationId=${locationId}&dateFrom=2026-04-09T08:00:00.000Z&dateTo=2026-04-09T23:59:59.999Z`, headers: commonHeaders },
      { name: 'kds-metrics-orders-list-raw', url: `https://kds-api.ftservices.cloud/metrics/orders/list/?locationId=${locationId}&dateFrom=2026-04-09T08:00:00.000Z&dateTo=2026-04-09T23:59:59.999Z`, headers: commonHeaders },
      { name: 'kds-metrics-orders-items', url: `https://kds-api.ftservices.cloud/metrics/orders/items/?locationId=${locationId}&dateFrom=2026-04-09T08:00:00.000Z&dateTo=2026-04-09T23:59:59.999Z`, headers: commonHeaders },
    ];

    const results: Record<string, any> = {};
    for (const t of tests) {
      try {
        const opts: any = { headers: t.headers };
        if ((t as any).method === 'POST') {
          opts.method = 'POST';
          opts.body = (t as any).body;
        }
        const res = await fetch(t.url, opts);
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text.substring(0, 300); }
        results[t.name] = { 
          status: res.status, 
          body: typeof body === 'string' ? body : JSON.stringify(body).substring(0, 500) 
        };
      } catch (e) {
        results[t.name] = { error: e.message };
      }
    }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
