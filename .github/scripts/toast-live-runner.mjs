// Toast live robot — Homemade Toast integration, live fetcher.
//
// Signs into Toast Web ONCE (Auth0 + TOTP from the saved setup key), then
// polls during store hours every POLL_SECONDS (default 90 s), pulling each
// store's Sales Summary via the report-generator API using the browser's own
// session, normalizing it, and posting the SAME day payload as the nightly
// export robot to `toast-sync` (data_source='live').
//
// Punches (labor pairing) are intentionally NOT ingested yet — read-only
// recon captured the shape; writing labor needs explicit owner sign-off.
//
// Env (GitHub secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY, CRON_SECRET
//   TOAST_LOGIN_EMAIL, TOAST_LOGIN_PASSWORD, TOAST_TOTP_SECRET
//   POLL_SECONDS (default 90), MAX_RUN_MINUTES (default 320), ONESHOT=1 (test)

import { chromium } from 'playwright';
import crypto from 'node:crypto';

const { SUPABASE_URL, SUPABASE_ANON_KEY, CRON_SECRET } = process.env;
const POLL_SECONDS = parseInt(process.env.POLL_SECONDS || '90', 10);
const MAX_RUN_MINUTES = parseFloat(process.env.MAX_RUN_MINUTES || '320');
const ONESHOT = process.env.ONESHOT === '1';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !CRON_SECRET) {
  console.error('❌ Missing SUPABASE_URL / SUPABASE_ANON_KEY / CRON_SECRET');
  process.exit(1);
}
for (const k of ['TOAST_LOGIN_EMAIL', 'TOAST_LOGIN_PASSWORD', 'TOAST_TOTP_SECRET']) {
  if (!process.env[k]) { console.error(`❌ Missing ${k}`); process.exit(1); }
}
const TOAST_TOTP_SECRET = process.env.TOAST_TOTP_SECRET;

// ── TOTP (RFC 6238, 6 digits / 30 s — same as Google Authenticator) ──
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '')) { const v = A.indexOf(ch.toUpperCase()); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const s = secret.replace(/\s+/g, '').toUpperCase();
  const key = b32decode(s);
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 1e6;
  return String(code).padStart(6, '0');
}

async function callService(action, body = {}) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/toast-service`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`toast-service ${action} failed: ${JSON.stringify(j)}`);
  return j;
}

function postToSync(days) {
  return fetch(`${SUPABASE_URL}/functions/v1/toast-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({ action: 'ingest', days }),
  });
}

// Store-local wall clock helpers (POS stores can be in any tz; Coop's = Central).
function localParts(tz, at = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const h = parseInt(p.hour === '24' ? '00' : p.hour, 10);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: h, minute: parseInt(p.minute, 10), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

const toMin = (t) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);

// Is the store open (with pre-open / post-close grace) for polling?
function inWindow(store) {
  if (process.env.FORCE_WINDOW === '1') return true;
  const { hour, minute, dow } = localParts(store.timezone);
  const nowMin = hour * 60 + minute;
  const day = (store.hours || []).find((h) => h.dow === dow);
  if (!day || day.closed) return false;
  // 2h after close so late clock-outs land and the day ends matching Toast.
  return nowMin >= toMin(day.open) - 30 && nowMin <= toMin(day.close) + 120;
}

