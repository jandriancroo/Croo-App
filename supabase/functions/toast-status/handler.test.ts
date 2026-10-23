import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { DateTime } from 'npm:luxon@3.7.2';
import { constantTimeEqual, createHandler, MAX_RELEASE_BYTES, parseRunner, percentage, sha256 } from './handler.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const NOW = DateTime.fromISO('2026-10-22T23:46:00Z');
const LOCATION = '11111111-1111-4111-8111-111111111111';
type Call = { table: string; method: string; args: unknown[] };
async function fixture(scope = 'studio', valid = true, publicBucket = true) {
  const calls: Call[] = [];
  const hash = await sha256(new TextEncoder().encode('unit-test-token-not-a-real-token'));
  const rows: Record<string, unknown> = {
    toast_status_tokens: valid ? { id: 'token-id', token_hash: hash, scope, location_id: LOCATION } : null,
    locations: { name: 'Test Store' }, toast_robot_status: { state: 'ok', message: 'session age 0.3h runner v3', heartbeat_at: NOW.toISO() },
    toast_sales_cache: { net_sales: 100, check_count: 5, fetched_at: NOW.toISO() },
    toast_shifts: [{ employee_name: 'Taylor Person', in_time: NOW.toISO(), tips: 999, croo_user_id: 'private-id' }],
    labor_cache: { labor_cost: 20 }, toast_status_restart_requests: null, app_releases: null,
  };
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'gt', 'or', 'order', 'limit', 'update', 'insert']) {
        chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      }
      chain.maybeSingle = () => Promise.resolve({ data: rows[table], error: null });
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve);
      return chain;
    },
    rpc(name: string, args: unknown) {
      calls.push({ table: name, method: 'rpc', args: [args] });
      return Promise.resolve({ data: name === 'business_date' ? '2026-10-22' : { ok: false, status: 'rate_limited', retry_after_s: 240 }, error: null });
    },
    storage: { getBucket: () => Promise.resolve({ data: { public: publicBucket }, error: null }) },
  } as unknown as SupabaseClient;
  return { handler: createHandler(db, () => NOW), calls };
}
function request(path = '/', method = 'GET', body?: BodyInit) {
  return new Request(`http://local/toast-status${path}`, { method, body, headers: { 'X-Status-Token': 'unit-test-token-not-a-real-token' } });
}
Deno.test('hash and constant-time comparison use SHA256 hex', async () => {
  equal(await sha256(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  equal(constantTimeEqual('abc', 'abc'), true); equal(constantTimeEqual('abc', 'abd'), false); equal(constantTimeEqual('a', 'ab'), false);
});
Deno.test('missing, wrong or revoked token returns empty 401', async () => {
  const missing = await (await fixture()).handler(new Request('http://local/toast-status/'));
  equal(missing.status, 401); equal(await missing.text(), '');
  const invalid = await fixture('studio', false);
  const response = await invalid.handler(request()); equal(response.status, 401); equal(await response.text(), '');
  equal(invalid.calls.some(c => c.method === 'eq' && c.args[0] === 'revoked' && c.args[1] === false), true);
});
Deno.test('all protected routes enforce their exact scope', async () => {
  const routes = [['/', 'GET', 'studio'], ['/restart', 'POST', 'studio'], ['/restart-pending', 'GET', 'mini'], ['/restart-ack', 'POST', 'mini'], ['/release?version=1.2.3', 'POST', 'publish']];
  for (const [path, method, allowed] of routes) for (const scope of ['studio', 'mini', 'publish']) {
    if (scope === allowed) continue;
    const response = await (await fixture(scope)).handler(request(path, method));
    equal(response.status, 401); equal(await response.text(), '');
  }
});
Deno.test('OPTIONS 405, unknown route 404; no CORS', async () => {
  const cases: [string, string, number][] = [['/', 'OPTIONS', 405], ['/unknown', 'GET', 404]];
  for (const [path, method, status] of cases) {
    const response = await (await fixture()).handler(request(path, method));
    equal(response.status, status); equal(await response.text(), '');
    equal([...response.headers.keys()].some(key => key.startsWith('access-control-')), false);
  }
});
Deno.test('studio binds every read to token location and excludes sensitive employee fields', async () => {
  const f = await fixture();
  const response = await f.handler(request('/?location_id=attacker'));
  equal(response.status, 200);
  const result = await response.json(); equal(result.clocked_in, [{ first_name: 'Taylor', in_time: NOW.toISO() }]);
  equal(result.labor_pct, 20); equal(result.sales.last_week_same_day.date, '2026-10-15');
  equal(f.calls.filter(c => c.method === 'eq' && c.args[0] === 'location_id').every(c => c.args[1] === LOCATION), true);
  equal(f.calls.some(c => c.method === 'eq' && c.args[0] === 'source' && c.args[1] === 'toast'), true);
  equal(f.calls.some(c => c.method === 'gt' && c.args[1] === NOW.minus({ minutes: 15 }).toISO()), true);
});
Deno.test('runner missing values stay null and percentage rounds one decimal', () => {
  equal(parseRunner('session age 0.3h runner v3'), { session_age_hours: 0.3, version: 'v3' });
  equal(parseRunner(null), { session_age_hours: null, version: null });
  equal(percentage(110, 100, true), 10); equal(percentage(1, 3), 33.3);
  equal(percentage(null, 100), null); equal(percentage(10, 0), null);
});
Deno.test('restart rate result is 429 and location cannot be supplied by body', async () => {
  const f = await fixture(); const response = await f.handler(request('/restart', 'POST', '{"location_id":"attacker"}'));
  equal(response.status, 429); equal(await response.json(), { ok: false, status: 'rate_limited', retry_after_s: 240 });
  equal(f.calls.find(c => c.table === 'toast_status_request_restart')?.args, [{ _location_id: LOCATION, _token_id: 'token-id' }]);
});
Deno.test('release limit is exactly 5MB and rejects oversized actual bytes without trusting length', async () => {
  equal(MAX_RELEASE_BYTES, 5242880);
  const bytes = new Uint8Array(MAX_RELEASE_BYTES + 1); bytes.set([0x50, 0x4b, 3, 4]);
  const response = await (await fixture('publish')).handler(request('/release?version=1.2.3', 'POST', bytes)); equal(response.status, 413);
});
Deno.test('release exact size passes limit but fails closed while bucket is private', async () => {
  const bytes = new Uint8Array(MAX_RELEASE_BYTES); bytes.set([0x50, 0x4b, 3, 4]);
  const response = await (await fixture('publish', true, false)).handler(request('/release?version=1.2.3', 'POST', bytes)); equal(response.status, 503);
});
Deno.test('release validates version and restart ack validates id', async () => {
  equal((await (await fixture('publish')).handler(request('/release?version=../unsafe', 'POST'))).status, 400);
  equal((await (await fixture('mini')).handler(request('/restart-ack', 'POST', '{"id":"bad"}'))).status, 400);
});Deno.test('public latest returns hardcoded 3.1.0 release', async () => {
  const response = await (await fixture()).handler(request('/latest'));
  equal(response.status, 200);
  const body = await response.json(); equal(body.version, '3.1.0'); equal(body.sha256, 'c677fe8ea7db869714ac78a91e33c895c76cb4fc21e3ae4f8e6668306e65db75');
});
