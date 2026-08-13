// @ts-nocheck
// Apple Watch device service — lets a paired Apple Watch read its location's
// Cubes / Schedule / Sales snapshot WITHOUT the iPhone app being open.
//
// Actions (POST JSON body):
//   issue    (authed org admin)   → create a watch device + return its token once
//   list     (authed org admin)   → list watch devices for an org
//   revoke   (authed org admin)   → revoke a watch device
//   snapshot (watch device token) → read-only cubes + today's schedule + sales
//
// Read-only for all business data. Never mutates cubes, sales, labor or schedules.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DateTime } from "https://esm.sh/luxon@3.4.4";
import { METRIC_CONFIGS, formatWatchValue, resolveAccentHex } from "./metricConfigs.ts";

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
  const now = DateTime.now().setZone(tz);
  const today = now.toFormat('yyyy-MM-dd');
  const weekStart = now.minus({ days: now.weekday - 1 }).toFormat('yyyy-MM-dd');
  const weekEnd = now.minus({ days: now.weekday - 1 }).plus({ days: 6 }).toFormat('yyyy-MM-dd');
  const monthStart = now.startOf('month').toFormat('yyyy-MM-dd');
  const monthEnd = now.endOf('month').toFormat('yyyy-MM-dd');
  const prevWeekStart = now.minus({ days: now.weekday - 1 + 7 }).toFormat('yyyy-MM-dd');
  const prevWeekEnd = now.minus({ days: now.weekday }).toFormat('yyyy-MM-dd');
  const prevMonthStart = now.minus({ months: 1 }).startOf('month').toFormat('yyyy-MM-dd');
  const prevMonthEnd = now.minus({ months: 1 }).endOf('month').toFormat('yyyy-MM-dd');

  const salesCols =
    'sale_date, net_sales, guest_count, pizza_count, avg_ticket, projected_sales, initial_projection, living_projection, override_projection, pace_adjusted_projection, yoy_net_sales, payments_data';

  const rangeStart = [monthStart, weekStart, prevWeekStart, prevMonthStart].sort()[0];
  const rangeEnd = [monthEnd, weekEnd, today].sort().slice(-1)[0];

  const [{ data: salesRows }, { data: laborRows }] = await Promise.all([
    sb.from('sales_cache').select(salesCols).eq('location_id', locationId).gte('sale_date', rangeStart).lte('sale_date', rangeEnd),
    sb.from('labor_cache').select('labor_date, labor_cost, labor_hours, source').eq('location_id', locationId).gte('labor_date', monthStart).lte('labor_date', today),
  ]);

  const sales = salesRows || [];
  const inRange = (from: string, to: string) => sales.filter(r => r.sale_date >= from && r.sale_date <= to);
  const todayRow = sales.find(r => r.sale_date === today);

  // Labor: one row per (date, source) — prefer punch_clock when both exist.
  const laborByDate = new Map<string, any>();
  for (const r of laborRows || []) {
    const existing = laborByDate.get(r.labor_date);
    if (!existing || r.source === 'punch_clock') laborByDate.set(r.labor_date, r);
  }
  const laborIn = (from: string, to: string) =>
    Array.from(laborByDate.entries()).filter(([d]) => d >= from && d <= to).map(([, r]) => r);

  const dailySales = num(todayRow?.net_sales);
  const wtdSales = sum(inRange(weekStart, today), 'net_sales');
  const mtdSales = sum(inRange(monthStart, today), 'net_sales');

  const projectionFor = (row: any): number | undefined =>
    num(row?.override_projection) ?? num(row?.living_projection) ?? num(row?.projected_sales) ?? num(row?.initial_projection);

  const dayPace = (() => {
    // Prefer the stored pace projection; fall back to the living projection so
    // the watch shows a pace even before the nightly pace job stamps a value.
    const pace = num(todayRow?.pace_adjusted_projection) ?? num(todayRow?.living_projection);
    return pace != null ? Math.max(pace, dailySales || 0) : undefined;
  })();

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

  const laborAgg = (from: string, to: string, salesTotal?: number) => {
    const rows = laborIn(from, to);
    if (!rows.length) return { cost: undefined, hours: undefined, percent: undefined };
    const cost = sum(rows, 'labor_cost');
    const hours = sum(rows, 'labor_hours');
    return { cost, hours, percent: salesTotal && salesTotal > 0 ? (cost / salesTotal) * 100 : undefined };
  };

  const dayLabor = laborAgg(today, today, dailySales);
  const weekLabor = laborAgg(weekStart, today, wtdSales);
  const monthLabor = laborAgg(monthStart, today, mtdSales);

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

  // ---------------- cubes visible to this location (org / brand / location scope)
  const { data: widgets } = await sb
    .from('dashboard_widgets')
    .select('id, title, accent_color, widget_type, config, display_order, authority_scope, location_id, organization_id, brand_id, is_active')
    .in('widget_type', ['data', 'data-3d'])
    .order('display_order', { ascending: true });

  const visibleWidgets = (widgets || []).filter(w => {
    if (w.is_active === false) return false;
    switch (w.authority_scope) {
      case 'location': return w.location_id === locationId;
      case 'org': return w.organization_id === location?.organization_id;
      case 'brand': return w.brand_id === location?.brand_id;
      case 'app': return true;
      default: return false;
    }
  });

  const cubes = visibleWidgets.map(w => {
    const cfg = w.config || {};
    const cubeType = cfg.cubeType || w.widget_type;
    const faceMetrics: string[][] = Array.isArray(cfg.faceMetrics) ? cfg.faceMetrics : [];
    const faceTitles: string[] = Array.isArray(cfg.faceTitles) ? cfg.faceTitles : [];
    const title = w.title || cfg.title || 'Cube';

    const faces = cubeType === 'data-3d' && faceMetrics.length
      ? faceMetrics
          .slice(0, cfg.numFaces || faceMetrics.length)
          .map((metrics, i) => ({ title: faceTitles[i] || `Face ${i + 1}`, metrics: toMetrics(metrics) }))
          .filter(f => f.metrics.length > 0)
      : [{ title, metrics: toMetrics(cfg.metrics || []) }].filter(f => f.metrics.length > 0);

    return {
      id: w.id,
      title,
      accentColor: resolveAccentHex(w.accent_color || cfg.accentColor),
      faces,
    };
  }).filter(c => c.faces.length > 0);

  // ---------------- today's published schedule
  const { data: shiftRows } = await sb
    .from('scheduled_shifts')
    .select('id, user_id, start_time, end_time, is_time_off, schedule:schedules!inner(is_published, location_id), template:shift_templates(name)')
    .eq('shift_date', today)
    .eq('schedule.location_id', locationId)
    .eq('schedule.is_published', true);

  const shifts = (shiftRows || []).filter((s: any) => !s.is_time_off);
  const userIds = [...new Set(shifts.map((s: any) => s.user_id).filter(Boolean))];
  const profileMap = new Map<string, any>();
  if (userIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id, full_name, nickname').in('id', userIds);
    (profiles || []).forEach((p: any) => profileMap.set(p.id, p));
  }

  const fmtTime = (t?: string | null) => {
    if (!t) return '';
    const dt = DateTime.fromFormat(String(t).slice(0, 5), 'HH:mm');
    return dt.isValid ? dt.toFormat('h:mma').replace(':00', '').toLowerCase() : String(t);
  };

  const nowMinutes = now.hour * 60 + now.minute;
  const toMinutes = (t?: string | null) => {
    if (!t) return null;
    const [h, m] = String(t).slice(0, 5).split(':').map(Number);
    if (Number.isNaN(h)) return null;
    return h * 60 + (m || 0);
  };

  const schedule = shifts
    .map((s: any) => {
      const p = profileMap.get(s.user_id);
      const start = toMinutes(s.start_time);
      let end = toMinutes(s.end_time);
      // Overnight shift: end wraps past midnight.
      if (start !== null && end !== null && end < start) end += 24 * 60;
      const hours = start !== null && end !== null
        ? Math.round(((end - start) / 60) * 100) / 100
        : 0;
      let status = 'later';
      if (start !== null && end !== null) {
        if (nowMinutes >= end) status = 'completed';
        else if (nowMinutes >= start) status = 'active';
      }
      return {
        id: s.id,
        name: (p?.nickname || p?.full_name || 'Open Shift'),
        role: s.template?.name || '',
        time: [fmtTime(s.start_time), fmtTime(s.end_time)].filter(Boolean).join(' – '),
        status,
        hours,
        isMe: false,
        _sort: s.start_time || '',
      };
    })
    .sort((a: any, b: any) => String(a._sort).localeCompare(String(b._sort)))
    .map(({ _sort, ...rest }: any) => rest);


  const SALES_SUMMARY_METRICS = [
    'sales_today', 'sales_pace', 'sales_projected_today', 'sales_last_year_day',
    'guest_count_today', 'avg_ticket', 'labor_percent_today', 'labor_hours_today',
    'sales_wtd', 'sales_mtd',
  ];

  return {
    updatedAt: new Date().toISOString(),
    locationId,
    locationName: location?.name || '',
    cubes,
    schedule,
    sales: toMetrics(SALES_SUMMARY_METRICS),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = body.action || 'snapshot';
    const sb = admin();

    // -------------------------------------------------- snapshot (device token)
    if (action === 'snapshot') {
      const token = req.headers.get('x-watch-token') || body.token;
      if (!token) return json({ error: 'Missing device token' }, 401);

      const hash = await sha256(String(token));
      const { data: device } = await sb
        .from('watch_devices')
        .select('id, location_id, label, revoked_at, allowed_location_ids')
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
