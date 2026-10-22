import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
// @ts-types="npm:@types/luxon@3"
import { DateTime } from 'npm:luxon@3.7.2';

export const MAX_RELEASE_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^\d+\.\d+\.\d+$/;
const BUCKET = 'toast-status-releases';
type Scope = 'studio' | 'mini' | 'publish';
type Token = { id: string; token_hash: string; scope: Scope; location_id: string };
const empty = (status: number) => new Response(null, { status });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function routeScope(method: string, path: string): Scope | null {
  if (method === 'GET' && path === '/') return 'studio';
  if (method === 'POST' && path === '/restart') return 'studio';
  if (method === 'GET' && path === '/restart-pending') return 'mini';
  if (method === 'POST' && path === '/restart-ack') return 'mini';
  if (method === 'POST' && path === '/release') return 'publish';
  return null;
}

export function parseRunner(message: string | null) {
  const age = message?.match(/session\s+age\s+(\d+(?:\.\d+)?)\s*h\b/i);
  const version = message?.match(/\bv\d+(?:\.\d+)*\b/i);
  return { session_age_hours: age ? Number(age[1]) : null, version: version?.[0] ?? null };
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function percentage(numerator: unknown, denominator: unknown, delta = false) {
  const n = numeric(numerator), d = numeric(denominator);
  return n === null || d === null || d <= 0 ? null : Math.round((n / d - (delta ? 1 : 0)) * 1000) / 10;
}

function unwrap<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error('Database operation failed');
  return result.data;
}

async function authenticate(req: Request, db: SupabaseClient, scope: Scope, now: string): Promise<Token | null> {
  const raw = req.headers.get('X-Status-Token');
  if (!raw) return null;
  const hash = await sha256(new TextEncoder().encode(raw));
  const result = await db.from('toast_status_tokens').select('id,token_hash,scope,location_id')
    .eq('token_hash', hash).eq('revoked', false).maybeSingle();
  if (result.error || !result.data || !constantTimeEqual(hash, result.data.token_hash) || result.data.scope !== scope) return null;
  unwrap(await db.from('toast_status_tokens').update({ last_used_at: now }).eq('id', result.data.id).eq('revoked', false));
  return result.data as Token;
}

async function pending(db: SupabaseClient, location: string, now: DateTime) {
  return unwrap(await db.from('toast_status_restart_requests').select('id,requested_at')
    .eq('location_id', location).is('acked_at', null).gt('requested_at', now.minus({ minutes: 15 }).toISO())
    .order('requested_at', { ascending: false }).limit(1).maybeSingle());
}

