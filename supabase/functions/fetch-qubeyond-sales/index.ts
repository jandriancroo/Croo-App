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

// Get dates for the last N same-day-of-weeks (e.g., last 4 Fridays if today is Friday)
function getSameDayOfWeekDates(todayStr: string, count: number): string[] {
  const dates: string[] = [];
  const today = new Date(todayStr + 'T12:00:00');
  for (let i = 1; i <= count; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - (7 * i)); // Go back i weeks
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

// Get current hour in location timezone (0-23)
function getCurrentHourInTimezone(timezone: string): number {
  const now = new Date();
  const tzTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return tzTime.getHours();
}

// Get current minutes in location timezone (0-59)
function getCurrentMinutesInTimezone(timezone: string): number {
  const now = new Date();
  const tzTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return tzTime.getMinutes();
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
  const requestPayload = {
    fields: [
      { fieldName: "hour" }, { fieldName: "checksCount" }, { fieldName: "netSales" },
      { fieldName: "averageCheck" }, { fieldName: "discount" }, { fieldName: "serviceCharge" },
      { fieldName: "tax" }, { fieldName: "netSalesPercentage" }
    ],
    filters: {
      // QuBeyond endpoints vary: some expect `singleLocation`, others expect `location.operationalUnits`.
      // Provide both to keep hourly sales resilient.
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
    const errorText = await response.text().catch(() => '');
    console.error(`[HOURLY] Fetch failed (${response.status}) for ${dateStr} loc ${qbLocationId}: ${errorText.substring(0, 300)}`);
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
  
  // Fetch ALL days in parallel - QuBeyond can handle concurrent requests
  const batchSize = 10; // Increased from 3 for better parallelism
  
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
          date: { from: null, to: null, values: dates, type: "custom" },
          singleLocation: parseInt(qbLocationId)
        },
        params: {
          sectionId: "main",
          pageNumber: 1,
          pageSize: 200,
          totalRecords: null,
          // Qu expects an array here (ReportFilterSort[])
          sort: [{ field: "netSales", dir: "desc" }],
          showTotals: true
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Product mix fetch failed:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    console.log('Product mix response keys:', Object.keys(data));
    console.log('Product mix first item sample:', JSON.stringify(data.items?.[0] || 'no items'));
    
    const products: { name: string; quantity: number; sales: number; category: string }[] = [];

    const addRow = (row: any, fallbackCategory?: string) => {
      const name = row.itemName || row.productName || row.name || '';
      if (!name || name === 'Totals') return;

      const category =
        row.itemGroupName ||
        row.itemGroup ||
        row.categoryName ||
        row.category ||
        fallbackCategory ||
        '';

      const quantity = parseFloat(String(row.quantity || '0').replace(/,/g, '')) || 0;
      const sales =
        parseFloat(String(row.netSales || row.itemSales || row.sales || '0').replace(/[$,]/g, '')) || 0;

      if (quantity > 0) {
        products.push({ name, quantity, sales, category });
      }
    };

    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        // The product mix response is grouped: top-level rows contain nested `items`
        if (item.items && Array.isArray(item.items)) {
          const groupName = item.itemGroupName || item.itemGroup || item.categoryName || item.category || '';
          for (const child of item.items) {
            addRow(child, groupName);
          }
        } else {
          addRow(item);
        }
      }
    }
    
    // Log Crusts category items specifically
    const crusts = products.filter(p => p.category.toLowerCase() === 'crusts');
    console.log(`Found ${products.length} products total, ${crusts.length} in Crusts category`);
    if (crusts.length > 0) {
      console.log('Crusts items:', JSON.stringify(crusts.slice(0, 10)));
    }
    
    return products.slice(0, 100);
  } catch (error) {
    console.error('Product mix fetch error:', error);
    return [];
  }
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

// Fetch tips data from QuBeyond Tips report
async function fetchTipsData(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<{ ccTips: number; cashTips: number; totalTips: number; byEmployee: { employeeName: string; ccTips: number; cashTips: number }[] } | null> {
  console.log(`[TIPS] Fetching tips data for ${dateStr} location ${qbLocationId}`);
  
  try {
    // Try with operationalUnits filter first (same as sales endpoint)
    const requestPayload = {
      fields: [
        { fieldName: "employee" },
        { fieldName: "tips" },
        { fieldName: "creditCardTips" },
        { fieldName: "cashTips" },
        { fieldName: "totalTips" }
      ],
      filters: {
        date: { from: null, to: null, values: [dateStr], type: "custom" },
        location: { operationalUnits: [parseInt(qbLocationId)] }
      },
      params: { 
        sectionId: "main", 
        pageNumber: 1, 
        pageSize: 100, 
        totalRecords: null, 
        sort: null, 
        showTotals: true 
      }
    };
    
    console.log(`[TIPS] Request payload:`, JSON.stringify(requestPayload));
    
    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/tips/sections/main', {
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
      console.error('[TIPS] Fetch failed:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    console.log('[TIPS] RAW response:', JSON.stringify(data));
    
    let totalCcTips = 0;
    let totalCashTips = 0;
    const byEmployee: { employeeName: string; ccTips: number; cashTips: number }[] = [];
    
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        const employeeName = item.employee || '';
        // QuBeyond uses 'tipsAmount' for the tips field
        const tips = parseFloat(String(item.tipsAmount || item.tips || item.creditCardTips || item.ccTips || '0').replace(/[$,]/g, '')) || 0;
        const cashTips = parseFloat(String(item.cashTips || '0').replace(/[$,]/g, '')) || 0;
        
        totalCcTips += tips;
        totalCashTips += cashTips;
        
        if (employeeName) {
          byEmployee.push({ employeeName, ccTips: tips, cashTips });
        }
      }
    }
    
    // Also check totals if available
    if (data.totals) {
      console.log('[TIPS] Totals object:', JSON.stringify(data.totals));
      // QuBeyond uses 'tipsAmount' in totals as well
      const totalFromTotals = parseFloat(String(data.totals.tipsAmount || data.totals.tips || data.totals.creditCardTips || '0').replace(/[$,]/g, '')) || 0;
      const cashFromTotals = parseFloat(String(data.totals.cashTips || '0').replace(/[$,]/g, '')) || 0;
      if (totalFromTotals > 0) totalCcTips = totalFromTotals;
      if (cashFromTotals > 0) totalCashTips = cashFromTotals;
    }
    
    console.log(`[TIPS] Result: ccTips=${totalCcTips}, cashTips=${totalCashTips}, employees=${byEmployee.length}`);
    return { ccTips: totalCcTips, cashTips: totalCashTips, totalTips: totalCcTips + totalCashTips, byEmployee };
  } catch (error) {
    console.error('[TIPS] Fetch error:', error);
    return null;
  }
}

// Fetch tips data for multiple dates (for pay period totals)
async function fetchTipsDataForDates(
  tokenGw: string,
  dates: string[],
  qbLocationId: string
): Promise<{ ccTips: number; cashTips: number; dailyTips: { date: string; ccTips: number; cashTips: number }[] }> {
  console.log(`Fetching tips data for ${dates.length} days`);
  
  let totalCcTips = 0;
  let totalCashTips = 0;
  const dailyTips: { date: string; ccTips: number; cashTips: number }[] = [];
  
  // Fetch tips data for each date
  for (const dateStr of dates) {
    const tips = await fetchTipsData(tokenGw, dateStr, qbLocationId);
    if (tips) {
      totalCcTips += tips.ccTips;
      totalCashTips += tips.cashTips;
      dailyTips.push({
        date: dateStr,
        ccTips: tips.ccTips,
        cashTips: tips.cashTips
      });
    }
  }
  
  return { ccTips: totalCcTips, cashTips: totalCashTips, dailyTips };
}

// Generate deterministic seeded random factor between -3% and +2%
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
  // Map to -3% to +2% range (0.97 to 1.02)
  return 0.97 + (normalized * 0.05);
}