async function signInOnce(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
  await ctx.addInitScript(`
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
    window.chrome = window.chrome || {runtime:{}};
  `);
  const page = await ctx.newPage();

  await page.goto('https://www.toasttab.com/login', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 120; i++) {
    const c = (await page.content().catch(() => "just a moment")).toLowerCase();
    if (!c.includes('just a moment') && !c.includes('security verification')) break;
    await page.waitForTimeout(1000);
  }
  // Interactive Turnstile (click inside the challenge iframe if present)
  for (let a = 0; a < 8; a++) {
    const c = (await page.content().catch(() => "just a moment")).toLowerCase();
    if (!c.includes('verify you are human') && !c.includes('turnstile')) break;
    try {
      for (const f of page.frames()) {
        if (f.url().includes('challenges.cloudflare.com')) {
          try { await f.locator('body').click({ timeout: 2000 }); } catch {}
        }
      }
    } catch {}
    await page.waitForTimeout(5000);
  }
  await page.waitForSelector('input[name=username]', { timeout: 90000 });
  await page.fill('input[name=username]', process.env.TOAST_LOGIN_EMAIL);
  await page.click('button[type=submit]');
  // Cloudflare can re-check between the email and password steps, so wait
  // longer and re-submit once instead of failing the whole run.
  try {
    await page.waitForSelector('input[type=password]', { timeout: 60000 });
  } catch {
    try { await page.click('button[type=submit]'); } catch {}
    await page.waitForSelector('input[type=password]', { timeout: 60000 });
  }

  await page.fill('input[type=password]', process.env.TOAST_LOGIN_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForTimeout(4000);
  for (let a = 0; a < 3; a++) {
    try {
      await page.waitForSelector('input[inputmode=numeric]', { timeout: 15000 });
      { const r = Math.floor(Date.now()/1000) % 30; await page.waitForTimeout(((a === 0 && r < 22) ? 0 : (31 - r)) * 1000); }
      await page.fill('input[inputmode=numeric]', totp(TOTP_TOTP_SECRET_V));
      const btns = page.locator("button:has-text('Verify'), button:has-text('Continue'), button[type=submit]");
      if (await btns.count() > 0) await btns.first().click();
    } catch { break; }
    try { await page.waitForURL(/toasttab\.com\/restaurants/, { timeout: 20000 }); } catch {}
    if (page.url().includes('toasttab.com/restaurants')) break;
  }
  if (!page.url().includes('toasttab.com/restaurants')) {
    try { await page.goto('https://www.toasttab.com/restaurants/admin/home', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch {}
  }
  if (!page.url().includes('toasttab.com/restaurants')) { await page.screenshot({path:'shots/live_fail.png'}); console.log((await page.innerText('body')).slice(0,400)); }
  const stillOtp = await page.locator('input[inputmode=numeric]').count().catch(() => 0);
  if (stillOtp && !page.url().includes('toasttab.com/restaurants')) throw new Error(`Sign-in did not land on Toast admin (at ${page.url()})`);
  try { await page.locator("[aria-label='Close']").first().click({ timeout: 3000 }); } catch {}
  try { await page.locator("button:has-text('Reject Non-Necessary')").click({ timeout: 4000 }); } catch {}
  console.log('✅ Toast sign-in OK');
  return { ctx, page };
}
let TOTP_TOTP_SECRET_V;

// Fetch inside the signed-in browser session (cookies + bot checks apply).
async function pageFetch(page, url, body) {
  return await page.evaluate(async ({ url, body }) => {
    const r = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  }, { url, body });
}

function reportBody(restaurantGuid, date /* yyyy-MM-dd */) {
  return {
    reportName: 'sales/SalesSummary',
    locations: [[{ locationGuid: restaurantGuid, locationType: 'RESTAURANT' }]],
    dateRanges: { customDateRanges: [{ startDateYYYYMMDD: date.replaceAll('-', ''), endDateYYYYMMDD: date.replaceAll('-', '') }] },
    parameters: {
      filterDiningOptions: false, filterDaysOfWeek: false, filterEmployees: false,
      filterServices: false, filterSources: false, filterServiceAreas: false,
      filterRevenueCenters: false, filterHourOfDay: false, filterHoursAndMinutes: false,
    },
    renderer: 'JSON',
    dispatcher: { type: 'LIVE' },
  };
}

// Normalize the SalesSummary results JSON into the shared toast-sync Day payload.
function normalize(results) {
  const net = Number(results?.netSales?.[0]?.netSales ?? 0);
  const dayRow = results?.trendsByDate?.[0] ?? {};
  const hourly = (results?.trendsByHour ?? []).map((h) => ({
    hour: `${String(h.hourOfDay).padStart(2, '0')}:00`,
    sales: Number(h.netSales ?? 0),
    checksCount: Number(h.orderCount ?? 0),
  }));
  // Only subtype-less rows — subtype rows are breakdowns of the same total.
  const tenders = (results?.paymentTypesSummary ?? [])
    .filter((p) => p.paymentSubtype == null)
    .map((p) => ({
      label: String(p.paymentType ?? 'UNKNOWN'),
      count: Number(p.paymentCount ?? 0),
      amount: Number(p.paymentAmount ?? 0),
      tips: Number(p.tipAmount ?? 0),
    }));
  const tips = Number(results?.employeeTips?.[0]?.tipsCollected ?? 0);
  return {
    netSales: Math.round(net * 100) / 100,
    guestCount: Number(dayRow.guestCount ?? 0),
    checkCount: Number(dayRow.orderCount ?? 0),
    hourly,
    payments: { tenders, total_tips: tips },
    raw: { diningOptions: results?.diningOptions, revenueCenters: results?.revenueCenters, services: results?.services, discounts: results?.discounts, netSales: results?.netSales, employeeTips: results?.employeeTips, paymentTypesSummary: results?.paymentTypesSummary, taxSummary: results?.taxSummary },
  };
}

async function pollOnce(page, store, date) {
  const { status: s1, json: j1 } = await pageFetch(page, 'https://www.toasttab.com/api/service/report-generator/v1/reportRequest', reportBody(store.restaurantGuid, date));
  if (s1 !== 200 || !j1?.reportRequestGuid) return { error: `reportRequest status ${s1}` };
  for (let t = 0; t < 20; t++) {
    const { status: s2, json: j2 } = await pageFetch(page, `https://www.toasttab.com/api/service/report-generator/v1/reportRequest/${j1.reportRequestGuid}/results`);
    if (s2 === 200 && j2 && !('status' in j2)) return normalize(j2);
    if (s2 !== 200 && s2 !== 404) return { error: `results status ${s2}` };
    if (j2?.status === 'FAILED') return { error: `report FAILED: ${j2?.errorMessage ?? ''}` };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { error: 'report did not complete' };
}

// ── Punches (read-only) ─────────────────────────────────────────────────────
// Replay the GetShiftsV2 GraphQL request captured from the Time Entry page
// (toast-shifts-request.json, written from the one-time capture). Dates in the
// template are rewritten to the target business date, so the same template
// works for any day. No template on disk → punch polling is skipped silently
// (sales keep flowing; labor pairing just idles).

import fs from 'node:fs';

function loadTemplate(name) {
  try {
    const p = new URL(`./${name}`, import.meta.url);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}
let SHIFTS_TPL = null;
let EMPLOYEES_TPL = null;

function replay(tpl, target /* yyyy-MM-dd */) {
  let url = tpl.url;
  let body = tpl.body ?? null;
  const dates = (tpl.dates || []).map((d) => ({
    raw: d,
    compact: /^\d{8}$/.test(d),
    iso: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d,
  }));
  // The last captured date is the reference; earlier dates keep their offset
  // so a captured date-range replays as the same span around the target day.
  const end = dates.length ? dates[dates.length - 1].iso : null;
  const offsets = dates.map((d) => {
    const delta = end ? daysBetweenIso(d.iso, end) : 0;
    const to = shiftDate(target, delta);
    return { from: d.raw, to: d.compact ? to.replaceAll('-', '') : to };
  });
  const sub = (s) => {
    let out = s;
    for (const o of offsets) out = out.split(o.from).join(o.to);
    return out;
  };
  url = sub(url);
  if (body) body = sub(body);
  return { url, body };
}

function daysBetweenIso(a, b) {
  return Math.round((Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8)) -
    Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8))) / 86400000);
}
function shiftDate(date, delta) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function findShiftArrays(node, out = []) {
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === 'object' && ('timeClock' in x || ('inTime' in x && 'id' in x)))) out.push(node);
    else node.forEach((n) => findShiftArrays(n, out));
    return out;
  }
  if (node && typeof node === 'object') {
    Object.values(node).forEach((n) => findShiftArrays(n, out));
  }
  return out;
}

