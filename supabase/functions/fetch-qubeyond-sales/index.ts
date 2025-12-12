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
  pull_labor?: boolean;
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

// Fetch labor data from Real Time Summary
async function fetchLaborData(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<{ laborPercent: number; laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number } | null> {
  console.log(`Fetching labor data for ${dateStr}`);
  
  try {
    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/real-time-summary/sections/overview', {
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
          date: { from: null, to: null, values: [dateStr], type: "today" },
          singleLocation: parseInt(qbLocationId),
          clockInRequired: true
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
      console.error('Labor data fetch failed:', response.status);
      return null;
    }

    const data = await response.json();
    console.log('Labor data response:', JSON.stringify(data).substring(0, 1000));
    
    let laborPercent = 0;
    let laborCost = 0;
    let hoursWorked = 0;
    let regularHours = 0;
    let overtimeHours = 0;
    
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        const metric = item.metric?.toLowerCase() || '';
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
    
    console.log(`Labor result: laborPercent=${laborPercent}%, laborCost=${laborCost}, hoursWorked=${hoursWorked}`);
    return { laborPercent, laborCost, hoursWorked, regularHours, overtimeHours };
  } catch (error) {
    console.error('Labor data fetch error:', error);
    return null;
  }
}

// Fetch labor data for multiple dates (for weekly/period totals)
async function fetchLaborDataForDates(
  tokenGw: string,
  dates: string[],
  qbLocationId: string
): Promise<{ laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; dailyLabor: { date: string; laborPercent: number; laborCost: number }[] }> {
  console.log(`Fetching labor data for ${dates.length} days`);
  
  let totalLaborCost = 0;
  let totalHoursWorked = 0;
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  const dailyLabor: { date: string; laborPercent: number; laborCost: number }[] = [];
  
  // Fetch labor data for each date
  for (const dateStr of dates) {
    const labor = await fetchLaborData(tokenGw, dateStr, qbLocationId);
    if (labor) {
      totalLaborCost += labor.laborCost;
      totalHoursWorked += labor.hoursWorked;
      totalRegularHours += labor.regularHours;
      totalOvertimeHours += labor.overtimeHours;
      dailyLabor.push({
        date: dateStr,
        laborPercent: labor.laborPercent,
        laborCost: labor.laborCost
      });
    }
  }
  
  return { laborCost: totalLaborCost, hoursWorked: totalHoursWorked, regularHours: totalRegularHours, overtimeHours: totalOvertimeHours, dailyLabor };
}

// Generate deterministic seeded random factor between -2% and +3%
// Uses a simple hash of date + locationId to ensure consistency for same inputs
function getSeededRandomFactor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Normalize to 0-1 range
  const normalized = Math.abs(hash % 1000) / 1000;
  // Map to -2% to +3% range (0.98 to 1.03)
  return 0.98 + (normalized * 0.05);
}

// Generate sales projections using deterministic formula (no AI)
// Daily: (4-week avg for day + last year same day) / 2 * random factor
// Weekly: (4-week avg + last year same week) / 2 * random factor
// Monthly: last year same month * random factor
// Generate hourly projections based on historical patterns
function generateHourlyProjections(
  hourlyActuals: { hour: string; sales: number }[],
  hoursOpen: number,
  hoursClose: number,
  todayStr: string,
  locationId: string,
  todayProjectedTotal: number,
  fourWeekHourlyPattern?: { hour: number; avgPercent: number }[]
): { hour: string; sales: number; projected: number }[] {
  const result: { hour: string; sales: number; projected: number }[] = [];
  const totalActualSales = hourlyActuals.reduce((sum, h) => sum + h.sales, 0);
  
  // Default hourly distribution if no historical pattern (typical restaurant curve)
  const defaultPattern: { [hour: number]: number } = {
    10: 0.02, 11: 0.08, 12: 0.15, 13: 0.12, 14: 0.06, 15: 0.05,
    16: 0.07, 17: 0.12, 18: 0.14, 19: 0.10, 20: 0.06, 21: 0.03
  };
  
  for (let hour = hoursOpen; hour < hoursClose; hour++) {
    const hourStr = `${hour.toString().padStart(2, '0')}:00`;
    const actual = hourlyActuals.find(h => parseInt(h.hour.split(':')[0]) === hour)?.sales || 0;
    
    // Calculate projected for this hour
    let hourlyProjected = 0;
    if (fourWeekHourlyPattern) {
      const pattern = fourWeekHourlyPattern.find(p => p.hour === hour);
      hourlyProjected = pattern ? todayProjectedTotal * pattern.avgPercent : 0;
    } else {
      const percent = defaultPattern[hour] || 0.05;
      hourlyProjected = todayProjectedTotal * percent;
    }
    
    result.push({ hour: hourStr, sales: actual, projected: Math.round(hourlyProjected) });
  }
  
  return result;
}

