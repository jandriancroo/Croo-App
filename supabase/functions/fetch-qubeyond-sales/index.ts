import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuBeyondCredentials {
  username: string;
  password: string;
  cid: string;
  sid: string;
  location_id: string;
}

// Decode JWT payload without verification
function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = atob(base64);
  return JSON.parse(jsonPayload);
}

// Get date string in YYYY-MM-DD format for a timezone
function getDateStringForTimezone(date: Date, timezone: string): string {
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const year = tzDate.getFullYear();
  const month = String(tzDate.getMonth() + 1).padStart(2, '0');
  const day = String(tzDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get start of week (Monday)
function getWeekStartDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

// Get start of month
function getMonthStartDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  date.setDate(1);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

// Generate date range array
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  const current = new Date(start);
  
  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Adjust date by days
function adjustDate(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

// Fetch sales for dates
async function fetchSalesForDates(
  tokenGw: string, 
  dates: string[], 
  qbLocationId: string,
  periodType: string
): Promise<{ total: number; guestCount: number }> {
  console.log(`Fetching ${periodType} sales for ${dates.length} days`);
  
  const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/sales', {
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
        date: { from: null, to: null, values: dates, type: "custom" },
        singleLocation: parseInt(qbLocationId)
      },
      params: { sectionId: "overview", pageNumber: 1, pageSize: 25, totalRecords: null, sort: null, showTotals: true }
    }),
  });

  if (!response.ok) {
    console.error(`${periodType} fetch failed:`, response.status);
    return { total: 0, guestCount: 0 };
  }

  const data = await response.json();
  let total = 0, guestCount = 0;
  
  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item.metricTypeId === 1 || item.metric === 'Net Sales') {
        total = parseFloat(String(item.total || '0').replace(/,/g, '')) || 0;
      }
      if (item.metricTypeId === 2 || item.metric === 'Check Count' || item.metric === 'Guest Count') {
        guestCount = parseInt(String(item.total || '0').replace(/,/g, '')) || 0;
      }
    }
  }
  return { total, guestCount };
}

// Fetch daily breakdown
async function fetchDailyBreakdown(
  tokenGw: string, 
  dates: string[],
  qbLocationId: string
): Promise<{ date: string; sales: number; guestCount: number }[]> {
  const dailyData: { date: string; sales: number; guestCount: number }[] = [];
  const batchSize = 7;
  
  for (let i = 0; i < dates.length; i += batchSize) {
    const batch = dates.slice(i, i + batchSize);
    const batchPromises = batch.map(async (dateStr) => {
      const result = await fetchSalesForDates(tokenGw, [dateStr], qbLocationId, `day-${dateStr}`);
      return { date: dateStr, sales: result.total, guestCount: result.guestCount };
    });
    const batchResults = await Promise.all(batchPromises);
    dailyData.push(...batchResults);
  }
  return dailyData.sort((a, b) => a.date.localeCompare(b.date));
}

