import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  const closeMinutes = parseTimeToMinutes(closeStr) + 10;
  
  return currentMinutesTotal >= openMinutes && currentMinutesTotal <= closeMinutes;
}

async function authenticateQuBeyond(
  username: string,
  password: string,
): Promise<{ tokenGw: string } | null> {
  console.log(`[sales-service] Authenticating with QuBeyond for ${username}...`);

  try {
    const loginPayload = {
      payload: { username, password, captchaToken: '' },
    };

    const loginResponse = await fetch('https://admin.qubeyond.com/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://admin.qubeyond.com',
        Referer: 'https://admin.qubeyond.com/login',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify(loginPayload),
    });

    if (!loginResponse.ok) {
      console.error('[sales-service] Auth failed:', loginResponse.status);
      return null;
    }

    const loginData = await loginResponse.json();
    const token = loginData?.token;
    if (!token) {
      console.error('[sales-service] No token in login response');
      return null;
    }

    const jwtPayload = decodeJwtPayload(token);
    const tokenGw = jwtPayload?.tokenGw as string | undefined;
    if (!tokenGw) {
      console.error('[sales-service] No tokenGw found in JWT payload');
      return null;
    }

    console.log(`[sales-service] Auth OK`);
    return { tokenGw };
  } catch (error) {
    console.error('[sales-service] Authentication error:', error);
    return null;
  }
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
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': tokenGw,
      'Origin': 'https://admin.qubeyond.com',
      'Referer': 'https://admin.qubeyond.com/',
    },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
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

async function fetchProductMix(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<number> {
  console.log(`[sales-service] Fetching product mix for ${dateStr}`);

  try {
    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/product-mix/sections/main', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': tokenGw,
        'Origin': 'https://admin.qubeyond.com',
        'Referer': 'https://admin.qubeyond.com/',
      },
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
      return 0;
    }

    const data = await response.json();
    let crustCount = 0;

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
      ).toLowerCase();

      if (category === 'crusts') {
        const quantity = parseFloat(String(row.quantity || '0').replace(/,/g, '')) || 0;
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

    console.log(`[sales-service] Actual crust count: ${crustCount}`);
    return crustCount;
  } catch (error) {
    console.error('[sales-service] Product mix error:', error);
    return 0;
  }
}

