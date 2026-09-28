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
function totp(secret, at = Date.now()) {
  const s = secret.replace(/\s+/g, '').toUpperCase();
  const key = Buffer.from(s + '='.repeat((8 - (s.length % 8)) % 8), 'base32');
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
  const { hour, minute, dow } = localParts(store.timezone);
  const nowMin = hour * 60 + minute;
  const day = (store.hours || []).find((h) => h.dow === dow);
  if (!day || day.closed) return false;
  return nowMin >= toMin(day.open) - 30 && nowMin <= toMin(day.close) + 45;
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
    const c = (await page.content()).toLowerCase();
    if (!c.includes('just a moment')) break;
    await page.waitForTimeout(1000);
  }
  // Interactive Turnstile (click inside the challenge iframe if present)
  for (let a = 0; a < 8; a++) {
    const c = (await page.content()).toLowerCase();
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
  await page.waitForSelector('input[name=username]', { timeout: 60000 });
  await page.fill('input[name=username]', process.env.TOAST_LOGIN_EMAIL);
  await page.click('button[type=submit]');
  await page.waitForSelector('input[type=password]', { timeout: 30000 });
  await page.fill('input[type=password]', process.env.TOAST_LOGIN_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForTimeout(4000);
  for (let a = 0; a < 3; a++) {
    try {
      await page.waitForSelector('input[inputmode=numeric]', { timeout: 15000 });
      await page.fill('input[inputmode=numeric]', totp(TOTP_TOTP_SECRET_V));
      const btns = page.locator("button:has-text('Verify'), button:has-text('Continue'), button[type=submit]");
      if (await btns.count() > 0) await btns.first().click();
    } catch { break; }
    await page.waitForTimeout(4000);
    if (page.url().includes('toasttab.com/restaurants')) break;
  }
  if (!page.url().includes('toasttab.com/restaurants')) throw new Error(`Sign-in did not land on Toast admin (at ${page.url()})`);
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

async function main() {
  TOTP_TOTP_SECRET_V = TOAST_TOTP_SECRET;
  const { stores } = await callService('schedule_list');
  const active = stores.filter((s) => s.restaurantGuid && inWindow(s));
  console.log(`Active Toast stores in polling window: ${active.map((s) => s.locationId).join(', ') || 'none'}`);
  if (active.length === 0) return;

  const browser = await chromium.launch({ headless: process.env.HEADFUL === '0', executablePath: process.env.CHROME_EXECUTABLE || undefined });
  let session;
  try {
    session = await signInOnce(browser);
    const start = Date.now();
    while (true) {
      if ((Date.now() - start) / 60000 > MAX_RUN_MINUTES) { console.log('⏱ run budget reached'); break; }
      for (const store of active) {
        const { date } = localParts(store.timezone);
        if (!inWindow(store)) continue;
        let out;
        try { out = await pollOnce(session.page, store, date); }
        catch (e) {
          console.warn(`⚠️ ${store.locationId} poll failed: ${e.message}`);
          // Re-sign-in once on session loss.
          try {
            await session.ctx.close();
            session = await signInOnce(browser);
            out = await pollOnce(session.page, store, date);
          } catch (e2) { console.warn(`⚠️ re-sign-in failed: ${e2.message}`); out = { error: e2.message }; }
        }
        if (out?.error) { console.warn(`⚠️ ${store.locationId}: ${out.error}`); continue; }
        const day = { locationId: store.locationId, date, source: 'live', ...out };
        const r = await postToSync([day]);
        const j = await r.json().catch(() => ({}));
        console.log(`📊 ${date} ${store.locationId}: net $${out.netSales} (${out.checkCount} checks) → ${r.ok ? 'ingested' : `ERROR ${r.status}`}`);
      }
      if (ONESHOT) { console.log('ONESHOT — exiting after one poll'); break; }
      const stillOpen = active.some((s) => inWindow(s));
      if (!stillOpen) { console.log('🌙 all stores closed'); break; }
      await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000 + Math.floor(Math.random() * 8000)));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
