// One-shot helper: discover QU operational units accessible to our gateway creds.
// Try a few candidate endpoints and return whatever responds.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function auth(): Promise<string | null> {
  const id = Deno.env.get('QU_USERNAME');
  const sec = Deno.env.get('QU_PASSWORD');
  if (!id || !sec) return null;
  const fd = new FormData();
  fd.append('grant_type', 'client_credentials');
  fd.append('client_id', id);
  fd.append('client_secret', sec);
  const r = await fetch('https://gateway-api.qubeyond.com/api/v4/authentication/oauth2/access-token', { method: 'POST', body: fd });
  if (!r.ok) return null;
  return (await r.json()).access_token ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const token = await auth();
  if (!token) return new Response(JSON.stringify({ error: 'auth failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'x-integration': Deno.env.get('QU_INTEGRATION_USER_ID') || '',
  };

  const candidates = [
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/data/operational-units' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/operational-units' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/data/locations' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/locations' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/data/brands' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/brands' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/data/organizations' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/data/stores' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/stores' },
    { method: 'GET',  url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/operational-units' },
    { method: 'POST', url: 'https://gateway-api.qubeyond.com/api/v4/data/operational-units/search', body: '{}' },
  ];

  const results: any[] = [];
  for (const c of candidates) {
    try {
      const r = await fetch(c.url, { method: c.method, headers, body: c.body });
      const txt = await r.text();
      results.push({ url: c.url, method: c.method, status: r.status, body: txt.substring(0, 4000) });
    } catch (e) {
      results.push({ url: c.url, method: c.method, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
