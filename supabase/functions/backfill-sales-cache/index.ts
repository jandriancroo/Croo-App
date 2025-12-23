import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuBeyondCredentials {
  username: string;
  password: string;
  location_id?: string;
}

interface HourlyData {
  hour: string;
  sales: number;
  checksCount: number;
}

interface DaySalesData {
  dateStr: string;
  dayOfWeek: number;
  hourlyData: HourlyData[];
  netSales: number;
  guestCount: number;
  pizzaCount: number;
  validationStatus: 'valid' | 'pending' | 'flagged';
  validationAttempts: number;
}

// Major US holidays where stores are typically closed
const CLOSED_HOLIDAYS = [
  // Thanksgiving (4th Thursday of November) and Christmas
  // We check by month-day for Christmas, dynamically calculate Thanksgiving
];

function isKnownClosedHoliday(dateStr: string): boolean {
  const date = new Date(dateStr + 'T12:00:00');
  const month = date.getMonth() + 1; // 1-based
  const day = date.getDate();
  const dayOfWeek = date.getDay();
  
  // Christmas
  if (month === 12 && day === 25) return true;
  
  // Thanksgiving (4th Thursday of November)
  if (month === 11 && dayOfWeek === 4) {
    // Find which Thursday this is
    const firstOfMonth = new Date(date.getFullYear(), 10, 1);
    const firstThursday = (4 - firstOfMonth.getDay() + 7) % 7 + 1;
    const fourthThursday = firstThursday + 21;
    if (day === fourthThursday) return true;
  }
  
  return false;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = atob(base64);
  return JSON.parse(jsonPayload);
}

// Generate deterministic seeded random factor between -3% and +2%
function getSeededRandomFactor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const normalized = Math.abs(hash % 1000) / 1000;
  return 0.97 + (normalized * 0.05);
}

// Get same weekday in same week of year from last year
function getYoYComparisonDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = date.getDay();
  
  // Get ISO week number for current date
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  
  // Find the same week of last year
  const lastYear = date.getFullYear() - 1;
  const startOfLastYear = new Date(lastYear, 0, 1);
  
  // Find first day of that week in last year
  const daysToAdd = (weekNumber - 1) * 7 - startOfLastYear.getDay();
  const weekStart = new Date(lastYear, 0, 1 + daysToAdd);
  
  // Add days to get to the same day of week
  weekStart.setDate(weekStart.getDate() + dayOfWeek);
  
  const year = weekStart.getFullYear();
  const month = String(weekStart.getMonth() + 1).padStart(2, '0');
  const day = String(weekStart.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function authenticateQuBeyond(username: string, password: string): Promise<{ tokenGw: string; qbLocationId: string } | null> {
  console.log('[BACKFILL] Starting QuBeyond authentication...');
  
  const loginPayload = {
    payload: { username, password, captchaToken: '' }
  };
  
  const loginResponse = await fetch('https://admin.qubeyond.com/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://admin.qubeyond.com',
      'Referer': 'https://admin.qubeyond.com/login',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify(loginPayload),
  });

  if (!loginResponse.ok) {
    console.error('[BACKFILL] Authentication failed:', loginResponse.status);
    return null;
  }

  const loginData = await loginResponse.json();
  if (!loginData.token) {
    console.error('[BACKFILL] No token in login response');
    return null;
  }

  const jwtPayload = decodeJwtPayload(loginData.token);
  const tokenGw = jwtPayload.tokenGw as string;
  if (!tokenGw) {
    console.error('[BACKFILL] No tokenGw found in JWT payload');
    return null;
  }

  let qbLocationId = (jwtPayload.locationId || jwtPayload.location_id || 
                     jwtPayload.storeId || jwtPayload.store_id ||
                     jwtPayload.singleLocation || jwtPayload.defaultLocation) as string || '';
  
  if (!qbLocationId && jwtPayload.user) {
    const user = jwtPayload.user as Record<string, unknown>;
    qbLocationId = (user.locationId || user.storeId || user.defaultLocation) as string || '';
  }
  
  console.log(`[BACKFILL] Authenticated successfully, location ID: ${qbLocationId}`);
  return { tokenGw, qbLocationId };
}