async function studioStatus(db: SupabaseClient, token: Token, now: DateTime) {
  const location = token.location_id;
  const businessDate = unwrap(await db.rpc('business_date', { _location_id: location }));
  if (typeof businessDate !== 'string') throw new Error('Business date unavailable');
  const lastWeek = DateTime.fromFormat(businessDate, 'yyyy-MM-dd', { zone: 'UTC' }).minus({ days: 7 }).toFormat('yyyy-MM-dd');
  const [loc, robot, lastPull, today, week, shifts, labor, restart] = await Promise.all([
    db.from('locations').select('name').eq('id', location).maybeSingle(),
    db.from('toast_robot_status').select('state,message,heartbeat_at').eq('location_id', location).maybeSingle(),
    db.from('toast_sales_cache').select('fetched_at').eq('location_id', location).order('fetched_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db.from('toast_sales_cache').select('net_sales,check_count').eq('location_id', location).eq('sale_date', businessDate).order('fetched_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db.from('toast_sales_cache').select('net_sales,check_count').eq('location_id', location).eq('sale_date', lastWeek).order('fetched_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    db.from('toast_shifts').select('employee_name,in_time').eq('location_id', location).is('out_time', null)
      .or(`shift_date.eq.${businessDate},in_time.gte.${now.minus({ hours: 24 }).toISO()}`).order('in_time', { ascending: true, nullsFirst: false }),
    db.from('labor_cache').select('labor_cost').eq('location_id', location).eq('labor_date', businessDate).eq('source', 'toast').maybeSingle(),
    pending(db, location, now),
  ]);
  const locationData = unwrap(loc), runner = unwrap(robot), pull = unwrap(lastPull);
  const todayData = unwrap(today), weekData = unwrap(week), shiftData = unwrap(shifts), laborData = unwrap(labor);
  return {
    location: { name: locationData?.name ?? null },
    runner: { state: runner?.state ?? null, message: runner?.message ?? null, heartbeat_at: runner?.heartbeat_at ?? null,
      last_sales_pull_at: pull?.fetched_at ?? null, ...parseRunner(runner?.message ?? null) },
    sales: { business_date: businessDate, net_sales: numeric(todayData?.net_sales), check_count: todayData?.check_count ?? null,
      last_week_same_day: { date: lastWeek, net_sales: numeric(weekData?.net_sales), check_count: weekData?.check_count ?? null },
      delta_pct: percentage(todayData?.net_sales, weekData?.net_sales, true) },
    clocked_in: (shiftData ?? []).map(shift => ({ first_name: String(shift.employee_name ?? '').trim().split(/\s+/)[0], in_time: shift.in_time })),
    labor_pct: percentage(laborData?.labor_cost, todayData?.net_sales), restart_pending: Boolean(restart), server_time: now.toISO(),
  };
}

async function release(req: Request, url: URL, db: SupabaseClient) {
  const version = url.searchParams.get('version');
  if (!version || !VERSION.test(version) || version.length > 60) return json({ error: 'version must be x.y.z' }, 400);
  const length = req.headers.get('Content-Length');
  if (length && Number(length) > MAX_RELEASE_BYTES) return empty(413);
  if (!req.body) return json({ error: 'ZIP body required' }, 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RELEASE_BYTES) { await reader.cancel(); return empty(413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (size < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || !((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))) return json({ error: 'ZIP body required' }, 400);
  // Never publish a download URL that cannot be served publicly.
  const bucket = unwrap(await db.storage.getBucket(BUCKET));
  if (!bucket?.public) return json({ error: 'Public release storage is not enabled' }, 503);
  const digest = await sha256(bytes);
  const path = `toast-status-${version}.zip`;
  const uploaded = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/zip', upsert: false });
  if (uploaded.error) return json({ error: 'Release upload rejected' }, 409);
  const downloadUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const inserted = await db.from('app_releases').insert({ app: 'toast-status', version, download_url: downloadUrl, sha256: digest });
  if (inserted.error) {
    await db.storage.from(BUCKET).remove([path]);
    return json({ error: 'Release metadata rejected' }, 409);
  }
  return json({ version, download_url: downloadUrl, sha256: digest });
}

export function createHandler(db: SupabaseClient, clock = () => DateTime.utc()) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return empty(405);
    const url = new URL(req.url);
    const match = url.pathname.match(/(?:^|\/)toast-status(\/.*)?$/);
    const path = match?.[1] || (match ? '/' : null);
    if (!path) return empty(404);
    try {
      if (req.method === 'GET' && path === '/latest') {
        const row = unwrap(await db.from('app_releases').select('version,download_url,sha256,notes')
          .eq('app', 'toast-status').order('created_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle());
        return row ? json(row) : empty(404);
      }
      const scope = routeScope(req.method, path);
      if (!scope) return empty(404);
      const now = clock();
      const token = await authenticate(req, db, scope, now.toISO() ?? '');
      if (!token) return empty(401);
      if (path === '/') return json(await studioStatus(db, token, now));
      if (path === '/restart') {
        const result = unwrap(await db.rpc('toast_status_request_restart', { _location_id: token.location_id, _token_id: token.id }));
        return json(result, result.status === 'rate_limited' ? 429 : 200);
      }
      if (path === '/restart-pending') {
        const row = await pending(db, token.location_id, now);
        return json({ pending: Boolean(row), id: row?.id ?? null, requested_at: row?.requested_at ?? null });
      }
      if (path === '/restart-ack') {
        const text = await req.text();
        let id: unknown;
        if (text.trim()) {
          let body: unknown;
          try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Expected an object' }, 400);
          id = (body as Record<string, unknown>).id;
          if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) return json({ error: 'Invalid request id' }, 400);
        }
        let query = db.from('toast_status_restart_requests').update({ acked_at: now.toISO() }).eq('location_id', token.location_id).is('acked_at', null);
        if (typeof id === 'string') query = query.eq('id', id);
        const rows = unwrap(await query.select('id'));
        return json({ ok: true, acked: rows?.length ?? 0 });
      }
      if (path === '/release') return await release(req, url, db);
      return empty(404);
    } catch {
      // No raw database errors, tokens, names, or request payloads in logs/responses.
      return empty(500);
    }
  };
}