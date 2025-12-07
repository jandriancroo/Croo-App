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
async function fetchSalesForDates(tokenGw: string, dates: string[], periodType: string): Promise<{ total: number; guestCount: number }> {
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
    return { total: 0, guestCount: 0 };
  }

  const data = await response.json();
  console.log(`${periodType} response preview:`, JSON.stringify(data).substring(0, 300));
  
  let total = 0;
  let guestCount = 0;
  
  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item.metricTypeId === 1 || item.metric === 'Net Sales') {
        total = parseFloat(String(item.total || '0').replace(/,/g, '')) || 0;
        console.log(`${periodType} Net Sales found: $${total}`);
      }
      if (item.metricTypeId === 2 || item.metric === 'Check Count' || item.metric === 'Guest Count') {
        guestCount = parseInt(String(item.total || '0').replace(/,/g, '')) || 0;
        console.log(`${periodType} Guest Count found: ${guestCount}`);
      }
    }
  }
  
  return { total, guestCount };
}

// Fetch daily breakdown for a date range (for week/month charts)
async function fetchDailyBreakdown(tokenGw: string, dates: string[]): Promise<{ date: string; sales: number; guestCount: number }[]> {
  console.log(`Fetching daily breakdown for ${dates.length} days`);
  
  // Fetch each day's sales individually for breakdown
  const dailyData: { date: string; sales: number; guestCount: number }[] = [];
  
  // Use Promise.all for parallel fetching but limit batch size
  const batchSize = 7;
  for (let i = 0; i < dates.length; i += batchSize) {
    const batch = dates.slice(i, i + batchSize);
    const batchPromises = batch.map(async (dateStr) => {
      const result = await fetchSalesForDates(tokenGw, [dateStr], `day-${dateStr}`);
      return { date: dateStr, sales: result.total, guestCount: result.guestCount };
    });
    const batchResults = await Promise.all(batchPromises);
    dailyData.push(...batchResults);
  }
  
  return dailyData.sort((a, b) => a.date.localeCompare(b.date));
}

// Fetch hourly sales breakdown using the dedicated hourly-sales endpoint
async function fetchHourlySales(tokenGw: string, dateStr: string): Promise<{ hour: string; sales: number; checksCount: number }[]> {
  console.log(`Fetching hourly sales breakdown for: ${dateStr}`);
  
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
        { fieldName: "hour" },
        { fieldName: "checksCount" },
        { fieldName: "netSales" },
        { fieldName: "averageCheck" },
        { fieldName: "discount" },
        { fieldName: "serviceCharge" },
        { fieldName: "tax" },
        { fieldName: "netSalesPercentage" }
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
        sectionId: "main",
        pageNumber: 1,
        pageSize: 25,
        totalRecords: null,
        sort: null,
        showTotals: true
      }
    }),
  });

  if (!response.ok) {
    console.error('Hourly sales fetch failed:', response.status);
    return [];
  }

  const data = await response.json();
  console.log('Hourly sales response structure:', JSON.stringify(data).substring(0, 500));
  
  const hourlyData: { hour: string; sales: number; checksCount: number }[] = [];
  
  // Helper to convert 12-hour format to 24-hour format
  const convertTo24Hour = (time12h: string): string => {
    // time12h is like "11:00 AM" or "01:00 PM"
    const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return time12h;
    
    let hours = parseInt(match[1]);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    
    if (period === 'AM') {
      if (hours === 12) hours = 0; // 12 AM = 00:00
    } else {
      if (hours !== 12) hours += 12; // 1 PM = 13, 12 PM = 12
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  };
  
  if (data.items && Array.isArray(data.items)) {
    console.log(`Found ${data.items.length} hourly items`);
    for (const item of data.items) {
      // Each item should have hour, netSales, checksCount
      const rawHour = item.hour || '';
      const hour24 = convertTo24Hour(rawHour);
      const sales = parseFloat(String(item.netSales || '0').replace(/[$,]/g, '')) || 0;
      const checksCount = parseInt(String(item.checksCount || '0').replace(/,/g, '')) || 0;
      
      if (rawHour) {
        hourlyData.push({ hour: hour24, sales, checksCount });
      }
    }
    console.log(`Parsed ${hourlyData.length} hourly entries`);
    if (hourlyData.length > 0) {
      console.log('Sample hourly data (24h format):', JSON.stringify(hourlyData.slice(0, 3)));
      console.log('Sample afternoon data:', JSON.stringify(hourlyData.filter(h => parseInt(h.hour.split(':')[0]) >= 11).slice(0, 3)));
    }
  }
  
  return hourlyData;
}

// Fetch today's daily total from the summary endpoint
async function fetchTodaySales(tokenGw: string, dateStr: string): Promise<number> {
  console.log(`Fetching today's total sales for: ${dateStr}`);
  
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
          values: [dateStr],
          type: "today"
        },
        singleLocation: 5448
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
    console.error('Today sales fetch failed:', response.status);
    return 0;
  }

  const data = await response.json();
  console.log('Today sales response items count:', data.items?.length);
  
  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item.metricTypeId === 1 || item.metric === 'Net Sales') {
        const total = parseFloat(String(item.total || '0').replace(/,/g, '')) || 0;
        console.log(`Daily Net Sales: $${total}`);
        return total;
      }
    }
  }
  
  return 0;
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
    const [dailySalesResult, weeklySalesResult, monthlySalesResult, hourlyData, weeklyBreakdown, monthlyBreakdown] = await Promise.all([
      fetchSalesForDates(tokenGw, [todayStr], 'daily'),
      fetchSalesForDates(tokenGw, weekDates, 'weekly'),
      fetchSalesForDates(tokenGw, monthDates, 'monthly'),
      fetchHourlySales(tokenGw, todayStr),
      fetchDailyBreakdown(tokenGw, weekDates),
      fetchDailyBreakdown(tokenGw, monthDates)
    ]);

    // Calculate average ticket and guest count from hourly data (more accurate)
    const totalSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
    const dailyGuestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
    const avgTicket = dailyGuestCount > 0 ? totalSales / dailyGuestCount : 0;

    // Calculate weekly and monthly guest counts from breakdowns
    const weeklyGuestCount = weeklyBreakdown.reduce((sum, d) => sum + d.guestCount, 0);
    const monthlyGuestCount = monthlyBreakdown.reduce((sum, d) => sum + d.guestCount, 0);

    // Return structured data
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
      hourlyCount: result.hourly.length,
      weeklyBreakdownCount: result.weeklyBreakdown.length,
      monthlyBreakdownCount: result.monthlyBreakdown.length,
      guestCount: result.guestCount
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
