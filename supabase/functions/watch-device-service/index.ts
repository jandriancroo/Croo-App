// @ts-nocheck
// Apple Watch device service — lets a paired Apple Watch read its location's
// Cubes / Schedule / Sales snapshot WITHOUT the iPhone app being open.
//
// Actions (POST JSON body):
//   issue    (authed org admin)   → create a watch device + return its token once
//   list     (authed org admin)   → list watch devices for an org
//   revoke   (authed org admin)   → revoke a watch device
//   snapshot (watch device token) → read-only cubes + today's schedule + sales
//   chats / thread / send (watch device token) → the pairing user's own chats (membership-scoped)
//   version  (no auth)            → deployed WATCH_SERVICE_VERSION
//
// Read-only for all business data. Never mutates cubes, sales, labor or schedules.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "https://esm.sh/luxon@3.4.4";
import { METRIC_CONFIGS, formatWatchValue, resolveAccentHex } from "./metricConfigs.ts";
import { computePace, laborPct, resolveGoal, storeNow } from "../_shared/cubeMetrics.ts";
import { clockedInUserIds } from "../_shared/onClock.ts";

// Bump on every change so a deploy can be confirmed: POST {"action":"version"}.
const WATCH_SERVICE_VERSION = "2026-10-15.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-watch-token',
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

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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
  const { data } = await sb.rpc('is_org_admin', { _user_id: userId, _organization_id: orgId });
  if (!data) {
    const { data: sa } = await sb.rpc('is_super_admin', { _user_id: userId });
    if (!sa) throw new Error("Only org admins can manage watch devices");
  }
}

// ---------------------------------------------------------------- payments
type PaymentRow = { paymentType: string; amount: number };

const PAYMENT_PATTERNS: Record<string, string[]> = {
  cash: ['cash'],
  credit_card: ['credit card', 'creditcard'],
  olo_doordash: ['doordash', 'door dash'],
  olo_ubereats: ['ubereats', 'uber eats'],
  olo_visa: ['olo visa'],
  olo_mastercard: ['olo mastercard', 'olo mc'],
  olo_prepaid: ['olo prepaid', 'prepaid'],
  olo_giftcard: ['olo gift card', 'olo giftcard'],
  svs_giftcard: ['svs gift card', 'svs giftcard'],
};
const OLO_COMBINED = ['olo_visa', 'olo_mastercard', 'olo_prepaid', 'olo_giftcard'];

function matchesPattern(row: PaymentRow, patterns: string[]) {
  const t = (row.paymentType || '').toLowerCase();
  return patterns.some(p => t.includes(p));
}

function paymentAmount(rows: PaymentRow[], patterns: string[]): number | undefined {
  if (!rows.length) return undefined;
  return rows.filter(r => matchesPattern(r, patterns)).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

function paymentPercent(rows: PaymentRow[], patterns: string[]): number | undefined {
  if (!rows.length) return undefined;
  const amount = paymentAmount(rows, patterns);
  if (amount === undefined) return undefined;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (!total) return 0;
  return (amount / total) * 100;
}

function mergePayments(rowsList: PaymentRow[][]): PaymentRow[] {
  const map = new Map<string, number>();
  for (const rows of rowsList) {
    for (const r of rows || []) {
      const key = r?.paymentType || '';
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + (Number(r.amount) || 0));
    }
  }
  return Array.from(map.entries()).map(([paymentType, amount]) => ({ paymentType, amount }));
}

// ---------------------------------------------------------------- snapshot
const num = (v: any): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const sum = (arr: any[], key: string) =>
  arr.reduce((s, r) => s + (Number(r?.[key]) || 0), 0);