function findEmployeeRows(node, out = []) {
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === 'object' && ('displayFullName' in x || 'fullName' in x))) out.push(node);
    else node.forEach((n) => findEmployeeRows(n, out));
    return out;
  }
  if (node && typeof node === 'object') {
    Object.values(node).forEach((n) => findEmployeeRows(n, out));
  }
  return out;
}

function normalizeShift(shift, employees /* Map<string, name> */) {
  const tc = shift.timeClock || {};
  const dur = shift.estimatedDurationBreakdown || {};
  const emp = shift.employee || {};
  const keys = [
    emp.user ?? emp.userId, emp.restaurantUser ?? emp.restaurantUserId,
    emp.externalEmployeeId, shift.restaurantUserId,
  ].filter((k) => k != null).map(String);
  const name = keys.map((k) => employees.get(k)).find(Boolean)
    || emp.displayName || emp.name
    || (keys[0] ? `Employee ${keys[0]}` : 'Unknown');
  const tipsObj = shift.tips || {};
  const breaks = (shift.takenBreaks || []).map((b) => ({
    start: b.startDateTime || b.startTime || b.start || null,
    end: b.endDateTime || b.endTime || b.end || null,
  }));
  return {
    id: String(shift.id ?? shift.shiftId ?? crypto.randomUUID()),
    employeeName: String(name).slice(0, 160),
    toastUserId: String(emp.user ?? emp.userId ?? shift.restaurantUserId ?? keys[0] ?? ''),
    restaurantUserId: emp.restaurantUser != null ? String(emp.restaurantUser) : null,
    externalEmployeeId: emp.externalEmployeeId != null ? String(emp.externalEmployeeId) : null,
    status: String(shift.status ?? 'UNKNOWN').slice(0, 40),
    inTime: String(tc.inTime ?? shift.inTime ?? ''),
    outTime: tc.outTime ?? shift.outTime ?? null,
    jobTitle: shift.job?.title ?? shift.jobTitle ?? null,
    isTipped: Boolean(shift.isTipped),
    tips: Math.round(Number(tipsObj.totalTips ?? (Number(tipsObj.cashGratuity ?? 0) + Number(tipsObj.nonCashGratuity ?? 0))) * 100) / 100,
    payableSeconds: Number(dur.payableTime ?? 0),
    overtimeSeconds: Number(dur.overtimeDuration ?? 0),
    unpaidBreakSeconds: Number(dur.unpaidBreakTime ?? 0),
    takenBreaks: breaks,
    missedBreaks: Array.isArray(shift.missedBreaks) ? shift.missedBreaks : [],
    anomalyCount: Array.isArray(shift.shiftAnomalies) ? shift.shiftAnomalies.length : 0,
  };
}

