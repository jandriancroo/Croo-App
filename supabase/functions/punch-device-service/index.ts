// @ts-nocheck
// Punch clock device pairing service.
// Actions:
//   generate  (authed org admin)  → create a pairing code for a location
//   redeem    (public)            → exchange a code for a device session
//   list      (authed org admin)  → list paired devices for an org
//   revoke    (authed org admin)  → revoke a paired device
//   heartbeat (device session)    → touch last_active_at
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getAuthedUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

async function assertOrgAdmin(sb: any, userId: string, orgId: string) {
  const { data, error } = await sb.rpc('is_org_admin', { _user_id: userId, _organization_id: orgId });
  if (error) throw new Error(`Permission check failed: ${error.message}`);
  if (!data) {
    // fall back to super admin
    const { data: sa } = await sb.rpc('is_super_admin', { _user_id: userId });
    if (!sa) throw new Error("Only org admins can manage punch clock devices");
  }
}

async function generateUniqueCode(sb: any): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const { data, error } = await sb.rpc('generate_pairing_code');
    if (error) throw error;
    const code = data as string;
    const { data: existing } = await sb
      .from('punch_clock_pairing_codes')
      .select('id')
      .eq('code', code)
      .is('redeemed_at', null)
      .maybeSingle();
    if (!existing) return code;
  }
  throw new Error("Could not generate unique pairing code");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, ...payload } = await req.json();
    const sb = admin();

    // -------------------------------- generate
    if (action === 'generate') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const { locationId, deviceName } = payload;
      if (!locationId || !deviceName?.trim()) {
        return json({ error: 'locationId and deviceName are required' }, 400);
      }

      const { data: loc, error: locErr } = await sb
        .from('locations')
        .select('id, organization_id, name')
        .eq('id', locationId)
        .single();
      if (locErr || !loc) return json({ error: 'Location not found' }, 404);

      await assertOrgAdmin(sb, userId, loc.organization_id);

      const code = await generateUniqueCode(sb);
      const { data: row, error: insErr } = await sb
        .from('punch_clock_pairing_codes')
        .insert({
          code,
          location_id: locationId,
          organization_id: loc.organization_id,
          device_name: deviceName.trim(),
          created_by: userId,
        })
        .select()
        .single();
      if (insErr) return json({ error: insErr.message }, 500);

      return json({ code: row.code, expiresAt: row.expires_at, locationName: loc.name, deviceName: row.device_name });
    }

    // -------------------------------- redeem (public)
    if (action === 'redeem') {
      const { code } = payload;
      if (!code || typeof code !== 'string') return json({ error: 'code is required' }, 400);
      const normalized = code.trim().toUpperCase();

      const { data: pairing, error: findErr } = await sb
        .from('punch_clock_pairing_codes')
        .select('*')
        .eq('code', normalized)
        .maybeSingle();
      if (findErr) return json({ error: findErr.message }, 500);
      if (!pairing) return json({ error: 'Invalid pairing code' }, 404);
      if (pairing.redeemed_at) return json({ error: 'This code has already been used' }, 410);
      if (new Date(pairing.expires_at) < new Date()) return json({ error: 'This code has expired' }, 410);

      // Create the device auth user with a random email/password
      const deviceUuid = crypto.randomUUID();
      const email = `device-${deviceUuid}@devices.croohq.internal`;
      const password = crypto.randomUUID() + crypto.randomUUID();

      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          is_punch_device: true,
          device_name: pairing.device_name,
          location_id: pairing.location_id,
        },
      });
      if (createErr || !created?.user) {
        return json({ error: `Could not create device session: ${createErr?.message}` }, 500);
      }

      const authUserId = created.user.id;

      // Insert device row
      const { data: device, error: devErr } = await sb
        .from('punch_clock_devices')
        .insert({
          auth_user_id: authUserId,
          location_id: pairing.location_id,
          organization_id: pairing.organization_id,
          device_name: pairing.device_name,
          created_by: pairing.created_by,
        })
        .select()
        .single();
      if (devErr) {
        await sb.auth.admin.deleteUser(authUserId).catch(() => {});
        return json({ error: `Could not register device: ${devErr.message}` }, 500);
      }

      // Mark code redeemed
      await sb.from('punch_clock_pairing_codes')
        .update({ redeemed_at: new Date().toISOString(), redeemed_device_id: device.id })
        .eq('id', pairing.id);

      // Sign in as the device to mint a session
      const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { data: session, error: signInErr } = await anonClient.auth.signInWithPassword({ email, password });
      if (signInErr || !session?.session) {
        return json({ error: `Could not mint device session: ${signInErr?.message}` }, 500);
      }

      // Fetch location details for the client
      const { data: loc } = await sb
        .from('locations')
        .select('id, name, store_number, organization_id')
        .eq('id', pairing.location_id)
        .single();

      return json({
        deviceId: device.id,
        deviceName: device.device_name,
        location: loc,
        session: {
          access_token: session.session.access_token,
          refresh_token: session.session.refresh_token,
          expires_at: session.session.expires_at,
        },
      });
    }

    // -------------------------------- list
    if (action === 'list') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { organizationId } = payload;
      if (!organizationId) return json({ error: 'organizationId is required' }, 400);
      await assertOrgAdmin(sb, userId, organizationId);

      const [{ data: devices }, { data: codes }] = await Promise.all([
        sb.from('punch_clock_devices')
          .select('id, device_name, location_id, paired_at, last_active_at, revoked_at, locations(name, store_number)')
          .eq('organization_id', organizationId)
          .order('paired_at', { ascending: false }),
        sb.from('punch_clock_pairing_codes')
          .select('id, code, device_name, location_id, expires_at, created_at, locations(name, store_number)')
          .eq('organization_id', organizationId)
          .is('redeemed_at', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
      ]);
      return json({ devices: devices || [], pendingCodes: codes || [] });
    }

    // -------------------------------- revoke
    if (action === 'revoke') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { deviceId } = payload;
      if (!deviceId) return json({ error: 'deviceId is required' }, 400);

      const { data: device, error: findErr } = await sb
        .from('punch_clock_devices')
        .select('id, auth_user_id, organization_id')
        .eq('id', deviceId)
        .single();
      if (findErr || !device) return json({ error: 'Device not found' }, 404);

      await assertOrgAdmin(sb, userId, device.organization_id);

      // Mark revoked (keeps audit trail), then delete the auth user to kill sessions
      await sb.from('punch_clock_devices')
        .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
        .eq('id', deviceId);
      await sb.auth.admin.deleteUser(device.auth_user_id).catch((e) => {
        console.error('deleteUser failed (device row still marked revoked):', e);
      });
      return json({ ok: true });
    }

    // -------------------------------- heartbeat (device session)
    if (action === 'heartbeat') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      await sb.from('punch_clock_devices')
        .update({ last_active_at: new Date().toISOString() })
        .eq('auth_user_id', userId)
        .is('revoked_at', null);
      return json({ ok: true });
    }

    // -------------------------------- verify (device session, on cold boot)
    if (action === 'verify') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { data: device } = await sb
        .from('punch_clock_devices')
        .select('id, device_name, location_id, revoked_at, locations(id, name, store_number, organization_id)')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (!device || device.revoked_at) return json({ ok: false, revoked: true });
      return json({ ok: true, device });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error('[punch-device-service] error:', err);
    return json({ error: err?.message || 'Server error' }, 500);
  }
});