// Generate sales projections using deterministic formula (no AI)
// Hourly: (4-week same weekday+hour avg + last year same day hour) / 2 * random factor
// Daily: (4-week avg for day + last year same day) / 2 * random factor
// Weekly: (4-week avg + last year same week) / 2 * random factor
// Monthly: (last month + last year same month) / 2 * random factor
// Generate hourly projections based on historical patterns with YoY blending
function generateHourlyProjections(
  hourlyActuals: { hour: string; sales: number }[],
  hoursOpen: number,
  hoursClose: number,
  todayStr: string,
  locationId: string,
  todayProjectedTotal: number,
  fourWeekHourlyPattern?: { hour: number; avgPercent: number }[],
  yoyHourlyData?: { hour: string; sales: number }[]
): { hour: string; sales: number; projected: number }[] {
  const result: { hour: string; sales: number; projected: number }[] = [];
  
  // Calculate YoY hourly pattern percentages if available
  const yoyHourlyPattern: { [hour: number]: number } = {};
  if (yoyHourlyData && yoyHourlyData.length > 0) {
    const yoyTotal = yoyHourlyData.reduce((sum, h) => sum + h.sales, 0);
    if (yoyTotal > 0) {
      for (const h of yoyHourlyData) {
        const hourNum = parseInt(h.hour.split(':')[0]);
        yoyHourlyPattern[hourNum] = h.sales / yoyTotal;
      }
    }
  }
  
  // Default hourly distribution if no historical pattern (typical restaurant curve)
  const defaultPattern: { [hour: number]: number } = {
    10: 0.02, 11: 0.07, 12: 0.14, 13: 0.11, 14: 0.05, 15: 0.04,
    16: 0.06, 17: 0.11, 18: 0.13, 19: 0.10, 20: 0.07, 21: 0.05,
    22: 0.03, 23: 0.02
  };
  
  for (let hour = hoursOpen; hour < hoursClose; hour++) {
    const hourStr = `${hour.toString().padStart(2, '0')}:00`;
    const actual = hourlyActuals.find(h => parseInt(h.hour.split(':')[0]) === hour)?.sales || 0;
    const randomFactor = getSeededRandomFactor(`${todayStr}-${locationId}-hr${hour}`);
    
    // Get 4-week average percentage for this hour
    const fourWeekPercent = fourWeekHourlyPattern?.find(p => p.hour === hour)?.avgPercent || 0;
    // Get YoY percentage for this hour
    const yoyPercent = yoyHourlyPattern[hour] || 0;
    
    let hourlyProjected = 0;
    if (fourWeekPercent > 0 && yoyPercent > 0) {
      // Blend: (4-week pattern + YoY pattern) / 2 applied to daily projection
      const blendedPercent = (fourWeekPercent + yoyPercent) / 2;
      hourlyProjected = todayProjectedTotal * blendedPercent * randomFactor;
    } else if (fourWeekPercent > 0) {
      hourlyProjected = todayProjectedTotal * fourWeekPercent * randomFactor;
    } else if (yoyPercent > 0) {
      hourlyProjected = todayProjectedTotal * yoyPercent * randomFactor;
    } else {
      const percent = defaultPattern[hour] || 0.05;
      hourlyProjected = todayProjectedTotal * percent * randomFactor;
    }
    
    result.push({ hour: hourStr, sales: actual, projected: Math.round(hourlyProjected) });
  }
  
  return result;
}