async function fetchShifts(page, restaurantGuid, date) {
  if (!SHIFTS_TPL) return null;
  const req = replay(SHIFTS_TPL, date);
  const { status, json } = await pageFetch(page, req.url, req.body);
  if (status !== 200) return { error: `GetShiftsV2 status ${status}` };
  const arrays = findShiftArrays(json);
  if (!arrays.length) return { error: 'no shift arrays in response' };
  const shifts = arrays.flatMap((a) => a);

  const employees = new Map();
  if (EMPLOYEES_TPL) {
    const er = replay(EMPLOYEES_TPL, date);
    const er2 = await pageFetch(page, er.url, er.body).catch(() => null);
    if (er2?.status === 200 && er2.json) {
      findEmployeeRows(er2.json).flat().forEach((e) => {
        const uid = e.user?.id ?? e.userId;
        const ruid = e.restaurantUsers?.[0]?.id ?? e.restaurantUserId ?? e.restaurantUser;
        if (uid != null) employees.set(String(uid), e.displayFullName || e.fullName || '');
        if (ruid != null) employees.set(String(ruid), e.displayFullName || e.fullName || '');
      });
    }
  }
  return shifts.map((s) => normalizeShift(s, employees));
}


// Local "9/28/26 8:21 AM" in store tz → UTC ISO.
function localToIso(txt, tz) {
  const m = String(txt || '').trim().match(/^(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)\s*(AM|PM)$/i);
  if (!m) return null;
  let [, mo, d, y, h, mi, ap] = m; y = +y < 100 ? 2000 + +y : +y; h = +h % 12 + (ap.toUpperCase() === 'PM' ? 12 : 0);
  const guess = Date.UTC(y, +mo - 1, +d, h, +mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asLocal - guess)).toISOString();
}
// Toast pay rates + full roster: one request to /api/restaurants/employees/users, cached 1h.
// Rate = wage override if set, else that job's default wage (cents → dollars). Salaries (>$500) skipped.
const normName = (n) => String(n || '').toLowerCase().replace(/[^a-z]/g, '');
let __wageCache = { at: 0, map: null };
async function fetchWageMap(page, locationId) {
  if (__wageCache.map && Date.now() - __wageCache.at < 3600e3) return __wageCache.map;
  try {
    const res = await page.evaluate(async (rid) => {
      const r = await fetch('/api/restaurants/employees/users', { credentials: 'include', headers: { Accept: '*/*', 'x-requested-with': 'XMLHttpRequest', 'toast-restaurant-external-id': rid, 'toast-management-set-guid': '16c17ca1-699a-43da-852a-3004d18fa63d', 'toast-restaurant-set-guid': '5ca95934-2724-44aa-a474-4a0bd7a5b9e1' } });
      return { status: r.status, body: r.ok ? await r.json() : null, err: r.ok ? '' : (await r.text()).slice(0, 300) };
    }, 'c93b197b-bbc8-4d94-a8b3-cc24cddc8c06');
    if (!res.body) { console.log('💵 wages status', res.status, res.err); return __wageCache.map; }
    const map = new Map();
    const roster = [];
    for (const u of res.body.users || []) {
      const byJob = new Map();
      for (const j of u.jobs || []) {
        const c = j.wageOverride?.fAmount ?? j.wage?.fAmount;
        if (c != null && c > 0 && c / 100 <= 500) byJob.set(String(j.name || '').toLowerCase().trim(), c / 100);
      }
      const e = { byJob };
      map.set(normName(`${u.firstName} ${u.lastName}`), e);
      if (u.chosenName) map.set(normName(`${u.chosenName} ${u.lastName}`), e);
      // Roster for the CrooHQ pairing screens. Key must match the punch report's
      // employee column (`name:Last, First`) so shifts auto-pair later.
      const ln = String(u.lastName || '').trim();
      const fn = String(u.firstName || '').trim();
      const cn = String(u.chosenName || '').trim();
      if (!ln && !fn && !cn) continue;
      const lastFirst = ln && (fn || cn) ? `${ln}, ${fn || cn}` : (fn || cn || ln);
      const first = (fn || cn).trim();
      const single = (u.jobs || []).length === 1 ? (u.jobs[0].wageOverride?.fAmount ?? u.jobs[0].wage?.fAmount) : null;
      roster.push({
        toastUserId: `name:${lastFirst}`.slice(0, 80),
        toastGuid: String(u.guid || '').slice(0, 80) || null,
        toastName: (first && ln ? `${first} ${ln}` : lastFirst).slice(0, 160),
        jobTitle: String(u.jobs?.[0]?.name || '').slice(0, 120) || null,
        hourlyWage: single && single / 100 > 0 && single / 100 <= 500 ? Math.round((single / 100) * 100) / 100 : null,
      });
    }
    console.log(`💵 wages loaded for ${map.size} names (${roster.length} roster)`);
    __wageCache = { at: Date.now(), map };
    if (locationId && roster.length > 0) {
      postEmployees(locationId, roster).then((r) => console.log(`👥 roster → toast-sync ${r.status}`)).catch((e) => console.log('👥 roster push failed:', e.message));
    }
    return map;
  } catch (e) { console.log('💵 wages error', e.message); return __wageCache.map; }
}
// Read-only punches from Toast's Time Entries report table (no GraphQL template needed).
async function fetchShiftsTable(ctx, tz, locationId) {
  const p = await ctx.newPage();
  try {
    await p.goto('https://www.toasttab.com/restaurants/admin/legacyReports/labor#labor-time-entries', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => [...document.querySelectorAll('table')].some((t) => /In Date/i.test(t.innerText) && /Employee/i.test(t.innerText)), null, { timeout: 45000 });
    // The table header paints before the rows arrive — a fixed 1.5s wait caused
    // "blank" reads (about half of checks). Wait up to 20s for real rows.
    await p.waitForFunction(() => {
      const t = [...document.querySelectorAll('table')].find((x) => /In Date/i.test(x.innerText) && /Employee/i.test(x.innerText));
      return t && [...t.querySelectorAll('tbody tr')].some((tr) => tr.querySelectorAll('td').length > 3);
    }, null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1000);
    const rows = await p.evaluate(() => {
      const t = [...document.querySelectorAll('table')].find((x) => /In Date/i.test(x.innerText) && /Employee/i.test(x.innerText));
      const heads = [...t.querySelectorAll('thead th')].map((h) => h.innerText.replace(/\s+/g, ' ').trim().toLowerCase());
      window.__heads = heads;
      return [...t.querySelectorAll('tbody tr')].map((tr) => {
        const c = [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim());
        const o = {}; heads.forEach((h, i) => { o[h] = c[i] ?? ''; }); return o;
      });
    });
    if (!globalThis.__loggedHeads && rows[0]) { console.log('🧾 columns:', Object.keys(rows[0]).join(' | ')); globalThis.__loggedHeads = true; }
    const wages = await fetchWageMap(p, locationId);
    const money = (v) => { const n = parseFloat(String(v || '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };
    return rows.filter((r) => r['employee'] && r['in date']).map((r) => {
      const wKey = Object.keys(r).find((k) => /^(wage|hourly wage|wage rate|pay rate|rate)$/.test(k));
      let hourlyWage = wKey ? money(r[wKey]) : null;
      if (!hourlyWage) { const rp = money(r['regular pay']); const rh = parseFloat(r['regular hours'] || '0'); if (rp && rh > 0) hourlyWage = Math.round((rp / rh) * 100) / 100; }
      const name = r['employee'].split(',').map((x) => x.trim()).reverse().join(' ');
      if (!hourlyWage && wages) { const e = wages.get(normName(name)); if (e) { const j = (r['job title'] || '').toLowerCase().trim(); hourlyWage = e.byJob.get(j) ?? (e.byJob.size === 1 ? [...e.byJob.values()][0] : null); } }
      const inTime = localToIso(r['in date'], tz);
      const outTime = localToIso(r['out date'], tz);
      const payH = parseFloat(r['payable hours'] || '0') || 0;
      const unpaidH = parseFloat(r['unpaid break time'] || '0') || 0;
      const id = crypto.createHash('sha1').update(`${r['employee']}|${r['in date']}`).digest('hex').slice(0, 24);
      return {
        id, employeeName: name.slice(0, 160), toastUserId: `name:${r['employee']}`.slice(0, 80),
        status: outTime ? 'FINISHED' : 'IN_PROGRESS', inTime, outTime,
        jobTitle: r['job title'] || null, payableSeconds: Math.round(payH * 3600), unpaidBreakSeconds: Math.round(unpaidH * 3600),
        hourlyWage: hourlyWage && hourlyWage > 0 ? hourlyWage : null,
      };
    }).filter((x) => x.inTime);
  } finally { await p.close().catch(() => {}); }
}

function postLabor(locationId, date, shifts) {
  return fetch(`${SUPABASE_URL}/functions/v1/toast-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({ action: 'ingest-labor', locationId, date, shifts }),
  });
}

function postEmployees(locationId, employees) {
  return fetch(`${SUPABASE_URL}/functions/v1/toast-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({ action: 'ingest-employees', locationId, employees }),
  });
}

async function backfill(days) {
  const { stores } = await callService('schedule_list');
  const browser = await chromium.launch({ headless: process.env.HEADFUL === '0', executablePath: process.env.CHROME_EXECUTABLE || undefined });
  let session;
  try {
    session = await signInOnce(browser);
    for (const store of stores.filter((s) => s.restaurantGuid)) {
      const { date: today } = localParts(store.timezone);
      let batch = [];
      for (let i = 1; i <= days; i++) {
        const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        let out = await pollOnce(session.page, store, date).catch((e) => ({ error: e.message }));
        if (out?.error) {
          console.warn(`⚠️ ${date}: ${out.error} — re-signing in`);
          try { await session.ctx.close(); session = await signInOnce(browser); out = await pollOnce(session.page, store, date); }
          catch (e) { out = { error: e.message }; }
          if (out?.error) { console.warn(`⚠️ skip ${date}`); continue; }
        }
        if (i > 7 && process.env.HOURLY_ALL !== '1') out.hourly = []; // hourly detail only for the last week (HOURLY_ALL=1 keeps every day)
        batch.push({ locationId: store.locationId, date, source: 'api', ...out });
        console.log(`📅 ${date}: $${out.netSales} (${out.checkCount} checks)`);
        if (batch.length >= 7 || i === days) {
          const r = await postToSync(batch); console.log(`→ ingest ${batch.length} days: ${r.status}`); batch = [];
        }
        await new Promise((r) => setTimeout(r, 1200 + Math.floor(Math.random() * 1500)));
      }
      if (batch.length) await postToSync(batch);
    }
  } finally { await browser.close(); }
}

// Check-ins so CrooHQ's watchdog knows exactly what the robot is doing.
// Never throws — a failed check-in must not stop the robot.
const RUN_ID = process.env.GITHUB_RUN_ID ? `gh-${process.env.GITHUB_RUN_ID}` : `local-${process.pid}`;
let HB_IDS = [];
async function hb(state, message, fullLogin = false) {
  if (!HB_IDS.length) return { allowed: true };
  try {
    return await callService('heartbeat', { locationIds: HB_IDS, state, message: message ? String(message).slice(0, 480) : undefined, runId: RUN_ID, fullLogin });
  } catch (e) { console.warn(`💓 check-in failed: ${e.message}`); return { allowed: true }; }
}

async function main() {
  TOTP_TOTP_SECRET_V = TOAST_TOTP_SECRET;
  if (process.env.BACKFILL_DAYS) return backfill(parseInt(process.env.BACKFILL_DAYS, 10));
  const { stores } = await callService('schedule_list');
  const active = stores.filter((s) => s.restaurantGuid && (process.env.PROBE_DATES === '1' || inWindow(s)));
  console.log(`Active Toast stores in polling window: ${active.map((s) => s.locationId).join(', ') || 'none'}`);
  if (active.length === 0) return;
  HB_IDS = active.map((s) => s.locationId);
  await hb('starting', `run ${RUN_ID}`);

  // Stay-signed-in strategy:
  //  1. Saved sign-in (cookies) on disk → reused on every restart/re-login, so no
  //     password + 2FA code unless Toast truly expired it.
  //  2. If Chrome itself crashes, relaunch Chrome (old code reused a dead browser
  //     forever, which looked like "logged out").
  //  3. Backoff between full sign-ins so we never hammer Toast's login, and a
  //     hard cap of 4 full sign-ins per day (enforced by CrooHQ, across runs).
  const STATE_FILE = process.env.TOAST_STATE_FILE || new URL('./.toast-session.json', import.meta.url).pathname;
  const launch = () => chromium.launch({ headless: process.env.HEADFUL === '0', executablePath: process.env.CHROME_EXECUTABLE || undefined });
  let browser = await launch();
  let lastFullLogin = 0;
  const saveState = async (ctx) => { try { await ctx.storageState({ path: STATE_FILE }); } catch {} };
  const trySaved = async () => {
    if (!fs.existsSync(STATE_FILE)) return null;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 }, storageState: STATE_FILE });
    const page = await ctx.newPage();
    await page.goto('https://www.toasttab.com/restaurants/admin/home', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(4000);
    if (/login|auth\.toasttab/.test(page.url())) { await ctx.close(); return null; }
    console.log('🔑 reused saved Toast sign-in');
    return { ctx, page };
  };
  const getSession = async () => {
    if (!browser.isConnected()) { console.warn('🔁 Chrome died — relaunching'); browser = await launch(); }
    const saved = await trySaved().catch(() => null);
    if (saved) { await hb('signed_in', 'reused saved sign-in'); return saved; }
    const wait = 120000 - (Date.now() - lastFullLogin);
    if (lastFullLogin && wait > 0) await new Promise((r) => setTimeout(r, wait));
    const gate = await hb('signing_in', 'full Toast sign-in', true);
    if (gate && gate.allowed === false) {
      const err = new Error('Daily Toast sign-in limit reached (4) — stopping so the account is not locked');
      err.code = 'LOGIN_CAPPED';
      throw err;
    }
    lastFullLogin = Date.now();
    let s;
    try { s = await signInOnce(browser); }
    catch (e) {
      const human = /username|Timeout|just a moment|verify/i.test(e.message);
      await hb(human ? 'human_check' : 'error', human ? `Stuck at Toast's human check: ${e.message}` : e.message);
      throw e;
    }
    await saveState(s.ctx);
    await hb('signed_in', `full sign-in ok (${gate?.fullLoginsToday ?? '?'} of ${gate?.maxFullLogins ?? 4} today)`);
    return s;
  };
  let session;
  SHIFTS_TPL = loadTemplate('toast-shifts-request.json');
  EMPLOYEES_TPL = loadTemplate('toast-employees-request.json');
  if (SHIFTS_TPL) console.log('🧾 punch template loaded — labor polling active');
  try {
    session = await getSession();
    if (process.env.PROBE_DATES === '1') {
      const p = await session.ctx.newPage();
      const seen = [];
      p.on('request', (rq) => { if (/report|labor|time/i.test(rq.url()) && rq.resourceType() !== 'image') seen.push(`${rq.method()} ${rq.url().slice(0, 200)} ${String(rq.postData() || '').slice(0, 300)}`); });
      await p.goto('https://www.toasttab.com/restaurants/admin/legacyReports/labor#labor-time-entries', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(12000);
      const ctl = await p.evaluate(() => [...document.querySelectorAll('input,select,button,a[data-range],[class*=date i],[id*=date i]')].slice(0, 80).map((e) => `${e.tagName}#${e.id}.${String(e.className).slice(0, 60)} name=${e.getAttribute('name')} val=${e.value ?? ''} txt=${(e.innerText || '').slice(0, 40).replace(/\s+/g, ' ')}`));
      console.log('CONTROLS\n' + ctl.join('\n'));
      console.log('REQUESTS\n' + seen.join('\n'));
      await p.screenshot({ path: '/tmp/toast-run/probe.png' });
      await saveState(session.ctx);
      return;
    }
    const start = Date.now();
    let loopN = -1;
    let handoffSent = false;
    let capped = false;
    while (true) {
      loopN++;
      const ranMin = (Date.now() - start) / 60000;
      if (ranMin > MAX_RUN_MINUTES) { console.log('⏱ run budget reached'); break; }
      // 15 min before the budget ends, ask the watchdog to queue the next run.
      // GitHub holds it until this run exits, so there's never two sign-ins.
      if (!handoffSent && ranMin > MAX_RUN_MINUTES - 15) { handoffSent = true; await hb('handoff', 'run budget almost used — next run please'); }
      if (!browser.isConnected()) { try { session = await getSession(); } catch (e) { console.warn(`⚠️ relaunch failed: ${e.message}`); if (e.code === 'LOGIN_CAPPED') { capped = true; break; } } }
      let polledOk = 0;
      let lastMsg = '';
      for (const store of active) {
        const { date } = localParts(store.timezone);
        if (!inWindow(store)) continue;
        let out;
        try { out = await pollOnce(session.page, store, date); }
        catch (e) {
          console.warn(`⚠️ ${store.locationId} poll failed: ${e.message}`);
          try {
            await session.ctx.close().catch(() => {});
            session = await getSession();
            out = await pollOnce(session.page, store, date);
          } catch (e2) {
            console.warn(`⚠️ re-sign-in failed: ${e2.message}`);
            if (e2.code === 'LOGIN_CAPPED') capped = true;
            out = { error: e2.message };
          }
        }
        if (capped) break;
        if (!out?.error && loopN % 10 === 0) await saveState(session.ctx);
        if (out?.error) { console.warn(`⚠️ ${store.locationId}: ${out.error}`); lastMsg = out.error; continue; }
        const day = { locationId: store.locationId, date, source: 'live', ...out };
        const r = await postToSync([day]);
        await r.json().catch(() => ({}));
        console.log(`📊 ${date} ${store.locationId}: net $${out.netSales} (${out.checkCount} checks) → ${r.ok ? 'ingested' : `ERROR ${r.status}`}`);
        if (r.ok) { polledOk++; lastMsg = `$${out.netSales} (${out.checkCount} checks)`; }
        // Read-only punch pull for the same day (Toast owns punches).
        // Punches every loop (90s) so late clock-outs are never missed.
        {
          try {
            const shifts = SHIFTS_TPL ? await fetchShifts(session.page, store.restaurantGuid, date) : await fetchShiftsTable(session.ctx, store.timezone, store.locationId);
            if (shifts?.error) { console.warn(`🧾 ${date}: ${shifts.error}`); }
            else if (Array.isArray(shifts) && shifts.length === 0) { console.warn(`🧾 ${date}: blank punch read — keeping last good labor`); lastMsg += ' · blank punch page'; }
            else if (Array.isArray(shifts)) {
              const lr = await postLabor(store.locationId, date, shifts);
              const lj = await lr.json().catch(() => ({}));
              console.log(`🧾 ${date}: ${shifts.length} shifts → ${lr.ok ? `ingested (${lj.updated ?? lj.shifts ?? ''})` : `ERROR ${lr.status}`}`);
              lastMsg += ` · ${shifts.length} punches`;
            }
          } catch (e) { console.warn(`🧾 ${date}: ${e.message}`); }
        }
      }
      if (capped) { await hb('login_capped', 'Daily Toast sign-in limit reached — needs a person'); break; }
      if (!handoffSent) await hb(polledOk > 0 ? 'polling' : 'error', lastMsg || 'no data this cycle');
      if (ONESHOT) { console.log('ONESHOT — exiting after one poll'); break; }
      const stillOpen = active.some((s) => inWindow(s));
      if (!stillOpen) { console.log('🌙 all stores closed'); await hb('stopped', 'store closed for the day'); break; }
      await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000 + Math.floor(Math.random() * 8000)));
    }
  } finally {
    await browser.close();
  }
}

main().catch(async (e) => {
  console.error('❌', e);
  await hb(e?.code === 'LOGIN_CAPPED' ? 'login_capped' : 'error', e?.message || String(e));
  process.exit(1);
});