// Fetch hourly sales
async function fetchHourlySales(
  tokenGw: string, 
  dateStr: string,
  qbLocationId: string
): Promise<{ hour: string; sales: number; checksCount: number }[]> {
  const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/hourly-sales/sections/main', {
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
        { fieldName: "hour" }, { fieldName: "checksCount" }, { fieldName: "netSales" },
        { fieldName: "averageCheck" }, { fieldName: "discount" }, { fieldName: "serviceCharge" },
        { fieldName: "tax" }, { fieldName: "netSalesPercentage" }
      ],
      filters: {
        date: { from: null, to: null, values: [dateStr], type: "today" },
        singleLocation: parseInt(qbLocationId)
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

// Fetch product mix
async function fetchProductMix(
  tokenGw: string, 
  dates: string[],
  qbLocationId: string
): Promise<{ name: string; quantity: number; sales: number; category: string }[]> {
  console.log(`Fetching product mix for ${dates.length} days`);
  
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
        { fieldName: "productName" },
        { fieldName: "categoryName" },
        { fieldName: "quantity" },
        { fieldName: "netSales" },
        { fieldName: "netSalesPercentage" }
      ],
      filters: {
        date: { from: null, to: null, values: dates, type: "custom" },
        singleLocation: parseInt(qbLocationId)
      },
      params: { sectionId: "main", pageNumber: 1, pageSize: 100, totalRecords: null, sort: { field: "netSales", dir: "desc" }, showTotals: true }
    }),
  });

  if (!response.ok) {
    console.error('Product mix fetch failed:', response.status);
    return [];
  }

  const data = await response.json();
  const products: { name: string; quantity: number; sales: number; category: string }[] = [];
  
  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      const name = item.productName || '';
      const category = item.categoryName || '';
      const quantity = parseInt(String(item.quantity || '0').replace(/,/g, '')) || 0;
      const sales = parseFloat(String(item.netSales || '0').replace(/[$,]/g, '')) || 0;
      if (name && quantity > 0) {
        products.push({ name, quantity, sales, category });
      }
    }
  }
  
  console.log(`Found ${products.length} products`);
  return products.slice(0, 50); // Top 50 products
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { locationId, targetDate, testCredentials } = await req.json().catch(() => ({}));
    
    let credentials: QuBeyondCredentials;
    
    if (testCredentials) {
      // Testing mode - use provided credentials
      credentials = testCredentials;
    } else if (locationId) {
      // Fetch credentials from database
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const { data: integration, error } = await supabase
        .from('location_integrations')
        .select('credentials, is_active')
        .eq('location_id', locationId)
        .eq('integration_type', 'qubeyond')
        .single();
      
      if (error || !integration) {
        console.log('No integration found for location:', locationId);
        return new Response(JSON.stringify({ error: 'No QuBeyond integration configured', authenticated: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (!integration.is_active) {
        return new Response(JSON.stringify({ error: 'QuBeyond integration is disabled', authenticated: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      credentials = integration.credentials as QuBeyondCredentials;
    } else {
      // Fallback to global secrets
      credentials = {
        username: Deno.env.get('QU_USERNAME') || '',
        password: Deno.env.get('QU_PASSWORD') || '',
        cid: Deno.env.get('QU_CID') || '',
        sid: Deno.env.get('QU_SID') || '',
        location_id: '5448'
      };
    }

    if (!credentials.username || !credentials.password) {
      throw new Error('QuBeyond credentials not configured');
    }

    console.log('Starting QuBeyond authentication with user:', credentials.username);

    // Login using the payload wrapper format (confirmed working)
    const loginPayload = {
      payload: {
        username: credentials.username,
        password: credentials.password,
        captchaToken: ''
      }
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
      const errorBody = await loginResponse.text();
      console.error('Login failed with status:', loginResponse.status);
      console.error('Login error body:', errorBody);
      
      // Check for rate limiting
      if (loginResponse.status === 429 || errorBody.toLowerCase().includes('rate') || errorBody.toLowerCase().includes('limit')) {
        throw new Error('Rate limited by QuBeyond API. Please try again in a few minutes.');
      }
      
      // Include more context in error
      throw new Error(`QuBeyond login failed (${loginResponse.status}): ${errorBody.substring(0, 200)}`);
    }

    const loginData = await loginResponse.json();
    if (!loginData.token) throw new Error('No token in login response');

    const jwtPayload = decodeJwtPayload(loginData.token);
    const tokenGw = jwtPayload.tokenGw;
    if (!tokenGw) throw new Error('No tokenGw found in JWT payload');

    console.log('Authentication successful');

    // If testing, just return success
    if (testCredentials) {
      return new Response(JSON.stringify({ authenticated: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const qbLocationId = credentials.location_id || '5448';
    
    // Determine target date (default to today in Pacific)
    const now = new Date();
    const todayStr = targetDate || getDateStringForTimezone(now, 'America/Los_Angeles');
    const weekStartStr = getWeekStartDate(todayStr);
    const monthStartStr = getMonthStartDate(todayStr);
    
    // Previous period dates for comparison
    const prevDayStr = adjustDate(todayStr, -7); // Same day last week
    const prevWeekStartStr = adjustDate(weekStartStr, -7);
    const prevWeekEndStr = adjustDate(todayStr, -7);
    const prevMonthDate = new Date(todayStr + 'T12:00:00');
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonthStartStr = getMonthStartDate(getDateStringForTimezone(prevMonthDate, 'America/Los_Angeles'));
    const prevMonthEndStr = getDateStringForTimezone(prevMonthDate, 'America/Los_Angeles');

    // Generate date arrays
    const weekDates = getDateRange(weekStartStr, todayStr);
    const monthDates = getDateRange(monthStartStr, todayStr);
    const prevWeekDates = getDateRange(prevWeekStartStr, prevWeekEndStr);
    const prevMonthDates = getDateRange(prevMonthStartStr, prevMonthEndStr);

    // Fetch all data in parallel
    const [
      dailySalesResult, 
      weeklySalesResult, 
      monthlySalesResult, 
      hourlyData, 
      weeklyBreakdown, 
      monthlyBreakdown,
      prevDaySalesResult,
      prevWeekSalesResult,
      prevMonthSalesResult,
      productMix
    ] = await Promise.all([
      fetchSalesForDates(tokenGw, [todayStr], qbLocationId, 'daily'),
      fetchSalesForDates(tokenGw, weekDates, qbLocationId, 'weekly'),
      fetchSalesForDates(tokenGw, monthDates, qbLocationId, 'monthly'),
      fetchHourlySales(tokenGw, todayStr, qbLocationId),
      fetchDailyBreakdown(tokenGw, weekDates, qbLocationId),
      fetchDailyBreakdown(tokenGw, monthDates, qbLocationId),
      fetchSalesForDates(tokenGw, [prevDayStr], qbLocationId, 'prevDay'),
      fetchSalesForDates(tokenGw, prevWeekDates, qbLocationId, 'prevWeek'),
      fetchSalesForDates(tokenGw, prevMonthDates, qbLocationId, 'prevMonth'),
      fetchProductMix(tokenGw, [todayStr], qbLocationId)
    ]);

    // Calculate metrics
    const dailyGuestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
    const weeklyGuestCount = weeklySalesResult.guestCount;
    const monthlyGuestCount = monthlySalesResult.guestCount;
    const avgTicket = dailyGuestCount > 0 ? dailySalesResult.total / dailyGuestCount : 0;

    const result = {
      daily: dailySalesResult.total,
      weekly: weeklySalesResult.total,
      monthly: monthlySalesResult.total,
      hourly: hourlyData,
      weeklyBreakdown,
      monthlyBreakdown,
      guestCount: {
        daily: dailyGuestCount,
        weekly: weeklyGuestCount,
        monthly: monthlyGuestCount
      },
      avgTicket,
      comparison: {
        prevDay: prevDaySalesResult.total,
        prevWeek: prevWeekSalesResult.total,
        prevMonth: prevMonthSalesResult.total
      },
      productMix,
      authenticated: true,
      timestamp: new Date().toISOString(),
      dateRange: {
        today: todayStr,
        weekStart: weekStartStr,
        monthStart: monthStartStr
      }
    };

    console.log('Returning sales data:', JSON.stringify({
      daily: result.daily,
      weekly: result.weekly,
      monthly: result.monthly,
      comparison: result.comparison,
      productMixCount: result.productMix.length
    }));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in fetch-qubeyond-sales:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage, authenticated: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});