// Generate daily projections for week view
// Uses same logic as month view for consistency
function generateDailyProjectionsForWeek(
  weeklyBreakdown: { date: string; sales: number }[],
  weekStartStr: string,
  locationId: string,
  fourWeekAverage?: { avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[] }
): { date: string; sales: number; projected: number }[] {
  const result: { date: string; sales: number; projected: number }[] = [];
  
  // Fallback averages from week data we already have (for days with sales)
  const observedDays = weeklyBreakdown.filter(d => (d.sales || 0) > 0);
  const overallAvg = observedDays.length > 0
    ? observedDays.reduce((sum, d) => sum + (d.sales || 0), 0) / observedDays.length
    : 0;

  const observedByDow: Record<number, number[]> = {};
  for (const d of observedDays) {
    const dow = new Date(d.date + 'T12:00:00').getDay();
    (observedByDow[dow] ||= []).push(d.sales || 0);
  }
  const avgByDow: Record<number, number> = {};
  for (const key of Object.keys(observedByDow)) {
    const dow = Number(key);
    const vals = observedByDow[dow];
    avgByDow[dow] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  
  // Generate all 7 days of the week
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStartStr + 'T12:00:00');
    date.setDate(date.getDate() + i);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayOfWeek = date.getDay();
    
    // Each day gets its own unique random factor seeded by date+location
    const randomFactor = getSeededRandomFactor(`${dateStr}-${locationId}`);
    
    const actual = weeklyBreakdown.find(d => d.date === dateStr)?.sales || 0;
    
    // Prefer 4-week by-DOW average when available; otherwise fall back to observed week averages
    const fourWeekBase = fourWeekAverage
      ? (fourWeekAverage.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0)
      : 0;

    const base = fourWeekBase > 0 ? fourWeekBase : (avgByDow[dayOfWeek] || overallAvg);
    const projected = base > 0 ? base * randomFactor : 0;
    
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

  const monthDate = new Date(monthStartStr + 'T12:00:00');
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();

  // Fallback averages from whatever month data we already have (typically up to today)
  const observedDays = monthlyBreakdown.filter(d => (d.sales || 0) > 0);
  const overallAvg = observedDays.length > 0
    ? observedDays.reduce((sum, d) => sum + (d.sales || 0), 0) / observedDays.length
    : 0;

  const observedByDow: Record<number, number[]> = {};
  for (const d of observedDays) {
    const dow = new Date(d.date + 'T12:00:00').getDay();
    (observedByDow[dow] ||= []).push(d.sales || 0);
  }
  const avgByDow: Record<number, number> = {};
  for (const key of Object.keys(observedByDow)) {
    const dow = Number(key);
    const vals = observedByDow[dow];
    avgByDow[dow] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayOfWeek = date.getDay();

    // Each day gets its own unique random factor seeded by date+location
    const randomFactor = getSeededRandomFactor(`${dateStr}-${locationId}`);

    const actual = monthlyBreakdown.find(d => d.date === dateStr)?.sales || 0;

    // Prefer 4-week by-DOW average when available; otherwise fall back to observed month averages
    const fourWeekBase = fourWeekAverage
      ? (fourWeekAverage.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0)
      : 0;

    const base = fourWeekBase > 0 ? fourWeekBase : (avgByDow[dayOfWeek] || overallAvg);
    const projected = base > 0 ? base * randomFactor : 0;

    result.push({ date: dateStr, sales: actual, projected: Math.round(projected) });
  }

  return result;
}

