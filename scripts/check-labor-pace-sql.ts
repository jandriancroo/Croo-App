// Server-side checks for get_labor_pace (run: bun scripts/check-labor-pace-sql.ts).
// Needs a signed-in session token in ACCESS_TOKEN (manager or super admin).
// 1) Pace parity: server sales_pace_today === app computePace for the same fixtures.
// 2) Per-shift owner rules via _lp_shift_eval.
// 3) Live: worked_hours / worked_labor_dollars === get_store_labor for each store given.
import { computePace } from '../supabase/functions/_shared/cubeMetrics';
import { paceFixtures, shiftFixtures, mealFixtures, hemetMealRules, ON_TRACK_BAND } from '../src/lib/laborPace.fixtures';

const URL = 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/rest/v1/rpc';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg';
const TOKEN = process.env.ACCESS_TOKEN!;
const STORES = (process.env.STORES || '').split(',').filter(Boolean);

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${URL}/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${fn}: ${JSON.stringify(j)}`);
  return j;
}

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fail++; };

for (const f of paceFixtures) {
  const app = computePace({ hourly_data: f.hourly, net_sales: f.net_sales, pace_adjusted_projection: f.stored, pace_calculated_at: f.stored_at, nowInStoreTz: { hour: f.h, minute: f.m }, nowMs: Date.parse(f.now) });
  const srv = await rpc('sales_pace_today', { _hourly: f.hourly, _net_sales: f.net_sales, _stored: f.stored, _stored_at: f.stored_at, _cur_h: f.h, _cur_m: f.m, _now: f.now });
  const same = app === null ? srv === null : srv !== null && Math.abs(Number(srv) - app) < 1e-6;
  check(`pace parity: ${f.name}`, same, `app=${app} server=${srv}`);
}

for (const f of shiftFixtures) {
  const r = await rpc('_labor_pace_shift_eval', { _s_start: f.s, _s_end: f.e, _npairs: f.npairs, _open: f.open, _first_in: f.first_in, _last_out: f.last_out, _now: f.now, _src: f.src, _schedule_only: f.so, _owed_sec: f.owed ?? 0, _taken_sec: f.taken ?? 0, _on_break: f.on_break ?? false });
  const row = Array.isArray(r) ? r[0] : r;
  const remH = Number(row.remaining_sec) / 3600;
  let ok = Math.abs(remH - f.rem_h) < 1e-9 && row.state === f.state;
  if ('late' in f) ok = ok && row.late_minutes === (f as any).late;
  if ('early' in f) ok = ok && row.early_out_minutes === (f as any).early;
  check(`shift rule: ${f.name}`, ok, JSON.stringify(row));
}

for (const m of mealFixtures) {
  const sec = await rpc('_labor_pace_meal_sec', { _gross: m.gross, ...hemetMealRules });
  check(`break size: ${m.name}`, Number(sec) === m.sec, `got=${sec}`);
}
check('on-track band is 1.0 point', Number(await rpc('_labor_pace_on_track_band', {})) === ON_TRACK_BAND);

for (const id of STORES) {
  const [p, l] = await Promise.all([rpc('get_labor_pace', { _location_id: id }), rpc('get_store_labor', { _location_ids: [id], _start: '2026-01-01', _end: '2026-01-01' }).catch(() => null)]);
  const today = p.business_date;
  const sl = (await rpc('get_store_labor', { _location_ids: [id], _start: today, _end: today }))[0];
  const dh = Math.abs(Number(p.worked_hours) - Number(sl.hours));
  const dc = Math.abs(Number(p.worked_labor_dollars) - Number(sl.cost));
  // Punch-clock stores are live: the two reads are a moment apart, so allow < 1 minute of one person's time.
  const tol = sl.source === 'punch_clock' ? { h: 0.02, c: 0.5 } : { h: 0, c: 0 };
  check(`worked = get_store_labor (${id.slice(0, 8)} ${sl.source})`, dh <= tol.h && dc <= tol.c, `proj=${p.worked_hours}h/$${p.worked_labor_dollars} store_labor=${sl.hours}h/$${sl.cost}`);
  check(`labor % null-safe (${id.slice(0, 8)})`, p.sales_pace > 0 ? p.pace_labor_pct !== 0 : p.pace_labor_pct === null);
  const uns = (p.people || []).flatMap((x: any) => x.shifts).filter((s: any) => s.state === 'unscheduled');
  for (const u of uns) check(`unscheduled end from template (${id.slice(0, 8)})`, u.end_from_template === true, `in=${u.actual_in} end=${u.scheduled_end}`);
  if (p.status) check(`status matches band (${id.slice(0, 8)})`, p.status === (Math.abs(p.variance_pct) <= ON_TRACK_BAND ? 'on_track' : p.variance_pct < 0 ? 'ahead' : 'behind'));
  void l;
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
