const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').toLowerCase();

  const fd = new FormData();
  fd.append('grant_type', 'client_credentials');
  fd.append('client_id', Deno.env.get('QU_USERNAME')!);
  fd.append('client_secret', Deno.env.get('QU_PASSWORD')!);
  const tr = await fetch('https://gateway-api.qubeyond.com/api/v4/authentication/oauth2/access-token', { method: 'POST', body: fd });
  const token = (await tr.json()).access_token;

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'x-integration': Deno.env.get('QU_INTEGRATION_USER_ID') || '',
  };

  const probes: Array<{ name: string; method: string; url: string; body?: any }> = [
    // Try other versions / scopes
    { name: 'v3-locations', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v3/data/locations' },
    { name: 'v2-locations', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v2/data/locations' },
    { name: 'v4-data-brands', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v4/data/brands' },
    { name: 'v4-data-companies', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v4/data/companies' },
    { name: 'v4-data-organizations', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v4/data/organizations' },
    { name: 'v4-data-menu-groups', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v4/data/menu-groups' },
    { name: 'v4-data-price-groups', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v4/data/price-groups' },
    { name: 'v4-data-stores', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v4/data/stores' },
    { name: 'v4-data-locations-all', method: 'GET', url: 'https://gateway-api.qubeyond.com/api/v4/data/locations/all' },
    { name: 'v4-data-locations-search', method: 'POST', url: 'https://gateway-api.qubeyond.com/api/v4/data/locations/search', body: { q: q || 'akers' } },
    // Try the same report endpoint our sales-service uses — with NO operationalUnit filter to see what comes back
    {
      name: 'hourly-sales-no-filter',
      method: 'POST',
      url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/hourly-sales/sections/main',
      body: { filters: { date: { from: null, to: null, values: [new Date().toISOString().slice(0,10)], type: 'custom' } } },
    },
    // Hourly sales for "all locations" via empty operationalUnits
    {
      name: 'hourly-sales-empty-units',
      method: 'POST',
      url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/hourly-sales/sections/main',
      body: { filters: { date: { from: null, to: null, values: [new Date().toISOString().slice(0,10)], type: 'custom' }, location: { operationalUnits: [] } } },
    },
  ];

  const results: any[] = [];
  for (const p of probes) {
    try {
      const r = await fetch(p.url, {
        method: p.method,
        headers,
        body: p.body !== undefined ? JSON.stringify(p.body) : undefined,
      });
      const txt = await r.text();
      // Try to extract any item array & count + matches against q
      let arrLen = 0;
      let matches: any[] = [];
      try {
        const j = JSON.parse(txt);
        const arr = j?.value?.items || j?.items || j?.value || j?.data || j;
        if (Array.isArray(arr)) {
          arrLen = arr.length;
          if (q) {
            matches = arr.filter((x: any) => JSON.stringify(x).toLowerCase().includes(q)).slice(0, 5);
          }
        }
      } catch {}
      results.push({
        name: p.name,
        status: r.status,
        len: arrLen,
        matches,
        sample: txt.substring(0, 800),
      });
    } catch (e) {
      results.push({ name: p.name, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ q, results }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
