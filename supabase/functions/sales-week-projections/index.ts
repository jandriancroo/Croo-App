// Compatibility entrypoint: goal creation belongs only to the goal engine.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { corsHeaders as sdkCorsHeaders } from 'npm:@supabase/supabase-js@2.118.0/cors';
import { z } from 'npm:zod@3';
import { authorizeCaller, requireAuthorizedCaller } from '../_shared/callerAuth.ts';
import { ensureLivingWeek } from '../_shared/goalEngine.ts';

const corsHeaders = { ...sdkCorsHeaders, 'Access-Control-Allow-Headers': `${sdkCorsHeaders['Access-Control-Allow-Headers']}, x-cron-secret` };
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('seed_week'), locationId: z.string().uuid(), weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal('seed_all_weeks'), weekOffset: z.number().optional() }),
]);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    let input: unknown;
    try { input = await req.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    const parsed = schema.safeParse(input);
    if (!parsed.success) return reply({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    if (body.action === 'seed_all_weeks') {
      const denied = await requireAuthorizedCaller(req, corsHeaders);
      return denied ?? reply({ success: true, deprecated: true });
    }
    const auth = await authorizeCaller(req, corsHeaders, { minRole: 'manager' });
    if ('response' in auth) return auth.response;
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Service configuration unavailable');
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    if (auth.caller.kind === 'user') {
      const { data, error } = await supabase.rpc('has_location_access', {
        _user_id: auth.caller.userId, _location_id: body.locationId,
      });
      if (error || data !== true) return reply({ error: 'Forbidden: no access to this location' }, 403);
    }
    const result = await ensureLivingWeek(supabase, body.locationId, body.weekStart);
    return reply({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply({ success: false, error: message }, /future Monday|Invalid local date/.test(message) ? 400 : 500);
  }
});
