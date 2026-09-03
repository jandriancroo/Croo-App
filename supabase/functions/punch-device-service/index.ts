// @ts-nocheck
// Punch clock device pairing service.
// Actions:
//   generate       (authed org admin)  → create a pairing code for a location
//   redeem         (public)            → exchange a code for a device session + durable device secret
//   reissue        (device secret)     → mint a NEW session for the SAME device row / auth user
//   backfill_secret(device session)    → give an already-paired healthy tablet a durable secret
//   list           (authed org admin)  → list paired devices for an org
//   revoke         (authed org admin)  → revoke a paired device
//   heartbeat      (device session)    → touch last_active_at
//   verify         (device session)    → confirm the device row is still live
//
// Pairing model (locked 2026-09-03): a paired tablet stays that store's punch
// clock until a manager revokes it. Unused pairing codes still expire in 60
// minutes; live devices NEVER expire and are never TTL'd on last_active_at.
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

// Reissue rate limit: a healthy tablet needs this a handful of times a day at
// most (cold launch, wake-repair). A runaway loop is capped here.
const REISSUE_MAX_PER_WINDOW = 12;
const REISSUE_WINDOW_MS = 60 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newDeviceSecret(): string {
  return `pds_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

// Constant-time compare of two equal-length hex digests.
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

// Rotate the device auth user's password and mint a fresh session for the SAME
// auth user. This is how a tablet recovers without a second GoTrue user.
async function mintSessionForDeviceUser(sb: any, authUserId: string) {
  const { data: userRes, error: getErr } = await sb.auth.admin.getUserById(authUserId);
  const email = userRes?.user?.email;
  if (getErr || !email) throw new Error('Device account is missing');

  const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { error: updErr } = await sb.auth.admin.updateUserById(authUserId, { password });
  if (updErr) throw new Error(`Could not refresh device credentials: ${updErr.message}`);

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: signed, error: signErr } = await anonClient.auth.signInWithPassword({ email, password });
  if (signErr || !signed?.session) throw new Error(`Could not mint device session: ${signErr?.message}`);

  return {
    access_token: signed.session.access_token,
    refresh_token: signed.session.refresh_token,
    expires_at: signed.session.expires_at,
  };
}

async function loadLocation(sb: any, locationId: string) {
  const { data } = await sb
    .from('locations')
    .select('id, name, store_number, organization_id')
    .eq('id', locationId)
    .single();
  return data;
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

      const { locationId, deviceName, mode, replaceDeviceId } = payload;
      if (!locationId || !deviceName?.trim()) {
        return json({ error: 'locationId and deviceName are required' }, 400);
      }
      const name = deviceName.trim();

      const { data: loc, error: locErr } = await sb
        .from('locations')
        .select('id, organization_id, name')
        .eq('id', locationId)
        .single();
      if (locErr || !loc) return json({ error: 'Location not found' }, 404);

      await assertOrgAdmin(sb, userId, loc.organization_id);

      // Duplicate-name guard: never silently create "Front iPad 2". Ask the
      // manager whether they are replacing that tablet or adding another one.
      const { data: dupes } = await sb
        .from('punch_clock_devices')
        .select('id, device_name, paired_at, last_active_at')
        .eq('location_id', locationId)
        .eq('device_name', name)
        .is('revoked_at', null)
        .order('paired_at', { ascending: false });

      const existing = dupes || [];
      if (existing.length && mode !== 'replace' && mode !== 'add') {
        return json({ duplicate: true, existingDevices: existing, locationName: loc.name, deviceName: name });
      }

      if (mode === 'replace' && existing.length) {
        const target = replaceDeviceId
          ? existing.find((d: any) => d.id === replaceDeviceId) || existing[0]
          : existing[0];
        const { data: full } = await sb
          .from('punch_clock_devices')
          .select('id, auth_user_id')
          .eq('id', target.id)
          .single();
        await sb.from('punch_clock_devices')
          .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
          .eq('id', target.id);
        if (full?.auth_user_id) {
          await sb.auth.admin.deleteUser(full.auth_user_id).catch((e: any) => {
            console.error('[punch-device-service] orphan device user cleanup failed:', e);
          });
        }
      }

      const code = await generateUniqueCode(sb);
      const { data: row, error: insErr } = await sb
        .from('punch_clock_pairing_codes')
        .insert({
          code,
          location_id: locationId,
          organization_id: loc.organization_id,
          device_name: name,
          created_by: userId,
        })
        .select()
        .single();
      if (insErr) return json({ error: insErr.message }, 500);

      return json({
        code: row.code,
        expiresAt: row.expires_at,
        locationName: loc.name,
        deviceName: row.device_name,
        replaced: mode === 'replace' && existing.length > 0,
      });
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

      // Durable device secret — the credential that survives token rotation.
      const deviceSecret = newDeviceSecret();
      const secretHash = await sha256Hex(deviceSecret);

      // Insert device row
      const { data: device, error: devErr } = await sb
        .from('punch_clock_devices')
        .insert({
          auth_user_id: authUserId,
          location_id: pairing.location_id,
          organization_id: pairing.organization_id,
          device_name: pairing.device_name,
          created_by: pairing.created_by,
          device_secret_hash: secretHash,
          device_secret_issued_at: new Date().toISOString(),
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

      const loc = await loadLocation(sb, pairing.location_id);

      return json({
        deviceId: device.id,
        deviceName: device.device_name,
        deviceSecret,
        location: loc,
        session: {
          access_token: session.session.access_token,
          refresh_token: session.session.refresh_token,
          expires_at: session.session.expires_at,
        },
      });
    }

    // -------------------------------- reissue (device secret — primary restore)
    if (action === 'reissue') {
      const { deviceId, deviceSecret } = payload;
      if (!deviceId || !deviceSecret) return json({ error: 'deviceId and deviceSecret are required' }, 400);

      const { data: device } = await sb
        .from('punch_clock_devices')
        .select('id, auth_user_id, location_id, device_name, revoked_at, device_secret_hash, reissue_window_start, reissue_count_in_window')
        .eq('id', deviceId)
        .maybeSingle();

      // "Dead" is only ever: row gone, or revoked. Nothing else unpairs a tablet.
      if (!device) return json({ error: 'Device not found', dead: true }, 404);
      if (device.revoked_at) return json({ error: 'This device was revoked', dead: true, revoked: true }, 403);
      if (!device.device_secret_hash) return json({ error: 'Device has no stored key' }, 409);

      const presented = await sha256Hex(String(deviceSecret));
      if (!timingSafeEqual(presented, device.device_secret_hash)) {
        console.warn('[punch-device-service] reissue rejected: bad secret for device', deviceId);
        return json({ error: 'Invalid device key' }, 403);
      }

      // Rate limit (per device, rolling 1h window).
      const now = Date.now();
      const windowStart = device.reissue_window_start ? new Date(device.reissue_window_start).getTime() : 0;
      const inWindow = windowStart && now - windowStart < REISSUE_WINDOW_MS;
      const count = inWindow ? (device.reissue_count_in_window || 0) : 0;
      if (count >= REISSUE_MAX_PER_WINDOW) {
        return json({ error: 'Too many session renewals — try again shortly' }, 429);
      }

      let session;
      try {
        session = await mintSessionForDeviceUser(sb, device.auth_user_id);
      } catch (e: any) {
        return json({ error: e?.message || 'Could not renew device session' }, 500);
      }

      const stamp = new Date().toISOString();
      await sb.from('punch_clock_devices')
        .update({
          last_active_at: stamp,
          last_reissue_at: stamp,
          reissue_window_start: inWindow ? device.reissue_window_start : stamp,
          reissue_count_in_window: count + 1,
        })
        .eq('id', device.id);

      const loc = await loadLocation(sb, device.location_id);
      console.log('[punch-device-service] reissued session for device', device.id, device.device_name);

      return json({
        deviceId: device.id,
        deviceName: device.device_name,
        location: loc,
        session,
      });
    }

    // -------------------------------- backfill_secret (device session)
    // A tablet paired before durable secrets existed, still holding a working
    // session, mints its secret in the background. No new pairing code needed.
    if (action === 'backfill_secret') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const { data: device } = await sb
        .from('punch_clock_devices')
        .select('id, device_name, location_id, revoked_at, device_secret_hash')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (!device) return json({ error: 'Device not found', dead: true }, 404);
      if (device.revoked_at) return json({ error: 'This device was revoked', dead: true, revoked: true }, 403);

      const deviceSecret = newDeviceSecret();
      const { error: updErr } = await sb
        .from('punch_clock_devices')
        .update({
          device_secret_hash: await sha256Hex(deviceSecret),
          device_secret_issued_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
        })
        .eq('id', device.id);
      if (updErr) return json({ error: updErr.message }, 500);

      const loc = await loadLocation(sb, device.location_id);
      return json({ deviceId: device.id, deviceName: device.device_name, deviceSecret, location: loc });
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
          .select('id, device_name, location_id, paired_at, last_active_at, revoked_at, last_reissue_at, device_secret_issued_at, locations(name, store_number)')
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
        .update({ revoked_at: new Date().toISOString(), revoked_by: userId, device_secret_hash: null })
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
        .select('id, device_name, location_id, revoked_at, device_secret_hash, locations(id, name, store_number, organization_id)')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (!device || device.revoked_at) return json({ ok: false, revoked: true });
      return json({ ok: true, device, hasSecret: !!device.device_secret_hash });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error('[punch-device-service] error:', err);
    return json({ error: err?.message || 'Server error' }, 500);
  }
});