// Generate daily projections for week view
function generateDailyProjectionsForWeek(
  weeklyBreakdown: { date: string; sales: number }[],
  weekStartStr: string,
  locationId: string,
  fourWeekAverage?: { avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[] }
): { date: string; sales: number; projected: number }[] {
  const result: { date: string; sales: number; projected: number }[] = [];
  const randomFactor = getSeededRandomFactor(`week-${weekStartStr}-${locationId}`);
  
  // Generate all 7 days of the week
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStartStr + 'T12:00:00');
    date.setDate(date.getDate() + i);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayOfWeek = date.getDay();
    
    const actual = weeklyBreakdown.find(d => d.date === dateStr)?.sales || 0;
    let projected = 0;
    
    if (fourWeekAverage) {
      const avgForDay = fourWeekAverage.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek);
      projected = avgForDay ? avgForDay.avgSales * randomFactor : 0;
    }
    
    result.push({ date: dateStr, sales: actual, projected: Math.round(projected) });
  }
  
  return result;
}

// Generate daily projections for month view
function generateDailyProjectionsForMonth(
  monthlyBreakdown: { date: string; sales: number }[],
  monthStartStr: string,
  locationId: string,
  fourWeekAverage?: { avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[] }
): { date: string; sales: number; projected: number }[] {
  const result: { date: string; sales: number; projected: number }[] = [];
  const randomFactor = getSeededRandomFactor(`month-${monthStartStr}-${locationId}`);
  
  const monthDate = new Date(monthStartStr + 'T12:00:00');
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayOfWeek = date.getDay();
    
    const actual = monthlyBreakdown.find(d => d.date === dateStr)?.sales || 0;
    let projected = 0;
    
    if (fourWeekAverage) {
      const avgForDay = fourWeekAverage.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek);
      projected = avgForDay ? avgForDay.avgSales * randomFactor : 0;
    }
    
    result.push({ date: dateStr, sales: actual, projected: Math.round(projected) });
  }
  
  return result;
}

