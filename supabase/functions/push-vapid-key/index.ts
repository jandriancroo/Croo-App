// Returns the server's VAPID *public* key so browsers always subscribe with
// the exact key the push sender signs with. Public keys are safe to expose —
// this is the same value that ships in every PushManager.subscribe() call.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? null;

  return new Response(JSON.stringify({ publicKey }), {
    status: publicKey ? 200 : 503,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});
