import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders as sdkCorsHeaders } from '../_shared/sdkCors.ts';
import { z } from 'npm:zod@3';
import { DateTime } from 'npm:luxon@3.7.2';
import { authorizeCaller, authenticateCaller, requireAuthorizedCaller, requireInternalCaller } from '../_shared/callerAuth.ts';
import { POS_SOURCES } from '../_shared/posSources.ts';
import { getLocationTimezone, todayInTimezone, weekStartFor } from '../_shared/weekProjections.ts';
import { ensureLivingWeek, runGoalEngine } from '../_shared/goalEngine.ts';
import { keepLiveLocationIds } from '../_shared/locationLive.ts';

const corsHeaders = { ...sdkCorsHeaders, 'Access-Control-Allow-Headers': `${sdkCorsHeaders['Access-Control-Allow-Headers']}, x-cron-secret` };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => DateTime.fromFormat(value, 'yyyy-MM-dd').isValid);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('tick') }),
  z.object({ action: z.literal('run_location'), locationId: z.string().uuid(), force: z.boolean().optional() }),
  z.object({ action: z.literal('ensure_living'), locationId: z.string().uuid(), weekStart: date }),
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
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Service configuration unavailable');
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    if (body.action === 'ensure_living') {
      const auth = await authorizeCaller(req, corsHeaders, { minRole: 'manager' });
      if ('response' in auth) return auth.response;
      if (auth.caller.kind === 'user') {
        const { data, error } = await supabase.rpc('has_location_access', {
          _user_id: auth.caller.userId, _location_id: body.locationId,
        });
        if (error || data !== true) return reply({ error: 'Forbidden: no access to this location' }, 403);
      }
      const tz = await getLocationTimezone(supabase, body.locationId);
      const T = todayInTimezone(tz);
      if (weekStartFor(body.weekStart) !== body.weekStart || body.weekStart <= weekStartFor(T)) {
        return reply({ error: 'weekStart must be a future Monday' }, 400);
      }
      const result = await ensureLivingWeek(supabase, body.locationId, body.weekStart);
      return reply({ success: true, ...result });
    }

    const denied = await requireAuthorizedCaller(req, corsHeaders);
    if (denied) return denied;
    // requireAuthorizedCaller also accepts user JWTs; explicitly exclude them.
    if (body.action === 'tick') {
      const internalDenied = requireInternalCaller(req, corsHeaders);
      if (internalDenied) return internalDenied;
    } else {
      const caller = await authenticateCaller(req);
      if (caller?.kind !== 'service') return reply({ error: 'Service caller required' }, 403);
    }
    if (body.action === 'run_location') {
      const tz = await getLocationTimezone(supabase, body.locationId);
      const T = todayInTimezone(tz);
      const result = await runGoalEngine(supabase, body.locationId, { T, tz, source: 'manual', writePlanning: false });
      return reply({ success: true, ...result });
    }

    const { data: integrations, error } = await supabase.from('location_integrations')
      .select('location_id').eq('is_active', true).in('integration_type', [...POS_SOURCES]);
    if (error) throw error;
    const ids = await keepLiveLocationIds(supabase, (integrations ?? []).map(row => row.location_id as string));
    const results: unknown[] = [];
    for (const locationId of ids) {
      let T: string | undefined;
      try {
        const tz = await getLocationTimezone(supabase, locationId);
        if (DateTime.now().setZone(tz).hour !== 3) continue;
        T = todayInTimezone(tz);
        const { data: prior, error: priorError } = await supabase.from('goal_engine_runs')
          .select('local_run_date').eq('location_id', locationId).eq('local_run_date', T).eq('source', 'tick').maybeSingle();
        if (priorError) throw priorError;
        if (prior) continue;
        results.push(await runGoalEngine(supabase, locationId, { T, tz, source: 'tick', writePlanning: false }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (T) {
          const { error: logError } = await supabase.from('goal_engine_runs').upsert({
            location_id: locationId, local_run_date: T, source: 'tick', error: message,
          }, { onConflict: 'location_id,local_run_date,source' });
          if (logError) console.error('[goal-engine] failure log:', logError.message);
        }
        results.push({ locationId, error: message });
      }
    }
    return reply({ success: true, action: 'tick', results });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