function generateProjections(
  dailySales: number,
  weeklySales: number,
  monthlySales: number,
  weeklyBreakdown: { date: string; sales: number }[],
  monthlyBreakdown: { date: string; sales: number }[],
  currentHour: number,
  hoursOpen: number,
  hoursClose: number,
  todayStr: string,
  locationId: string,
  lastYearData?: { 
    sameDay: number; 
    sameWeek: number; 
    sameMonth: number;
    weeklyBreakdown: { date: string; sales: number }[];
  },
  fourWeekAverage?: {
    avgWeekTotal: number;
    avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[];
    weeks: { weekStart: string; total: number }[];
  }
): { todayProjected: number; weekProjected: number; monthProjected: number } {
  const today = new Date(todayStr + 'T12:00:00');
  const dayOfWeek = today.getDay();
  
  // Get consistent random factor for this date/location combination
  const randomFactor = getSeededRandomFactor(`${todayStr}-${locationId}`);
  console.log(`Projection random factor for ${todayStr}/${locationId}: ${randomFactor.toFixed(4)} (${((randomFactor - 1) * 100).toFixed(2)}%)`);
  
  // === DAILY PROJECTION ===
  // (4-week avg for this day of week + last year same day) / 2 * random factor
  let todayProjected = 0;
  const fourWeekDayAvg = fourWeekAverage?.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0;
  const lastYearSameDay = lastYearData?.sameDay || 0;
  
  if (fourWeekDayAvg > 0 && lastYearSameDay > 0) {
    // Both available: average them and apply random factor
    todayProjected = ((fourWeekDayAvg + lastYearSameDay) / 2) * randomFactor;
  } else if (fourWeekDayAvg > 0) {
    // Only 4-week avg available
    todayProjected = fourWeekDayAvg * randomFactor;
  } else if (lastYearSameDay > 0) {
    // Only last year available
    todayProjected = lastYearSameDay * randomFactor;
  } else {
    // Fallback: use current daily sales or weekly average
    const completedDays = weeklyBreakdown.filter(d => d.sales > 0);
    if (completedDays.length > 0) {
      todayProjected = (completedDays.reduce((sum, d) => sum + d.sales, 0) / completedDays.length) * randomFactor;
    } else {
      todayProjected = dailySales;
    }
  }
  
  // If after close, use actual sales
  if (currentHour >= hoursClose) {
    todayProjected = dailySales;
  }
  
  // Ensure at least actual sales
  todayProjected = Math.max(todayProjected, dailySales);
  
  // === WEEKLY PROJECTION ===
  // (4-week avg week + last year same week) / 2 * random factor
  let weekProjected = 0;
  const fourWeekAvgWeek = fourWeekAverage?.avgWeekTotal || 0;
  const lastYearSameWeek = lastYearData?.sameWeek || 0;
  
  if (fourWeekAvgWeek > 0 && lastYearSameWeek > 0) {
    // Both available: average them and apply random factor
    weekProjected = ((fourWeekAvgWeek + lastYearSameWeek) / 2) * randomFactor;
  } else if (fourWeekAvgWeek > 0) {
    weekProjected = fourWeekAvgWeek * randomFactor;
  } else if (lastYearSameWeek > 0) {
    weekProjected = lastYearSameWeek * randomFactor;
  } else {
    // Fallback: project from current week data
    const daysRemainingInWeek = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const avgDailySales = weeklyBreakdown.length > 0 ? weeklySales / weeklyBreakdown.length : todayProjected;
    weekProjected = (weeklySales + (avgDailySales * daysRemainingInWeek)) * randomFactor;
  }
  
  // Ensure at least actual weekly sales
  weekProjected = Math.max(weekProjected, weeklySales);
  
  // === MONTHLY PROJECTION ===
  // Last year same month * random factor (simpler formula per user request)
  let monthProjected = 0;
  const lastYearSameMonth = lastYearData?.sameMonth || 0;
  
  if (lastYearSameMonth > 0) {
    // Use last year's same month with random factor
    monthProjected = lastYearSameMonth * randomFactor;
  } else {
    // Fallback: project from current month data
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysRemainingInMonth = daysInMonth - today.getDate();
    const daysOfData = monthlyBreakdown.length;
    const monthAvgDaily = daysOfData > 0 ? monthlySales / daysOfData : todayProjected;
    monthProjected = (monthlySales + (monthAvgDaily * daysRemainingInMonth)) * randomFactor;
  }
  
  // Ensure at least actual monthly sales
  monthProjected = Math.max(monthProjected, monthlySales);
  
  console.log(`Deterministic projections: daily=${todayProjected.toFixed(2)}, weekly=${weekProjected.toFixed(2)}, monthly=${monthProjected.toFixed(2)}`);
  console.log(`  Inputs: 4wkDayAvg=${fourWeekDayAvg.toFixed(2)}, lastYrDay=${lastYearSameDay.toFixed(2)}, 4wkWeekAvg=${fourWeekAvgWeek.toFixed(2)}, lastYrWeek=${lastYearSameWeek.toFixed(2)}, lastYrMonth=${lastYearSameMonth.toFixed(2)}`);
  
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

    // Fetch labor data if pull_labor is enabled
    let laborData = null;
    let weeklyLaborData: { laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; dailyLabor: { date: string; laborPercent: number; laborCost: number }[] } | null = null;
    
    if (credentials.pull_labor) {
      console.log('Pull labor enabled - fetching labor data from Real Time Summary');
      // Fetch today's labor and weekly labor in parallel
      const [todayLabor, weekLabor] = await Promise.all([
        fetchLaborData(tokenGw, todayStr, qbLocationId),
        fetchLaborDataForDates(tokenGw, weekDates, qbLocationId)
      ]);
      laborData = todayLabor;
      weeklyLaborData = weekLabor;
    }

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

    // Fetch last year data and 4-week historical data for better projections
    // Always fetch this data - we need it for chart projections even when header projections are cached
    let lastYearData: { 
      sameDay: number; 
      sameWeek: number; 
      sameMonth: number;
      weeklyBreakdown: { date: string; sales: number }[];
    } | undefined;
    
    let fourWeekAverage: {
      avgWeekTotal: number;
      avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[];
      weeks: { weekStart: string; total: number }[];
    } | undefined;
    
    // Always fetch historical data for chart projections
    console.log('Fetching historical data for projections...');
      
      // Generate 4-week historical date ranges (past 4 complete weeks)
      const fourWeekRanges: { weekStart: string; weekEnd: string }[] = [];
      for (let i = 1; i <= 4; i++) {
        const weekStartOffset = i * 7;
        const weekEndOffset = (i - 1) * 7 + 1;
        fourWeekRanges.push({
          weekStart: adjustDate(weekStartStr, -weekStartOffset),
          weekEnd: adjustDate(weekStartStr, -weekEndOffset)
        });
      }
      
      console.log('4-week historical ranges:', fourWeekRanges.map(r => `${r.weekStart} to ${r.weekEnd}`).join(', '));
      
      try {
        // Fetch all 4 weeks of data in parallel
        const fourWeekPromises = fourWeekRanges.map(range => {
          const dates = getDateRange(range.weekStart, range.weekEnd);
          return fetchDailyBreakdown(tokenGw, dates, qbLocationId);
        });
        
        // Also fetch last year data
        const [lastYearDayHourly, lastYearWeekBreakdown, lastYearMonthResult, ...fourWeekResults] = await Promise.all([
          fetchHourlySales(tokenGw, lastYearTodayStr, qbLocationId),
          fetchDailyBreakdown(tokenGw, lastYearWeekDates, qbLocationId),
          fetchSalesForDates(tokenGw, lastYearMonthDates, qbLocationId, 'last_year_month'),
          ...fourWeekPromises
        ]);
        
        // Process last year data
        const lastYearSameDay = lastYearDayHourly.reduce((sum, h) => sum + h.sales, 0);
        const lastYearSameWeek = lastYearWeekBreakdown.reduce((sum, d) => sum + d.sales, 0);
        
        lastYearData = {
          sameDay: lastYearSameDay,
          sameWeek: lastYearSameWeek,
          sameMonth: lastYearMonthResult.total,
          weeklyBreakdown: lastYearWeekBreakdown.map(d => ({ date: d.date, sales: d.sales }))
        };
        
        console.log(`Last year same day: $${lastYearSameDay}, same week: $${lastYearSameWeek}, same month: $${lastYearMonthResult.total}`);
        
        // Process 4-week historical data
        const allFourWeekDays: { date: string; sales: number; dayOfWeek: number }[] = [];
        const weekTotals: { weekStart: string; total: number }[] = [];
        
        fourWeekResults.forEach((weekData, idx) => {
          const weekTotal = weekData.reduce((sum, d) => sum + d.sales, 0);
          weekTotals.push({
            weekStart: fourWeekRanges[idx].weekStart,
            total: weekTotal
          });
          
          weekData.forEach(d => {
            const date = new Date(d.date + 'T12:00:00');
            allFourWeekDays.push({
              date: d.date,
              sales: d.sales,
              dayOfWeek: date.getDay()
            });
          });
        });
        
        // Calculate averages by day of week
        const salesByDayOfWeek: { [key: number]: number[] } = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
        allFourWeekDays.forEach(d => {
          if (d.sales > 0) {
            salesByDayOfWeek[d.dayOfWeek].push(d.sales);
          }
        });
        
        const avgDailyByDayOfWeek = Object.entries(salesByDayOfWeek).map(([dow, sales]) => ({
          dayOfWeek: parseInt(dow),
          avgSales: sales.length > 0 ? sales.reduce((sum, s) => sum + s, 0) / sales.length : 0
        }));
        
        const avgWeekTotal = weekTotals.length > 0 
          ? weekTotals.reduce((sum, w) => sum + w.total, 0) / weekTotals.length 
          : 0;
        
        fourWeekAverage = {
          avgWeekTotal,
          avgDailyByDayOfWeek,
          weeks: weekTotals
        };
        
        console.log(`4-week average weekly total: $${avgWeekTotal.toFixed(2)}`);
        console.log('Average by day of week:', avgDailyByDayOfWeek.map(d => `${d.dayOfWeek}: $${d.avgSales.toFixed(2)}`).join(', '));
        
    } catch (error) {
      console.error('Failed to fetch historical data:', error);
      // Continue without historical data
    }

    // Generate AI projections
    // Note: We always generate hourly/daily projections, but may use cached totals for the header projections
    let projections = { todayProjected: 0, weekProjected: 0, monthProjected: 0 };
    
    if (!skipProjections) {
      console.log('Generating deterministic projections with 4-week average and last year data...');
      projections = generateProjections(
        dailySales,
        weeklySales,
        monthlySales,
        weeklyBreakdown,
        monthlyBreakdown,
        currentHour,
        hoursOpen,
        hoursClose,
        todayStr,
        locationId || 'default',
        lastYearData,
        fourWeekAverage
      );
    } else {
      console.log('Skipping projection totals - client has cached values');
      // projections will remain 0, client will use cached values
    }
    
    // Always generate hourly/daily projections for charts (use projected total or estimate)
    const effectiveTodayProjected = projections.todayProjected > 0 
      ? projections.todayProjected 
      : dailySales * 1.3; // Fallback estimate if no projection
    
    const hourlyWithProjections = generateHourlyProjections(
      todayHourly,
      hoursOpen,
      hoursClose,
      todayStr,
      locationId || 'default',
      effectiveTodayProjected
    );
    
    // Generate daily projections for week (uses 4-week average if available, otherwise estimate)
    const weeklyWithProjections = generateDailyProjectionsForWeek(
      weeklyBreakdown,
      weekStartStr,
      locationId || 'default',
      fourWeekAverage
    );
    
    // Generate daily projections for month
    const monthlyWithProjections = generateDailyProjectionsForMonth(
      monthlyBreakdown,
      monthStartStr,
      locationId || 'default',
      fourWeekAverage
    );

    // Add labor % to hourly data if we have labor data (use daily labor % for all hours as approximation)
    let hourlyWithLabor = hourlyWithProjections;
    if (laborData && laborData.laborPercent > 0) {
      hourlyWithLabor = hourlyWithProjections.map(h => ({
        ...h,
        laborPercent: laborData.laborPercent
      }));
    }
    
    // Add labor % to weekly breakdown if we have weekly labor data
    let weeklyWithLabor = weeklyWithProjections;
    if (weeklyLaborData && weeklyLaborData.dailyLabor.length > 0) {
      weeklyWithLabor = weeklyWithProjections.map(d => {
        const dayLabor = weeklyLaborData.dailyLabor.find(l => l.date === d.date);
        return {
          ...d,
          laborPercent: dayLabor?.laborPercent || 0,
          laborCost: dayLabor?.laborCost || 0
        };
      });
    }
    
    // Calculate weekly labor totals
    const weeklyLaborTotals = weeklyLaborData && weeklySales > 0 ? {
      laborPercent: (weeklyLaborData.laborCost / weeklySales) * 100,
      laborCost: weeklyLaborData.laborCost,
      hoursWorked: weeklyLaborData.hoursWorked,
      regularHours: weeklyLaborData.regularHours,
      overtimeHours: weeklyLaborData.overtimeHours
    } : null;

    const result = {
      daily: dailySales,
      weekly: weeklySales,
      monthly: monthlySales,
      hourly: hourlyWithLabor,
      weeklyBreakdown: weeklyWithLabor,
      monthlyBreakdown: monthlyWithProjections,
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
      labor: laborData, // Labor data from Real Time Summary (if pull_labor enabled)
      weeklyLabor: weeklyLaborTotals, // Weekly labor totals (if pull_labor enabled)
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
