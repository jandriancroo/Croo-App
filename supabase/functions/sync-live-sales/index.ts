import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LocationToSync {
  locationId: string;
  locationName: string;
  integrationId: string;
  credentials: {
    username: string;
    password: string;
  };
  timezone: string;
  openTime: string | null;
  closeTime: string | null;
}

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
  // Default hours if not set: 10:00 - 22:00
  const openStr = openTime || '10:00';
  const closeStr = closeTime || '22:00';
  
  const currentMinutesTotal = currentHours * 60 + currentMinutes;
  const openMinutes = parseTimeToMinutes(openStr);
  const closeMinutes = parseTimeToMinutes(closeStr) + 10; // Add 10 min buffer after close
  
  return currentMinutesTotal >= openMinutes && currentMinutesTotal <= closeMinutes;
}

async function authenticateQuBeyond(username: string, password: string): Promise<{ tokenGw: string; qbLocationId: string } | null> {
  console.log(`Authenticating with QuBeyond for ${username}...`);
  
  try {
    const authResponse = await fetch('https://api.qubeyond.com/api/v2.0/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        rememberMe: false,
        siteCode: null
      }),
    });

    if (!authResponse.ok) {
      console.error('Auth failed:', authResponse.status);
      return null;
    }

    const authData = await authResponse.json();
    const tokenApi = authData?.token;
    if (!tokenApi) {
      console.error('No token in auth response');
      return null;
    }

    // Exchange for gateway token
    const gwResponse = await fetch('https://api.qubeyond.com/api/v2.0/auth/gw-token', {
      method: 'GET',
      headers: { 'Authorization': tokenApi },
    });

    if (!gwResponse.ok) {
      console.error('GW token fetch failed:', gwResponse.status);
      return null;
    }

    const gwData = await gwResponse.json();
    const tokenGw = gwData?.accessToken;
    if (!tokenGw) {
      console.error('No accessToken in GW response');
      return null;
    }

    // Decode to get location ID
    const decoded = decodeJwtPayload(tokenGw);
    const qbLocationId = String(decoded?.loc || decoded?.locations?.[0] || '');
    
    console.log(`Authenticated successfully, location ID: ${qbLocationId}`);
    return { tokenGw, qbLocationId };
  } catch (error) {
    console.error('Authentication error:', error);
    return null;
  }
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

  const convertTo24Hour = (time12h: string): string => {
    const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return time12h;
    let hours = parseInt(match[1]);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    if (period === 'AM') { if (hours === 12) hours = 0; }
    else { if (hours !== 12) hours += 12; }
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  };

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
          { fieldName: "category" }, { fieldName: "name" }, { fieldName: "itemCount" },
          { fieldName: "netSales" }, { fieldName: "netSalesPercentage" },
          { fieldName: "itemCountPercentage" }
        ],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: "custom" },
          singleLocation: parseInt(qbLocationId),
          location: { operationalUnits: [parseInt(qbLocationId)] }
        },
        params: { sectionId: "main", pageNumber: 1, pageSize: 1000, totalRecords: null, sort: null, showTotals: true }
      }),
    });

    if (!response.ok) return 0;

    const data = await response.json();
    let pizzaCount = 0;
    
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        const category = String(item.category || '').toLowerCase();
        const name = String(item.name || '').toLowerCase();
        if (category.includes('pizza') || name.includes('pizza')) {
          pizzaCount += parseInt(String(item.itemCount || '0').replace(/,/g, '')) || 0;
        }
      }
    }
    
    return pizzaCount;
  } catch (error) {
    console.error('Product mix fetch error:', error);
    return 0;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting live sales sync...');

    // Get all locations with active QU integrations
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

    // Fetch location settings separately
    const locationIds = integrations?.map(i => i.location_id) || [];
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

    // Also fetch location_hours for business hours (reuse locationIds from above)
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

    const results: { locationId: string; name: string; status: string; salesUpdated?: number }[] = [];

    for (const integration of integrations) {
      const locationId = integration.location_id;
      const locationName = (integration.locations as any)?.name || 'Unknown';
      const credentials = integration.credentials as { username?: string; password?: string };
      const settings = settingsByLocation[locationId];
      const timezone = settings?.timezone || 'America/Los_Angeles';

      // Check if within business hours
      const currentTime = getCurrentTimeInTimezone(timezone);
      const today = new Date();
      const tzToday = new Date(today.toLocaleString('en-US', { timeZone: timezone }));
      const dayOfWeek = tzToday.getDay(); // 0 = Sunday

      let openTime = settings?.hours_open || '10:00';
      let closeTime = settings?.hours_close || '22:00';

      // Check location_hours for today
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

      console.log(`${locationName}: Syncing live sales...`);

      // Authenticate
      const auth = await authenticateQuBeyond(credentials.username, credentials.password);
      if (!auth) {
        console.error(`${locationName}: Authentication failed`);
        results.push({ locationId, name: locationName, status: 'auth_failed' });
        continue;
      }

      // Fetch today's hourly sales
      const todayStr = getDateStringForTimezone(new Date(), timezone);
      const hourlyData = await fetchHourlySales(auth.tokenGw, todayStr, auth.qbLocationId);
      
      // Calculate totals
      const netSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
      const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
      
      // Fetch pizza count
      const pizzaCount = await fetchProductMix(auth.tokenGw, todayStr, auth.qbLocationId);

      // Format hourly data for storage
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

      // Upsert to sales_cache
      const { error: upsertError } = await supabase
        .from('sales_cache')
        .upsert({
          location_id: locationId,
          sale_date: todayStr,
          net_sales: netSales,
          guest_count: guestCount,
          pizza_count: pizzaCount,
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
        console.log(`${locationName}: Updated - $${netSales.toFixed(2)}, ${guestCount} guests`);
        results.push({ locationId, name: locationName, status: 'success', salesUpdated: netSales });
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

  } catch (error: unknown) {
    console.error('Sync error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
