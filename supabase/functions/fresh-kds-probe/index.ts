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
    const deviceId = 'b3ed98da-4919-4333-ac2a-b66760bc8f42';
    const accessToken = 'd4c8e886-b63d-4a2f-abae-5e7f14680c51';

    const commonHeaders = {
      'Authorization': `Bearer ${token}`,
      'x-brand-id': brandId,
      'Accept': 'application/json',
    };

    const tests = [
      // Try device-level endpoints on kds-api - this is how actual KDS screens get orders
      { name: 'kds-device-orders', url: `https://kds-api.ftservices.cloud/devices/${deviceId}/orders`, headers: commonHeaders },
      { name: 'kds-device-orders-active', url: `https://kds-api.ftservices.cloud/devices/${deviceId}/orders/active`, headers: commonHeaders },
      { name: 'kds-device-config', url: `https://kds-api.ftservices.cloud/devices/${deviceId}`, headers: commonHeaders },
      { name: 'kds-device-queue', url: `https://kds-api.ftservices.cloud/devices/${deviceId}/queue`, headers: commonHeaders },
      
      // Try with access token as auth instead
      { name: 'kds-device-access-token', url: `https://kds-api.ftservices.cloud/devices/${deviceId}/orders`, headers: { 'Authorization': `Bearer ${accessToken}`, 'x-brand-id': brandId, 'Accept': 'application/json' } },
      
      // Try location-level order endpoints
      { name: 'kds-location-orders', url: `https://kds-api.ftservices.cloud/locations/${locationId}/orders`, headers: commonHeaders },
      { name: 'kds-location-orders-active', url: `https://kds-api.ftservices.cloud/locations/${locationId}/orders/active`, headers: commonHeaders },
      { name: 'kds-location-queue', url: `https://kds-api.ftservices.cloud/locations/${locationId}/queue`, headers: commonHeaders },
      
      // Try the orders endpoint directly
      { name: 'kds-orders', url: `https://kds-api.ftservices.cloud/orders?locationId=${locationId}`, headers: commonHeaders },
      { name: 'kds-orders-active', url: `https://kds-api.ftservices.cloud/orders/active?locationId=${locationId}`, headers: commonHeaders },
      
      // Try brand-api device/location endpoints
      { name: 'brand-location-devices', url: `https://brand-api.ftservices.cloud/locations/${locationId}/devices`, headers: commonHeaders },
      { name: 'brand-location-orders', url: `https://brand-api.ftservices.cloud/locations/${locationId}/orders`, headers: commonHeaders },
      { name: 'brand-devices', url: `https://brand-api.ftservices.cloud/devices/${deviceId}`, headers: commonHeaders },
      
      // Try the integrations API with device access token
      { name: 'integrations-device-token', url: `https://integrations-api.ftservices.cloud/integrators/kds-orders/active`, headers: { 'Authorization': `Bearer ${accessToken}`, 'x-location-id': locationId, 'Accept': 'application/json' } },
      
      // Try user-api for device auth
      { name: 'user-device-auth', url: `https://user-api.ftservices.cloud/auth`, method: 'POST', body: JSON.stringify({ audience: 'fresh-kds-device', deviceId, accessToken }), headers: { 'Content-Type': 'application/json' } },
      
      // Try kds-api root to discover endpoints
      { name: 'kds-api-root', url: `https://kds-api.ftservices.cloud/`, headers: commonHeaders },
      { name: 'kds-api-health', url: `https://kds-api.ftservices.cloud/health`, headers: commonHeaders },
      { name: 'kds-api-swagger', url: `https://kds-api.ftservices.cloud/swagger`, headers: commonHeaders },
      { name: 'kds-api-docs', url: `https://kds-api.ftservices.cloud/api-docs`, headers: commonHeaders },
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
        try { body = JSON.parse(text); } catch { body = text.substring(0, 500); }
        results[t.name] = { 
          status: res.status, 
          body: typeof body === 'string' ? body : JSON.stringify(body).substring(0, 800) 
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
