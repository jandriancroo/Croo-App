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

  const items: any[] = [];
  let page = 1;
  let totalReported = 0;
  while (true) {
    const r = await fetch(`https://gateway-api.qubeyond.com/api/v4/data/locations?pageSize=500&pageNumber=${page}`, { headers });
    if (!r.ok) break;
    const data = await r.json();
    const batch = data?.value?.items || [];
    totalReported = data?.value?.totalCount ?? data?.value?.total ?? totalReported;
    items.push(...batch);
    if (batch.length < 500 || items.length >= (totalReported || items.length)) break;
    page += 1;
    if (page > 20) break;
  }

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
