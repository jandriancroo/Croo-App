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

function getWeekStartDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

function getMonthStartDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  date.setDate(1);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

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

function adjustDate(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

// Get current hour in location timezone (0-23)
function getCurrentHourInTimezone(timezone: string): number {
  const now = new Date();
  const tzTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return tzTime.getHours();
}

// Fetch sales for dates with detailed logging
async function fetchSalesForDates(
  tokenGw: string, 
  dates: string[], 
  qbLocationId: string,
  periodType: string
): Promise<{ total: number; guestCount: number }> {
  console.log(`Fetching ${periodType} sales for ${dates.length} days with location ID: ${qbLocationId}`);
  
  const requestPayload = {
    fields: [{ fieldName: "metric" }, { fieldName: "total" }],
    filters: {
      date: { from: null, to: null, values: dates, type: "custom" },
      location: { operationalUnits: [parseInt(qbLocationId)] }
    },
    params: { sectionId: "overview", pageNumber: 1, pageSize: 25, totalRecords: null, sort: null, showTotals: true }
  };
  
  console.log(`[DEBUG] Request payload:`, JSON.stringify(requestPayload));
  
  const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/sales', {
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
    console.error(`${periodType} fetch failed:`, response.status);
    return { total: 0, guestCount: 0 };
  }

  const data = await response.json();
  console.log(`[DEBUG] ${periodType} FULL RESPONSE:`, JSON.stringify(data));
  
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
  
  console.log(`${periodType} result: total=${total}, guestCount=${guestCount}`);
  return { total, guestCount };
}

// Fetch hourly sales for a specific day
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

// Fetch hourly sales for multiple days and aggregate by hour (for real-time comparison)
async function fetchHourlySalesForDates(
  tokenGw: string, 
  dates: string[],
  qbLocationId: string,
  upToHour?: number // If provided, only count sales up to this hour
): Promise<{ totalSales: number; totalGuests: number }> {
  let totalSales = 0;
  let totalGuests = 0;
  
  for (const dateStr of dates) {
    const hourlyData = await fetchHourlySales(tokenGw, dateStr, qbLocationId);
    
    for (const hourData of hourlyData) {
      const hourNum = parseInt(hourData.hour.split(':')[0]);
      
      // If upToHour is specified, only include hours up to that time
      if (upToHour === undefined || hourNum <= upToHour) {
        totalSales += hourData.sales;
        totalGuests += hourData.checksCount;
      }
    }
  }
  
  return { totalSales, totalGuests };
}

// Fetch daily breakdown with guest counts from hourly data
async function fetchDailyBreakdown(
  tokenGw: string, 
  dates: string[],
  qbLocationId: string
): Promise<{ date: string; sales: number; guestCount: number }[]> {
  const dailyData: { date: string; sales: number; guestCount: number }[] = [];
  
  // Fetch each day's hourly data in parallel (batches of 3 to avoid rate limits)
  const batchSize = 3;
  
  for (let i = 0; i < dates.length; i += batchSize) {
    const batch = dates.slice(i, i + batchSize);
    const batchPromises = batch.map(async (dateStr) => {
      const hourlyData = await fetchHourlySales(tokenGw, dateStr, qbLocationId);
      const sales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
      const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
      console.log(`Day ${dateStr}: sales=${sales}, guests=${guestCount}`);
      return { date: dateStr, sales, guestCount };
    });
    const batchResults = await Promise.all(batchPromises);
    dailyData.push(...batchResults);
  }
  
  return dailyData.sort((a, b) => a.date.localeCompare(b.date));
}