async function fetchHourlySales(
  tokenGw: string, 
  dateStr: string,
  qbLocationId: string
): Promise<HourlyData[]> {
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

  if (!response.ok) return [];

  const data = await response.json();
  const hourlyData: HourlyData[] = [];

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

// Fetch a single day's data with retry logic
async function fetchDayData(
  tokenGw: string,
  qbLocationId: string,
  dateStr: string,
  pizzaSalesPercentage: number = 80,
  averagePizzaPrice: number = 10.50,
  maxRetries: number = 3
): Promise<DaySalesData> {
  const date = new Date(dateStr + 'T12:00:00');
  let attempts = 0;
  let lastResult: DaySalesData | null = null;
  
  while (attempts < maxRetries) {
    attempts++;
    
    const hourlyData = await fetchHourlySales(tokenGw, dateStr, qbLocationId);
    
    const netSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
    const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
    
    // Calculate pizza count using revenue-based estimation
    const pizzaRevenue = netSales * (pizzaSalesPercentage / 100);
    // Round to nearest half pizza
    const rawPizzaCount = pizzaRevenue / averagePizzaPrice;
    const pizzaCount = Math.round(rawPizzaCount * 2) / 2;
    
    lastResult = {
      dateStr,
      dayOfWeek: date.getDay(),
      hourlyData,
      netSales,
      guestCount,
      pizzaCount,
      validationStatus: 'pending',
      validationAttempts: attempts
    };
    
    // If we got sales, it's valid
    if (netSales > 0) {
      lastResult.validationStatus = 'valid';
      return lastResult;
    }
    
    // Known holiday - valid zero
    if (isKnownClosedHoliday(dateStr)) {
      lastResult.validationStatus = 'valid';
      return lastResult;
    }
    
    // Wait before retry
    if (attempts < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // After max retries, flag if still zero
  if (lastResult && lastResult.netSales === 0 && !isKnownClosedHoliday(dateStr)) {
    lastResult.validationStatus = 'flagged';
  }
  
  return lastResult!;
}

function getBackfillDates(daysBack: number = 365): string[] {
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
  
  return dates;
}

// Calculate weekly aggregates (Monday-Sunday weeks)
function calculateWeeklyAggregates(
  allData: DaySalesData[],
  locationId: string
): { period_start: string; period_end: string; net_sales: number; guest_count: number; pizza_count: number; days_with_sales: number }[] {
  const weeklyMap = new Map<string, { start: Date; end: Date; sales: number; guests: number; pizzas: number; daysWithSales: number }>();
  
  for (const day of allData) {
    const date = new Date(day.dateStr + 'T12:00:00');
    // Get start of week (Monday) - getDay() returns 0 for Sunday, so we need to adjust
    const dayOfWeek = date.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday goes back 6 days, other days go back to Monday
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - daysToSubtract);
    const weekKey = weekStart.toISOString().split('T')[0];
    
    // Week ends on Sunday (6 days after Monday)
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    const existing = weeklyMap.get(weekKey) || { start: weekStart, end: weekEnd, sales: 0, guests: 0, pizzas: 0, daysWithSales: 0 };
    existing.sales += day.netSales;
    existing.guests += day.guestCount;
    existing.pizzas += day.pizzaCount;
    if (day.netSales > 0) existing.daysWithSales++;
    weeklyMap.set(weekKey, existing);
  }
  
  return Array.from(weeklyMap.entries()).map(([key, val]) => ({
    period_start: key,
    period_end: val.end.toISOString().split('T')[0],
    net_sales: val.sales,
    guest_count: val.guests,
    pizza_count: val.pizzas,
    days_with_sales: val.daysWithSales
  }));
}

// Calculate monthly aggregates
function calculateMonthlyAggregates(
  allData: DaySalesData[],
  locationId: string
): { period_start: string; period_end: string; net_sales: number; guest_count: number; pizza_count: number; days_with_sales: number }[] {
  const monthlyMap = new Map<string, { start: Date; end: Date; sales: number; guests: number; pizzas: number; daysWithSales: number }>();
  
  for (const day of allData) {
    const date = new Date(day.dateStr + 'T12:00:00');
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthKey = monthStart.toISOString().split('T')[0];
    
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    
    const existing = monthlyMap.get(monthKey) || { start: monthStart, end: monthEnd, sales: 0, guests: 0, pizzas: 0, daysWithSales: 0 };
    existing.sales += day.netSales;
    existing.guests += day.guestCount;
    existing.pizzas += day.pizzaCount;
    if (day.netSales > 0) existing.daysWithSales++;
    monthlyMap.set(monthKey, existing);
  }
  
  return Array.from(monthlyMap.entries()).map(([key, val]) => ({
    period_start: key,
    period_end: val.end.toISOString().split('T')[0],
    net_sales: val.sales,
    guest_count: val.guests,
    pizza_count: val.pizzas,
    days_with_sales: val.daysWithSales
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { locationId, integrationId } = await req.json();
    
    if (!locationId || !integrationId) {
      return new Response(
        JSON.stringify({ error: 'Missing locationId or integrationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[BACKFILL] Starting full 365-day backfill for location ${locationId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get integration credentials
    const { data: integration, error: intError } = await supabase
      .from('location_integrations')
      .select('credentials')
      .eq('id', integrationId)
      .single();

    if (intError || !integration) {
      console.error('[BACKFILL] Failed to get integration:', intError);
      return new Response(
        JSON.stringify({ error: 'Integration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials = integration.credentials as QuBeyondCredentials;

    // Update status to in_progress
    await supabase
      .from('location_integrations')
      .update({
        backfill_status: 'in_progress',
        backfill_started_at: new Date().toISOString(),
        backfill_error: null,
        backfill_days_completed: 0
      })
      .eq('id', integrationId);

    // Authenticate with QuBeyond
    const auth = await authenticateQuBeyond(credentials.username, credentials.password);
    if (!auth) {
      await supabase
        .from('location_integrations')
        .update({ backfill_status: 'failed', backfill_error: 'Authentication failed' })
        .eq('id', integrationId);
      
      return new Response(
        JSON.stringify({ error: 'QuBeyond authentication failed' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const qbLocationId = credentials.location_id || auth.qbLocationId;
    const dates = getBackfillDates(365);
    
    // Fetch pizza estimation settings
    const { data: locationSettings } = await supabase
      .from('location_settings')
      .select('pizza_sales_percentage, average_pizza_price')
      .eq('location_id', locationId)
      .single();
    
    const pizzaSalesPercentage = locationSettings?.pizza_sales_percentage ?? 80;
    const averagePizzaPrice = locationSettings?.average_pizza_price ?? 10.50;
    
    console.log(`[BACKFILL] Will fetch ${dates.length} days of data with pizza estimation: ${pizzaSalesPercentage}% @ $${averagePizzaPrice}`);

    // PHASE 1: Fetch all data with retry logic
    const allRawData: DaySalesData[] = [];
    const BATCH_SIZE = 5; // Smaller batches for more reliable fetching
    let daysCompleted = 0;
    let daysWithSales = 0;

    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(
        batch.map(dateStr => fetchDayData(auth.tokenGw, qbLocationId, dateStr, pizzaSalesPercentage, averagePizzaPrice, 3))
      );

      for (const result of batchResults) {
        if (result) {
          allRawData.push(result);
          if (result.netSales > 0) daysWithSales++;
        }
      }

      daysCompleted += batch.length;
      
      await supabase
        .from('location_integrations')
        .update({ 
          backfill_days_completed: daysCompleted,
          backfill_error: `Fetching: ${daysWithSales}/${daysCompleted} days with sales`
        })
        .eq('id', integrationId);
      
      console.log(`[BACKFILL] Progress: ${daysCompleted}/${dates.length} days (${daysWithSales} with sales)`);
      
      if (i + BATCH_SIZE < dates.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`[BACKFILL] Fetched ${allRawData.length} days (${daysWithSales} with sales), building YoY references...`);

    // Sort by date (oldest first)
    allRawData.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    // Create a lookup map for YoY
    const dataByDate = new Map<string, DaySalesData>();
    for (const d of allRawData) {
      dataByDate.set(d.dateStr, d);
    }

    // PHASE 2: Save to database with YoY references
    const cacheRecords = [];
    
    for (const dayData of allRawData) {
      // Get YoY comparison date
      const yoyDateStr = getYoYComparisonDate(dayData.dateStr);
      const yoyData = dataByDate.get(yoyDateStr);
      
      const avgTicket = dayData.guestCount > 0 ? dayData.netSales / dayData.guestCount : null;
      
      cacheRecords.push({
        location_id: locationId,
        sale_date: dayData.dateStr,
        net_sales: dayData.netSales,
        guest_count: dayData.guestCount,
        pizza_count: dayData.pizzaCount,
        avg_ticket: avgTicket,
        hourly_data: dayData.hourlyData,
        projected_sales: 0, // Will be calculated on-demand with new formula
        fetched_at: new Date().toISOString(),
        validation_status: dayData.validationStatus,
        validation_attempts: dayData.validationAttempts,
        flagged_no_sales: dayData.validationStatus === 'flagged',
        yoy_sale_date: yoyData ? yoyDateStr : null,
        yoy_net_sales: yoyData?.netSales || null,
        yoy_hourly_data: yoyData?.hourlyData || null
      });
    }

    // Save daily data in batches
    const SAVE_BATCH_SIZE = 50;
    for (let i = 0; i < cacheRecords.length; i += SAVE_BATCH_SIZE) {
      const batch = cacheRecords.slice(i, i + SAVE_BATCH_SIZE);
      
      const { error: upsertError } = await supabase
        .from('sales_cache')
        .upsert(batch, { onConflict: 'location_id,sale_date' });
      
      if (upsertError) {
        console.error('[BACKFILL] Upsert error:', upsertError);
      }
    }

    // PHASE 3: Calculate and save weekly/monthly aggregates
    console.log('[BACKFILL] Calculating weekly and monthly aggregates...');
    
    const weeklyAggregates = calculateWeeklyAggregates(allRawData, locationId);
    const monthlyAggregates = calculateMonthlyAggregates(allRawData, locationId);
    
    // Save weekly aggregates
    for (const week of weeklyAggregates) {
      const avgDaily = week.days_with_sales > 0 ? week.net_sales / week.days_with_sales : null;
      await supabase
        .from('sales_aggregates')
        .upsert({
          location_id: locationId,
          aggregate_type: 'weekly',
          period_start: week.period_start,
          period_end: week.period_end,
          net_sales: week.net_sales,
          guest_count: week.guest_count,
          pizza_count: week.pizza_count,
          avg_daily_sales: avgDaily,
          days_with_sales: week.days_with_sales
        }, { onConflict: 'location_id,aggregate_type,period_start' });
    }
    
    // Save monthly aggregates
    for (const month of monthlyAggregates) {
      const avgDaily = month.days_with_sales > 0 ? month.net_sales / month.days_with_sales : null;
      await supabase
        .from('sales_aggregates')
        .upsert({
          location_id: locationId,
          aggregate_type: 'monthly',
          period_start: month.period_start,
          period_end: month.period_end,
          net_sales: month.net_sales,
          guest_count: month.guest_count,
          pizza_count: month.pizza_count,
          avg_daily_sales: avgDaily,
          days_with_sales: month.days_with_sales
        }, { onConflict: 'location_id,aggregate_type,period_start' });
    }

    // Mark as complete
    const flaggedCount = cacheRecords.filter(r => r.flagged_no_sales).length;
    await supabase
      .from('location_integrations')
      .update({
        backfill_status: 'completed',
        backfill_completed_at: new Date().toISOString(),
        backfill_days_completed: dates.length,
        backfill_error: flaggedCount > 0 ? `${flaggedCount} days flagged with no sales` : null
      })
      .eq('id', integrationId);

    console.log(`[BACKFILL] Completed! ${daysWithSales}/${dates.length} days with sales, ${flaggedCount} flagged`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        daysProcessed: allRawData.length,
        daysWithSales,
        flaggedDays: flaggedCount,
        weeklyPeriods: weeklyAggregates.length,
        monthlyPeriods: monthlyAggregates.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[BACKFILL] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