// Calculate pace-adjusted projection: actual sales + remaining hourly projections
function calculatePaceAdjustedProjection(
  actualSales: number,
  currentHour: number,
  currentMinutes: number,
  hoursOpen: number,
  hoursClose: number,
  hourlyProjections: { hour: string; projected: number }[]
): number {
  // If store is closed or hasn't opened yet, return actual sales
  if (currentHour < hoursOpen || currentHour >= hoursClose) {
    return actualSales;
  }
  
  // Calculate fraction of current hour remaining
  const minutesRemainingInCurrentHour = 60 - currentMinutes;
  const fractionOfCurrentHourRemaining = minutesRemainingInCurrentHour / 60;
  
  // Get current hour's projection and add fractional remaining portion
  const currentHourStr = `${currentHour.toString().padStart(2, '0')}:00`;
  const currentHourProjection = hourlyProjections.find(h => h.hour === currentHourStr);
  const currentHourRemainingProjection = currentHourProjection 
    ? currentHourProjection.projected * fractionOfCurrentHourRemaining 
    : 0;
  
  // Sum up projections for FUTURE hours (starting from next hour through close)
  let futureHoursProjected = 0;
  for (let hour = currentHour + 1; hour < hoursClose; hour++) {
    const hourStr = `${hour.toString().padStart(2, '0')}:00`;
    const projection = hourlyProjections.find(h => h.hour === hourStr);
    if (projection) {
      futureHoursProjected += projection.projected;
    }
  }
  
  // Total remaining = fractional current hour + all future hours
  const totalRemainingProjected = currentHourRemainingProjection + futureHoursProjected;
  
  // Pace-adjusted = actual sales + total remaining projections
  const paceAdjusted = actualSales + totalRemainingProjected;
  
  // CRITICAL: Pacing should NEVER be below actual sales - clamp to floor
  const clampedPace = Math.max(paceAdjusted, actualSales);
  
  console.log(`Pace calculation: $${actualSales.toFixed(0)} actual + $${currentHourRemainingProjection.toFixed(0)} (${minutesRemainingInCurrentHour}min left in hr ${currentHour}) + $${futureHoursProjected.toFixed(0)} future = $${clampedPace.toFixed(0)}`);
  
  return Math.round(clampedPace);
}

