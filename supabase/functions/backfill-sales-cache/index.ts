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

interface LaborData {
  laborPercent: number;
  laborCost: number;
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
}

// Major US holidays where stores are typically closed
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

// Returns just the tokenGw - we use the location_id from our database credentials
async function authenticateQuBeyond(username: string, password: string): Promise<{ tokenGw: string } | null> {
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

  console.log(`[BACKFILL] Authenticated successfully`);
  return { tokenGw };
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

// Fetch product mix to get actual crust count for a single date
async function fetchProductMixCrustCount(
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

    return crustCount;
  } catch (error) {
    return 0;
  }
}

// Fetch labor data from QuBeyond Real Time Summary
async function fetchLaborData(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<LaborData | null> {
  try {
    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/real-time-summary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': tokenGw,
        'Origin': 'https://admin.qubeyond.com',
        'Referer': 'https://admin.qubeyond.com/',
      },
      body: JSON.stringify({
        fields: [{ fieldName: "metric" }, { fieldName: "total" }],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: "custom" },
          location: { operationalUnits: [parseInt(qbLocationId)] }
        },
        params: { 
          sectionId: "real-time-summary", 
          pageNumber: 1, 
          pageSize: 25, 
          totalRecords: null, 
          sort: null, 
          showTotals: true 
        }
      }),
    });

    if (!response.ok) {
      console.error(`[LABOR-BACKFILL] Fetch failed for ${dateStr}:`, response.status);
      return null;
    }

    const data = await response.json();
    
    let laborPercent = 0;
    let laborCost = 0;
    let hoursWorked = 0;
    let regularHours = 0;
    let overtimeHours = 0;
    
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        const metric = (item.metric || '').toLowerCase();
        const total = parseFloat(String(item.total || '0').replace(/[$,%]/g, '')) || 0;
        
        if (metric.includes('total labor %') || metric === 'total labor %') {
          laborPercent = total;
        } else if (metric.includes('labor cost') || metric === 'labor cost') {
          laborCost = total;
        } else if (metric === 'hours worked') {
          hoursWorked = total;
        } else if (metric === 'regular hours') {
          regularHours = total;
        } else if (metric === 'overtime hours') {
          overtimeHours = total;
        }
      }
    }
    
    console.log(`[LABOR-BACKFILL] ${dateStr}: $${laborCost.toFixed(2)} / ${hoursWorked.toFixed(1)}h (${laborPercent.toFixed(1)}%)`);
    return { laborPercent, laborCost, hoursWorked, regularHours, overtimeHours };
  } catch (error) {
    console.error(`[LABOR-BACKFILL] Error fetching labor for ${dateStr}:`, error);
    return null;
  }
}

// Fetch a single day's data with retry logic - now fetches actual crust count
async function fetchDayData(
  tokenGw: string,
  qbLocationId: string,
  dateStr: string,
  maxRetries: number = 3
): Promise<DaySalesData> {
  const date = new Date(dateStr + 'T12:00:00');
  let attempts = 0;
  let lastResult: DaySalesData | null = null;
  
  while (attempts < maxRetries) {
    attempts++;
    
    // Fetch hourly sales and product mix in parallel
    const [hourlyData, pizzaCount] = await Promise.all([
      fetchHourlySales(tokenGw, dateStr, qbLocationId),
      fetchProductMixCrustCount(tokenGw, dateStr, qbLocationId)
    ]);
    
    const netSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
    const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
    
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
    const { locationId, integrationId, days, laborOnly, laborDates } = await req.json();
    
    if (!locationId || !integrationId) {
      return new Response(
        JSON.stringify({ error: 'Missing locationId or integrationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      return new Response(
        JSON.stringify({ error: 'Integration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials = integration.credentials as QuBeyondCredentials;
    const qbLocationId = credentials.location_id || '';
    
    // LABOR-ONLY BACKFILL MODE
    if (laborOnly && laborDates && Array.isArray(laborDates)) {
      console.log(`[LABOR-BACKFILL] Starting labor-only backfill for ${laborDates.length} dates`);
      
      const auth = await authenticateQuBeyond(credentials.username, credentials.password);
      if (!auth) {
        return new Response(
          JSON.stringify({ error: 'QuBeyond authentication failed' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let successCount = 0;
      for (const dateStr of laborDates) {
        const laborData = await fetchLaborData(auth.tokenGw, dateStr, qbLocationId);
        if (laborData && laborData.laborCost > 0) {
          await supabase
            .from('sales_cache')
            .upsert({
              location_id: locationId,
              sale_date: dateStr,
              labor_cost: laborData.laborCost,
              labor_hours: laborData.hoursWorked,
              regular_hours: laborData.regularHours,
              overtime_hours: laborData.overtimeHours,
              fetched_at: new Date().toISOString()
            }, { onConflict: 'location_id,sale_date' });
          successCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      return new Response(
        JSON.stringify({ success: true, laborDatesProcessed: successCount }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const daysToBackfill = days || 365;
    console.log(`[BACKFILL] Starting ${daysToBackfill}-day backfill for location ${locationId} with actual crust counts`);

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

    // Authenticate with QuBeyond (reuse credentials from above)
    const authForBackfill = await authenticateQuBeyond(credentials.username, credentials.password);
    if (!authForBackfill) {
      await supabase
        .from('location_integrations')
        .update({ backfill_status: 'failed', backfill_error: 'Authentication failed' })
        .eq('id', integrationId);
      
      return new Response(
        JSON.stringify({ error: 'QuBeyond authentication failed' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use the QuBeyond location_id from our database credentials (not from JWT)
    if (!qbLocationId) {
      await supabase
        .from('location_integrations')
        .update({ backfill_status: 'failed', backfill_error: 'Missing QuBeyond location_id in credentials' })
        .eq('id', integrationId);
      
      return new Response(
        JSON.stringify({ error: 'Missing QuBeyond location_id in credentials' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[BACKFILL] Using QuBeyond location_id=${qbLocationId} from DB credentials`);
    const dates = getBackfillDates(daysToBackfill);
    
    console.log(`[BACKFILL] Will fetch ${dates.length} days of data with actual crust counts from product mix`);

    // PHASE 1: Fetch all data with retry logic
    const allRawData: DaySalesData[] = [];
    const BATCH_SIZE = 3; // Smaller batches since we're making 2 API calls per day now
    let daysCompleted = 0;
    let daysWithSales = 0;

    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(
        batch.map(dateStr => fetchDayData(authForBackfill.tokenGw, qbLocationId, dateStr, 3))
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
        await new Promise(resolve => setTimeout(resolve, 300));
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
        guest_count: Math.round(dayData.guestCount),
        pizza_count: Math.round(dayData.pizzaCount), // Now from actual crust count
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

    console.log(`[BACKFILL] Completed! ${daysWithSales}/${dates.length} days with sales, ${flaggedCount} flagged. All pizza counts from actual crusts.`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        daysProcessed: allRawData.length,
        daysWithSales,
        flaggedDays: flaggedCount,
        weeklyPeriods: weeklyAggregates.length,
        monthlyPeriods: monthlyAggregates.length,
        pizzaCountSource: 'actual_crusts'
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
