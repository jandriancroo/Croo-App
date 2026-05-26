const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || 'akers').toLowerCase();
  const start = parseInt(url.searchParams.get('start') || '1000');
  const end = parseInt(url.searchParams.get('end') || '6000');
  const concurrency = parseInt(url.searchParams.get('c') || '40');

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

  const ids: number[] = [];
  for (let i = start; i <= end; i++) ids.push(i);

  const matches: any[] = [];
  const stats = { ok: 0, notFound: 0, forbidden: 0, other: 0 };
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const myIdx = cursor++;
      const id = ids[myIdx];
      try {
        const r = await fetch(`https://gateway-api.qubeyond.com/api/v4/data/locations/${id}`, { headers });
        if (r.status === 200) {
          stats.ok++;
          const txt = await r.text();
          const lower = txt.toLowerCase();
          if (lower.includes(q)) {
            try {
              const j = JSON.parse(txt);
              const v = j?.value || j;
              matches.push({
                id: v.id,
                storeNumber: v.storeNumber,
                marketingName: v.marketingName,
                businessName: v.businessName,
                city: v.city,
                state: v.state?.stateCode,
                address: `${v.address1 || ''} ${v.address2 || ''}`.trim(),
              });
            } catch {
              matches.push({ id, raw: txt.substring(0, 300) });
            }
          }
        } else if (r.status === 404) stats.notFound++;
        else if (r.status === 403) stats.forbidden++;
        else stats.other++;
      } catch {
        stats.other++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return new Response(JSON.stringify({ q, start, end, stats, matchCount: matches.length, matches }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
