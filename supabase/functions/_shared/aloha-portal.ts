// Shared Aloha Insight portal client — used by aloha-service (test)
// and aloha-sync (fetchAlohaDay).
//
// The portal is a JSP + servlet stack (login.do → /servlet/handlerswitch).
// There is no official REST API for this deployment, so we authenticate
// with the same form the browser uses and reuse the resulting session to
// call the "creategridsummaryfile" + "downloadgridsummaryfile" servlets.
//
// Flow:
//   1. GET  /login.do                       → captures initial JSESSIONID
//   2. POST /login.do  (form-encoded)       → auth, sets JSESSIONID
//   3. GET  /                               → scrape appConfiguration.settings
//                                             (sessionManagerID, userId, userLocale)
//   4. GET  /servlet/handlerswitch?endPoint=creategridsummaryfile...
//   5. GET  /servlet/handlerswitch?endPoint=downloadgridsummaryfile...
//                                            → CSV per-store rows

export interface AlohaSession {
  cookieHeader: string;      // Cookie header value to send on subsequent calls
  sessionManagerID: string;  // sessMgrID query param for servlet calls
  userId: string;
  userLocale: string;
  companyId: string;
}

export interface AlohaLoginInput {
  portalUrl: string;   // e.g. https://sierrafoodgroup.alohaenterprise.com
  companyId: string;   // e.g. sfg07
  loginName: string;
  password: string;
}

// ── tiny cookie jar ────────────────────────────────────────────────────────
type Jar = Map<string, string>;