async function buildSnapshot(sb: any, device: any, overrideLocationId?: string) {
  const locationId = overrideLocationId || device.location_id;

  const [{ data: location }, { data: settings }] = await Promise.all([
    sb.from('locations').select('id, name, organization_id, brand_id').eq('id', locationId).maybeSingle(),
    sb.from('location_settings').select('timezone').eq('location_id', locationId).maybeSingle(),
  ]);

  const tz = settings?.timezone || 'America/Los_Angeles';
  // "Today" is the store's business date (same as every other cube).
  const { data: bd } = await sb.rpc('business_date', { _location_id: locationId });
  const today = String(bd ?? '').slice(0, 10) || storeNow(tz).date;
  const now = DateTime.fromISO(today, { zone: tz });
  const weekStart = now.minus({ days: now.weekday - 1 }).toFormat('yyyy-MM-dd');
  const weekEnd = now.minus({ days: now.weekday - 1 }).plus({ days: 6 }).toFormat('yyyy-MM-dd');
  const monthStart = now.startOf('month').toFormat('yyyy-MM-dd');
  const monthEnd = now.endOf('month').toFormat('yyyy-MM-dd');
  const prevWeekStart = now.minus({ days: now.weekday - 1 + 7 }).toFormat('yyyy-MM-dd');
  const prevWeekEnd = now.minus({ days: now.weekday }).toFormat('yyyy-MM-dd');
  const prevMonthStart = now.minus({ months: 1 }).startOf('month').toFormat('yyyy-MM-dd');
  const prevMonthEnd = now.minus({ months: 1 }).endOf('month').toFormat('yyyy-MM-dd');

  const salesCols =
    'sale_date, net_sales, guest_count, pizza_count, avg_ticket, projected_sales, initial_projection, living_projection, override_projection, pace_adjusted_projection, pace_calculated_at, hourly_data, yoy_net_sales, payments_data';

  const rangeStart = [monthStart, weekStart, prevWeekStart, prevMonthStart].sort()[0];
  const rangeEnd = [monthEnd, weekEnd, today].sort().slice(-1)[0];

  // Labor: one server-chosen row per store-day from public._store_labor (business today live).
  const laborStart = weekStart < monthStart ? weekStart : monthStart;
  const laborDays: string[] = [];
  for (let d = DateTime.fromISO(laborStart); d.toFormat('yyyy-MM-dd') <= today; d = d.plus({ days: 1 })) laborDays.push(d.toFormat('yyyy-MM-dd'));
  const [{ data: salesRows }, laborResults] = await Promise.all([
    sb.from('sales_cache').select(salesCols).eq('location_id', locationId).gte('sale_date', rangeStart).lte('sale_date', rangeEnd),
    Promise.all(laborDays.map((d) => sb.rpc('_store_labor', { _location_id: locationId, _date: d, _live: d === today }))),
  ]);
  const laborByDate = new Map<string, { cost: number; hours: number }>();
  laborResults.forEach((res: any, i: number) => {
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    if (row && (Number(row.cost) > 0 || Number(row.hours) > 0)) {
      laborByDate.set(laborDays[i], { cost: Number(row.cost) || 0, hours: Number(row.hours) || 0 });
    }
  });

  const sales = salesRows || [];
  const inRange = (from: string, to: string) => sales.filter(r => r.sale_date >= from && r.sale_date <= to);
  const todayRow = sales.find(r => r.sale_date === today);

  const dailySales = num(todayRow?.net_sales);
  const wtdSales = sum(inRange(weekStart, today), 'net_sales');
  const mtdSales = sum(inRange(monthStart, today), 'net_sales');

  const projectionFor = (row: any): number | undefined => resolveGoal(row) ?? undefined;

  // Today's pace: the shared deterministic helper (fresh stored pace, else V3).
  const dayPace = todayRow ? (computePace({ ...todayRow, nowInStoreTz: storeNow(tz) }) ?? undefined) : undefined;

  const periodProjection = (from: string, to: string) => {
    const rows = inRange(from, to);
    let total = 0;
    let any = false;
    for (const r of rows) {
      const actual = num(r.net_sales);
      const proj = projectionFor(r);
      if (r.sale_date < today && actual != null) { total += actual; any = true; }
      else if (r.sale_date === today) { const v = dayPace ?? actual ?? proj; if (v != null) { total += v; any = true; } }
      else if (proj != null) { total += proj; any = true; }
    }
    return any ? total : undefined;
  };

  const lyDay = num(todayRow?.yoy_net_sales);
  const lyWeek = (() => { const rows = inRange(weekStart, weekEnd); const v = sum(rows, 'yoy_net_sales'); return v || undefined; })();
  const lyMonth = (() => { const rows = inRange(monthStart, monthEnd); const v = sum(rows, 'yoy_net_sales'); return v || undefined; })();

  const laborAgg = (from: string, salesTotal?: number) => {
    const rows = [...laborByDate].filter(([d]) => d >= from && d <= today).map(([, r]) => r);
    if (!rows.length) return { cost: undefined, hours: undefined, percent: undefined };
    const cost = sum(rows, 'cost');
    const hours = sum(rows, 'hours');
    return { cost, hours, percent: laborPct(cost, salesTotal) ?? undefined };
  };
  const dayLabor = laborAgg(today, dailySales);
  const weekLabor = laborAgg(weekStart, wtdSales);
  const monthLabor = laborAgg(monthStart, mtdSales);

  const paymentsDaily: PaymentRow[] = Array.isArray(todayRow?.payments_data) ? todayRow.payments_data : [];
  const paymentsWeekly = mergePayments(inRange(weekStart, today).map(r => (Array.isArray(r.payments_data) ? r.payments_data : [])));
  const paymentsMonthly = mergePayments(inRange(monthStart, today).map(r => (Array.isArray(r.payments_data) ? r.payments_data : [])));

  const pct = (pace?: number, ly?: number) => (pace != null && ly ? (pace / ly - 1) * 100 : undefined);

  const values: Record<string, number | undefined> = {
    sales_today: dailySales,
    sales_pace: dayPace,
    sales_projected_today: projectionFor(todayRow),
    sales_last_year_day: lyDay,
    guest_count_today: num(todayRow?.guest_count),
    pizza_count_today: num(todayRow?.pizza_count),
    avg_ticket: num(todayRow?.avg_ticket),
    labor_percent_today: dayLabor.percent,
    labor_cost_today: dayLabor.cost,
    labor_hours_today: dayLabor.hours,
    labor_percent: dayLabor.percent,
    labor_cost: dayLabor.cost,
    labor_hours: dayLabor.hours,

    sales_wtd: wtdSales || undefined,
    sales_pace_week: periodProjection(weekStart, weekEnd),
    sales_projected_week: periodProjection(weekStart, weekEnd),
    sales_prev_week: sum(inRange(prevWeekStart, prevWeekEnd), 'net_sales') || undefined,
    sales_last_year_week: lyWeek,
    guest_count_wtd: sum(inRange(weekStart, today), 'guest_count') || undefined,
    pizza_count_wtd: sum(inRange(weekStart, today), 'pizza_count') || undefined,
    labor_percent_wtd: weekLabor.percent,
    labor_cost_wtd: weekLabor.cost,
    labor_hours_wtd: weekLabor.hours,

    sales_mtd: mtdSales || undefined,
    sales_pace_month: periodProjection(monthStart, monthEnd),
    sales_projected_month: periodProjection(monthStart, monthEnd),
    sales_prev_month: sum(inRange(prevMonthStart, prevMonthEnd), 'net_sales') || undefined,
    sales_last_year_month: lyMonth,
    guest_count_mtd: sum(inRange(monthStart, today), 'guest_count') || undefined,
    pizza_count_mtd: sum(inRange(monthStart, today), 'pizza_count') || undefined,
    labor_percent_mtd: monthLabor.percent,
    labor_cost_mtd: monthLabor.cost,
    labor_hours_mtd: monthLabor.hours,
  };

  values.pace_vs_ly_day = pct(dayPace, lyDay);
  values.pace_vs_ly_week = pct(values.sales_pace_week, lyWeek);
  values.pace_vs_ly_month = pct(values.sales_pace_month, lyMonth);

  const resolveMetric = (metric: string): number | undefined => {
    if (metric in values) return values[metric];
    const m = /^payment_(.+?)_(today|wtd|mtd)(_pct)?$/.exec(metric);
    if (!m) return undefined;
    const [, key, periodKey, isPct] = m;
    const rows = periodKey === 'today' ? paymentsDaily : periodKey === 'wtd' ? paymentsWeekly : paymentsMonthly;
    const read = isPct ? paymentPercent : paymentAmount;
    if (key === 'olo_combined') {
      const total = OLO_COMBINED.reduce((s, k) => s + (read(rows, PAYMENT_PATTERNS[k]) ?? 0), 0);
      return total > 0 ? total : undefined;
    }
    const patterns = PAYMENT_PATTERNS[key];
    if (!patterns) return undefined;
    return read(rows, patterns);
  };

  const toMetrics = (metrics: string[]) =>
    (metrics || [])
      .filter(m => METRIC_CONFIGS[m])
      .map(m => ({
        label: METRIC_CONFIGS[m].label,
        value: formatWatchValue(resolveMetric(m), METRIC_CONFIGS[m].format),
      }));

  // ---------------- cubes: exactly the pairing user's dashboard for this location
  // Mirrors fetchDashboardWidgets (src/hooks/useDashboardWidgets.ts) + the
  // dashboard_widgets SELECT policy + Dashboard's hidden-for-self filter, run
  // as the user who paired the watch (watch_devices.created_by).
  const userId: string | null = device.created_by || null;
  const [{ data: roleData }, { data: userLocRows }, { data: widgets, error: widgetsErr }] = await Promise.all([
    userId ? sb.rpc('get_user_role', { _user_id: userId }) : Promise.resolve({ data: null }),
    userId ? sb.rpc('get_user_location_ids', { _user_id: userId }) : Promise.resolve({ data: [] }),
    sb.from('dashboard_widgets')
      .select('id, title, accent_color, widget_type, config, display_order, authority_scope, location_id, organization_id, brand_id, is_active, created_by, audience_roles, hidden_for_user_ids')
      .eq('is_active', true)
      .in('widget_type', ['data', 'data-3d'])
      .order('display_order', { ascending: true }),
  ]);
  if (widgetsErr) console.error('[watch-device-service] widgets query failed', widgetsErr);
  const userRole: string | null = typeof roleData === 'string' ? roleData : null;
  const userLocIds: string[] = (userLocRows || [])
    .map((r: any) => (typeof r === 'string' ? r : r?.get_user_location_ids || r?.id))
    .filter(Boolean);

  // Orgs the user belongs to, and the brands of those orgs (for org/brand scope).
  let userOrgIds: string[] = [];
  let userBrandIds: string[] = [];
  if (userId) {
    const [{ data: memberRows }, { data: locOrgRows }] = await Promise.all([
      sb.from('organization_members').select('organization_id').eq('user_id', userId),
      userLocIds.length ? sb.from('locations').select('organization_id').in('id', userLocIds) : Promise.resolve({ data: [] }),
    ]);
    const locOrgIds = Array.from(new Set((locOrgRows || []).map((r: any) => r.organization_id).filter(Boolean)));
    // is_org_member = direct membership OR assigned to a location in the org.
    userOrgIds = Array.from(new Set([...(memberRows || []).map((r: any) => r.organization_id), ...locOrgIds].filter(Boolean)));
    if (locOrgIds.length) {
      const { data: orgRows } = await sb.from('organizations').select('brand_id').in('id', locOrgIds);
      userBrandIds = Array.from(new Set((orgRows || []).map((r: any) => r.brand_id).filter(Boolean)));
    }
  }
  const audienceOk = (w: any) => !Array.isArray(w.audience_roles) || w.audience_roles.length === 0
    || (userRole !== null && w.audience_roles.includes(userRole));

  const visibleWidgets = (widgets || []).filter((w: any) => {
    if (!userId) return false;
    if (Array.isArray(w.hidden_for_user_ids) && w.hidden_for_user_ids.includes(userId)) return false;
    switch (w.authority_scope) {
      case 'self': return w.created_by === userId && w.location_id === locationId;
      case 'location': return w.location_id === locationId && userLocIds.includes(locationId) && audienceOk(w);
      case 'org': return userOrgIds.includes(w.organization_id) && audienceOk(w);
      case 'brand': return userBrandIds.includes(w.brand_id) && audienceOk(w);
      case 'app': return audienceOk(w);
      default: return false;
    }
  });

  const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const cubes = visibleWidgets.map((w: any) => {
    const cfg = w.config || {};
    // Saved config keys are snake_case (see mapRow in useDashboardWidgets.ts).
    const faceMetrics: string[][] = Array.isArray(cfg.face_metrics) ? cfg.face_metrics : [];
    const faceTitles: string[] = Array.isArray(cfg.face_titles) ? cfg.face_titles : [];
    const numFaces = Number(cfg.num_faces) || faceMetrics.length || 1;
    const title = String(w.title || '').trim() || 'Cube';
    const faceTitle = (raw: any) => {
      const t = String(raw || '').trim();
      return t && !sameTitle(t, title) ? t : '';
    };

    const faces = w.widget_type === 'data-3d' && faceMetrics.length
      ? faceMetrics
          .slice(0, numFaces)
          .map((metrics, i) => ({ title: faceTitle(faceTitles[i]), metrics: toMetrics((metrics || []).slice(0, 5)) }))
          .filter(f => f.metrics.length > 0)
      : [{ title: '', metrics: toMetrics((Array.isArray(cfg.metrics) ? cfg.metrics : []).slice(0, 5)) }].filter(f => f.metrics.length > 0);

    return {
      id: w.id,
      title,
      accentColor: resolveAccentHex(w.accent_color || cfg.accentColor),
      faces,
    };
  }).filter((c: any) => c.faces.length > 0);

  // ---------------- today's published schedule, with live clock status
  const { data: shiftRows, error: shiftErr } = await sb
    .from('scheduled_shifts')
    .select('id, user_id, start_time, end_time, is_time_off, schedule:schedules!inner(is_published, location_id), template:shift_templates(template_name)')
    .eq('shift_date', today)
    .eq('schedule.location_id', locationId)
    .eq('schedule.is_published', true);
  if (shiftErr) console.error('[watch-device-service] schedule query failed', shiftErr);

  // Schedule visibility: shift managers and up see everyone; team members only themselves.
  const seesFullSchedule = userRole !== 'team_member';
  const shifts = (shiftRows || [])
    .filter((s: any) => !s.is_time_off)
    .filter((s: any) => seesFullSchedule || s.user_id === userId);

  const userIds = [...new Set(shifts.map((s: any) => s.user_id).filter(Boolean))] as string[];
  const profileMap = new Map<string, any>();
  if (userIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id, full_name, nickname').in('id', userIds);
    (profiles || []).forEach((p: any) => profileMap.set(p.id, p));
  }

  // Who is on the clock: the ONE read (_shared/onClock.ts). Punch times are read
  // separately for display only.
  let onClock = new Set<string>();
  try {
    onClock = new Set(await clockedInUserIds(sb, locationId));
  } catch (e) {
    console.error('[watch-device-service] onClock read failed', e);
  }
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  type Live = { clockIn?: string; clockOut?: string; breakStart?: string; onBreak?: boolean };
  const liveByUser = new Map<string, Live>();
  if (userIds.length) {
    const { data: source } = await sb.rpc('labor_source_for', { _location_id: locationId });
    if (source === 'toast') {
      const { data: ts } = await sb.from('toast_shifts')
        .select('croo_user_id, in_time, out_time')
        .eq('location_id', locationId).in('croo_user_id', userIds).gte('in_time', since).order('in_time');
      for (const r of ts || []) {
        liveByUser.set(r.croo_user_id, { clockIn: r.in_time || undefined, clockOut: r.out_time || undefined });
      }
    } else {
      const { data: punches } = await sb.from('time_punches')
        .select('user_id, punch_type, punch_time')
        .eq('location_id', locationId).in('user_id', userIds).gte('punch_time', since).order('punch_time');
      const byUser: Record<string, any[]> = {};
      for (const p of punches || []) (byUser[p.user_id] ||= []).push(p);
      for (const [uid, ps] of Object.entries(byUser)) {
        const lastInIdx = ps.map((p) => p.punch_type).lastIndexOf('clock_in');
        if (lastInIdx < 0) continue;
        const after = ps.slice(lastInIdx + 1);
        const out = after.find((p) => p.punch_type === 'clock_out');
        const last = after[after.length - 1];
        liveByUser.set(uid, {
          clockIn: ps[lastInIdx].punch_time,
          clockOut: out?.punch_time,
          onBreak: !out && last?.punch_type === 'break_start',
          breakStart: !out && last?.punch_type === 'break_start' ? last.punch_time : undefined,
        });
      }
    }
  }

  const fmtTime = (t?: string | null) => {
    if (!t) return '';
    const dt = DateTime.fromFormat(String(t).slice(0, 5), 'HH:mm');
    return dt.isValid ? dt.toFormat('h:mma').replace(':00', '').replace('AM', 'a').replace('PM', 'p') : String(t);
  };
  const fmtStamp = (iso?: string) => {
    if (!iso) return '';
    const dt = DateTime.fromISO(iso).setZone(tz);
    return dt.isValid ? dt.toFormat('h:mma').replace('AM', 'a').replace('PM', 'p') : '';
  };
  const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

  const clock = storeNow(tz);
  const nowMinutes = clock.hour * 60 + clock.minute;
  const toMinutes = (t?: string | null) => {
    if (!t) return null;
    const [h, m] = String(t).slice(0, 5).split(':').map(Number);
    if (Number.isNaN(h)) return null;
    return h * 60 + (m || 0);
  };

  const schedule = shifts
    .map((s: any) => {
      const p = profileMap.get(s.user_id);
      const name = s.user_id ? (p?.nickname || p?.full_name || 'Team member') : 'Open Shift';
      const start = toMinutes(s.start_time);
      let end = toMinutes(s.end_time);
      if (start !== null && end !== null && end < start) end += 24 * 60; // overnight
      const hours = start !== null && end !== null ? Math.round(((end - start) / 60) * 100) / 100 : 0;
      const live = (s.user_id && liveByUser.get(s.user_id)) || {};
      const isOn = !!s.user_id && onClock.has(s.user_id);

      let status = 'later';
      let liveLabel = '';
      if (isOn && live.onBreak) { status = 'break'; liveLabel = `On break · ${fmtStamp(live.breakStart)}`; }
      else if (isOn) { status = 'active'; liveLabel = live.clockIn ? `In ${fmtStamp(live.clockIn)}` : 'Clocked in'; }
      else if (live.clockIn && live.clockOut) { status = 'completed'; liveLabel = `Out ${fmtStamp(live.clockOut)}`; }
      else if (start !== null && end !== null) {
        if (nowMinutes >= end) status = 'completed';
        else if (nowMinutes >= start) { status = 'late'; liveLabel = 'Not in yet'; }
      }

      return {
        id: s.id,
        name,
        initials: s.user_id ? initialsOf(name) : '—',
        role: s.template?.template_name || '',
        time: [fmtTime(s.start_time), fmtTime(s.end_time)].filter(Boolean).join(' – '),
        status,
        live: liveLabel,
        hours,
        startMin: start,
        endMin: end,
        isMe: !!userId && s.user_id === userId,
        _sort: s.start_time || '',
      };
    })
    .sort((a: any, b: any) => String(a._sort).localeCompare(String(b._sort)))
    .map(({ _sort, ...rest }: any) => rest);

  const scheduleSummary = {
    onNow: schedule.filter((s: any) => s.status === 'active' || s.status === 'break').length,
    later: schedule.filter((s: any) => s.status === 'later' || s.status === 'late').length,
    nowMin: nowMinutes,
    totalHours: Math.round(schedule.reduce((t: number, s: any) => t + (s.hours || 0), 0) * 10) / 10,
  };

  // ---------------- sales summary, shaped like the dashboard Sales Summary widget
  const [{ data: cmpData }, { data: totData }] = await Promise.all([
    sb.rpc('get_sales_comparisons', { _location_id: locationId, _date: today }),
    sb.rpc('get_sales_ly_totals', { _location_id: locationId, _date: today }),
  ]);
  const cmp = Array.isArray(cmpData) ? cmpData[0] : cmpData;
  const tot = Array.isArray(totData) ? totData[0] : totData;

  // LY "at this point": last year's same business date through the current store hour.
  let lyThrough = 0;
  for (const h of (Array.isArray(cmp?.ly_hourly_data) ? cmp.ly_hourly_data : [])) {
    const hs = String(h?.hour ?? '');
    const hn = parseInt(hs.includes(':') ? hs.split(':')[0] : hs, 10);
    if (Number.isFinite(hn) && hn <= clock.hour) lyThrough += Number(h?.sales) || 0;
  }
  const lyFullDay = cmp?.ly_net_sales != null ? Number(cmp.ly_net_sales) : undefined;
  const lyAt = lyThrough > 0 ? {
    day: lyThrough,
    week: cmp?.ly_wtd_net != null && lyFullDay !== undefined ? Math.max(0, Number(cmp.ly_wtd_net) - lyFullDay + lyThrough) : undefined,
    month: cmp?.ly_mtd_net != null && lyFullDay !== undefined ? Math.max(0, Number(cmp.ly_mtd_net) - lyFullDay + lyThrough) : undefined,
  } : {};

  const money = (v?: number) => (v == null || Number.isNaN(v) ? '—' : `$${Math.round(v).toLocaleString('en-US')}`);
  const moneyCents = (v?: number) => (v == null || Number.isNaN(v) ? '—' : `$${v.toFixed(2)}`);
  const count = (v?: number) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US'));
  const goalSum = (from: string, to: string) => {
    const v = inRange(from, to).reduce((t, r) => t + (projectionFor(r) || 0), 0);
    return v > 0 ? v : undefined;
  };
  // Same thresholds as getPaceStatus in SalesSummary.tsx.
  const paceStatus = (actual?: number, pace?: number, goal?: number) => {
    if (!actual || actual < 100 || !pace || pace <= 0 || !goal || goal <= 0) return null;
    const r = (pace / goal) * 100;
    return r >= 102 ? 'On Fire' : r >= 95 ? 'On Track' : 'Behind';
  };
  const vsLy = (salesNow?: number, ly?: number) => (salesNow != null && ly ? (salesNow / ly - 1) * 100 : undefined);
  const period = (o: {
    label: string; sales?: number; goal?: number; pace?: number; lastYear?: number; lyAtPoint?: number;
    labor: { cost?: number; hours?: number; percent?: number }; pizzas?: number; guests?: number; ticket?: number;
  }) => {
    const change = vsLy(o.sales, o.lyAtPoint);
    return {
      label: o.label,
      salesValue: o.sales ?? null,
      goalValue: o.goal ?? null,
      paceValue: o.pace ?? null,
      sales: money(o.sales),
      status: paceStatus(o.sales, o.pace, o.goal),
      vsLy: change == null ? null : `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs LY`,
      vsLyUp: change == null ? null : change >= 0,
      lastYear: money(o.lastYear),
      goal: money(o.goal),
      pace: money(o.pace),
      laborPercent: o.labor.percent == null ? '—' : `${o.labor.percent.toFixed(1)}%`,
      laborCost: money(o.labor.cost),
      laborHours: o.labor.hours == null ? '—' : `${o.labor.hours.toFixed(1)}h`,
      pizzas: count(o.pizzas),
      ticket: moneyCents(o.ticket),
      guests: count(o.guests),
    };
  };
  const todayPace = dayPace != null ? Math.max(dayPace, dailySales || 0) : undefined;
  const wtdGuests = values.guest_count_wtd;
  const mtdGuests = values.guest_count_mtd;
  const salesSummary = {
    today: period({
      label: "TODAY'S SALES", sales: dailySales, goal: projectionFor(todayRow), pace: todayPace,
      lastYear: tot?.ly_day_total != null ? Number(tot.ly_day_total) : lyFullDay, lyAtPoint: lyAt.day,
      labor: dayLabor, pizzas: values.pizza_count_today, guests: values.guest_count_today, ticket: values.avg_ticket,
    }),
    week: period({
      label: 'WEEK-TO-DATE', sales: wtdSales || undefined, goal: goalSum(weekStart, weekEnd), pace: values.sales_pace_week,
      lastYear: tot?.ly_week_total != null ? Number(tot.ly_week_total) : lyWeek, lyAtPoint: lyAt.week,
      labor: weekLabor, pizzas: values.pizza_count_wtd, guests: wtdGuests,
      ticket: wtdGuests ? (wtdSales || 0) / wtdGuests : undefined,
    }),
    month: period({
      label: 'MONTH-TO-DATE', sales: mtdSales || undefined, goal: goalSum(monthStart, monthEnd), pace: values.sales_pace_month,
      lastYear: tot?.ly_month_total != null ? Number(tot.ly_month_total) : lyMonth, lyAtPoint: lyAt.month,
      labor: monthLabor, pizzas: values.pizza_count_mtd, guests: mtdGuests,
      ticket: mtdGuests ? (mtdSales || 0) / mtdGuests : undefined,
    }),
    wtd: money(wtdSales || undefined),
    mtd: money(mtdSales || undefined),
  };

  const SALES_SUMMARY_METRICS = [
    'sales_today', 'sales_pace', 'sales_projected_today', 'sales_last_year_day',
    'guest_count_today', 'avg_ticket', 'labor_percent_today', 'labor_hours_today',
    'sales_wtd', 'sales_mtd',
  ];

  return {
    version: WATCH_SERVICE_VERSION,
    updatedAt: new Date().toISOString(),
    locationId,
    locationName: location?.name || '',
    cubes,
    schedule,
    scheduleSummary,
    sales: toMetrics(SALES_SUMMARY_METRICS),
    salesSummary,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = body.action || 'snapshot';
    const sb = admin();

    if (action === 'version') return json({ version: WATCH_SERVICE_VERSION });

    // -------------------------------------------------- snapshot (device token)
    if (action === 'snapshot') {
      const token = req.headers.get('x-watch-token') || body.token;
      if (!token) return json({ error: 'Missing device token' }, 401);

      const hash = await sha256(String(token));
      const { data: device } = await sb
        .from('watch_devices')
        .select('id, location_id, label, revoked_at, allowed_location_ids, created_by')
        .eq('token_hash', hash)
        .maybeSingle();

      if (!device || device.revoked_at) return json({ error: 'Device not paired' }, 401);

      // A watch token is scoped to every location the pairing user could access.
      const allowedIds: string[] = (device.allowed_location_ids?.length
        ? device.allowed_location_ids
        : [device.location_id]).filter(Boolean);

      const requested = body.locationId ? String(body.locationId) : null;
      const activeLocationId = requested && allowedIds.includes(requested) ? requested : device.location_id;

      const { data: allowedLocations } = await sb
        .from('locations')
        .select('id, name')
        .in('id', allowedIds)
        .order('name');

      const snapshot = await buildSnapshot(sb, device, activeLocationId);
      await sb.from('watch_devices').update({ last_active_at: new Date().toISOString() }).eq('id', device.id);
      return json({ snapshot: { ...snapshot, locations: allowedLocations || [] } });
    }


    // -------------------------------------------------- chats (device token)
    if (action === 'chats' || action === 'thread' || action === 'send') {
      const token = req.headers.get('x-watch-token') || body.token;
      if (!token) return json({ error: 'Missing device token' }, 401);
      const { data: device } = await sb
        .from('watch_devices')
        .select('id, location_id, revoked_at, allowed_location_ids, created_by')
        .eq('token_hash', await sha256(String(token)))
        .maybeSingle();
      if (!device || device.revoked_at) return json({ error: 'Device not paired' }, 401);
      const me: string | null = device.created_by;
      if (!me) return json({ chats: [], error: 'Re-pair this watch to use chats' });

      const allowedIds: string[] = (device.allowed_location_ids?.length ? device.allowed_location_ids : [device.location_id]).filter(Boolean);
      const requested = body.locationId ? String(body.locationId) : null;
      const locationId = requested && allowedIds.includes(requested) ? requested : device.location_id;

      // Only chats this person is a member of, at this store (same filter as _shared/messagePlan.ts scopeChats).
      const { data: mine } = await sb.from('chat_members').select('chat_id, last_read_at').eq('user_id', me);
      const lastRead = new Map((mine || []).map((m: any) => [m.chat_id, m.last_read_at]));
      const myIds = (mine || []).map((m: any) => m.chat_id);
      if (!myIds.length) return json({ chats: [] });
      const { data: chatRows } = await sb
        .from('chats')
        .select('id, title, is_group, is_announcement, location_id, chat_members(user_id)')
        .in('id', myIds)
        .eq('location_id', locationId);
      const chats = (chatRows || []).filter((c: any) => (c.chat_members || []).some((m: any) => m.user_id === me));
      const kindOf = (c: any) => c.is_announcement ? 'announcement'
        : (c.is_group && String(c.title || '').trim() === 'Shift Marketplace') ? 'marketplace'
        : c.is_group ? 'group' : 'dm';

      const nameOf = async (ids: string[]) => {
        const { data: ps } = await sb.from('profiles').select('id, full_name, nickname').in('id', ids);
        return new Map((ps || []).map((p: any) => [p.id, p.nickname || p.full_name || 'Team member']));
      };
      const initialsFor = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
      const stamp = (iso?: string) => {
        if (!iso) return '';
        const dt = DateTime.fromISO(iso).setZone(tz0);
        if (!dt.isValid) return '';
        const today0 = DateTime.now().setZone(tz0).startOf('day');
        if (dt >= today0) return dt.toFormat('h:mma').replace('AM', 'a').replace('PM', 'p');
        if (dt >= today0.minus({ days: 6 })) return dt.toFormat('ccc');
        return dt.toFormat('M/d');
      };
      const { data: ls } = await sb.from('location_settings').select('timezone').eq('location_id', locationId).maybeSingle();
      const tz0 = ls?.timezone || 'America/Los_Angeles';

      if (action === 'chats') {
        const rows: any[] = [];
        const others = new Set<string>();
        for (const c of chats) for (const m of c.chat_members || []) others.add(m.user_id);
        const { data: lastMsgs } = await sb
          .from('messages')
          .select('id, chat_id, sender_id, content, created_at, is_deleted_for_everyone, attachment_type')
          .in('chat_id', chats.map((c: any) => c.id))
          .order('created_at', { ascending: false })
          .limit(400);
        for (const m of lastMsgs || []) others.add(m.sender_id);
        const names = await nameOf(Array.from(others));
        for (const c of chats) {
          const kind = kindOf(c);
          if (kind === 'marketplace') continue;
          const msgs = (lastMsgs || []).filter((m: any) => m.chat_id === c.id);
          const last = msgs[0];
          const lr = lastRead.get(c.id) ? Date.parse(lastRead.get(c.id)) : 0;
          const unread = msgs.filter((m: any) => m.sender_id !== me && !m.is_deleted_for_everyone && Date.parse(m.created_at) > lr).length;
          const otherId = (c.chat_members || []).map((m: any) => m.user_id).find((u: string) => u !== me);
          const title = c.title || (kind === 'dm' ? names.get(otherId) : 'Group') || 'Chat';
          const preview = !last ? '' : last.is_deleted_for_everyone ? 'Message deleted'
            : last.content ? `${last.sender_id === me ? 'You' : (names.get(last.sender_id) || '').split(' ')[0]}: ${last.content}`.replace(/^: /, '')
            : last.attachment_type ? 'Sent an attachment' : '';
          rows.push({
            id: c.id, title, initials: initialsFor(title), kind, unread, preview,
            time: stamp(last?.created_at), at: last?.created_at || '',
            canReply: kind === 'dm' || kind === 'group',
          });
        }
        rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
        return json({ chats: rows.slice(0, 20), unreadTotal: rows.reduce((t, r) => t + r.unread, 0) });
      }

      const chatId = String(body.chatId || '');
      const chat = chats.find((c: any) => c.id === chatId);
      if (!chat) return json({ error: 'Chat not found' }, 404);
      const kind = kindOf(chat);

      if (action === 'thread') {
        const { data: msgs } = await sb
          .from('messages')
          .select('id, sender_id, content, created_at, is_deleted_for_everyone, attachment_type')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: false })
          .limit(25);
        const names = await nameOf(Array.from(new Set((msgs || []).map((m: any) => m.sender_id))));
        await sb.from('chat_members').update({ last_read_at: new Date().toISOString() }).eq('chat_id', chatId).eq('user_id', me);
        const out = (msgs || []).reverse().map((m: any) => ({
          id: m.id,
          mine: m.sender_id === me,
          sender: m.sender_id === me ? 'You' : String(names.get(m.sender_id) || '').split(' ')[0],
          text: m.is_deleted_for_everyone ? 'Message deleted' : (m.content || (m.attachment_type ? 'Attachment' : '')),
          time: stamp(m.created_at),
        }));
        return json({ messages: out, canReply: kind === 'dm' || kind === 'group' });
      }

      // send: same row and same push as src/lib/chatMessages.ts sendChatMessage (plain text only, ordinary DMs/groups).
      if (kind !== 'dm' && kind !== 'group') return json({ error: 'Read-only chat' }, 403);
      const content = String(body.content || '').trim().slice(0, 1000);
      if (!content) return json({ error: 'Empty message' }, 400);
      const { data: row, error: insErr } = await sb
        .from('messages')
        .insert({ chat_id: chatId, sender_id: me, content })
        .select('id, created_at')
        .single();
      if (insErr) return json({ error: insErr.message }, 500);
      // The push must not make the watch wait: run it after the reply when the runtime allows.
      const pushTask = (async () => {
        try {
          const memberIds = (chat.chat_members || []).map((m: any) => m.user_id).filter((u: string) => u !== me);
          if (memberIds.length) {
            const sender = (await nameOf([me])).get(me) || 'New Message';
            await sb.functions.invoke('send-push-notification', {
              body: { user_ids: memberIds, sender_id: me, title: sender, body: content.substring(0, 100),
                      notification_type: 'chat_messages', data: { chat_id: chatId, type: 'message', message_id: row.id } },
            });
          }
        } catch (e) { console.error('watch chat push failed', e); }
      })();
      try { (globalThis as any).EdgeRuntime.waitUntil(pushTask); } catch { await pushTask; }
      return json({ ok: true, id: row.id });
    }

    // -------------------------------------------------- issue (authed admin)
    if (action === 'issue') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const { locationId, label } = body;
      if (!locationId) return json({ error: 'locationId is required' }, 400);

      const { data: loc } = await sb.from('locations').select('id, name, organization_id').eq('id', locationId).maybeSingle();
      if (!loc) return json({ error: 'Location not found' }, 404);
      await assertOrgAdmin(sb, userId, loc.organization_id);

      // Scope the token to every location the pairing user can access.
      const { data: userLocRows } = await sb.rpc('get_user_location_ids', { _user_id: userId });
      const userLocIds: string[] = (userLocRows || [])
        .map((r: any) => (typeof r === 'string' ? r : r?.get_user_location_ids || r?.id))
        .filter(Boolean);
      const allowedIds = Array.from(new Set([locationId, ...userLocIds]));
      const { data: allowedLocations } = await sb
        .from('locations')
        .select('id, name')
        .in('id', allowedIds)
        .order('name');

      const token = randomToken();
      const hash = await sha256(token);
      const { data: device, error } = await sb
        .from('watch_devices')
        .insert({
          location_id: locationId,
          organization_id: loc.organization_id,
          label: (label || '').trim() || 'Apple Watch',
          token_hash: hash,
          token_hint: token.slice(-6),
          allowed_location_ids: allowedIds,
          created_by: userId,
        })
        .select('id, label, location_id, created_at')
        .single();
      if (error) throw error;

      return json({ token, device, locationId, locationName: loc.name, locations: allowedLocations || [] });
    }

    // -------------------------------------------------- list (authed admin)
    if (action === 'list') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { organizationId } = body;
      if (!organizationId) return json({ error: 'organizationId is required' }, 400);
      await assertOrgAdmin(sb, userId, organizationId);

      const { data, error } = await sb
        .from('watch_devices')
        .select('id, label, location_id, token_hint, created_at, last_active_at, revoked_at, locations(name, store_number)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ devices: data || [] });
    }

    // -------------------------------------------------- revoke (authed admin)
    if (action === 'revoke') {
      const userId = await getAuthedUser(req);
      if (!userId) return json({ error: 'Unauthorized' }, 401);
      const { deviceId } = body;
      if (!deviceId) return json({ error: 'deviceId is required' }, 400);

      const { data: device } = await sb.from('watch_devices').select('id, organization_id').eq('id', deviceId).maybeSingle();
      if (!device) return json({ error: 'Device not found' }, 404);
      await assertOrgAdmin(sb, userId, device.organization_id);

      const { error } = await sb
        .from('watch_devices')
        .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
        .eq('id', deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error('[watch-device-service]', e);
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 400);
  }
});
