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
  if (!res.ok) return `FAIL:${res.status}`;
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
    const accessToken = 'd4c8e886-b63d-4a2f-abae-5e7f14680c51';

    const kdsToken = await getToken('fresh-kds-mobile');
    const trackerToken = await getToken('fresh-order-tracker-mobile');

    const results: Record<string, any> = {};

    // Decode JWT payload to see claims
    for (const [name, token] of [['kds', kdsToken], ['tracker', trackerToken]]) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        results[`${name}-jwt-claims`] = payload;
      } catch { results[`${name}-jwt-claims`] = 'failed to decode'; }
    }

    const tests: { name: string; url: string; headers: Record<string,string>; method?: string; body?: string }[] = [];

    // KDS mobile token - try device registration / pairing flow
    const kdsH = { 'Authorization': `Bearer ${kdsToken}`, 'x-brand-id': brandId, 'Accept': 'application/json', 'Content-Type': 'application/json' };
    
    // The KDS app pairs with a device. Try device pairing endpoints
    tests.push({ name: 'kds-pair-device', url: `https://kds-api.ftservices.cloud/pair`, method: 'POST', body: JSON.stringify({ deviceId, accessToken, locationId }), headers: kdsH });
    tests.push({ name: 'kds-connect', url: `https://kds-api.ftservices.cloud/connect`, method: 'POST', body: JSON.stringify({ deviceId, accessToken, locationId }), headers: kdsH });
    tests.push({ name: 'kds-register', url: `https://kds-api.ftservices.cloud/register`, method: 'POST', body: JSON.stringify({ deviceId, accessToken, locationId }), headers: kdsH });
    
    // Try querying orders with KDS mobile token
    tests.push({ name: 'kds-mob-orders', url: `https://kds-api.ftservices.cloud/orders?locationId=${locationId}&deviceId=${deviceId}`, headers: kdsH });
    tests.push({ name: 'kds-mob-active', url: `https://kds-api.ftservices.cloud/active?locationId=${locationId}`, headers: kdsH });
    tests.push({ name: 'kds-mob-tickets', url: `https://kds-api.ftservices.cloud/tickets?locationId=${locationId}`, headers: kdsH });
    tests.push({ name: 'kds-mob-queue-loc', url: `https://kds-api.ftservices.cloud/queue?locationId=${locationId}`, headers: kdsH });
    
    // Order Tracker specific endpoints
    const tH = { 'Authorization': `Bearer ${trackerToken}`, 'x-brand-id': brandId, 'Accept': 'application/json' };
    tests.push({ name: 'tracker-orders', url: `https://kds-api.ftservices.cloud/order-tracker/orders?locationId=${locationId}`, headers: tH });
    tests.push({ name: 'tracker-active', url: `https://kds-api.ftservices.cloud/order-tracker/active?locationId=${locationId}`, headers: tH });
    tests.push({ name: 'tracker-queue', url: `https://kds-api.ftservices.cloud/order-tracker/queue?locationId=${locationId}`, headers: tH });
    tests.push({ name: 'tracker-status', url: `https://kds-api.ftservices.cloud/order-tracker/status?locationId=${locationId}`, headers: tH });
    
    // Try order-tracker API host directly
    tests.push({ name: 'order-tracker-api', url: `https://order-tracker-api.ftservices.cloud/`, headers: tH });
    tests.push({ name: 'order-tracker-orders', url: `https://order-tracker-api.ftservices.cloud/orders?locationId=${locationId}`, headers: tH });
    
    // Try with accessToken as query param
    tests.push({ name: 'kds-orders-access', url: `https://kds-api.ftservices.cloud/orders?locationId=${locationId}&accessToken=${accessToken}`, headers: kdsH });
    
    // Try brand-api with KDS mobile token for device config
    tests.push({ name: 'brand-device-config', url: `https://brand-api.ftservices.cloud/devices/${deviceId}/config`, headers: kdsH });
    tests.push({ name: 'brand-device-details', url: `https://brand-api.ftservices.cloud/devices?deviceId=${deviceId}`, headers: kdsH });
    
    // Socket/SSE endpoints
    tests.push({ name: 'kds-events', url: `https://kds-api.ftservices.cloud/events?locationId=${locationId}`, headers: kdsH });
    tests.push({ name: 'kds-stream', url: `https://kds-api.ftservices.cloud/stream?locationId=${locationId}`, headers: kdsH });
    tests.push({ name: 'kds-subscribe', url: `https://kds-api.ftservices.cloud/subscribe?locationId=${locationId}`, headers: kdsH });

    for (const t of tests) {
      try {
        const opts: any = { headers: t.headers, method: t.method || 'GET' };
        if (t.body) opts.body = t.body;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        opts.signal = controller.signal;
        const res = await fetch(t.url, opts);
        clearTimeout(timeout);
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { body = text.substring(0, 500); }
        results[t.name] = { 
          status: res.status, 
          body: typeof body === 'string' ? body : JSON.stringify(body).substring(0, 800) 
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