function updateJar(jar: Jar, res: Response) {
  // Deno / Web fetch exposes Set-Cookie only via `getSetCookie()` (Deno ≥1.35).
  // Fallback to the raw header if the runtime is older.
  const setCookies: string[] =
    (res.headers as any).getSetCookie?.() ??
    (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    if (value === "" || value === "deleted") jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar: Jar): string {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

async function jarFetch(jar: Jar, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("User-Agent", UA);
  headers.set("Accept-Language", "en-US,en;q=0.9");
  if (!headers.has("Accept")) headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  const jarHeader = cookieHeader(jar);
  if (jarHeader) headers.set("Cookie", jarHeader);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  updateJar(jar, res);
  // Manual redirect follow (max 5)
  let cur = res;
  let hops = 0;
  while (cur.status >= 300 && cur.status < 400 && cur.headers.get("location") && hops < 5) {
    const loc = new URL(cur.headers.get("location")!, url).toString();
    const h = new Headers();
    h.set("User-Agent", UA);
    h.set("Accept-Language", "en-US,en;q=0.9");
    const c = cookieHeader(jar);
    if (c) h.set("Cookie", c);
    cur = await fetch(loc, { method: "GET", headers: h, redirect: "manual" });
    updateJar(jar, cur);
    hops++;
    url = loc;
  }
  return cur;
}

// ── Login + session bootstrap ──────────────────────────────────────────────
export async function alohaLogin(input: AlohaLoginInput): Promise<AlohaSession> {
  const jar: Jar = new Map();
  const base = normalizePortalBase(input.portalUrl);

  // 1. Prime session (JSESSIONID)
  const primeRes = await jarFetch(jar, `${base}/login.do`);
  if (!primeRes.ok) {
    throw new Error(`Aloha login prime failed: HTTP ${primeRes.status}`);
  }

  // 2. Submit credentials
  const form = new URLSearchParams({
    loginName: input.loginName,
    password: input.password,
    companyId: input.companyId,
    attempts: "1",
    ssl: "true",
    orig: new URL(base).host,
    fromJsp: "true",
    recaptcha_response: "",
  });

  const loginRes = await jarFetch(jar, `${base}/login.do`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": base,
      "Referer": `${base}/login.do`,
    },
    body: form.toString(),
  });

  const loginBody = await loginRes.text();

  // Failure heuristics: portal re-renders login.do with an error block. The
  // login page always includes reCAPTCHA script references, so only treat it as
  // a real challenge when the returned page contains challenge-specific text.
  const looksLikeLoginPage =
    /name=["']loginForm["']/i.test(loginBody) ||
    /invalid (user|login|password)/i.test(loginBody) ||
    hasRecaptchaChallenge(loginBody) && !/appConfiguration/.test(loginBody);

  if (looksLikeLoginPage || !/appConfiguration/.test(loginBody)) {
    // Try landing pages explicitly (some deployments redirect to a specific app)
    for (const path of [
      "/insightdashboard/dashboard.jsp",
      "/portal/portal.jsp",
      "/insightdashboard/",
      "/insight/",
      "/",
    ]) {
      const r = await jarFetch(jar, `${base}${path}`);
      const body = await r.text();
      if (/appConfiguration/.test(body) && !/name=["']loginForm["']/i.test(body)) {
        return parseAppConfig(base, body, input.companyId, jar);
      }
    }
    // Extract the visible portal error. The login page renders messages inside
    // a <span class="...Error">…</span> or the loginErrorTd cell.
    const patterns = [
      /<span[^>]*class=["'][^"']*Error[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      /<td[^>]*id=["']loginErrorTd["'][^>]*>([\s\S]*?)<\/td>/i,
      /<div[^>]*class=["'][^"']*(?:error|alert)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ];
    let err = "";
    for (const re of patterns) {
      const m = loginBody.match(re);
      if (m) {
        const txt = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (txt && !/you must enter/i.test(txt)) { err = txt.slice(0, 300); break; }
      }
    }
    if (!err) {
      err = hasRecaptchaChallenge(loginBody)
        ? "reCAPTCHA challenge required — portal is blocking programmatic login"
        : "credentials rejected (no error message returned)";
    }
    throw new Error(`Aloha login failed: ${err}`);

  }

  return parseAppConfig(base, loginBody, input.companyId, jar);
}

function hasRecaptchaChallenge(html: string): boolean {
  return /g-recaptcha-response|captcha challenge|captcha verification|please verify|verify that you are not/i.test(html);
}

function parseAppConfig(base: string, html: string, companyId: string, jar: Jar): AlohaSession {
  // appConfiguration.settings.sessionManagerID = "abc123"
  const sess = html.match(/sessionManagerID["']?\s*[:=]\s*["']([^"']+)["']/);
  const uid = html.match(/\buserId["']?\s*[:=]\s*["']?([^"',\s;}]+)/);
  const loc = html.match(/\buserLocale["']?\s*[:=]\s*["']([^"']+)["']/);
  const comp = html.match(/\bcompany["']?\s*[:=]\s*["']([^"']+)["']/);

  if (!sess) {
    throw new Error("Aloha login: could not locate sessionManagerID in dashboard HTML");
  }
  return {
    cookieHeader: cookieHeader(jar),
    sessionManagerID: sess[1],
    userId: uid?.[1] ?? "",
    userLocale: loc?.[1] ?? "en_US",
    companyId: comp?.[1] ?? companyId,
  };
}

// ── Grid summary CSV pull ──────────────────────────────────────────────────
// locationType values (from the dashboard JS Models.Enums.LocationType):
//   Store=1, Area=2, Region=3, StoreGroup=4, AllStores=5
export type AlohaLocationType = 1 | 2 | 3 | 4 | 5;

export interface AlohaGridRow {
  StoreName: string;
  NetSales: number;
  NetSalesLastYear: number;
  NetSalesVariance: number;
  LaborHours: number;
  LaborDollars: number;
  LaborPercent: number;
  PromoCount: number;
  PromoDollars: number;
  CompCount: number;
  CompDollars: number;
  VoidCount: number;
  VoidDollars: number;
  CheckCount: number;
  GuestCount: number;
  SalesPerLaborHour: number;
  PPA: number;
  CKAvg: number;
  AreaName: string;
  RegionName: string;
}

const STORE_HEADERS =
  "StoreName,NetSales,NetSalesLastYear,NetSalesVariance,LaborHours,LaborDollars,LaborPercent," +
  "PromoCount,PromoDollars,CompCount,CompDollars,VoidCount,VoidDollars,CheckCount,GuestCount," +
  "SalesPerLaborHour,PPA,CKAvg,AreaName,RegionName";

const SUMMARY_HEADERS =
  "Summary,NetSales,NetSalesLastYear,NetSalesVariance,LaborHours,LaborDollars,LaborPercent," +
  "PromoCount,PromoDollars,CompCount,CompDollars,VoidCount,VoidDollars,CheckCount,GuestCount," +
  "SalesPerLaborHour,PPA,CKAvg";

export async function fetchAlohaGridCsv(
  session: AlohaSession,
  portalUrl: string,
  startDate: string,   // YYYY-MM-DD
  endDate: string,     // YYYY-MM-DD
  locationType: AlohaLocationType,
  locationValue: string | number,
): Promise<string> {
  const base = normalizePortalBase(portalUrl);
  const jar: Jar = new Map();
  // Rehydrate session cookies
  for (const pair of session.cookieHeader.split(/;\s*/)) {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }

  // 1. Ask the server to create the export file
  const createParams = new URLSearchParams({
    endPoint: "creategridsummaryfile",
    media: "file",
    handler: "30",
    companyId: session.companyId,
    userId: session.userId,
    userLocale: session.userLocale,
    startDate,
    endDate,
    sessMgrID: session.sessionManagerID,
    locationType: String(locationType),
    locationValue: String(locationValue),
    storeHeaders: STORE_HEADERS,
    summaryHeaders: SUMMARY_HEADERS,
  });

  const createRes = await jarFetch(jar, `${base}/servlet/handlerswitch?${createParams.toString()}`);
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Aloha creategridsummaryfile failed: HTTP ${createRes.status} — ${body.slice(0, 200)}`);
  }
  // Body is usually a small JSON/plain-text ack; ignore.
  await createRes.arrayBuffer();

  // 2. Download it
  const downloadUrl =
    `${base}/servlet/handlerswitch?endPoint=downloadgridsummaryfile&media=file&handler=30` +
    `&sessMgrID=${encodeURIComponent(session.sessionManagerID)}`;
  const dlRes = await jarFetch(jar, downloadUrl);
  if (!dlRes.ok) {
    const body = await dlRes.text();
    throw new Error(`Aloha downloadgridsummaryfile failed: HTTP ${dlRes.status} — ${body.slice(0, 200)}`);
  }
  return await dlRes.text();
}

function normalizePortalBase(portalUrl: string): string {
  const url = portalUrl.trim().replace(/\/$/, "");
  return url.replace(/\/login\.do$/i, "");
}

// ── CSV parser (Aloha exports are simple comma-quoted CSV) ─────────────────
export function parseAlohaGridCsv(csv: string): { stores: AlohaGridRow[]; summary?: AlohaGridRow } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { stores: [] };

  // Aloha wraps store rows and (optionally) a summary row using a shared header row.
  const headerCols = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 2) continue;
    const row: Record<string, string> = {};
    headerCols.forEach((h, idx) => { row[h] = (cols[idx] ?? "").trim(); });
    rows.push(row);
  }

  const parseRow = (r: Record<string, string>): AlohaGridRow => ({
    StoreName: r.StoreName ?? r.Summary ?? "",
    NetSales: num(r.NetSales),
    NetSalesLastYear: num(r.NetSalesLastYear),
    NetSalesVariance: num(r.NetSalesVariance),
    LaborHours: num(r.LaborHours),
    LaborDollars: num(r.LaborDollars),
    LaborPercent: num(r.LaborPercent),
    PromoCount: num(r.PromoCount),
    PromoDollars: num(r.PromoDollars),
    CompCount: num(r.CompCount),
    CompDollars: num(r.CompDollars),
    VoidCount: num(r.VoidCount),
    VoidDollars: num(r.VoidDollars),
    CheckCount: num(r.CheckCount),
    GuestCount: num(r.GuestCount),
    SalesPerLaborHour: num(r.SalesPerLaborHour),
    PPA: num(r.PPA),
    CKAvg: num(r.CKAvg),
    AreaName: r.AreaName ?? "",
    RegionName: r.RegionName ?? "",
  });

  const summaryRow = rows.find((r) => (r.Summary ?? "").toLowerCase().includes("total") || r.Summary);
  const storeRows = rows.filter((r) => r !== summaryRow && (r.StoreName ?? "").trim() !== "");

  return {
    stores: storeRows.map(parseRow),
    summary: summaryRow ? parseRow(summaryRow) : undefined,
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ""; }
      else if (ch === '"') { inQ = true; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const cleaned = v.replace(/[$,%\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// ── InsightDashboard config-based fetch (works for "yesterday" tiles) ─────
// The Insight portal computes tile metrics server-side and returns them via
// /servlet/InsightDashboard?requestType=getDashboardConfiguration. Each tile
// carries a dateRangeId (1 = Yesterday on the BWW GO default dashboard) and
// tileData with the resolved value. We harvest:
//   • Tile type=4 "ALL METRICS"       → per-store + grand totals (all daily fields)
//   • Tile type=2 "Top Selling Items" → product mix { id, name, sales }
//   • Tile type=5 "Labor Hours"       → employee labor list (weekly, per store)
// Hourly and tips are NOT in the dashboard payload; those need the Drilldown
// Viewer report and can be layered in later.
export interface AlohaStoreRow {
  storeName: string;
  netSales: number;
  netSalesLastYear: number;
  laborHours: number;
  laborDollars: number;
  laborPercent: number;
  compCount: number;
  compDollars: number;
  promoCount: number;
  promoDollars: number;
  voidCount: number;
  voidDollars: number;
  checkCount: number;
  guestCount: number;
  salesPerLaborHour: number;
  ppa: number;
  ckAvg: number;
  areaName: string;
  regionName: string;
}

export interface AlohaProductMixItem {
  id: string;
  name: string;
  categoryId: string;
  sales: number;
}

export interface AlohaEmployeeLabor {
  name: string;
  hours: number;
}

export interface AlohaYesterdayReport {
  grand: AlohaStoreRow;
  stores: AlohaStoreRow[];
  productMix: AlohaProductMixItem[];
  employeeLaborWeek: AlohaEmployeeLabor[];
}

function n(v: unknown): number {
  if (v == null) return 0;
  const s = String(v).replace(/[$,%\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  const num = Number(s);
  return Number.isFinite(num) ? num : 0;
}

function mapStoreRow(r: any, storeName?: string): AlohaStoreRow {
  return {
    storeName: storeName ?? r.StoreName ?? r.Summary ?? "",
    netSales: n(r.NetSales),
    netSalesLastYear: n(r.NetSalesLastYear),
    laborHours: n(r.LaborHours),
    laborDollars: n(r.LaborDollars),
    laborPercent: n(r.LaborPercent),
    compCount: n(r.CompCount),
    compDollars: n(r.CompDollars),
    promoCount: n(r.PromoCount),
    promoDollars: n(r.PromoDollars),
    voidCount: n(r.VoidCount),
    voidDollars: n(r.VoidDollars),
    checkCount: n(r.CheckCount),
    guestCount: n(r.GuestCount),
    salesPerLaborHour: n(r.SalesPerLaborHour),
    ppa: n(r.PPA),
    ckAvg: n(r.CKAvg),
    areaName: r.AreaName ?? "",
    regionName: r.RegionName ?? "",
  };
}

export async function fetchAlohaYesterdayReport(
  session: AlohaSession,
  portalUrl: string,
): Promise<AlohaYesterdayReport> {
  const base = normalizePortalBase(portalUrl);
  const jar: Jar = new Map();
  for (const pair of session.cookieHeader.split(/;\s*/)) {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }

  const url =
    `${base}/servlet/InsightDashboard?requestType=getDashboardConfiguration` +
    `&companyId=${encodeURIComponent(session.companyId)}` +
    `&userId=${encodeURIComponent(session.userId)}` +
    `&userLocale=${encodeURIComponent(session.userLocale)}` +
    `&sessMgrID=${encodeURIComponent(session.sessionManagerID)}`;

  const res = await jarFetch(jar, url);
  if (!res.ok) {
    throw new Error(`Aloha getDashboardConfiguration failed: HTTP ${res.status}`);
  }
  let body = await res.text();
  body = body.replace(/^\)\]\}',?\s*/, "");

  let tiles: any[];
  try {
    tiles = JSON.parse(body);
  } catch {
    throw new Error(`Aloha getDashboardConfiguration returned non-JSON: ${body.slice(0, 120)}`);
  }
  if (!Array.isArray(tiles)) {
    throw new Error("Aloha getDashboardConfiguration: unexpected shape");
  }

  // ── Grid tile (type=4) → per-store + grand totals ──
  const gridTile = tiles.find((t) => t.tileType === 4 && t.locationType === 5);
  if (!gridTile?.tileData) {
    throw new Error("Aloha dashboard: ALL METRICS grid tile missing");
  }
  const stores: AlohaStoreRow[] = Array.isArray(gridTile.tileData.stores)
    ? gridTile.tileData.stores.map((r: any) => mapStoreRow(r))
    : [];
  const grand: AlohaStoreRow = gridTile.tileData.grand
    ? mapStoreRow(gridTile.tileData.grand, "Grand Total")
    : (stores[0] ?? mapStoreRow({}));

  // ── Pie tile (type=2) → product mix flattened across categories ──
  const pieTile = tiles.find((t) => t.tileType === 2 && t.locationType === 5);
  const productMix: AlohaProductMixItem[] = [];
  const cats = pieTile?.tileData?.categories;
  if (cats && typeof cats === "object") {
    for (const [catId, cat] of Object.entries(cats as Record<string, any>)) {
      const items = (cat as any)?.items;
      if (!items) continue;
      for (const [itemId, item] of Object.entries(items as Record<string, any>)) {
        const it = item as any;
        productMix.push({
          id: String(it?.id ?? itemId),
          name: String(it?.name ?? ""),
          categoryId: String(catId),
          sales: n(it?.sales),
        });
      }
    }
  }

  // ── Labor tile (type=5) → weekly employee hours (informational) ──
  const laborTile = tiles.find((t) => t.tileType === 5);
  const employeeLaborWeek: AlohaEmployeeLabor[] = Array.isArray(laborTile?.tileData?.employeeSeries)
    ? laborTile.tileData.employeeSeries.map((row: any) => ({
        name: String(row?.[0] ?? ""),
        hours: n(row?.[1]),
      }))
    : [];

  return { grand, stores, productMix, employeeLaborWeek };
}