// Fetch tills data (expected cash) for a specific date
async function fetchTillsData(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<{ expectedCash: number; actualCash: number; overUnder: number } | null> {
  console.log(`Fetching tills data for ${dateStr}`);
  
  try {
    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/tills/sections/main', {
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
          { fieldName: "date" },
          { fieldName: "location" },
          { fieldName: "employee" },
          { fieldName: "startingCash" },
          { fieldName: "cashSales" },
          { fieldName: "paidIns" },
          { fieldName: "paidOuts" },
          { fieldName: "endingCash" },
          { fieldName: "actualCash" },
          { fieldName: "overOrUnderAmount" },
          { fieldName: "cashTips" }
        ],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: "custom" },
          singleLocation: parseInt(qbLocationId),
          noSales: null
        },
        params: { 
          sectionId: "main", 
          pageNumber: 1, 
          pageSize: 25, 
          totalRecords: null, 
          sort: [{ fieldName: "date", direction: "asc" }],
          showTotals: true 
        }
      }),
    });

    if (!response.ok) {
      console.error('Tills fetch failed:', response.status);
      return null;
    }

    const data = await response.json();
    console.log('Tills response:', JSON.stringify(data).substring(0, 500));
    
    // Look for the totals or first item with endingCash
    let expectedCash = 0;
    let actualCash = 0;
    let overUnder = 0;
    
    if (data.totals) {
      expectedCash = parseFloat(String(data.totals.endingCash || '0').replace(/[$,]/g, '')) || 0;
      actualCash = parseFloat(String(data.totals.actualCash || '0').replace(/[$,]/g, '')) || 0;
      overUnder = parseFloat(String(data.totals.overOrUnderAmount || '0').replace(/[$,]/g, '')) || 0;
    } else if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      // Sum up all items
      for (const item of data.items) {
        expectedCash += parseFloat(String(item.endingCash || '0').replace(/[$,]/g, '')) || 0;
        actualCash += parseFloat(String(item.actualCash || '0').replace(/[$,]/g, '')) || 0;
        overUnder += parseFloat(String(item.overOrUnderAmount || '0').replace(/[$,]/g, '')) || 0;
      }
    }
    
    console.log(`Tills result: expectedCash=${expectedCash}, actualCash=${actualCash}, overUnder=${overUnder}`);
    return { expectedCash, actualCash, overUnder };
  } catch (error) {
    console.error('Tills fetch error:', error);
    return null;
  }
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
  return products.slice(0, 50);
}

