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

    const tests = [
      // Probe brand-api for explo/embed/analytics endpoints
      { name: 'brand-api-root', url: `https://brand-api.ftservices.cloud/`, headers: commonHeaders },
      { name: 'brand-api-explo', url: `https://brand-api.ftservices.cloud/explo`, headers: commonHeaders },
      { name: 'brand-api-analytics', url: `https://brand-api.ftservices.cloud/analytics`, headers: commonHeaders },
      { name: 'brand-api-embed', url: `https://brand-api.ftservices.cloud/embed-token`, headers: commonHeaders },
      { name: 'brand-api-tools', url: `https://brand-api.ftservices.cloud/tools`, headers: commonHeaders },
      { name: 'brand-api-tools-kds', url: `https://brand-api.ftservices.cloud/tools/kds`, headers: commonHeaders },
      { name: 'brand-api-reports', url: `https://brand-api.ftservices.cloud/reports`, headers: commonHeaders },
      { name: 'brand-api-brands', url: `https://brand-api.ftservices.cloud/brands/${brandId}`, headers: commonHeaders },
      { name: 'brand-api-brands-tools', url: `https://brand-api.ftservices.cloud/brands/${brandId}/tools`, headers: commonHeaders },
      { name: 'brand-api-brands-explo', url: `https://brand-api.ftservices.cloud/brands/${brandId}/explo`, headers: commonHeaders },
      { name: 'brand-api-brands-analytics', url: `https://brand-api.ftservices.cloud/brands/${brandId}/analytics`, headers: commonHeaders },
      // user-api endpoints
      { name: 'user-api-root', url: `https://user-api.ftservices.cloud/`, headers: commonHeaders },
      { name: 'user-api-me', url: `https://user-api.ftservices.cloud/me`, headers: commonHeaders },
      { name: 'user-api-users-me', url: `https://user-api.ftservices.cloud/users/me`, headers: commonHeaders },
      // kds-api root to find available routes
      { name: 'kds-api-root', url: `https://kds-api.ftservices.cloud/`, headers: commonHeaders },
      { name: 'kds-api-metrics', url: `https://kds-api.ftservices.cloud/metrics`, headers: commonHeaders },
      // Try Explo with bearer token in Authorization
      {
        name: 'explo-with-bearer',
        url: 'https://us-east-1.data.explo.co/v1/namespaces/bbe60577-a294-416b-a11e-010d29dabe46/data-sources/1c2eb0da-4422-4856-9b40-a38771e63251/views/ba82b391-d19c-4db4-b8f1-1f66e3b5bbbb/run',
        method: 'POST',
        body: JSON.stringify({
          queryContext: {
            brand_id: brandId,
            locations: [locationId],
            "properties.locations": [locationId],
            date_2: {
              startDate: new Date().toISOString().split('T')[0] + 'T00:00:00.000Z',
              endDate: new Date().toISOString().split('T')[0] + 'T23:59:59.999Z',
            }
          },
          dataRequestParameters: { pagingConfiguration: { perPage: 100 } },
        }),
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      },
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
          body: typeof body === 'string' ? body : JSON.stringify(body).substring(0, 400) 
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
