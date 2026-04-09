import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FRESH_AUTH_URL = 'https://user-api.ftservices.cloud/auth';

async function getToken(audience: string): Promise<string> {
  const username = Deno.env.get('FRESH_KDS_USERNAME');
  const password = Deno.env.get('FRESH_KDS_PASSWORD');
  if (!username || !password) throw new Error('Credentials not configured');
  const res = await fetch(FRESH_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience, username, password }),
  });
  if (!res.ok) {
    const t = await res.text();
    return `AUTH_FAILED:${res.status}:${t.substring(0,200)}`;
  }
  const data = await res.json();
  return data.token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const brandId = Deno.env.get('FRESH_KDS_BRAND_ID') || '';
    const locationId = 'a49a6059-e5c2-4992-aa0f-48bdbc35f860';
    const deviceId = 'b3ed98da-4919-4333-ac2a-b66760bc8f42';

    // Get tokens for different audiences
    const [webToken, trackerToken, kdsToken, togoToken] = await Promise.all([
      getToken('fresh-tools-web'),
      getToken('fresh-order-tracker-mobile'),
      getToken('fresh-kds-mobile'),
      getToken('fresh-togo-web'),
    ]);

    const results: Record<string, any> = {};

    // Log token statuses
    results['tokens'] = {
      web: webToken.startsWith('AUTH_FAILED') ? webToken : 'OK',
      tracker: trackerToken.startsWith('AUTH_FAILED') ? trackerToken : 'OK',
      kds: kdsToken.startsWith('AUTH_FAILED') ? kdsToken : 'OK',
      togo: togoToken.startsWith('AUTH_FAILED') ? togoToken : 'OK',
    };

    const tests: { name: string; url: string; headers: Record<string,string>; method?: string; body?: string }[] = [];

    // For each working token, try key endpoints
    const tokenMap: Record<string, string> = {};
    if (!webToken.startsWith('AUTH_FAILED')) tokenMap['web'] = webToken;
    if (!trackerToken.startsWith('AUTH_FAILED')) tokenMap['tracker'] = trackerToken;
    if (!kdsToken.startsWith('AUTH_FAILED')) tokenMap['kds'] = kdsToken;
    if (!togoToken.startsWith('AUTH_FAILED')) tokenMap['togo'] = togoToken;

    for (const [name, token] of Object.entries(tokenMap)) {
      const h = { 'Authorization': `Bearer ${token}`, 'x-brand-id': brandId, 'Accept': 'application/json' };
      
      // Try integrations API with proper device header
      tests.push({ name: `${name}-integrations-orders`, url: `https://integrations-api.ftservices.cloud/integrators/kds-orders/active`, headers: { ...h, 'x-location-id': locationId, 'x-device-ids': deviceId } });
      
      // Try kds-api metrics (we know this works with web token)
      tests.push({ name: `${name}-kds-metrics-counts`, url: `https://kds-api.ftservices.cloud/metrics/orders/counts/?locationId=${locationId}&dateFrom=2026-04-09T08:00:00.000Z&dateTo=2026-04-09T23:59:59.999Z`, headers: h });
    }

    // Also try brand-api with toolId variations
    const wh = { 'Authorization': `Bearer ${webToken}`, 'x-brand-id': brandId, 'Accept': 'application/json' };
    tests.push({ name: 'brand-loc-devices-kds', url: `https://brand-api.ftservices.cloud/locations/${locationId}/devices?toolId=kds`, headers: wh });
    tests.push({ name: 'brand-loc-devices-order-tracker', url: `https://brand-api.ftservices.cloud/locations/${locationId}/devices?toolId=order-tracker`, headers: wh });
    tests.push({ name: 'brand-loc-devices-togo', url: `https://brand-api.ftservices.cloud/locations/${locationId}/devices?toolId=togo`, headers: wh });
    tests.push({ name: 'brand-loc-devices-all', url: `https://brand-api.ftservices.cloud/locations/${locationId}/devices?toolId=all`, headers: wh });
    
    // Try brand-api other endpoints
    tests.push({ name: 'brand-loc-settings', url: `https://brand-api.ftservices.cloud/locations/${locationId}/settings`, headers: wh });
    tests.push({ name: 'brand-loc-integrations', url: `https://brand-api.ftservices.cloud/locations/${locationId}/integrations`, headers: wh });
    tests.push({ name: 'brand-integrations', url: `https://brand-api.ftservices.cloud/integrations`, headers: wh });
    tests.push({ name: 'brand-orders', url: `https://brand-api.ftservices.cloud/orders?locationId=${locationId}`, headers: wh });
    
    // Try togo API (handles online orders)
    tests.push({ name: 'togo-api-root', url: `https://togo-api.ftservices.cloud/`, headers: wh });
    tests.push({ name: 'togo-api-orders', url: `https://togo-api.ftservices.cloud/orders?locationId=${locationId}`, headers: wh });

    for (const t of tests) {
      try {
        const opts: any = { headers: t.headers, method: t.method || 'GET' };
        if (t.body) opts.body = t.body;
        const res = await fetch(t.url, opts);
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text.substring(0, 500); }
        results[t.name] = { 
          status: res.status, 
          body: typeof body === 'string' ? body : JSON.stringify(body).substring(0, 1000) 
        };
      } catch (e) {
        results[t.name] = { error: e.message.substring(0, 200) };
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
