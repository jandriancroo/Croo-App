import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireCaller } from '../_shared/callerAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// SHARED UTILITIES
// ============================================================================

function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = atob(base64);
  return JSON.parse(jsonPayload);
}

function getDateStringForTimezone(date: Date, timezone: string): string {
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const year = tzDate.getFullYear();
  const month = String(tzDate.getMonth() + 1).padStart(2, '0');
  const day = String(tzDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentTimeInTimezone(timezone: string): { hours: number; minutes: number } {
  const now = new Date();
  const tzTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return { hours: tzTime.getHours(), minutes: tzTime.getMinutes() };
}

function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function isWithinBusinessHours(
  currentHours: number, 
  currentMinutes: number, 
  openTime: string | null, 
  closeTime: string | null
): boolean {
  const openStr = openTime || '10:00';
  const closeStr = closeTime || '22:00';
  
  const currentMinutesTotal = currentHours * 60 + currentMinutes;
  const openMinutes = parseTimeToMinutes(openStr);
  let closeMinutes = parseTimeToMinutes(closeStr) + 10;
  
  // Handle midnight/past-midnight closing (e.g. 00:00 or 01:00 means next day)
  if (closeMinutes <= openMinutes) {
    // Close time wraps past midnight — treat as next-day (add 24h worth of minutes)
    closeMinutes += 24 * 60;
  }
  
  return currentMinutesTotal >= openMinutes && currentMinutesTotal <= closeMinutes;
}

// ============================================================================
// V4 OAuth2 Authentication (replaces legacy scraping auth)
// ============================================================================

// Cached token — the Qu OAuth2 token is valid far longer than one cron tick,
// so re-minting it on every invocation was both slow and a needless chance to fail.
let cachedV4Token: { token: string; expiresAt: number } | null = null;
const V4_TOKEN_TTL_MS = 45 * 60 * 1000;
const V4_AUTH_ATTEMPTS = 3;

async function fetchV4Token(clientId: string, clientSecret: string): Promise<string | null> {
  const formData = new FormData();
  formData.append('grant_type', 'client_credentials');
  formData.append('client_id', clientId);
  formData.append('client_secret', clientSecret);

  // Don't let a hung Qu endpoint burn the whole worker wall-clock budget.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/authentication/oauth2/access-token', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[sales-service] V4 OAuth2 auth failed (${response.status}): ${text.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const token = data.access_token;
    if (!token) {
      console.error('[sales-service] No access_token in OAuth2 response');
      return null;
    }
    return token;
  } catch (error) {
    console.error('[sales-service] V4 OAuth2 error:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticateV4(): Promise<string | null> {
  const clientId = Deno.env.get('QU_USERNAME');
  const clientSecret = Deno.env.get('QU_PASSWORD');

  if (!clientId || !clientSecret) {
    console.error('[sales-service] Missing QU_USERNAME or QU_PASSWORD env vars');
    return null;
  }

  if (cachedV4Token && Date.now() < cachedV4Token.expiresAt) {
    return cachedV4Token.token;
  }

  // A single transient blip on Qu's OAuth endpoint used to abort the entire
  // sync run. Retry with backoff before giving up on the tick.
  for (let attempt = 1; attempt <= V4_AUTH_ATTEMPTS; attempt++) {
    const token = await fetchV4Token(clientId, clientSecret);
    if (token) {
      cachedV4Token = { token, expiresAt: Date.now() + V4_TOKEN_TTL_MS };
      console.log(`[sales-service] V4 OAuth2 auth OK (attempt ${attempt})`);
      return token;
    }
    if (attempt < V4_AUTH_ATTEMPTS) {
      const backoff = 500 * Math.pow(2, attempt - 1);
      console.warn(`[sales-service] V4 auth attempt ${attempt} failed, retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  cachedV4Token = null;
  console.error(`[sales-service] V4 OAuth2 auth failed after ${V4_AUTH_ATTEMPTS} attempts`);
  return null;
}


function getV4Headers(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'x-integration': Deno.env.get('QU_INTEGRATION_USER_ID') || '',
  };
}

function getQbLocationId(credentials: unknown): string {
  const raw = (credentials as { location_id?: string | number } | null)?.location_id;
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

// Legacy wrapper — allows existing callers (backfill, sync-day, etc.) to work without signature changes
async function getOrRefreshToken(
  _supabase: any,
  _integrationId: string,
  _username: string,
  _password: string
): Promise<string | null> {
  return await authenticateV4();
}

function convertTo24Hour(time12h: string): string {
  const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return time12h;
  let hours = parseInt(match[1]);
  const minutes = match[2];
  const period = match[3].toUpperCase();
  if (period === 'AM') { if (hours === 12) hours = 0; }
  else { if (hours !== 12) hours += 12; }
  return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

// ============================================================================
// DATA FETCHERS
// ============================================================================

async function fetchHourlySales(
  tokenGw: string, 
  dateStr: string,
  qbLocationId: string
): Promise<{ hour: string; sales: number; checksCount: number }[]> {
  const requestPayload = {
    fields: [
      { fieldName: "hour" }, { fieldName: "checksCount" }, { fieldName: "netSales" },
      { fieldName: "averageCheck" }, { fieldName: "discount" }, { fieldName: "serviceCharge" },
      { fieldName: "tax" }, { fieldName: "netSalesPercentage" }
    ],
    filters: {
      date: { from: null, to: null, values: [dateStr], type: "custom" },
      singleLocation: parseInt(qbLocationId),
      location: { operationalUnits: [parseInt(qbLocationId)] }
    },
    params: { sectionId: "main", pageNumber: 1, pageSize: 25, totalRecords: null, sort: null, showTotals: true }
  };

  const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/hourly-sales/sections/main', {
    method: 'POST',
    headers: getV4Headers(tokenGw),
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    // Detect unprovisioned stores (403 "No operational units") and throw to skip all remaining calls
    if (response.status === 403) {
      const txt = await response.text().catch(() => '');
      if (txt.includes('No operational units')) {
        throw new Error('UNPROVISIONED_STORE');
      }
    }
    console.error(`Hourly fetch failed (${response.status}) for ${dateStr}`);
    return [];
  }

  const data = await response.json();
  const hourlyData: { hour: string; sales: number; checksCount: number }[] = [];

  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      const rawHour = item.hour || '';
      const hour24 = convertTo24Hour(rawHour);
      const sales = parseFloat(String(item.netSales || '0').replace(/[$,]/g, '')) || 0;
      const checksCount = parseInt(String(item.checksCount || '0').replace(/,/g, '')) || 0;
      if (rawHour) hourlyData.push({ hour: hour24, sales, checksCount });
    }
  }
  
  return hourlyData;
}

interface ProductMixResult {
  pizzaCount: number;
  productMix: { itemName: string; category: string; quantity: number; netSales: number }[];
}

async function fetchProductMix(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<ProductMixResult> {
  console.log(`[sales-service] Fetching product mix for ${dateStr}`);

  try {
    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/product-mix/sections/main', {
      method: 'POST',
      headers: getV4Headers(tokenGw),
      body: JSON.stringify({
        fields: [
          { fieldName: "itemGroup" },
          { fieldName: "itemName" },
          { fieldName: "quantity" },
          { fieldName: "netSales" }
        ],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: "custom" },
          singleLocation: parseInt(qbLocationId),
          location: { operationalUnits: [parseInt(qbLocationId)] }
        },
        params: {
          sectionId: "main",
          pageNumber: 1,
          pageSize: 200,
          totalRecords: null,
          sort: [{ field: "netSales", dir: "desc" }],
          showTotals: true
        }
      }),
    });

    if (!response.ok) {
      console.error('[sales-service] Product mix fetch failed:', response.status);
      return { pizzaCount: 0, productMix: [] };
    }

    const data = await response.json();
    let crustCount = 0;
    const productMix: { itemName: string; category: string; quantity: number; netSales: number }[] = [];

    const processRow = (row: any, fallbackCategory?: string) => {
      const name = row.itemName || row.productName || row.name || '';
      if (!name || name === 'Totals') return;

      const category = (
        row.itemGroupName ||
        row.itemGroup ||
        row.categoryName ||
        row.category ||
        fallbackCategory ||
        ''
      );

      const quantity = parseFloat(String(row.quantity || '0').replace(/,/g, '')) || 0;
      const netSales = parseFloat(String(row.netSales || '0').replace(/[$,]/g, '')) || 0;

      // Collect full product mix
      productMix.push({ itemName: name, category, quantity, netSales });

      // Also count pizza crusts
      if (category.toLowerCase() === 'crusts') {
        const isHalf = name.includes('1/2') || name.includes('(1/2)');
        crustCount += isHalf ? quantity * 0.5 : quantity;
      }
    };

    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        if (item.items && Array.isArray(item.items)) {
          const groupName = item.itemGroupName || item.itemGroup || item.categoryName || item.category || '';
          for (const child of item.items) {
            processRow(child, groupName);
          }
        } else {
          processRow(item);
        }
      }
    }

    console.log(`[sales-service] Product mix: ${productMix.length} items, crust count: ${crustCount}`);
    return { pizzaCount: crustCount, productMix };
  } catch (error) {
    console.error('[sales-service] Product mix error:', error);
    return { pizzaCount: 0, productMix: [] };
  }
}

// Fetch payment method breakdown - uses only summary/payments (the only endpoint that works for Blaze stores)
async function fetchPaymentsData(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<{ paymentType: string; amount: number }[]> {
  console.log(`[sales-service] Fetching payments data for ${dateStr}`);

  const parsePayments = (data: any): { paymentType: string; amount: number }[] => {
    const payments: { paymentType: string; amount: number }[] = [];
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      let rawName = item.paymentType ?? item.tenderType ?? item.tenderName ?? item.name ?? item.metric ?? item.type ?? '';
      // Handle nested objects (e.g. { name: "Cash" } from summary/payments endpoint)
      if (rawName && typeof rawName === 'object') {
        rawName = rawName.name ?? rawName.label ?? rawName.value ?? rawName.metric ?? JSON.stringify(rawName);
      }
      const paymentType = String(rawName || '').trim();
      if (!paymentType || paymentType === 'Total' || paymentType === 'Totals') continue;
      const rawAmount = item.amount ?? item.total ?? item.value ?? item.netSales ?? 0;
      const amount = parseFloat(String(rawAmount).replace(/[$,]/g, '')) || 0;
      payments.push({ paymentType, amount });
    }
    return payments;
  };

  try {
    const resp = await fetch(
      'https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/payments',
      {
        method: 'POST',
        headers: getV4Headers(tokenGw),
        body: JSON.stringify({
          fields: [{ fieldName: 'paymentType' }, { fieldName: 'total' }],
          filters: {
            date: { from: null, to: null, values: [dateStr], type: 'custom' },
            location: { operationalUnits: [parseInt(qbLocationId)] },
          },
          params: { sectionId: 'main', pageNumber: 1, pageSize: 100, totalRecords: null, sort: null, showTotals: true },
        }),
      }
    );

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error(`[sales-service] Payments summary/payments failed: ${resp.status} ${txt.substring(0, 120)}`);
      return [];
    }

    const data = await resp.json();
    const parsed = parsePayments(data);
    console.log(`[sales-service] Payments summary/payments: ${parsed.length} types`);
    return parsed;
  } catch (error) {
    console.error('[sales-service] Payments error:', error);
    return [];
  }
}

// Get the same date from last year (for YOY comparison)
function getYOYDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${year - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Fetch YOY data from sales_cache (already backfilled) instead of hitting API
async function getYOYFromCache(
  supabase: any,
  locationId: string,
  dateStr: string
): Promise<{ yoyNetSales: number | null; yoyHourlyData: any[] | null; yoySaleDate: string | null }> {
  const yoyDateStr = getYOYDate(dateStr);
  
  const { data, error } = await supabase
    .from('sales_cache')
    .select('net_sales, hourly_data')
    .eq('location_id', locationId)
    .eq('sale_date', yoyDateStr)
    .maybeSingle();

  if (error || !data || !data.net_sales) {
    return { yoyNetSales: null, yoyHourlyData: null, yoySaleDate: null };
  }

  return {
    yoyNetSales: data.net_sales,
    yoyHourlyData: data.hourly_data,
    yoySaleDate: yoyDateStr,
  };
}

// ============================================================================
// HELPER: Build formatted 24-hour array from hourly data
// ============================================================================

function formatHourlyTo24(
  hourlyData: { hour: string; sales: number; checksCount: number }[],
  existingHourly?: any[]
): any[] {
  // Build lookup of existing projected/laborPercent/laborCost values
  const existingMap = new Map<string, any>();
  if (existingHourly) {
    for (const h of existingHourly) {
      if (h?.hour) existingMap.set(h.hour, h);
    }
  }
  
  const formatted = [];
  for (let h = 0; h < 24; h++) {
    const hourStr = `${h.toString().padStart(2, '0')}:00`;
    const hourData = hourlyData.find(hd => hd.hour === hourStr);
    const existing = existingMap.get(hourStr);
    const entry: any = {
      hour: hourStr,
      sales: hourData?.sales || 0,
      checksCount: hourData?.checksCount || 0
    };
    // Preserve projected values from existing cache (set by fetch-qubeyond-sales)
    if (existing?.projected != null && existing.projected > 0) {
      entry.projected = existing.projected;
    }
    if (existing?.laborPercent != null) {
      entry.laborPercent = existing.laborPercent;
    }
    if (existing?.laborCost != null) {
      entry.laborCost = existing.laborCost;
    }
    formatted.push(entry);
  }
  return formatted;
}

// ============================================================================
// HELPER: Fetch all data for a date and build upsert payload
// ============================================================================

async function fetchAllSalesData(
  supabase: any,
  tokenGw: string,
  dateStr: string,
  qbLocationId: string,
  locationId: string
): Promise<{
  netSales: number;
  guestCount: number;
  avgTicket: number | null;
  pizzaCount: number;
  formattedHourly: any[];
  productMix: any[];
  paymentsData: any[];
  yoyNetSales: number | null;
  yoyHourlyData: any[] | null;
  yoySaleDate: string | null;
}> {
  // Fetch API data + YOY + existing cache (for projection preservation) in parallel
  const [hourlyData, pmResult, paymentsData, yoyData, existingCache] = await Promise.all([
    fetchHourlySales(tokenGw, dateStr, qbLocationId),
    fetchProductMix(tokenGw, dateStr, qbLocationId),
    fetchPaymentsData(tokenGw, dateStr, qbLocationId),
    getYOYFromCache(supabase, locationId, dateStr),
    supabase.from('sales_cache').select('hourly_data').eq('location_id', locationId).eq('sale_date', dateStr).maybeSingle(),
  ]);

  const netSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
  const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
  const avgTicket = guestCount > 0 ? netSales / guestCount : null;
  const existingHourly = existingCache?.data?.hourly_data as any[] | undefined;
  const formattedHourly = formatHourlyTo24(hourlyData, existingHourly);

  return {
    netSales,
    guestCount,
    avgTicket,
    pizzaCount: pmResult.pizzaCount,
    formattedHourly,
    productMix: pmResult.productMix,
    paymentsData,
    ...yoyData,
  };
}

function buildUpsertPayload(locationId: string, dateStr: string, data: Awaited<ReturnType<typeof fetchAllSalesData>>) {
  return {
    location_id: locationId,
    sale_date: dateStr,
    net_sales: data.netSales,
    guest_count: data.guestCount,
    avg_ticket: data.avgTicket,
    hourly_data: data.formattedHourly,
    // Never overwrite good item-level detail with an empty array when the
    // product-mix endpoint errors out / rate limits — leave prior data intact.
    ...(data.productMix.length > 0
      ? { product_mix: data.productMix, pizza_count: Math.round(data.pizzaCount) }
      : {}),
    ...(data.paymentsData.length > 0 ? { payments_data: data.paymentsData } : {}),
    yoy_net_sales: data.yoyNetSales,
    yoy_hourly_data: data.yoyHourlyData,
    yoy_sale_date: data.yoySaleDate,
    validation_status: 'valid',
    validation_attempts: 1,
    flagged_no_sales: false,
    fetched_at: new Date().toISOString(),
  };
}

// ============================================================================
// ACTION: sync-live
// ============================================================================

async function handleSyncLive(supabase: any): Promise<Response> {
  console.log('Starting live sales sync...');

  const { data: integrations, error: intError } = await supabase
    .from('location_integrations')
    .select(`
      id,
      location_id,
      credentials,
      locations!inner(id, name)
    `)
    .eq('integration_type', 'qubeyond')
    .eq('is_active', true);

  const locationIds = integrations?.map((i: any) => i.location_id) || [];
  const { data: locationSettings } = await supabase
    .from('location_settings')
    .select('location_id, timezone, hours_open, hours_close')
    .in('location_id', locationIds);

  const settingsByLocation: Record<string, { timezone: string; hours_open: string | null; hours_close: string | null }> = {};
  if (locationSettings) {
    for (const ls of locationSettings) {
      settingsByLocation[ls.location_id] = {
        timezone: ls.timezone || 'America/Los_Angeles',
        hours_open: ls.hours_open,
        hours_close: ls.hours_close
      };
    }
  }

  if (intError) {
    console.error('Error fetching integrations:', intError);
    return new Response(JSON.stringify({ error: intError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (!integrations || integrations.length === 0) {
    console.log('No active QU integrations found');
    return new Response(JSON.stringify({ message: 'No active integrations' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`Found ${integrations.length} active QU integrations`);

  const { data: locationHours } = await supabase
    .from('location_hours')
    .select('location_id, day_of_week, open_time, close_time, is_closed')
    .in('location_id', locationIds);

  const hoursByLocation: Record<string, Record<number, { open: string; close: string; closed: boolean }>> = {};
  if (locationHours) {
    for (const lh of locationHours) {
      if (!hoursByLocation[lh.location_id]) hoursByLocation[lh.location_id] = {};
      hoursByLocation[lh.location_id][lh.day_of_week] = {
        open: lh.open_time || '10:00',
        close: lh.close_time || '22:00',
        closed: lh.is_closed || false
      };
    }
  }

  const results: { locationId: string; name: string; status: string; salesUpdated?: number; pizzaCount?: number }[] = [];

  // V4: Get ONE global token for all locations
  const tokenGw = await authenticateV4();
  if (!tokenGw) {
    // sync-live is cron-driven every ~6 minutes. A failed auth means we skip
    // this tick, not that the endpoint is broken — returning 5xx here made
    // every transient Qu blip look like an edge function outage.
    console.error('[sales-service] V4 authentication failed, skipping this sync tick');
    return new Response(JSON.stringify({ skipped: true, reason: 'qu_auth_failed' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }


  for (const integration of integrations) {
    const locationId = integration.location_id;
    const locationName = (integration.locations as any)?.name || 'Unknown';
    const credentials = integration.credentials as { location_id?: string | number };
    const settings = settingsByLocation[locationId];
    const timezone = settings?.timezone || 'America/Los_Angeles';

    const qbLocationId = getQbLocationId(credentials);
    if (!qbLocationId) {
      console.log(`${locationName}: Missing QuBeyond location_id in credentials`);
      results.push({ locationId, name: locationName, status: 'missing_qb_location_id' });
      continue;
    }

    const currentTime = getCurrentTimeInTimezone(timezone);
    const today = new Date();
    const tzToday = new Date(today.toLocaleString('en-US', { timeZone: timezone }));
    const dayOfWeek = tzToday.getDay();

    let openTime = settings?.hours_open || '10:00';
    let closeTime = settings?.hours_close || '22:00';

    if (hoursByLocation[locationId]?.[dayOfWeek]) {
      const todayHours = hoursByLocation[locationId][dayOfWeek];
      if (todayHours.closed) {
        console.log(`${locationName}: Closed today, skipping`);
        results.push({ locationId, name: locationName, status: 'closed_today' });
        continue;
      }
      openTime = todayHours.open;
      closeTime = todayHours.close;
    }

    if (!isWithinBusinessHours(currentTime.hours, currentTime.minutes, openTime, closeTime)) {
      console.log(`${locationName}: Outside business hours (${openTime}-${closeTime}+10min), current: ${currentTime.hours}:${currentTime.minutes}`);
      results.push({ locationId, name: locationName, status: 'outside_hours' });
      continue;
    }

    console.log(`${locationName}: Syncing live sales with QuBeyond location_id=${qbLocationId}...`);

    const todayStr = getDateStringForTimezone(new Date(), timezone);
    
    let salesData;
    try {
      salesData = await fetchAllSalesData(supabase, tokenGw, todayStr, qbLocationId, locationId);
    } catch (err: any) {
      if (err?.message === 'UNPROVISIONED_STORE') {
        console.log(`${locationName}: Unprovisioned in QU (403), skipping all API calls`);
        results.push({ locationId, name: locationName, status: 'unprovisioned' });
        continue;
      }
      throw err;
    }

    if (salesData.netSales > 0) {
      const payload = buildUpsertPayload(locationId, todayStr, salesData);

      const { error: upsertError } = await supabase
        .from('sales_cache')
        .upsert(payload, { onConflict: 'location_id,sale_date' });

      if (upsertError) {
        console.error(`${locationName}: Upsert error:`, upsertError);
        results.push({ locationId, name: locationName, status: 'upsert_error' });
      } else {
        console.log(`${locationName}: Updated - $${salesData.netSales.toFixed(2)}, ${salesData.guestCount} guests, ${salesData.pizzaCount} pizzas, ${salesData.productMix.length} items, ${salesData.paymentsData.length} payments, YOY: ${salesData.yoyNetSales ? '$' + salesData.yoyNetSales.toFixed(2) : 'n/a'}`);
        results.push({ locationId, name: locationName, status: 'success', salesUpdated: salesData.netSales, pizzaCount: salesData.pizzaCount });
      }
    } else {
      console.log(`${locationName}: No sales data yet (${salesData.netSales}), skipping update to preserve existing data`);
      results.push({ locationId, name: locationName, status: 'no_sales_yet' });
    }
  }

  console.log('Live sales sync completed');
  return new Response(JSON.stringify({ 
    success: true, 
    synced: results.filter(r => r.status === 'success').length,
    skipped: results.filter(r => r.status !== 'success').length,
    results 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// ACTION: backfill
// ============================================================================

async function handleBackfill(req: Request, supabase: any): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('Authorization') || '';
  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { locationId, daysBack = 365 } = await req.json();

  if (!locationId) {
    return new Response(JSON.stringify({ error: 'Missing locationId' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: hasAccess, error: accessError } = await supabase.rpc(
    'has_location_access',
    { _user_id: user.id, _location_id: locationId },
  );

  if (accessError || !hasAccess) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: integration, error: intError } = await supabase
    .from('location_integrations')
    .select('id, credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'qubeyond')
    .eq('is_active', true)
    .maybeSingle();

  if (intError || !integration) {
    return new Response(JSON.stringify({ error: 'Integration not configured' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const credentials = integration.credentials as { location_id?: string | number };
  const qbLocationId = getQbLocationId(credentials);
  if (!qbLocationId) {
    return new Response(JSON.stringify({ error: 'Missing QuBeyond location_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[sales-service] backfill: ${locationId}, daysBack=${daysBack}`);

  // Mark started + reset progress so UI shows movement from 0
  await supabase
    .from('location_integrations')
    .update({
      backfill_status: 'in_progress',
      backfill_days_completed: 0,
      backfill_error: null,
      backfill_started_at: new Date().toISOString(),
    })
    .eq('id', integration.id);

  // Build date list (yesterday backwards)
  const dates: string[] = [];
  const today = new Date();
  for (let i = 1; i <= daysBack; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }

  // Background worker — survives the HTTP response via EdgeRuntime.waitUntil
  const runBackfill = async () => {
    try {
      const tokenGw = await authenticateV4();
      if (!tokenGw) {
        await supabase
          .from('location_integrations')
          .update({ backfill_status: 'failed', backfill_error: 'QuBeyond authentication failed' })
          .eq('id', integration.id);
        return;
      }

      let processed = 0;
      let successCount = 0;
      let unprovisioned = false;

      for (const dateStr of dates) {
        let salesData;
        try {
          salesData = await fetchAllSalesData(supabase, tokenGw, dateStr, qbLocationId, locationId);
        } catch (err: any) {
          if (err?.message === 'UNPROVISIONED_STORE') {
            unprovisioned = true;
            break;
          }
          console.error(`[sales-service] backfill error ${dateStr}:`, err?.message || err);
          processed++;
          if (processed % 10 === 0) {
            await supabase
              .from('location_integrations')
              .update({ backfill_days_completed: processed })
              .eq('id', integration.id);
          }
          continue;
        }

        if (salesData.netSales > 0) {
          const payload = buildUpsertPayload(locationId, dateStr, salesData);
          const { error: upsertError } = await supabase
            .from('sales_cache')
            .upsert(payload, { onConflict: 'location_id,sale_date' });
          if (!upsertError) successCount++;
        }

        processed++;
        // Flush progress every 10 days so the UI bar moves
        if (processed % 10 === 0) {
          await supabase
            .from('location_integrations')
            .update({ backfill_days_completed: processed })
            .eq('id', integration.id);
        }
      }

      if (unprovisioned) {
        await supabase
          .from('location_integrations')
          .update({
            backfill_status: 'failed',
            backfill_days_completed: processed,
            backfill_error: 'QuBeyond has not authorized this store on the API client. Contact QuBeyond support.',
          })
          .eq('id', integration.id);
      } else {
        await supabase
          .from('location_integrations')
          .update({
            backfill_status: 'completed',
            backfill_days_completed: dates.length,
            backfill_error: null,
          })
          .eq('id', integration.id);
        console.log(`[sales-service] backfill OK: ${locationId} ${successCount}/${dates.length} days`);
      }
    } catch (err: any) {
      console.error(`[sales-service] backfill fatal:`, err);
      await supabase
        .from('location_integrations')
        .update({
          backfill_status: 'failed',
          backfill_error: (err?.message || 'Unknown error').slice(0, 500),
        })
        .eq('id', integration.id);
    }
  };

  // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
  EdgeRuntime.waitUntil(runBackfill());

  return new Response(
    JSON.stringify({ status: 'started', locationId, totalDays: dates.length }),
    { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

// ============================================================================
// ACTION: sync-day
// ============================================================================

async function handleSyncDay(req: Request, supabase: any): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('Authorization') || '';
  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { locationId, date } = await req.json();

  if (!locationId || !date) {
    return new Response(JSON.stringify({ error: 'Missing locationId or date' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: hasAccess, error: accessError } = await supabase.rpc(
    'has_location_access',
    { _user_id: user.id, _location_id: locationId },
  );

  if (accessError) {
    console.error('[sales-service] access check error:', accessError);
    return new Response(JSON.stringify({ error: 'Access check failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!hasAccess) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: integration, error: intError } = await supabase
    .from('location_integrations')
    .select('id, credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'qubeyond')
    .eq('is_active', true)
    .maybeSingle();

  if (intError || !integration) {
    console.error('[sales-service] Integration not found:', intError);
    return new Response(JSON.stringify({ error: 'Integration not configured' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const credentials = integration.credentials as { location_id?: string | number };
  const qbLocationId = getQbLocationId(credentials);
  if (!qbLocationId) {
    return new Response(JSON.stringify({ error: 'Missing QuBeyond location_id in credentials' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[sales-service] sync-day: ${locationId} ${date}, QB location=${qbLocationId}`);

  const tokenGw = await authenticateV4();
  if (!tokenGw) {
    return new Response(JSON.stringify({ error: 'QuBeyond authentication failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const salesData = await fetchAllSalesData(supabase, tokenGw, date, qbLocationId, locationId);

  if (salesData.netSales <= 0) {
    console.log(`[sales-service] sync-day: ${locationId} ${date} netSales=0, not overwriting`);
    return new Response(
      JSON.stringify({ status: 'no_sales', locationId, date, netSales: salesData.netSales, guestCount: salesData.guestCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const payload = buildUpsertPayload(locationId, date, salesData);

  const { error: upsertError } = await supabase
    .from('sales_cache')
    .upsert(payload, { onConflict: 'location_id,sale_date' });

  if (upsertError) {
    console.error('[sales-service] sync-day upsert failed:', upsertError);
    return new Response(JSON.stringify({ error: upsertError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[sales-service] sync-day OK: ${locationId} ${date} $${salesData.netSales.toFixed(2)} (${salesData.guestCount} guests, ${salesData.pizzaCount} pizzas, ${salesData.productMix.length} items, YOY: ${salesData.yoyNetSales ? '$' + salesData.yoyNetSales.toFixed(2) : 'n/a'})`);

  return new Response(
    JSON.stringify({ status: 'updated', locationId, date, netSales: salesData.netSales, guestCount: salesData.guestCount, pizzaCount: salesData.pizzaCount }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

// ============================================================================
// ACTION: sync-yesterday — No auth required, uses service role (called by nightly maintenance)
// ============================================================================

async function handleSyncYesterday(supabase: any): Promise<Response> {
  console.log('[sales-service] sync-yesterday: Starting...');

  const { data: integrations, error: intError } = await supabase
    .from('location_integrations')
    .select(`id, location_id, credentials, locations!inner(id, name)`)
    .eq('integration_type', 'qubeyond')
    .eq('is_active', true);

  if (intError || !integrations || integrations.length === 0) {
    console.log('[sales-service] sync-yesterday: No active integrations');
    return new Response(JSON.stringify({ message: 'No active integrations' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const results: { locationId: string; name: string; status: string }[] = [];

  for (const integration of integrations) {
    const locationId = integration.location_id;
    const locationName = (integration.locations as any)?.name || 'Unknown';
    const credentials = integration.credentials as { location_id?: string | number };
    const qbLocationId = getQbLocationId(credentials);

    if (!qbLocationId) {
      results.push({ locationId, name: locationName, status: 'missing_qb_location_id' });
      continue;
    }

    // Get timezone for this location
    const { data: settings } = await supabase
      .from('location_settings')
      .select('timezone')
      .eq('location_id', locationId)
      .maybeSingle();

    const timezone = settings?.timezone || 'America/Los_Angeles';
    
    // Calculate yesterday in the location's timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayStr = formatter.format(now);
    const yesterdayDate = new Date(todayStr + 'T12:00:00');
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    console.log(`[sales-service] sync-yesterday: ${locationName} syncing ${yesterdayStr}`);

    try {
      const tokenGw = await authenticateV4();
      if (!tokenGw) {
        results.push({ locationId, name: locationName, status: 'auth_failed' });
        continue;
      }

      const salesData = await fetchAllSalesData(supabase, tokenGw, yesterdayStr, qbLocationId, locationId);

      if (salesData.netSales <= 0) {
        results.push({ locationId, name: locationName, status: 'no_sales' });
        continue;
      }

      const payload = buildUpsertPayload(locationId, yesterdayStr, salesData);

      const { error: upsertError } = await supabase
        .from('sales_cache')
        .upsert(payload, { onConflict: 'location_id,sale_date' });

      if (upsertError) {
        console.error(`[sales-service] sync-yesterday ${locationName} upsert error:`, upsertError);
        results.push({ locationId, name: locationName, status: 'upsert_error' });
      } else {
        console.log(`[sales-service] sync-yesterday ${locationName}: $${salesData.netSales.toFixed(2)}, ${salesData.productMix.length} mix items`);
        results.push({ locationId, name: locationName, status: 'success' });
      }
    } catch (err) {
      console.error(`[sales-service] sync-yesterday ${locationName} error:`, err);
      results.push({ locationId, name: locationName, status: 'error' });
    }
  }

  return new Response(JSON.stringify({
    success: true,
    synced: results.filter(r => r.status === 'success').length,
    results,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// ACTION: sync-dates — No user auth, uses service role. Backfills specific dates for one location.
// ============================================================================

async function handleSyncDates(req: Request, supabase: any): Promise<Response> {
  const { locationId, dates } = await req.json();

  if (!locationId || !dates || !Array.isArray(dates) || dates.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing locationId or dates array' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Cap at 30 days per call
  const datesToSync = dates.slice(0, 30);

  const { data: integration, error: intError } = await supabase
    .from('location_integrations')
    .select('id, credentials, locations!inner(id, name)')
    .eq('location_id', locationId)
    .eq('integration_type', 'qubeyond')
    .eq('is_active', true)
    .maybeSingle();

  if (intError || !integration) {
    return new Response(JSON.stringify({ error: 'Integration not configured' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const locationName = (integration.locations as any)?.name || 'Unknown';
  const credentials = integration.credentials as { location_id?: string | number };
  const qbLocationId = getQbLocationId(credentials);

  if (!qbLocationId) {
    return new Response(JSON.stringify({ error: 'Missing credentials' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const tokenGw = await authenticateV4();
  if (!tokenGw) {
    return new Response(JSON.stringify({ error: 'QuBeyond authentication failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[sales-service] sync-dates: ${locationName} syncing ${datesToSync.length} dates`);

  const results: { date: string; status: string; netSales?: number; mixItems?: number }[] = [];

  for (const dateStr of datesToSync) {
    try {
      const salesData = await fetchAllSalesData(supabase, tokenGw, dateStr, qbLocationId, locationId);

      if (salesData.netSales <= 0) {
        results.push({ date: dateStr, status: 'no_sales' });
        continue;
      }

      const payload = buildUpsertPayload(locationId, dateStr, salesData);

      const { error: upsertError } = await supabase
        .from('sales_cache')
        .upsert(payload, { onConflict: 'location_id,sale_date' });

      if (upsertError) {
        console.error(`[sales-service] sync-dates ${dateStr} upsert error:`, upsertError);
        results.push({ date: dateStr, status: 'upsert_error' });
      } else {
        console.log(`[sales-service] sync-dates ${locationName} ${dateStr}: $${salesData.netSales.toFixed(2)}, ${salesData.productMix.length} mix items`);
        results.push({ date: dateStr, status: 'success', netSales: salesData.netSales, mixItems: salesData.productMix.length });
      }
    } catch (err) {
      console.error(`[sales-service] sync-dates ${dateStr} error:`, err);
      results.push({ date: dateStr, status: 'error' });
    }
  }

  return new Response(JSON.stringify({
    success: true,
    location: locationName,
    synced: results.filter(r => r.status === 'success').length,
    total: datesToSync.length,
    results,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// TIPS SYNC — Bulk fetch tips for a date range and upsert into daily_tips
// ============================================================================

async function fetchTipsForDate(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<{ ccTips: number; cashTips: number } | null> {
  try {
    const requestPayload = {
      fields: [
        { fieldName: "employee" },
        { fieldName: "tips" },
        { fieldName: "creditCardTips" },
        { fieldName: "cashTips" },
        { fieldName: "totalTips" }
      ],
      filters: {
        date: { from: null, to: null, values: [dateStr], type: "custom" },
        location: { operationalUnits: [parseInt(qbLocationId)] }
      },
      params: { sectionId: "main", pageNumber: 1, pageSize: 100, totalRecords: null, sort: null, showTotals: true }
    };

    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/tips/sections/main', {
      method: 'POST',
      headers: getV4Headers(tokenGw),
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      console.error(`[sync-tips] Fetch failed for ${dateStr}:`, response.status);
      return null;
    }

    const data = await response.json();
    let totalCcTips = 0;
    let totalCashTips = 0;

    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        totalCcTips += parseFloat(String(item.tipsAmount || item.tips || item.creditCardTips || '0').replace(/[$,]/g, '')) || 0;
        totalCashTips += parseFloat(String(item.cashTips || '0').replace(/[$,]/g, '')) || 0;
      }
    }

    if (data.totals) {
      const totalFromTotals = parseFloat(String(data.totals.tipsAmount || data.totals.tips || data.totals.creditCardTips || '0').replace(/[$,]/g, '')) || 0;
      const cashFromTotals = parseFloat(String(data.totals.cashTips || '0').replace(/[$,]/g, '')) || 0;
      if (totalFromTotals > 0) totalCcTips = totalFromTotals;
      if (cashFromTotals > 0) totalCashTips = cashFromTotals;
    }

    return { ccTips: totalCcTips, cashTips: totalCashTips };
  } catch (error) {
    console.error(`[sync-tips] Error fetching tips for ${dateStr}:`, error);
    return null;
  }
}

async function handleSyncTips(req: Request, supabase: any) {
  const body = await req.json();
  const { locationId, startDate, endDate } = body;

  if (!locationId || !startDate || !endDate) {
    return new Response(JSON.stringify({ error: 'Missing locationId, startDate, or endDate' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`[sync-tips] Syncing tips for location ${locationId} from ${startDate} to ${endDate}`);

  // Get QU integration
  const { data: integration } = await supabase
    .from('location_integrations')
    .select('id, credentials, is_active')
    .eq('location_id', locationId)
    .eq('integration_type', 'qubeyond')
    .eq('is_active', true)
    .single();

  if (!integration) {
    return new Response(JSON.stringify({ error: 'No active QuBeyond integration found', synced: 0 }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const creds = integration.credentials as { location_id?: string | number };
  const tokenGw = await authenticateV4();
  if (!tokenGw) {
    return new Response(JSON.stringify({ error: 'Authentication failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const qbLocationId = getQbLocationId(creds);
  if (!qbLocationId) {
    return new Response(JSON.stringify({ error: 'Missing QuBeyond location_id in credentials' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Generate date range
  const dates: string[] = [];
  const current = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate + 'T12:00:00Z');
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  console.log(`[sync-tips] Fetching tips for ${dates.length} days`);

  // Fetch tips in parallel batches of 5 to avoid rate limiting
  const BATCH_SIZE = 5;
  const allResults: { date: string; ccTips: number; cashTips: number }[] = [];

  for (let i = 0; i < dates.length; i += BATCH_SIZE) {
    const batch = dates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (dateStr) => {
        const tips = await fetchTipsForDate(tokenGw, dateStr, qbLocationId);
        return tips ? { date: dateStr, ...tips } : null;
      })
    );
    results.forEach(r => { if (r) allResults.push(r); });
  }

  // Bulk upsert into daily_tips
  if (allResults.length > 0) {
    const rows = allResults.map(r => ({
      location_id: locationId,
      tip_date: r.date,
      total_cc_tips: r.ccTips,
      total_cash_tips: r.cashTips,
      fetched_at: new Date().toISOString()
    }));

    // Upsert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase
        .from('daily_tips')
        .upsert(batch, { onConflict: 'location_id,tip_date' });

      if (error) {
        console.error(`[sync-tips] Upsert error batch ${i}:`, error.message);
      }
    }
  }

  console.log(`[sync-tips] Done. Synced ${allResults.length}/${dates.length} days`);

  return new Response(JSON.stringify({
    status: 'ok',
    synced: allResults.length,
    total: dates.length,
    totalCcTips: allResults.reduce((s, r) => s + r.ccTips, 0),
    totalCashTips: allResults.reduce((s, r) => s + r.cashTips, 0),
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// ACTION: test-api — Hit all V4 endpoints for active stores, return results (no DB writes)
// ============================================================================

async function handleTestApi(supabase: any): Promise<Response> {
  console.log('[sales-service] test-api: Starting V4 API test...');

  const token = await authenticateV4();
  if (!token) {
    return new Response(JSON.stringify({ error: 'V4 OAuth2 authentication failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Get all active QU integrations
  const { data: integrations } = await supabase
    .from('location_integrations')
    .select('id, location_id, credentials, locations!inner(id, name)')
    .eq('integration_type', 'qubeyond')
    .eq('is_active', true);

  if (!integrations || integrations.length === 0) {
    return new Response(JSON.stringify({ error: 'No active QU integrations found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const todayStr = getDateStringForTimezone(new Date(), 'America/Los_Angeles');
  const headers = getV4Headers(token);
  const locationResults: any[] = [];

  for (const integration of integrations) {
    const locationName = (integration.locations as any)?.name || 'Unknown';
    const credentials = integration.credentials as { location_id?: string };
    const qbLocationId = credentials?.location_id || '';

    if (!qbLocationId) {
      locationResults.push({ location: locationName, status: 'missing_qb_location_id' });
      continue;
    }

    console.log(`[test-api] Testing ${locationName} (QB: ${qbLocationId})...`);

    const endpoints = [
      {
        name: 'sales_summary',
        url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/sales',
        payload: {
          fields: [{ fieldName: 'metric' }, { fieldName: 'total' }],
          filters: { date: { from: null, to: null, values: [todayStr], type: 'custom' }, location: { operationalUnits: [parseInt(qbLocationId)] } },
          params: { sectionId: 'overview', pageNumber: 1, pageSize: 25, totalRecords: null, sort: null, showTotals: true }
        }
      },
      {
        name: 'hourly_sales',
        url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/hourly-sales/sections/main',
        payload: {
          fields: [{ fieldName: 'hour' }, { fieldName: 'checksCount' }, { fieldName: 'netSales' }],
          filters: { date: { from: null, to: null, values: [todayStr], type: 'custom' }, singleLocation: parseInt(qbLocationId), location: { operationalUnits: [parseInt(qbLocationId)] } },
          params: { sectionId: 'main', pageNumber: 1, pageSize: 25, totalRecords: null, sort: null, showTotals: true }
        }
      },
      {
        name: 'product_mix',
        url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/product-mix/sections/main',
        payload: {
          fields: [{ fieldName: 'itemGroup' }, { fieldName: 'itemName' }, { fieldName: 'quantity' }, { fieldName: 'netSales' }],
          filters: { date: { from: null, to: null, values: [todayStr], type: 'custom' }, singleLocation: parseInt(qbLocationId), location: { operationalUnits: [parseInt(qbLocationId)] } },
          params: { sectionId: 'main', pageNumber: 1, pageSize: 50, totalRecords: null, sort: [{ field: 'netSales', dir: 'desc' }], showTotals: true }
        }
      },
      {
        name: 'payments',
        url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/payments/sections/main',
        payload: {
          fields: [{ fieldName: 'tenderType' }, { fieldName: 'amount' }, { fieldName: 'count' }],
          filters: { date: { from: null, to: null, values: [todayStr], type: 'custom' }, singleLocation: parseInt(qbLocationId), location: { operationalUnits: [parseInt(qbLocationId)] } },
          params: { sectionId: 'main', pageNumber: 1, pageSize: 50, totalRecords: null, sort: null, showTotals: true }
        }
      },
      {
        name: 'tips',
        url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/tips/sections/main',
        payload: {
          fields: [{ fieldName: 'employee' }, { fieldName: 'tips' }, { fieldName: 'creditCardTips' }, { fieldName: 'cashTips' }],
          filters: { date: { from: null, to: null, values: [todayStr], type: 'custom' }, location: { operationalUnits: [parseInt(qbLocationId)] } },
          params: { sectionId: 'main', pageNumber: 1, pageSize: 100, totalRecords: null, sort: null, showTotals: true }
        }
      }
    ];

    // Hit all endpoints in parallel
    const endpointResults = await Promise.allSettled(
      endpoints.map(async (ep) => {
        const start = Date.now();
        try {
          const resp = await fetch(ep.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(ep.payload),
          });
          const elapsed = Date.now() - start;
          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            return { name: ep.name, status: resp.status, error: text.substring(0, 200), ms: elapsed };
          }
          const data = await resp.json();
          const itemCount = Array.isArray(data.items) ? data.items.length : 0;
          const hasTotals = !!data.totals;
          // Extract key metrics for quick review
          let summary: any = { itemCount, hasTotals };
          if (ep.name === 'sales_summary' && data.items) {
            for (const item of data.items) {
              if (item.metricTypeId === 1 || item.metric === 'Net Sales') summary.netSales = item.total;
              if (item.metric === 'Gross Sales') summary.grossSales = item.total;
              if (item.metric === 'Discount') summary.discounts = item.total;
              if (item.metricTypeId === 2 || item.metric === 'Check Count') summary.checkCount = item.total;
            }
          }
          return { name: ep.name, status: 200, ms: elapsed, summary, sampleItem: data.items?.[0] || null };
        } catch (err: any) {
          return { name: ep.name, status: 0, error: err.message, ms: Date.now() - start };
        }
      })
    );

    const locResult: any = { location: locationName, qbLocationId, date: todayStr, endpoints: {} };
    for (const r of endpointResults) {
      if (r.status === 'fulfilled') {
        locResult.endpoints[r.value.name] = r.value;
      } else {
        locResult.endpoints['unknown'] = { error: r.reason?.message || 'Promise rejected' };
      }
    }
    locationResults.push(locResult);
  }

  return new Response(JSON.stringify({
    success: true,
    authMethod: 'V4 OAuth2 client_credentials',
    date: todayStr,
    locationsCount: locationResults.length,
    results: locationResults,
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Caller must be the service role (cron / edge-to-edge) or a verified session.
  const authed = await requireCaller(req, corsHeaders);
  if ('response' in authed) return authed.response;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    // Accept action via ?action= query param OR X-Action header (UI uses header)
    const action =
      url.searchParams.get('action') ||
      req.headers.get('x-action') ||
      req.headers.get('X-Action') ||
      'sync-live';

    console.log(`[sales-service] Action: ${action}`);

    switch (action) {
      case 'sync-live':
        return await handleSyncLive(supabase);
      
      case 'sync-day':
        return await handleSyncDay(req, supabase);
      
      case 'sync-yesterday':
        return await handleSyncYesterday(supabase);
      
      case 'backfill':
        return await handleBackfill(req, supabase);
      
      case 'sync-dates':
        return await handleSyncDates(req, supabase);

      case 'sync-tips':
        return await handleSyncTips(req, supabase);

      case 'test-api':
        return await handleTestApi(supabase);
      
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error: unknown) {
    console.error('Sales service error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});