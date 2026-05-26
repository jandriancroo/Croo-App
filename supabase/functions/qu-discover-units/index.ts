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
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'x-integration': Deno.env.get('QU_INTEGRATION_USER_ID') || '',
  };

  const probeUrls = [
    'https://gateway-api.qubeyond.com/api/v4/data/locations',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?pageSize=1000',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?PageSize=1000',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?page=2',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?Page=2',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?pageNumber=2',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?PageNumber=2',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?skip=20&take=500',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?$top=500',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?limit=500',
    'https://gateway-api.qubeyond.com/api/v4/data/locations?offset=20&limit=500',
  ];
  const probe: any[] = [];
  for (const u of probeUrls) {
    const r = await fetch(u, { headers });
    const txt = await r.text();
    let firstIds: any[] = [];
    let count = 0;
    let totalCount: any = null;
    try {
      const j = JSON.parse(txt);
      const arr = j?.value?.items || j?.items || [];
      count = arr.length;
      firstIds = arr.slice(0, 3).map((x: any) => ({ id: x.id, storeNumber: x.storeNumber }));
      totalCount = j?.value?.totalCount ?? j?.totalCount ?? j?.value?.count ?? null;
    } catch {}
    probe.push({ url: u, status: r.status, count, totalCount, firstIds });
  }
  const items: any[] = [];
  const totalReported = 0;

  const matches = q
    ? items.filter((i: any) =>
        (i.marketingName || '').toLowerCase().includes(q) ||
        (i.businessName || '').toLowerCase().includes(q) ||
        (i.fiscalName || '').toLowerCase().includes(q) ||
        (i.address1 || '').toLowerCase().includes(q) ||
        (i.city || '').toLowerCase().includes(q) ||
        String(i.storeNumber || '').toLowerCase().includes(q))
    : items;

  return new Response(JSON.stringify({
    total: items.length,
    totalReported,
    matchCount: matches.length,
    matches: matches.map((i: any) => ({
      id: i.id,
      storeNumber: i.storeNumber,
      marketingName: i.marketingName,
      businessName: i.businessName,
      address: `${i.address1 || ''} ${i.address2 || ''}, ${i.city || ''}, ${i.state?.stateCode || ''} ${i.postalCode || ''}`.trim(),
      timezone: i.localTimeZone?.timeZoneId,
    })),
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
