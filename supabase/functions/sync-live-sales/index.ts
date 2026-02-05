import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
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

async function authenticateQuBeyond(username: string, password: string): Promise<string | null> {
  try {
    const response = await fetch('https://admin.qubeyond.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ payload: { username, password, captchaToken: '' } }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const token = data?.token;
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    return payload?.tokenGw || null;
  } catch {
    return null;
  }
}

async function fetchHourlySales(tokenGw: string, dateStr: string, qbLocationId: string) {
  const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/hourly-sales/sections/main', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': tokenGw,
    },
    body: JSON.stringify({
      fields: [{ fieldName: "hour" }, { fieldName: "checksCount" }, { fieldName: "netSales" }],
      filters: {
        date: { from: null, to: null, values: [dateStr], type: "custom" },
        singleLocation: parseInt(qbLocationId),
        location: { operationalUnits: [parseInt(qbLocationId)] }
      },
      params: { sectionId: "main", pageNumber: 1, pageSize: 25, totalRecords: null, sort: null, showTotals: true }
    }),
  });

  if (!response.ok) return [];

  const data = await response.json();
  const hourlyData: { hour: string; sales: number; checksCount: number }[] = [];

  const convertTo24Hour = (time12h: string): string => {
    const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return time12h;
    let hours = parseInt(match[1]);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    if (period === 'AM' && hours === 12) hours = 0;
    else if (period === 'PM' && hours !== 12) hours += 12;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all locations with active QU integrations
    const { data: integrations, error: intError } = await supabase
      .from('location_integrations')
      .select('id, location_id, credentials, locations!inner(id, name)')
      .eq('integration_type', 'qubeyond')
      .eq('is_active', true);

    if (intError || !integrations?.length) {
      return new Response(JSON.stringify({ message: intError?.message || 'No active integrations' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const locationIds = integrations.map(i => i.location_id);
    
    const [settingsRes, hoursRes] = await Promise.all([
      supabase.from('location_settings').select('location_id, timezone, hours_open, hours_close').in('location_id', locationIds),
      supabase.from('location_hours').select('location_id, day_of_week, open_time, close_time, is_closed').in('location_id', locationIds)
    ]);

    const settingsByLocation: Record<string, any> = {};
    for (const ls of settingsRes.data || []) {
      settingsByLocation[ls.location_id] = ls;
    }

    const hoursByLocation: Record<string, Record<number, any>> = {};
    for (const lh of hoursRes.data || []) {
      if (!hoursByLocation[lh.location_id]) hoursByLocation[lh.location_id] = {};
      hoursByLocation[lh.location_id][lh.day_of_week] = lh;
    }

    const results: any[] = [];

    for (const integration of integrations) {
      const locationId = integration.location_id;
      const locationName = (integration.locations as any)?.name || 'Unknown';
      const credentials = integration.credentials as any;
      const settings = settingsByLocation[locationId];
      const timezone = settings?.timezone || 'America/Los_Angeles';
      const qbLocationId = credentials?.location_id;

      if (!qbLocationId || !credentials?.username || !credentials?.password) {
        results.push({ locationId, name: locationName, status: 'missing_credentials' });
        continue;
      }

      // Check business hours
      const currentTime = getCurrentTimeInTimezone(timezone);
      const today = new Date();
      const tzToday = new Date(today.toLocaleString('en-US', { timeZone: timezone }));
      const dayOfWeek = tzToday.getDay();

      let openTime = settings?.hours_open || '10:00';
      let closeTime = settings?.hours_close || '22:00';

      const todayHours = hoursByLocation[locationId]?.[dayOfWeek];
      if (todayHours?.is_closed) {
        results.push({ locationId, name: locationName, status: 'closed_today' });
        continue;
      }
      if (todayHours) {
        openTime = todayHours.open_time || openTime;
        closeTime = todayHours.close_time || closeTime;
      }

      if (!isWithinBusinessHours(currentTime.hours, currentTime.minutes, openTime, closeTime)) {
        results.push({ locationId, name: locationName, status: 'outside_hours' });
        continue;
      }

      // Authenticate and fetch data
      const tokenGw = await authenticateQuBeyond(credentials.username, credentials.password);
      if (!tokenGw) {
        results.push({ locationId, name: locationName, status: 'auth_failed' });
        continue;
      }

      const todayStr = getDateStringForTimezone(new Date(), timezone);
      const hourlyData = await fetchHourlySales(tokenGw, todayStr, qbLocationId);
      
      const netSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
      const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);

      if (netSales > 0) {
        const formattedHourly = [];
        for (let h = 0; h < 24; h++) {
          const hourStr = `${h.toString().padStart(2, '0')}:00`;
          const hourData = hourlyData.find(hd => hd.hour === hourStr);
          formattedHourly.push({ hour: hourStr, sales: hourData?.sales || 0, checksCount: hourData?.checksCount || 0 });
        }

        await supabase.from('sales_cache').upsert({
          location_id: locationId,
          sale_date: todayStr,
          net_sales: netSales,
          guest_count: guestCount,
          hourly_data: formattedHourly,
          validation_status: 'valid',
          validation_attempts: 1,
          flagged_no_sales: false,
          fetched_at: new Date().toISOString()
        }, { onConflict: 'location_id,sale_date' });

        results.push({ locationId, name: locationName, status: 'success', salesUpdated: netSales });
      } else {
        results.push({ locationId, name: locationName, status: 'no_sales_yet' });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