// Generate AI sales projections using Lovable AI
async function generateProjections(
  dailySales: number,
  weeklySales: number,
  monthlySales: number,
  weeklyBreakdown: { date: string; sales: number }[],
  monthlyBreakdown: { date: string; sales: number }[],
  currentHour: number,
  hoursOpen: number,
  hoursClose: number,
  todayStr: string,
  lastYearData?: { 
    sameDay: number; 
    sameWeek: number; 
    sameMonth: number;
    weeklyBreakdown: { date: string; sales: number }[];
  }
): Promise<{ todayProjected: number; weekProjected: number; monthProjected: number }> {
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.log("No LOVABLE_API_KEY, using simple projections");
      return simpleProjections(dailySales, weeklySales, monthlySales, weeklyBreakdown, monthlyBreakdown, currentHour, hoursOpen, hoursClose, todayStr, lastYearData);
    }

    // Calculate remaining hours and days
    const hoursRemaining = Math.max(0, hoursClose - currentHour);
    const today = new Date(todayStr + 'T12:00:00');
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, etc.
    const daysRemainingInWeek = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysRemainingInMonth = daysInMonth - today.getDate();

    // Build last year comparison section
    let lastYearSection = "";
    if (lastYearData) {
      lastYearSection = `
LAST YEAR COMPARISON (same dates from last year - USE THIS FOR CONTEXT):
- Same day last year: $${lastYearData.sameDay.toFixed(2)}
- Same week last year (full week): $${lastYearData.sameWeek.toFixed(2)}
- Same month last year (full month): $${lastYearData.sameMonth.toFixed(2)}

Last year's daily breakdown for same week:
${lastYearData.weeklyBreakdown.map(d => `${d.date}: $${d.sales.toFixed(2)}`).join('\n')}

Year-over-year trends: Compare current performance to last year. If this year is trending +10% vs last year, apply similar growth to projections.
`;
    }

    const prompt = `You are a sales projection AI for a pizza restaurant. Based on the following data, predict the final totals. Be conservative in your projections - it's better to slightly underestimate than dramatically overestimate.

Current Status:
- Today's sales so far: $${dailySales.toFixed(2)}
- Current time: ${currentHour}:00 (business closes at ${hoursClose}:00)
- Hours remaining today: ${hoursRemaining} hours
- Week-to-date sales: $${weeklySales.toFixed(2)}
- Days remaining this week (through Sunday): ${daysRemainingInWeek} days
- Month-to-date sales: $${monthlySales.toFixed(2)} (${monthlyBreakdown.length} days of data)
- Days remaining this month: ${daysRemainingInMonth} days

Daily sales this week so far:
${weeklyBreakdown.map(d => `${d.date}: $${d.sales.toFixed(2)}`).join('\n')}

Daily sales this month (last 14 days):
${monthlyBreakdown.slice(-14).map(d => `${d.date}: $${d.sales.toFixed(2)}`).join('\n')}
${lastYearSection}
Based on the hourly sales patterns (restaurants typically see lunch rush 11am-1pm and dinner rush 5pm-8pm):
1. Today's FINAL end-of-day total (close of business at ${hoursClose}:00)
2. This week's FINAL total (through end of day Sunday)
3. This month's FINAL total - BE CONSERVATIVE here, especially if we only have ${monthlyBreakdown.length} days of data

IMPORTANT: 
- For monthly projections, don't just multiply daily average by remaining days. Account for typical restaurant patterns (some days are slower than others). 
- Use last year's data as a baseline if available - apply year-over-year growth/decline trends.
- Use conservative estimates.

Return ONLY a JSON object with these three numbers, no explanation:
{"todayProjected": number, "weekProjected": number, "monthProjected": number}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a sales forecasting AI for restaurants. Always respond with valid JSON only. Use realistic projections based on hourly patterns - dinner hours typically generate 40-50% of daily sales. When last year data is available, use it as a key reference point for your projections." },
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      console.error("AI projection failed:", response.status);
      return simpleProjections(dailySales, weeklySales, monthlySales, weeklyBreakdown, monthlyBreakdown, currentHour, hoursOpen, hoursClose, todayStr, lastYearData);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log("AI projections:", parsed);
      return {
        todayProjected: parsed.todayProjected || 0,
        weekProjected: parsed.weekProjected || 0,
        monthProjected: parsed.monthProjected || 0
      };
    }
    
    return simpleProjections(dailySales, weeklySales, monthlySales, weeklyBreakdown, monthlyBreakdown, currentHour, hoursOpen, hoursClose, todayStr, lastYearData);
  } catch (error) {
    console.error("AI projection error:", error);
    return simpleProjections(dailySales, weeklySales, monthlySales, weeklyBreakdown, monthlyBreakdown, currentHour, hoursOpen, hoursClose, todayStr, lastYearData);
  }
}

// Simple fallback projections without AI
function simpleProjections(
  dailySales: number,
  weeklySales: number,
  monthlySales: number,
  weeklyBreakdown: { date: string; sales: number }[],
  monthlyBreakdown: { date: string; sales: number }[],
  currentHour: number,
  hoursOpen: number,
  hoursClose: number,
  todayStr: string,
  lastYearData?: { 
    sameDay: number; 
    sameWeek: number; 
    sameMonth: number;
    weeklyBreakdown: { date: string; sales: number }[];
  }
): { todayProjected: number; weekProjected: number; monthProjected: number } {
  const totalBusinessHours = hoursClose - hoursOpen;
  
  // Calculate today's projection based on expected hourly performance
  let todayProjected = 0;
  
  // Don't start projecting until after opening hour (sales flow starts at opening)
  if (currentHour < hoursOpen) {
    // Before opening - use last year same day if available, else use this week's average
    if (lastYearData && lastYearData.sameDay > 0) {
      todayProjected = lastYearData.sameDay;
    } else {
      const completedDays = weeklyBreakdown.filter(d => d.sales > 0);
      if (completedDays.length > 0) {
        todayProjected = completedDays.reduce((sum, d) => sum + d.sales, 0) / completedDays.length;
      }
    }
  } else if (currentHour >= hoursClose) {
    // After close - actual sales ARE the projection (day is complete)
    todayProjected = dailySales;
  } else {
    // During business hours - project based on expected hourly performance
    const hoursElapsed = currentHour - hoursOpen;
    
    // Calculate expected percentage of day's sales by current hour
    let expectedPercentComplete = 0;
    for (let h = hoursOpen; h < currentHour; h++) {
      if (h >= 11 && h < 14) expectedPercentComplete += 0.25 / 3; // 25% over 3 hours (lunch)
      else if (h >= 14 && h < 17) expectedPercentComplete += 0.20 / 3; // 20% over 3 hours (afternoon)
      else if (h >= 17 && h < 22) expectedPercentComplete += 0.55 / 5; // 55% over 5 hours (dinner)
      else expectedPercentComplete += 0.5 / totalBusinessHours; // fallback for hours outside typical patterns
    }
    
    // If we have some sales, project based on actual vs expected performance
    if (dailySales > 0 && expectedPercentComplete > 0) {
      todayProjected = dailySales / expectedPercentComplete;
    } else if (hoursElapsed > 0) {
      const hoursFraction = hoursElapsed / totalBusinessHours;
      const projectionMultiplier = Math.min(1 / hoursFraction, 3);
      todayProjected = dailySales * projectionMultiplier;
    } else {
      // Just opened - use last year same day or this week average
      if (lastYearData && lastYearData.sameDay > 0) {
        todayProjected = lastYearData.sameDay;
      } else {
        const completedDays = weeklyBreakdown.filter(d => d.sales > 0);
        todayProjected = completedDays.length > 0 
          ? completedDays.reduce((sum, d) => sum + d.sales, 0) / completedDays.length 
          : dailySales;
      }
    }
  }
  
  // Week projection: use last year as baseline if available
  const today = new Date(todayStr + 'T12:00:00');
  const dayOfWeek = today.getDay();
  const daysRemainingInWeek = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const daysThisWeek = weeklyBreakdown.length;
  
  let weekProjected: number;
  if (lastYearData && lastYearData.sameWeek > 0 && daysThisWeek > 0) {
    // Calculate YoY growth rate and apply to projection
    const lastYearAvg = lastYearData.sameWeek / 7;
    const thisYearAvg = weeklySales / daysThisWeek;
    const growthRate = thisYearAvg / lastYearAvg;
    weekProjected = weeklySales + (todayProjected - dailySales) + (lastYearAvg * growthRate * daysRemainingInWeek);
  } else {
    const avgDailySales = daysThisWeek > 0 ? weeklySales / daysThisWeek : todayProjected;
    const todayRemainingProjected = todayProjected - dailySales;
    weekProjected = weeklySales + todayRemainingProjected + (avgDailySales * daysRemainingInWeek);
  }
  
  // Month projection: use last year as baseline if available
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const dayOfMonth = today.getDate();
  const daysRemainingInMonth = daysInMonth - dayOfMonth;
  
  let monthProjected: number;
  if (lastYearData && lastYearData.sameMonth > 0 && monthlyBreakdown.length > 0) {
    // Calculate YoY growth rate and apply to projection
    const lastYearAvg = lastYearData.sameMonth / daysInMonth;
    const thisYearAvg = monthlySales / monthlyBreakdown.length;
    const growthRate = thisYearAvg / lastYearAvg;
    monthProjected = (monthlySales + (todayProjected - dailySales) + (lastYearAvg * growthRate * daysRemainingInMonth)) * 0.95; // Slightly conservative
  } else {
    const daysOfData = monthlyBreakdown.length;
    let monthAvgDaily: number;
    if (daysOfData >= 7) {
      monthAvgDaily = monthlySales / daysOfData;
    } else if (daysThisWeek > 0) {
      monthAvgDaily = weeklySales / daysThisWeek;
    } else {
      monthAvgDaily = todayProjected;
    }
    monthProjected = (monthlySales + (todayProjected - dailySales) + (monthAvgDaily * daysRemainingInMonth)) * 0.90;
  }
  
  return { todayProjected, weekProjected, monthProjected };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { locationId, targetDate, testCredentials, skipProjections } = await req.json().catch(() => ({}));
    
    let credentials: QuBeyondCredentials;
    let hoursOpen = 11;
    let hoursClose = 22;
    
    if (testCredentials) {
      credentials = testCredentials;
    } else if (locationId) {
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
      
      // Fetch location hours
      const { data: locationSettings } = await supabase
        .from('location_settings')
        .select('hours_open, hours_close')
        .eq('location_id', locationId)
        .single();
      
      if (locationSettings) {
        hoursOpen = parseInt(locationSettings.hours_open?.split(':')[0] || '11');
        hoursClose = parseInt(locationSettings.hours_close?.split(':')[0] || '22');
      }
    } else {
      credentials = {
        username: Deno.env.get('QU_USERNAME') || '',
        password: Deno.env.get('QU_PASSWORD') || ''
      };
    }

    if (!credentials.username || !credentials.password) {
      throw new Error('QuBeyond credentials not configured');
    }

    console.log('Starting QuBeyond authentication with user:', credentials.username);

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
      
      if (loginResponse.status === 429 || errorBody.toLowerCase().includes('rate') || errorBody.toLowerCase().includes('limit')) {
        throw new Error('Rate limited by QuBeyond API. Please try again in a few minutes.');
      }
      
      throw new Error(`QuBeyond login failed (${loginResponse.status}): ${errorBody.substring(0, 200)}`);
    }

    const loginData = await loginResponse.json();
    if (!loginData.token) throw new Error('No token in login response');

    const jwtPayload = decodeJwtPayload(loginData.token);
    const tokenGw = jwtPayload.tokenGw;
    if (!tokenGw) throw new Error('No tokenGw found in JWT payload');

    console.log('JWT payload keys:', Object.keys(jwtPayload));
    console.log('JWT payload:', JSON.stringify(jwtPayload, null, 2));

    let qbLocationId = credentials.location_id;
    
    if (!qbLocationId) {
      qbLocationId = jwtPayload.locationId || jwtPayload.location_id || 
                     jwtPayload.storeId || jwtPayload.store_id ||
                     jwtPayload.singleLocation || jwtPayload.defaultLocation;
      
      if (!qbLocationId && jwtPayload.user) {
        qbLocationId = jwtPayload.user.locationId || jwtPayload.user.storeId || jwtPayload.user.defaultLocation;
      }
      if (!qbLocationId && jwtPayload.locations && Array.isArray(jwtPayload.locations) && jwtPayload.locations.length > 0) {
        qbLocationId = jwtPayload.locations[0].id || jwtPayload.locations[0];
      }
    }
    
    console.log('Using QuBeyond location ID:', qbLocationId);
    console.log('Authentication successful');

    if (testCredentials) {
      return new Response(JSON.stringify({ 
        authenticated: true,
        jwtPayload: jwtPayload,
        discoveredLocationId: qbLocationId
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!qbLocationId) {
      throw new Error('Could not determine QuBeyond location ID. Please configure it in settings.');
    }
    
    const timezone = 'America/Los_Angeles';
    const now = new Date();
    const todayStr = targetDate || getDateStringForTimezone(now, timezone);
    const weekStartStr = getWeekStartDate(todayStr);
    const monthStartStr = getMonthStartDate(todayStr);
    const currentHour = getCurrentHourInTimezone(timezone);
    
    // Previous period dates - FULL historical periods (not real-time)
    // Today comparison: same weekday last week, real-time comparison
    const prevDayStr = adjustDate(todayStr, -7); // Same weekday last week
    
    // Previous FULL week (Monday-Sunday of last week)
    const prevWeekStartStr = adjustDate(weekStartStr, -7);
    const prevWeekEndStr = adjustDate(weekStartStr, -1); // Sunday of last week (full week)
    
    // Previous FULL month
    const prevMonthDate = new Date(todayStr + 'T12:00:00');
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonthStart = getMonthStartDate(getDateStringForTimezone(prevMonthDate, timezone));
    // Get last day of previous month
    const lastDayPrevMonth = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0);
    const prevMonthEndStr = getDateStringForTimezone(lastDayPrevMonth, timezone);

    // LAST YEAR dates for better projections
    const lastYearTodayDate = new Date(todayStr + 'T12:00:00');
    lastYearTodayDate.setFullYear(lastYearTodayDate.getFullYear() - 1);
    // Adjust to same day of week
    const targetDayOfWeek = new Date(todayStr + 'T12:00:00').getDay();
    const lastYearDayOfWeek = lastYearTodayDate.getDay();
    const dayDiff = targetDayOfWeek - lastYearDayOfWeek;
    lastYearTodayDate.setDate(lastYearTodayDate.getDate() + dayDiff);
    const lastYearTodayStr = getDateStringForTimezone(lastYearTodayDate, timezone);
    
    // Last year same week (full week)
    const lastYearWeekStartStr = getWeekStartDate(lastYearTodayStr);
    const lastYearWeekEndStr = adjustDate(lastYearWeekStartStr, 6); // Sunday
    
    // Last year same month (full month)
    const lastYearMonthDate = new Date(todayStr + 'T12:00:00');
    lastYearMonthDate.setFullYear(lastYearMonthDate.getFullYear() - 1);
    const lastYearMonthStartStr = getMonthStartDate(getDateStringForTimezone(lastYearMonthDate, timezone));
    const lastDayLastYearMonth = new Date(lastYearMonthDate.getFullYear(), lastYearMonthDate.getMonth() + 1, 0);
    const lastYearMonthEndStr = getDateStringForTimezone(lastDayLastYearMonth, timezone);

    // Generate date arrays
    const weekDates = getDateRange(weekStartStr, todayStr);
    const monthDates = getDateRange(monthStartStr, todayStr);
    const prevWeekDates = getDateRange(prevWeekStartStr, prevWeekEndStr); // Full previous week
    const prevMonthDates = getDateRange(prevMonthStart, prevMonthEndStr); // Full previous month
    const lastYearWeekDates = getDateRange(lastYearWeekStartStr, lastYearWeekEndStr); // Last year same week
    const lastYearMonthDates = getDateRange(lastYearMonthStartStr, lastYearMonthEndStr); // Last year same month

    console.log(`Today: ${todayStr}, Current hour: ${currentHour}`);
    console.log(`Week dates: ${weekDates.join(', ')}`);
    console.log(`Prev week dates: ${prevWeekDates.join(', ')}`);
    console.log(`Last year same day: ${lastYearTodayStr}`);
    console.log(`Last year week dates: ${lastYearWeekDates.join(', ')}`);

    // Fetch hourly data for today and previous day (for real-time comparison)
    const [
      todayHourly,
      prevDayHourly,
      weeklyBreakdown,
      monthlyBreakdown,
      productMix,
      tillsData
    ] = await Promise.all([
      fetchHourlySales(tokenGw, todayStr, qbLocationId),
      fetchHourlySales(tokenGw, prevDayStr, qbLocationId),
      fetchDailyBreakdown(tokenGw, weekDates, qbLocationId),
      fetchDailyBreakdown(tokenGw, monthDates, qbLocationId),
      fetchProductMix(tokenGw, [todayStr], qbLocationId),
      fetchTillsData(tokenGw, todayStr, qbLocationId)
    ]);

    // Calculate today's metrics from hourly data
    const dailySales = todayHourly.reduce((sum, h) => sum + h.sales, 0);
    const dailyGuestCount = todayHourly.reduce((sum, h) => sum + h.checksCount, 0);
    
    // Calculate previous day REAL-TIME comparison (same hours as now)
    let prevDaySalesRealTime = 0;
    let prevDayGuestsRealTime = 0;
    for (const h of prevDayHourly) {
      const hourNum = parseInt(h.hour.split(':')[0]);
      if (hourNum <= currentHour) {
        prevDaySalesRealTime += h.sales;
        prevDayGuestsRealTime += h.checksCount;
      }
    }
    
    // Previous day full day total
    const prevDayTotalSales = prevDayHourly.reduce((sum, h) => sum + h.sales, 0);

    // Calculate weekly/monthly from breakdown data (accurate guest counts)
    const weeklySales = weeklyBreakdown.reduce((sum, d) => sum + d.sales, 0);
    const weeklyGuestCount = weeklyBreakdown.reduce((sum, d) => sum + d.guestCount, 0);
    const monthlySales = monthlyBreakdown.reduce((sum, d) => sum + d.sales, 0);
    const monthlyGuestCount = monthlyBreakdown.reduce((sum, d) => sum + d.guestCount, 0);
    
    console.log(`Weekly breakdown totals: sales=${weeklySales}, guests=${weeklyGuestCount}`);
    console.log(`Monthly breakdown totals: sales=${monthlySales}, guests=${monthlyGuestCount}`);

    // Fetch previous week/month breakdowns for real-time comparison
    const [prevWeekBreakdown, prevMonthBreakdown] = await Promise.all([
      fetchDailyBreakdown(tokenGw, prevWeekDates, qbLocationId),
      fetchDailyBreakdown(tokenGw, prevMonthDates, qbLocationId)
    ]);
    
    const prevWeekSales = prevWeekBreakdown.reduce((sum, d) => sum + d.sales, 0);
    const prevMonthSales = prevMonthBreakdown.reduce((sum, d) => sum + d.sales, 0);

    const avgTicket = dailyGuestCount > 0 ? dailySales / dailyGuestCount : 0;

    // Fetch last year data for better projections (only if not skipping projections)
    let lastYearData: { 
      sameDay: number; 
      sameWeek: number; 
      sameMonth: number;
      weeklyBreakdown: { date: string; sales: number }[];
    } | undefined;
    
    if (!skipProjections) {
      console.log('Fetching last year data for projections...');
      try {
        const [lastYearDayHourly, lastYearWeekBreakdown, lastYearMonthResult] = await Promise.all([
          fetchHourlySales(tokenGw, lastYearTodayStr, qbLocationId),
          fetchDailyBreakdown(tokenGw, lastYearWeekDates, qbLocationId),
          fetchSalesForDates(tokenGw, lastYearMonthDates, qbLocationId, 'last_year_month')
        ]);
        
        const lastYearSameDay = lastYearDayHourly.reduce((sum, h) => sum + h.sales, 0);
        const lastYearSameWeek = lastYearWeekBreakdown.reduce((sum, d) => sum + d.sales, 0);
        
        lastYearData = {
          sameDay: lastYearSameDay,
          sameWeek: lastYearSameWeek,
          sameMonth: lastYearMonthResult.total,
          weeklyBreakdown: lastYearWeekBreakdown.map(d => ({ date: d.date, sales: d.sales }))
        };
        
        console.log(`Last year same day: $${lastYearSameDay}, same week: $${lastYearSameWeek}, same month: $${lastYearMonthResult.total}`);
      } catch (error) {
        console.error('Failed to fetch last year data:', error);
        // Continue without last year data
      }
    }

    // Generate AI projections (skip if client already has cached projections)
    let projections = { todayProjected: 0, weekProjected: 0, monthProjected: 0 };
    if (!skipProjections) {
      console.log('Generating AI projections with last year data...');
      projections = await generateProjections(
        dailySales,
        weeklySales,
        monthlySales,
        weeklyBreakdown,
        monthlyBreakdown,
        currentHour,
        hoursOpen,
        hoursClose,
        todayStr,
        lastYearData
      );
    } else {
      console.log('Skipping projections - client has cached values');
    }

    const result = {
      daily: dailySales,
      weekly: weeklySales,
      monthly: monthlySales,
      hourly: todayHourly,
      weeklyBreakdown,
      monthlyBreakdown,
      guestCount: {
        daily: dailyGuestCount,
        weekly: weeklyGuestCount,
        monthly: monthlyGuestCount
      },
      avgTicket,
      comparison: {
        prevDay: prevDaySalesRealTime, // Real-time: same hours last week
        prevDayFullDay: prevDayTotalSales, // Full day total for reference
        prevWeek: prevWeekSales, // Week-to-date comparison
        prevMonth: prevMonthSales // Month-to-date comparison
      },
      projections, // AI-powered projections
      productMix,
      tills: tillsData, // Tills data for drawer count expected cash
      authenticated: true,
      timestamp: new Date().toISOString(),
      currentHour,
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
      guestCount: result.guestCount,
      comparison: result.comparison,
      projections: result.projections,
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
