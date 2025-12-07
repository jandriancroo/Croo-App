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

// Fetch sales data for a specific period
async function fetchSalesForPeriod(tokenGw: string, dateFrom: string, dateTo: string, periodType: string): Promise<number> {
  console.log(`Fetching ${periodType} sales: ${dateFrom} to ${dateTo}`);
  
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
          from: dateFrom,
          to: dateTo,
          values: [],
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
  
  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item.metricTypeId === 1) { // Net Sales
        const total = parseFloat(String(item.total || '0').replace(/,/g, '')) || 0;
        console.log(`${periodType} Net Sales: $${total}`);
        return total;
      }
    }
  }
  
  return 0;
}

// Fetch hourly sales data
async function fetchHourlySales(tokenGw: string, dateStr: string): Promise<{ hour: string; amount: number }[]> {
  console.log(`Fetching hourly sales for: ${dateStr}`);
  
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
    console.error('Hourly fetch failed:', response.status);
    return [];
  }

  const data = await response.json();
  console.log('Hourly data response:', JSON.stringify(data).substring(0, 500));
  
  const hourlyData: { hour: string; amount: number }[] = [];
  
  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      const hour = item.hour || item.Hour || '';
      const amount = parseFloat(String(item.netSales || item.NetSales || item.total || '0').replace(/,/g, '')) || 0;
      if (hour) {
        hourlyData.push({ hour, amount });
      }
    }
  }
  
  return hourlyData;
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

    // Step 4: Fetch all data in parallel
    const [dailySales, weeklySales, monthlySales, hourlyData] = await Promise.all([
      fetchSalesForPeriod(tokenGw, todayStr, todayStr, 'daily'),
      fetchSalesForPeriod(tokenGw, weekStartStr, todayStr, 'weekly'),
      fetchSalesForPeriod(tokenGw, monthStartStr, todayStr, 'monthly'),
      fetchHourlySales(tokenGw, todayStr)
    ]);

    // Return structured data
    const result = {
      daily: dailySales,
      weekly: weeklySales,
      monthly: monthlySales,
      hourly: hourlyData,
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
