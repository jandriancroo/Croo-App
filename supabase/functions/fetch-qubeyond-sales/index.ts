import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decode JWT payload without verification (we just need to extract tokenGw)
function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = parts[1];
  // Base64url decode
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = atob(base64);
  return JSON.parse(jsonPayload);
}

// Get date string in YYYY-MM-DD format for Pacific timezone
function getPacificDateString(date: Date): string {
  const pacificDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const year = pacificDate.getFullYear();
  const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
  const day = String(pacificDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get start of week (Monday) in Pacific timezone
function getWeekStartDate(date: Date): string {
  const pacificDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const day = pacificDate.getDay();
  const diff = day === 0 ? 6 : day - 1; // Adjust for Monday start
  pacificDate.setDate(pacificDate.getDate() - diff);
  return getPacificDateString(pacificDate);
}

// Get start of month in Pacific timezone
function getMonthStartDate(date: Date): string {
  const pacificDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  pacificDate.setDate(1);
  return getPacificDateString(pacificDate);
}

// Generate array of date strings from start to end (inclusive)
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  
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

// Fetch sales data for specified dates using the working endpoint format
async function fetchSalesForDates(tokenGw: string, dates: string[], periodType: string): Promise<number> {
  console.log(`Fetching ${periodType} sales for ${dates.length} days: ${dates[0]} to ${dates[dates.length - 1]}`);
  
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
      fields: [
        { fieldName: "metric" },
        { fieldName: "total" }
      ],
      filters: {
        date: {
          from: null,
          to: null,
          values: dates,
          type: "custom"
        },
        singleLocation: 5448 // Jo Pizza location ID
      },
      params: {
        sectionId: "overview",
        pageNumber: 1,
        pageSize: 25,
        totalRecords: null,
        sort: null,
        showTotals: true
      }
    }),
  });

  if (!response.ok) {
    console.error(`${periodType} fetch failed:`, response.status);
    return 0;
  }

  const data = await response.json();
  console.log(`${periodType} response preview:`, JSON.stringify(data).substring(0, 300));
  
  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item.metricTypeId === 1 || item.metric === 'Net Sales') {
        const total = parseFloat(String(item.total || '0').replace(/,/g, '')) || 0;
        console.log(`${periodType} Net Sales found: $${total}`);
        return total;
      }
    }
  }
  
  return 0;
}

// Fetch today's sales using the hourly endpoint (which works correctly)
async function fetchTodaySales(tokenGw: string, dateStr: string): Promise<{ daily: number; hourly: { hour: string; sales: number }[] }> {
  console.log(`Fetching today's sales for: ${dateStr}`);
  
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
      fields: [
        { fieldName: "hour" },
        { fieldName: "netSales" }
      ],
      filters: {
        date: {
          from: null,
          to: null,
          values: [dateStr],
          type: "today"
        },
        singleLocation: 5448
      },
      params: {
        sectionId: "hourly",
        pageNumber: 1,
        pageSize: 24,
        totalRecords: null,
        sort: null,
        showTotals: true
      }
    }),
  });

  if (!response.ok) {
    console.error('Today sales fetch failed:', response.status);
    return { daily: 0, hourly: [] };
  }

  const data = await response.json();
  console.log('Today sales response items count:', data.items?.length);
  
  // Log first few items to understand structure
  if (data.items && data.items.length > 0) {
    console.log('Sample items:', JSON.stringify(data.items.slice(0, 3)));
  }
  
  let dailyTotal = 0;
  const hourlyData: { hour: string; sales: number }[] = [];
  
  if (data.items && Array.isArray(data.items)) {
    // First, extract the daily total from Net Sales metric
    for (const item of data.items) {
      if (item.metricTypeId === 1 || item.metric === 'Net Sales') {
        dailyTotal = parseFloat(String(item.total || '0').replace(/,/g, '')) || 0;
        console.log(`Daily Net Sales from hourly endpoint: $${dailyTotal}`);
        break;
      }
    }
    
    // Check if there's hourly data in a different structure
    if (data.hourlyData && Array.isArray(data.hourlyData)) {
      for (const item of data.hourlyData) {
        const hour = item.hour || '';
        const sales = parseFloat(String(item.netSales || item.sales || '0').replace(/,/g, '')) || 0;
        if (hour) {
          hourlyData.push({ hour, sales });
        }
      }
    }
  }
  
  return { daily: dailyTotal, hourly: hourlyData };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const username = Deno.env.get('QU_USERNAME');
    const password = Deno.env.get('QU_PASSWORD');

    if (!username || !password) {
      throw new Error('QuBeyond credentials not configured');
    }

    console.log('Starting QuBeyond authentication...');

    // Step 1: Login to get JWT token
    const loginResponse = await fetch('https://admin.qubeyond.com/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://admin.qubeyond.com',
        'Referer': 'https://admin.qubeyond.com/login',
      },
      body: JSON.stringify({
        payload: {
          username: username,
          password: password,
          captchaToken: ''
        }
      }),
    });

    if (!loginResponse.ok) {
      const errorText = await loginResponse.text();
      console.error('Login failed:', loginResponse.status, errorText);
      throw new Error(`Login failed: ${loginResponse.status}`);
    }

    const loginData = await loginResponse.json();
    console.log('Login successful, got token');

    if (!loginData.token) {
      throw new Error('No token in login response');
    }

    // Step 2: Decode JWT to get tokenGw (the gateway Bearer token)
    const jwtPayload = decodeJwtPayload(loginData.token);
    const tokenGw = jwtPayload.tokenGw;
    
    if (!tokenGw) {
      throw new Error('No tokenGw found in JWT payload');
    }

    console.log('Extracted gateway token');

    // Step 3: Get dates in Pacific timezone
    const now = new Date();
    const todayStr = getPacificDateString(now);
    const weekStartStr = getWeekStartDate(now);
    const monthStartStr = getMonthStartDate(now);
    
    console.log(`Date ranges - Today: ${todayStr}, Week start: ${weekStartStr}, Month start: ${monthStartStr}`);

    // Generate date arrays for weekly and monthly
    const weekDates = getDateRange(weekStartStr, todayStr);
    const monthDates = getDateRange(monthStartStr, todayStr);

    // Step 4: Fetch all data in parallel
    const [todayData, weeklySales, monthlySales] = await Promise.all([
      fetchTodaySales(tokenGw, todayStr),
      fetchSalesForDates(tokenGw, weekDates, 'weekly'),
      fetchSalesForDates(tokenGw, monthDates, 'monthly')
    ]);

    // Return structured data
    const result = {
      daily: todayData.daily,
      weekly: weeklySales,
      monthly: monthlySales,
      hourly: todayData.hourly,
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
      hourlyCount: result.hourly.length
    }));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in fetch-qubeyond-sales:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage, authenticated: false }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});