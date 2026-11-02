import { parseHTML } from 'npm:linkedom@0.18.12';
import { DateTime } from 'npm:luxon@3.7.2';
import { alohaLogin } from '../_shared/aloha-portal.ts';
import { safeHeaders, hasPunchColumns, safeProbeError } from './probeMetadata.ts';

interface Page { url: string; status: number; html: string }
interface Result {
  source: string; reachable: boolean; httpStatus: number | null; error: string | null;
  headers: string[]; rowCount: number; timeIn: boolean; timeOut: boolean;
}
const sources = ['Dynamic DDV: Labor with Wages', 'Dynamic DDV: Labor without Wages', 'Classic DDV: employee labor', 'Reports Viewer: Labor Data Export', 'Reports Viewer: Employee Pay with Punch Clock Data'];
const failed = (source: string, error: string, status: number | null = null): Result => ({
  source, reachable: false, httpStatus: status, error, headers: [], rowCount: 0, timeIn: false, timeOut: false,
});

function metadata(source: string, page: Page): Result {
  if (page.status < 200 || page.status >= 300) return failed(source, `HTTP ${page.status}`, page.status);
  if (/name=["']loginForm["']|session (?:expired|invalid)|account.{0,20}locked/i.test(page.html)) return failed(source, 'Portal login/session unavailable', page.status);
  const document = parseHTML(page.html).document as unknown as Document;
  let headers: string[] = [];
  let rowCount = 0;
  for (const table of Array.from(document.querySelectorAll('table'))) {
    const rows = Array.from(table.querySelectorAll('tr')).filter(row => row.closest('table') === table);
    let headerIndex = -1;
    let tableHeaders: string[] = [];
    for (let index = 0; index < rows.length; index++) {
      const cells = Array.from(rows[index].querySelectorAll('th,td')).filter(cell => cell.closest('tr') === rows[index]);
      const recognized = safeHeaders(cells.map(cell => cell.textContent ?? ''));
      if (recognized.length >= 2 && recognized.length > tableHeaders.length) {
        tableHeaders = recognized; headerIndex = index;
      }
    }
    if (headerIndex < 0) continue;
    const count = rows.slice(headerIndex + 1).filter(row => {
      const cells = Array.from(row.querySelectorAll('td')).filter(cell => cell.closest('tr') === row);
      return cells.length >= tableHeaders.length && !/^(?:grand\s+)?total\b/i.test(cells[0]?.textContent?.trim() ?? '') && cells.some(cell => cell.textContent?.trim());
    }).length;
    if (tableHeaders.length > headers.length) { headers = tableHeaders; rowCount = count; }
  }
  return { source, reachable: headers.length > 0, httpStatus: page.status,
    error: headers.length ? null : 'No report column headers found', headers, rowCount, ...hasPunchColumns(headers) };
}

export async function probeLaborDetail(credentials: Record<string, unknown>, date: string): Promise<Result[]> {
  const portalUrl = String(credentials.portal_url ?? '');
  const origin = new URL(portalUrl).origin;
  // Never allow arbitrary destinations or client-supplied credentials.
  if (origin !== 'https://sierrafoodgroup.alohaenterprise.com') return sources.map(source => failed(source, 'Unsupported saved portal'));
  const session = await alohaLogin({ portalUrl: origin, companyId: String(credentials.company_id ?? ''), loginName: String(credentials.username ?? ''), password: String(credentials.password ?? '') });
  const cookies = new Map(session.cookieHeader.split(/;\s*/).map(pair => { const i = pair.indexOf('='); return [pair.slice(0, i), pair.slice(i + 1)]; }));
  let requests = 0;
  const request = async (path: string, form?: URLSearchParams): Promise<Page> => {
    let url = new URL(path, origin);
    if (url.origin !== origin || requests >= 45) throw new Error('Portal request budget exceeded');
    for (let hops = 0; hops < 5; hops++) {
      requests++;
      const response = await fetch(url, { method: form ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(18000),
        headers: { Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0', Referer: origin + '/', Origin: origin }, body: form?.toString() });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]; const i = pair.indexOf('=');
        if (i > 0) cookies.set(pair.slice(0,i), pair.slice(i+1));
      }
      const html = await response.text();
      const next = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && next) {
        url = new URL(next, url); form = undefined;
        if (url.origin !== origin) throw new Error('Portal redirected outside origin');
        continue;
      }
      return { url: url.toString(), status: response.status, html };
    }
    throw new Error('Portal redirect limit exceeded');
  };
  const mdy = DateTime.fromFormat(date, 'yyyy-MM-dd', { zone: 'America/Los_Angeles' }).toFormat('M/d/yyyy');
  const baseForm = () => new URLSearchParams({ StoreID: '4274', RegionID: '0', AreaID: '0', BaseName: '4274', StoreName: '4274', StartDate: mdy, EndDate: mdy, SelDate: mdy, bCanPrint: '1' });
  const pages: Page[] = [];
  for (const path of ['/', '/portal/portal.jsp', '/ddv/ddv_parse.jsp']) {
    try { pages.push(await request(path)); } catch { /* Another viewer may still be reachable. */ }
  }
  // Discover actual viewer links from the portal rather than invent servlet names.
  const visited = new Set(pages.map(page => page.url));
  for (let depth = 0; depth < 2; depth++) {
    const links: string[] = [];
    for (const page of [...pages]) {
      const document = parseHTML(page.html).document as unknown as Document;
      for (const el of Array.from(document.querySelectorAll('a[href],iframe[src],frame[src],script[src]'))) {
        const raw = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
        if (!raw || /^(?:javascript:|#)/i.test(raw)) continue;
        const url = new URL(raw, page.url);
        if (url.origin !== origin || visited.has(url.toString())) continue;
        if (!/ddv|drill|report|portal|navigation|menu/i.test(url.pathname + ' ' + el.textContent)) continue;
        if (/save|delete|schedule|logout|logoff/i.test(url.pathname + url.search)) continue;
        links.push(url.toString()); visited.add(url.toString());
      }
      // Portal menus sometimes store viewer URLs in JavaScript strings.
      for (const match of page.html.matchAll(/["']([^"'\s<>]*(?:ddv|drill|report)[^"'\s<>]*\.(?:jsp|do)(?:\?[^"'<>]*)?)["']/gi)) {
        const url = new URL(match[1], page.url);
        if (url.origin === origin && !visited.has(url.toString()) && !/save|delete|schedule/i.test(url.toString())) { links.push(url.toString()); visited.add(url.toString()); }
      }
    }
    for (const link of links.slice(0, 10)) { try { pages.push(await request(link)); } catch { /* metadata reports unresolved navigation */ } }
  }

  const runNamed = async (source: string, label: string, viewer: 'dynamic' | 'reports'): Promise<Result> => {
    for (const page of pages) {
      if (viewer === 'dynamic' && !/ddv|drill/i.test(page.url + page.html)) continue;
      const document = parseHTML(page.html).document as unknown as Document;
      const option = Array.from(document.querySelectorAll('option')).find(el => el.textContent?.trim().toLowerCase() === label.toLowerCase());
      const anchor = Array.from(document.querySelectorAll('a[href]')).find(el => el.textContent?.trim().toLowerCase() === label.toLowerCase());
      if (anchor) {
        const href = anchor.getAttribute('href') ?? '';
        if (!/^javascript:/i.test(href) && !/save|delete|schedule/i.test(href)) return metadata(source, await request(new URL(href, page.url).toString(), baseForm()));
      }
      if (!option) continue;
      const formElement = option.closest('form');
      const action = formElement?.getAttribute('action');
      if (!formElement || !action || /save|delete|schedule/i.test(action)) return failed(source, 'Report listed; run contract could not be resolved safely', page.status);
      const form = baseForm();
      for (const input of Array.from(formElement.querySelectorAll('input[name],select[name]'))) {
        const name = input.getAttribute('name'); if (!name) continue;
        if (input.tagName === 'INPUT' && /submit|button/i.test(input.getAttribute('type') ?? '')) continue;
        const selected = input.querySelector('option[selected]') ?? input.querySelector('option');
        form.set(name, input.getAttribute('value') ?? selected?.getAttribute('value') ?? '');
        if (/store|location/i.test(name) && !/name|type/i.test(name)) form.set(name, '4274');
        if (/date/i.test(name)) form.set(name, mdy);
      }
      const selectName = option.parentElement?.getAttribute('name');
      if (!selectName) return failed(source, 'Report listed; selector contract unavailable', page.status);
      form.set(selectName, option.getAttribute('value') ?? '');
      return metadata(source, await request(new URL(action, page.url).toString(), form));
    }
    return failed(source, 'Report/viewer not found in accessible portal navigation');
  };

  const results: Result[] = [];
  for (const [source, label, viewer] of [[sources[0], 'Labor with Wages', 'dynamic'], [sources[1], 'Labor without Wages', 'dynamic']] as const) {
    try { results.push(await runNamed(source, label, viewer)); } catch (error) { results.push(failed(source, safeProbeError(error))); }
  }
  try {
    let form = baseForm();
    let page = await request('/ddv/ddv_parse_labor.jsp', form);
    const followed = new Set<string>();
    let employeeLevel = false;
    for (let depth = 0; depth < 4; depth++) {
      const info = metadata(sources[2], page);
      if (info.headers.some(header => /^employee/i.test(header)) || (info.timeIn && info.timeOut)) { employeeLevel = true; break; }
      // Interpret only the observed c() form-assignment contract; never eval portal JS.
      const c = page.html.match(/function\s+c\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{([\s\S]*?)\}/i);
      const handle = [...page.html.matchAll(/\bc\(\s*(\d+)\s*,\s*'([^']*)'\s*\)/g)].find(match => !followed.has(match[1]));
      if (!c || !handle) break;
      const next = new URLSearchParams(form);
      let assignments = 0;
      for (const match of c[3].matchAll(/(?:\w+\.)*(\w+)\.value\s*=\s*(\w+|['"][^'"]*['"])/g)) {
        const value = match[2] === c[1] ? handle[1] : match[2] === c[2] ? handle[2] : /^['"]/.test(match[2]) ? match[2].slice(1,-1) : null;
        if (value != null) { next.set(match[1], value); assignments++; }
      }
      if (!assignments || !/\.submit\s*\(/.test(c[3])) break;
      const action = c[3].match(/\.action\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? '/ddv/ddv_parse_labor.jsp';
      if (!/ddv[^?]*\.jsp/i.test(action) || /save|delete/i.test(action)) break;
      followed.add(handle[1]); form = next; page = await request(new URL(action, page.url).toString(), form);
    }
    const result = metadata(sources[2], page);
    if (!employeeLevel) { result.reachable = false; result.error = 'Labor summary reachable; employee drill contract could not be resolved safely'; }
    results.push(result);
  } catch (error) { results.push(failed(sources[2], safeProbeError(error))); }
  for (const [source, label] of [[sources[3], 'Labor Data Export'], [sources[4], 'Employee Pay with Punch Clock Data']]) {
    try { results.push(await runNamed(source, label, 'reports')); } catch (error) { results.push(failed(source, safeProbeError(error))); }
  }
  return results;
}