// ============================================================================
// ACTION: sync-live (replaces sync-live-sales)
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

  for (const integration of integrations) {
    const locationId = integration.location_id;
    const locationName = (integration.locations as any)?.name || 'Unknown';
    const credentials = integration.credentials as { username?: string; password?: string; location_id?: string };
    const settings = settingsByLocation[locationId];
    const timezone = settings?.timezone || 'America/Los_Angeles';

    const qbLocationId = credentials?.location_id || '';
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

    if (!credentials?.username || !credentials?.password) {
      console.log(`${locationName}: Missing credentials`);
      results.push({ locationId, name: locationName, status: 'missing_credentials' });
      continue;
    }

    console.log(`${locationName}: Syncing live sales with QuBeyond location_id=${qbLocationId}...`);

    const auth = await authenticateQuBeyond(credentials.username, credentials.password);
    if (!auth) {
      console.error(`${locationName}: Authentication failed`);
      results.push({ locationId, name: locationName, status: 'auth_failed' });
      continue;
    }

    const todayStr = getDateStringForTimezone(new Date(), timezone);
    const [hourlyData, pizzaCount] = await Promise.all([
      fetchHourlySales(auth.tokenGw, todayStr, qbLocationId),
      fetchProductMix(auth.tokenGw, todayStr, qbLocationId)
    ]);
    
    const netSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
    const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);

    const formattedHourly = [];
    for (let h = 0; h < 24; h++) {
      const hourStr = `${h.toString().padStart(2, '0')}:00`;
      const hourData = hourlyData.find(hd => hd.hour === hourStr);
      formattedHourly.push({
        hour: hourStr,
        sales: hourData?.sales || 0,
        checksCount: hourData?.checksCount || 0
      });
    }

    if (netSales > 0) {
      const { error: upsertError } = await supabase
        .from('sales_cache')
        .upsert({
          location_id: locationId,
          sale_date: todayStr,
          net_sales: netSales,
          guest_count: guestCount,
          pizza_count: Math.round(pizzaCount),
          hourly_data: formattedHourly,
          validation_status: 'valid',
          validation_attempts: 1,
          flagged_no_sales: false,
          fetched_at: new Date().toISOString()
        }, {
          onConflict: 'location_id,sale_date'
        });

      if (upsertError) {
        console.error(`${locationName}: Upsert error:`, upsertError);
        results.push({ locationId, name: locationName, status: 'upsert_error' });
      } else {
        console.log(`${locationName}: Updated - $${netSales.toFixed(2)}, ${guestCount} guests, ${pizzaCount} pizzas (from crusts)`);
        results.push({ locationId, name: locationName, status: 'success', salesUpdated: netSales, pizzaCount });
      }
    } else {
      console.log(`${locationName}: No sales data yet (${netSales}), skipping update to preserve existing data`);
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
// ACTION: sync-day (replaces sync-day-sales)
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

  // Authorize caller for this location
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
    .select('credentials')
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

  const credentials = integration.credentials as { username?: string; password?: string; location_id?: string };
  if (!credentials?.username || !credentials?.password) {
    return new Response(JSON.stringify({ error: 'Missing integration credentials' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const qbLocationId = credentials?.location_id || '';
  if (!qbLocationId) {
    return new Response(JSON.stringify({ error: 'Missing QuBeyond location_id in credentials' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[sales-service] sync-day: ${locationId} ${date}, QB location=${qbLocationId}`);

  const auth = await authenticateQuBeyond(credentials.username, credentials.password);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'QuBeyond authentication failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const [hourly, pizzaCount] = await Promise.all([
    fetchHourlySales(auth.tokenGw, date, qbLocationId),
    fetchProductMix(auth.tokenGw, date, qbLocationId)
  ]);

  const netSales = hourly.reduce((sum, h) => sum + h.sales, 0);
  const guestCount = hourly.reduce((sum, h) => sum + h.checksCount, 0);

  const formattedHourly: { hour: string; sales: number; checksCount: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const hourStr = `${h.toString().padStart(2, '0')}:00`;
    const hourData = hourly.find(hd => hd.hour === hourStr);
    formattedHourly.push({
      hour: hourStr,
      sales: hourData?.sales || 0,
      checksCount: hourData?.checksCount || 0,
    });
  }

  if (netSales <= 0) {
    console.log(`[sales-service] sync-day: ${locationId} ${date} netSales=0, not overwriting`);
    return new Response(
      JSON.stringify({ status: 'no_sales', locationId, date, netSales, guestCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const avgTicket = guestCount > 0 ? netSales / guestCount : null;

  const { error: upsertError } = await supabase
    .from('sales_cache')
    .upsert({
      location_id: locationId,
      sale_date: date,
      net_sales: netSales,
      guest_count: guestCount,
      pizza_count: Math.round(pizzaCount),
      avg_ticket: avgTicket,
      hourly_data: formattedHourly,
      validation_status: 'valid',
      validation_attempts: 1,
      flagged_no_sales: false,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'location_id,sale_date' });

  if (upsertError) {
    console.error('[sales-service] sync-day upsert failed:', upsertError);
    return new Response(JSON.stringify({ error: upsertError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[sales-service] sync-day OK: ${locationId} ${date} $${netSales.toFixed(2)} (${guestCount} guests, ${pizzaCount} pizzas)`);

  return new Response(
    JSON.stringify({ status: 'updated', locationId, date, netSales, guestCount, pizzaCount }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

// ============================================================================
// MAIN ROUTER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'sync-live';

    console.log(`[sales-service] Action: ${action}`);

    switch (action) {
      case 'sync-live':
        return await handleSyncLive(supabase);
      
      case 'sync-day':
        return await handleSyncDay(req, supabase);
      
      // Future actions: backfill, fetch-full
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