function generateProjections(
  dailySales: number,
  weeklySales: number,
  monthlySales: number,
  weeklyBreakdown: { date: string; sales: number }[],
  monthlyBreakdown: { date: string; sales: number }[],
  currentHour: number,
  currentMinutes: number,
  hoursOpen: number,
  hoursClose: number,
  todayStr: string,
  locationId: string,
  hourlyProjections: { hour: string; projected: number }[],
  lastYearData?: { 
    sameDay: number; 
    sameWeek: number; 
    sameMonth: number;
    lastMonth?: number;
    weeklyBreakdown: { date: string; sales: number }[];
    yoyHourlyData?: { hour: string; sales: number }[];
  },
  fourWeekAverage?: {
    avgWeekTotal: number;
    avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[];
    weeks: { weekStart: string; total: number }[];
  }
): { todayProjected: number; todayPaceAdjusted: number; weekProjected: number; monthProjected: number } {
  const today = new Date(todayStr + 'T12:00:00');
  const dayOfWeek = today.getDay();
  
  // Get consistent random factor for this date/location combination
  const randomFactor = getSeededRandomFactor(`${todayStr}-${locationId}`);
  console.log(`Projection random factor for ${todayStr}/${locationId}: ${randomFactor.toFixed(4)} (${((randomFactor - 1) * 100).toFixed(2)}%)`);
  
  // === DAILY PROJECTION (Historical-based starting projection) ===
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
  
  // NOTE: todayProjected stays as the original historical-based target
  // It should NOT be overwritten with actual sales after close
  // The "Target EOD" is what we were aiming for, "Pacing To" reflects actual performance
  
  // === PACE-ADJUSTED PROJECTION (Actual sales + remaining hourly projections) ===
  const todayPaceAdjusted = calculatePaceAdjustedProjection(
    dailySales,
    currentHour,
    currentMinutes,
    hoursOpen,
    hoursClose,
    hourlyProjections
  );
  
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
  // (Last month + last year same month) / 2 * random factor
  let monthProjected = 0;
  const lastYearSameMonth = lastYearData?.sameMonth || 0;
  const lastMonthSales = lastYearData?.lastMonth || 0;
  
  if (lastMonthSales > 0 && lastYearSameMonth > 0) {
    // Both available: average them and apply random factor
    monthProjected = ((lastMonthSales + lastYearSameMonth) / 2) * randomFactor;
  } else if (lastYearSameMonth > 0) {
    // Only last year same month available
    monthProjected = lastYearSameMonth * randomFactor;
  } else if (lastMonthSales > 0) {
    // Only last month available
    monthProjected = lastMonthSales * randomFactor;
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
  
  console.log(`Deterministic projections: daily=${todayProjected.toFixed(2)}, pace=${todayPaceAdjusted}, weekly=${weekProjected.toFixed(2)}, monthly=${monthProjected.toFixed(2)}`);
  console.log(`  Inputs: 4wkDayAvg=${fourWeekDayAvg.toFixed(2)}, lastYrDay=${lastYearSameDay.toFixed(2)}, 4wkWeekAvg=${fourWeekAvgWeek.toFixed(2)}, lastYrWeek=${lastYearSameWeek.toFixed(2)}, lastYrMonth=${lastYearSameMonth.toFixed(2)}`);
  
  return { todayProjected, todayPaceAdjusted, weekProjected, monthProjected };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { locationId, targetDate, testCredentials, skipProjections, fastMode } = await req.json().catch(() => ({}));
    
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
      
      // Fetch location hours for today's day of week
      const now = new Date();
      const timezone = 'America/Los_Angeles'; // Default timezone
      const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const dayOfWeek = localDate.getDay(); // 0 = Sunday, 6 = Saturday
      
      const { data: locationHours } = await supabase
        .from('location_hours')
        .select('open_time, close_time, is_closed')
        .eq('location_id', locationId)
        .eq('day_of_week', dayOfWeek)
        .single();
      
      if (locationHours && !locationHours.is_closed) {
        hoursOpen = parseInt(locationHours.open_time?.split(':')[0] || '11');
        // Handle midnight (00:00) as 24 for calculation purposes
        const closeHour = parseInt(locationHours.close_time?.split(':')[0] || '22');
        hoursClose = closeHour === 0 ? 24 : closeHour;
        console.log(`Location hours for day ${dayOfWeek}: ${hoursOpen}:00 - ${hoursClose === 24 ? '00' : hoursClose}:00`);
      } else {
        // Fallback to location_settings if no day-specific hours
        const { data: locationSettings } = await supabase
          .from('location_settings')
          .select('hours_open, hours_close')
          .eq('location_id', locationId)
          .single();
        
        if (locationSettings) {
          hoursOpen = parseInt(locationSettings.hours_open?.split(':')[0] || '11');
          hoursClose = parseInt(locationSettings.hours_close?.split(':')[0] || '22');
        }
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
    const currentMinutes = getCurrentMinutesInTimezone(timezone);
    
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
    
    // Always fetch tips data
    let tipsData = null;
    let weeklyTipsData: { ccTips: number; cashTips: number; dailyTips: { date: string; ccTips: number; cashTips: number }[] } | null = null;
    
    if (credentials.pull_labor) {
      console.log('Pull labor enabled - fetching labor data from Real Time Summary');
      // Fetch today's labor, weekly labor, and tips data in parallel
      const [todayLabor, weekLabor, todayTips, weekTips] = await Promise.all([
        fetchLaborData(tokenGw, todayStr, qbLocationId),
        fetchLaborDataForDates(tokenGw, weekDates, qbLocationId),
        fetchTipsData(tokenGw, todayStr, qbLocationId),
        fetchTipsDataForDates(tokenGw, weekDates, qbLocationId)
      ]);
      laborData = todayLabor;
      weeklyLaborData = weekLabor;
      tipsData = todayTips;
      weeklyTipsData = weekTips;
    } else {
      // Still fetch tips even without labor
      const [todayTips, weekTips] = await Promise.all([
        fetchTipsData(tokenGw, todayStr, qbLocationId),
        fetchTipsDataForDates(tokenGw, weekDates, qbLocationId)
      ]);
      tipsData = todayTips;
      weeklyTipsData = weekTips;
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

    const avgTicket = dailyGuestCount > 0 ? dailySales / dailyGuestCount : 0;

    // In fast mode, skip expensive historical data fetching for faster initial load
    let prevWeekSales = 0;
    let prevMonthSales = 0;
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
    
    let fourWeekHourlyPattern: { hour: number; avgPercent: number }[] | undefined;

    if (!fastMode) {
      // Fetch previous week/month breakdowns for real-time comparison
      const [prevWeekBreakdown, prevMonthBreakdown] = await Promise.all([
        fetchDailyBreakdown(tokenGw, prevWeekDates, qbLocationId),
        fetchDailyBreakdown(tokenGw, prevMonthDates, qbLocationId)
      ]);
      
      prevWeekSales = prevWeekBreakdown.reduce((sum, d) => sum + d.sales, 0);
      prevMonthSales = prevMonthBreakdown.reduce((sum, d) => sum + d.sales, 0);

      // Fetch last year data and 4-week historical data for better projections
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

      // Fetch hourly data for the last 4 same-day-of-weeks to build hourly pattern
      try {
        const sameDayDates = getSameDayOfWeekDates(todayStr, 4);
        console.log('Fetching hourly data for same-day-of-weeks:', sameDayDates.join(', '));
        
        // Fetch hourly data for all 4 same-day-of-week dates in parallel
        const hourlyDataPromises = sameDayDates.map(dateStr => fetchHourlySales(tokenGw, dateStr, qbLocationId));
        const hourlyDataResults = await Promise.all(hourlyDataPromises);
        
        // Aggregate hourly sales across all 4 days
        const hourlyTotals: { [hour: number]: number[] } = {};
        const dailyTotals: number[] = [];
        
        hourlyDataResults.forEach(dayData => {
          const dayTotal = dayData.reduce((sum, h) => sum + h.sales, 0);
          if (dayTotal > 0) {
            dailyTotals.push(dayTotal);
            dayData.forEach(h => {
              const hourNum = parseInt(h.hour.split(':')[0]);
              if (!hourlyTotals[hourNum]) hourlyTotals[hourNum] = [];
              hourlyTotals[hourNum].push(h.sales);
            });
          }
        });
        
        // Calculate average percentage for each hour
        if (dailyTotals.length > 0) {
          const avgDailyTotal = dailyTotals.reduce((sum, t) => sum + t, 0) / dailyTotals.length;
          
          fourWeekHourlyPattern = Object.entries(hourlyTotals).map(([hourStr, sales]) => {
            const avgHourlySales = sales.reduce((sum, s) => sum + s, 0) / sales.length;
            return {
              hour: parseInt(hourStr),
              avgPercent: avgDailyTotal > 0 ? avgHourlySales / avgDailyTotal : 0
            };
          }).sort((a, b) => a.hour - b.hour);
          
          console.log('Hourly pattern calculated:', fourWeekHourlyPattern.map(p => 
            `${p.hour}:00 = ${(p.avgPercent * 100).toFixed(1)}%`
          ).join(', '));
        }
      } catch (error) {
        console.error('Failed to fetch hourly pattern data:', error);
        // Continue with default pattern
      }
    } else {
      // Fast mode: fetch historical data from database cache instead of live API calls
      console.log('Fast mode enabled - fetching historical data from sales_cache...');
      
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        const today = new Date(todayStr + 'T12:00:00');
        const dayOfWeek = today.getDay();
        
        // Calculate last year same day of week (find the Saturday before Christmas last year)
        const lastYearDate = new Date(today);
        lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
        // Adjust to same day of week
        const lastYearDayOfWeek = lastYearDate.getDay();
        const dayDiff = dayOfWeek - lastYearDayOfWeek;
        lastYearDate.setDate(lastYearDate.getDate() + dayDiff);
        const lastYearTodayStr = `${lastYearDate.getFullYear()}-${String(lastYearDate.getMonth() + 1).padStart(2, '0')}-${String(lastYearDate.getDate()).padStart(2, '0')}`;
        
        // Get last 4 weeks of same day-of-week from cache
        const fourWeekDates: string[] = [];
        for (let i = 1; i <= 4; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - (i * 7));
          fourWeekDates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        }
        
        // Fetch from sales_cache in parallel
        const [fourWeekResult, lastYearResult] = await Promise.all([
          supabase
            .from('sales_cache')
            .select('sale_date, net_sales, hourly_data')
            .eq('location_id', locationId)
            .in('sale_date', fourWeekDates),
          supabase
            .from('sales_cache')
            .select('sale_date, net_sales')
            .eq('location_id', locationId)
            .eq('sale_date', lastYearTodayStr)
            .maybeSingle()
        ]);
        
        if (fourWeekResult.data && fourWeekResult.data.length > 0) {
          const validDays = fourWeekResult.data.filter(d => d.net_sales > 0);
          const avgSales = validDays.length > 0 
            ? validDays.reduce((sum, d) => sum + d.net_sales, 0) / validDays.length 
            : 0;
          
          // Build 4-week average structure
          const avgDailyByDayOfWeek = [{ dayOfWeek, avgSales }];
          
          // Calculate weekly totals for the past 4 weeks
          const weekTotals: { weekStart: string; total: number }[] = [];
          
          fourWeekAverage = {
            avgWeekTotal: avgSales * 7, // Rough estimate
            avgDailyByDayOfWeek,
            weeks: weekTotals
          };
          
          console.log(`Fast mode: 4-week avg for day ${dayOfWeek}: $${avgSales.toFixed(2)} (from ${validDays.length} days)`);
          
          // Calculate hourly pattern from cached data
          const hourlyTotals = new Map<number, { sales: number; count: number }>();
          for (const day of validDays) {
            const hourlyData = day.hourly_data as { hour: string; sales: number }[] | null;
            if (hourlyData) {
              for (const h of hourlyData) {
                const hourNum = parseInt(h.hour.split(':')[0]);
                const existing = hourlyTotals.get(hourNum) || { sales: 0, count: 0 };
                existing.sales += h.sales;
                existing.count += 1;
                hourlyTotals.set(hourNum, existing);
              }
            }
          }
          
          if (hourlyTotals.size > 0) {
            fourWeekHourlyPattern = [];
            for (const [hour, data] of hourlyTotals.entries()) {
              const avgHourlySales = data.sales / data.count;
              const percent = avgSales > 0 ? avgHourlySales / avgSales : 0;
              fourWeekHourlyPattern.push({ hour, avgPercent: percent });
            }
            fourWeekHourlyPattern.sort((a, b) => a.hour - b.hour);
          }
        }
        
        if (lastYearResult.data && lastYearResult.data.net_sales > 0) {
          lastYearData = {
            sameDay: lastYearResult.data.net_sales,
            sameWeek: 0, // Not needed for daily projection
            sameMonth: 0, // Not needed for daily projection
            weeklyBreakdown: []
          };
          console.log(`Fast mode: Last year same day (${lastYearTodayStr}): $${lastYearResult.data.net_sales.toFixed(2)}`);
        }
        
      } catch (error) {
        console.error('Fast mode: Failed to fetch from sales_cache:', error);
        // Continue without historical data - will use fallback
      }
    }

    // First, calculate preliminary daily projection for hourly distribution
    // This is needed before we can calculate pace-adjusted projection
    let preliminaryTodayProjected = dailySales * 1.3; // Default fallback
    
    if (fourWeekAverage || lastYearData) {
      const today = new Date(todayStr + 'T12:00:00');
      const dayOfWeek = today.getDay();
      const fourWeekDayAvg = fourWeekAverage?.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0;
      const lastYearSameDay = lastYearData?.sameDay || 0;
      
      if (fourWeekDayAvg > 0 && lastYearSameDay > 0) {
        preliminaryTodayProjected = (fourWeekDayAvg + lastYearSameDay) / 2;
      } else if (fourWeekDayAvg > 0) {
        preliminaryTodayProjected = fourWeekDayAvg;
      } else if (lastYearSameDay > 0) {
        preliminaryTodayProjected = lastYearSameDay;
      }
    }
    
    // Generate hourly projections first (needed for pace calculation)
    const hourlyWithProjections = generateHourlyProjections(
      todayHourly,
      hoursOpen,
      hoursClose,
      todayStr,
      locationId || 'default',
      preliminaryTodayProjected,
      fourWeekHourlyPattern
    );
    
    // Now generate full projections including pace-adjusted (using hourly projections)
    let projections = { todayProjected: 0, todayPaceAdjusted: 0, weekProjected: 0, monthProjected: 0 };
    
    if (!skipProjections) {
      console.log('Generating deterministic projections with 4-week average and last year data...');
      projections = generateProjections(
        dailySales,
        weeklySales,
        monthlySales,
        weeklyBreakdown,
        monthlyBreakdown,
        currentHour,
        currentMinutes,
        hoursOpen,
        hoursClose,
        todayStr,
        locationId || 'default',
        hourlyWithProjections,
        lastYearData,
        fourWeekAverage
      );
    } else {
      console.log('Skipping projection totals - client has cached values');
      // projections will remain 0, client will use cached values
    }
    
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

    // Calculate pizza count from "Crusts" category in product mix
    // Items with "1/2" in the name count as 0.5 pizzas each
    const pizzaCount = productMix
      .filter(item => item.category.toLowerCase() === 'crusts')
      .reduce((sum, item) => {
        const isHalf = item.name.includes('1/2') || item.name.includes('(1/2)');
        return sum + (isHalf ? item.quantity * 0.5 : item.quantity);
      }, 0);
    
    console.log(`Pizza count (Crusts category, 1/2 items counted as 0.5): ${pizzaCount}`);

    // Store calculated projections in sales_cache for FUTURE dates only
    // Once a projection is saved, it should not change (immutable)
    // Past dates already have actuals, so projections aren't needed
    if (locationId && !fastMode) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // Collect projections for future dates only (today and beyond)
      const futureDates = new Set<string>();
      const allProjections: { location_id: string; sale_date: string; projected_sales: number }[] = [];
      
      // Add weekly projections for today and future
      for (const day of weeklyWithProjections) {
        if (day.projected > 0 && day.date >= todayStr) {
          futureDates.add(day.date);
          allProjections.push({
            location_id: locationId,
            sale_date: day.date,
            projected_sales: day.projected
          });
        }
      }
      
      // Add monthly projections for future dates not in weekly
      for (const day of monthlyWithProjections) {
        if (day.projected > 0 && day.date >= todayStr && !futureDates.has(day.date)) {
          allProjections.push({
            location_id: locationId,
            sale_date: day.date,
            projected_sales: day.projected
          });
        }
      }
      
      if (allProjections.length > 0) {
        // First, check which dates already have projections saved
        const datesToCheck = allProjections.map(p => p.sale_date);
        const { data: existingData } = await supabase
          .from('sales_cache')
          .select('sale_date, projected_sales')
          .eq('location_id', locationId)
          .in('sale_date', datesToCheck);
        
        // Only save projections for dates that don't already have one
        const existingProjections = new Set(
          (existingData || [])
            .filter(d => d.projected_sales && d.projected_sales > 0)
            .map(d => d.sale_date)
        );
        
        const newProjections = allProjections.filter(p => !existingProjections.has(p.sale_date));
        
        if (newProjections.length > 0) {
          console.log(`Saving ${newProjections.length} NEW projections (skipping ${existingProjections.size} existing)...`);
          
          for (const proj of newProjections) {
            // Check if row exists first
            const { data: existing } = await supabase
              .from('sales_cache')
              .select('id')
              .eq('location_id', proj.location_id)
              .eq('sale_date', proj.sale_date)
              .single();
            
            if (existing) {
              // Row exists - only update projected_sales
              const { error } = await supabase
                .from('sales_cache')
                .update({ projected_sales: proj.projected_sales })
                .eq('location_id', proj.location_id)
                .eq('sale_date', proj.sale_date);
              
              if (error) {
                console.error(`Failed to update projection for ${proj.sale_date}:`, error.message);
              }
            } else {
              // Row doesn't exist - insert new row
              const { error } = await supabase
                .from('sales_cache')
                .insert({
                  location_id: proj.location_id,
                  sale_date: proj.sale_date,
                  projected_sales: proj.projected_sales,
                  net_sales: 0,
                  guest_count: 0
                });
              
              if (error) {
                console.error(`Failed to insert projection for ${proj.sale_date}:`, error.message);
              }
            }
          }
          
          console.log('Projections stored successfully');
        } else {
          console.log('All projections already exist, no updates needed');
        }
      }
    }

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
      pizzaCount, // Total crusts sold today
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
      tips: tipsData, // Today's tips data (CC + cash)
      weeklyTips: weeklyTipsData, // Weekly tips breakdown by day
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
      productMixCount: result.productMix.length,
      tips: result.tips,
      weeklyTips: result.weeklyTips
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
