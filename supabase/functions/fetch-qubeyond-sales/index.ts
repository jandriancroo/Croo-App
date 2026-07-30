import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireCaller } from '../_shared/callerAuth.ts';


// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuBeyondCredentials {
  location_id?: string | number;
  pull_labor?: boolean;
}

function getQbLocationId(credentials: QuBeyondCredentials): string {
  if (credentials.location_id === undefined || credentials.location_id === null) return '';
  return String(credentials.location_id).trim();
}

function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = atob(base64);
  return JSON.parse(jsonPayload);
}

// V4 OAuth2 Authentication
async function authenticateV4(): Promise<string | null> {
  const clientId = Deno.env.get('QU_USERNAME');
  const clientSecret = Deno.env.get('QU_PASSWORD');
  if (!clientId || !clientSecret) {
    console.error('[fetch-qubeyond] Missing QU_USERNAME or QU_PASSWORD env vars');
    return null;
  }
  try {
    const formData = new FormData();
    formData.append('grant_type', 'client_credentials');
    formData.append('client_id', clientId);
    formData.append('client_secret', clientSecret);
    const response = await fetch('https://gateway-api.qubeyond.com/api/v4/authentication/oauth2/access-token', {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[fetch-qubeyond] V4 OAuth2 auth failed (${response.status}): ${text.substring(0, 200)}`);
      return null;
    }
    const data = await response.json();
    if (!data.access_token) {
      console.error('[fetch-qubeyond] No access_token in OAuth2 response');
      return null;
    }
    console.log('[fetch-qubeyond] V4 OAuth2 auth OK');
    return data.access_token;
  } catch (error) {
    console.error('[fetch-qubeyond] V4 OAuth2 error:', error);
    return null;
  }
}

function getV4Headers(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'x-integration': Deno.env.get('QU_INTEGRATION_USER_ID') || '',
  };
}

function getLocalDate(date: Date, timezone: string): string {
  // Use Intl.DateTimeFormat with formatToParts for reliable timezone conversion
  const formatter = new Intl.DateTimeFormat('en-US', { 
    timeZone: timezone, 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  return `${year}-${month}-${day}`;
}

// Get timezone offset in milliseconds for a given date and timezone
function getTimezoneOffsetMs(date: Date, timezone: string): number {
  // Create formatter that shows the offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset'
  });
  const parts = formatter.formatToParts(date);
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
  
  // Parse offset like "GMT-08:00" or "GMT+05:30"
  const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3], 10);
  
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

function getDateStringForTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

// Convert a date string (YYYY-MM-DD) in a given timezone to UTC start/end times
function getUtcRangeForLocalDate(dateStr: string, timezone: string): { startUtc: string; endUtc: string } {
  // Parse the date string as components
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Create a reference date to get the timezone offset
  // Use noon to avoid DST edge cases
  const refDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetMs = getTimezoneOffsetMs(refDate, timezone);
  
  // Start of day in local timezone (00:00:00) converted to UTC
  // If timezone is GMT-8, local midnight = UTC 08:00
  const localMidnightUtc = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs;
  const localEndOfDayUtc = Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMs;
  
  return {
    startUtc: new Date(localMidnightUtc).toISOString(),
    endUtc: new Date(localEndOfDayUtc).toISOString()
  };
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

// ============ HOLIDAY-AWARE PROJECTIONS ============
// Major holidays that significantly affect sales patterns
// These need special handling in projections

interface HolidayInfo {
  name: string;
  type: 'major' | 'closed' | 'minor'; // major = compare holiday-to-holiday, closed = skip, minor = normal DOW logic
}

// Calculate dynamic holidays for a given year
function getHolidaysForYear(year: number): Map<string, HolidayInfo> {
  const holidays = new Map<string, HolidayInfo>();
  
  // Fixed-date holidays
  holidays.set(`${year}-01-01`, { name: "New Year's Day", type: 'major' });
  holidays.set(`${year}-12-31`, { name: "New Year's Eve", type: 'major' });
  holidays.set(`${year}-07-04`, { name: "Independence Day", type: 'major' });
  holidays.set(`${year}-12-25`, { name: "Christmas Day", type: 'closed' });
  holidays.set(`${year}-12-24`, { name: "Christmas Eve", type: 'major' });
  holidays.set(`${year}-02-14`, { name: "Valentine's Day", type: 'major' });
  holidays.set(`${year}-10-31`, { name: "Halloween", type: 'major' });
  holidays.set(`${year}-11-11`, { name: "Veterans Day", type: 'minor' });
  
  // MLK Day: 3rd Monday of January
  const mlkDay = getNthWeekdayOfMonth(year, 0, 1, 3); // January, Monday, 3rd
  holidays.set(mlkDay, { name: "Martin Luther King Jr. Day", type: 'minor' });
  
  // Presidents Day: 3rd Monday of February
  const presidentsDay = getNthWeekdayOfMonth(year, 1, 1, 3); // February, Monday, 3rd
  holidays.set(presidentsDay, { name: "Presidents Day", type: 'minor' });
  
  // Memorial Day: Last Monday of May
  const memorialDay = getLastWeekdayOfMonth(year, 4, 1); // May, Monday
  holidays.set(memorialDay, { name: "Memorial Day", type: 'major' });
  
  // Labor Day: 1st Monday of September
  const laborDay = getNthWeekdayOfMonth(year, 8, 1, 1); // September, Monday, 1st
  holidays.set(laborDay, { name: "Labor Day", type: 'major' });
  
  // Thanksgiving: 4th Thursday of November
  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4); // November, Thursday, 4th
  holidays.set(thanksgiving, { name: "Thanksgiving", type: 'closed' });
  // Day after Thanksgiving (Black Friday) - unique pattern
  const blackFriday = adjustDate(thanksgiving, 1);
  holidays.set(blackFriday, { name: "Black Friday", type: 'major' });
  
  // Mother's Day: 2nd Sunday of May
  const mothersDay = getNthWeekdayOfMonth(year, 4, 0, 2); // May, Sunday, 2nd
  holidays.set(mothersDay, { name: "Mother's Day", type: 'major' });
  
  // Father's Day: 3rd Sunday of June
  const fathersDay = getNthWeekdayOfMonth(year, 5, 0, 3); // June, Sunday, 3rd
  holidays.set(fathersDay, { name: "Father's Day", type: 'major' });
  
  // Super Bowl Sunday: typically 2nd Sunday of February (approximate - varies)
  const superBowl = getNthWeekdayOfMonth(year, 1, 0, 2); // February, Sunday, 2nd
  holidays.set(superBowl, { name: "Super Bowl Sunday", type: 'major' });
  
  return holidays;
}

// Get Nth weekday of a month (e.g., 3rd Monday)
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const firstDay = new Date(year, month, 1);
  let dayOfWeek = firstDay.getDay();
  let daysToAdd = (weekday - dayOfWeek + 7) % 7;
  daysToAdd += (n - 1) * 7;
  const result = new Date(year, month, 1 + daysToAdd);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

// Get last weekday of a month (e.g., last Monday of May)
function getLastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const lastDay = new Date(year, month + 1, 0); // Last day of month
  let dayOfWeek = lastDay.getDay();
  let daysToSubtract = (dayOfWeek - weekday + 7) % 7;
  const result = new Date(year, month + 1, -daysToSubtract);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

// Check if a date is a holiday and get its info
function getHolidayInfo(dateStr: string): HolidayInfo | null {
  const year = parseInt(dateStr.split('-')[0]);
  const holidays = getHolidaysForYear(year);
  return holidays.get(dateStr) || null;
}

// Find the same holiday in a different year
function getSameHolidayLastYear(todayStr: string, holidayName: string): string | null {
  const year = parseInt(todayStr.split('-')[0]);
  const lastYearHolidays = getHolidaysForYear(year - 1);
  
  for (const [dateStr, info] of lastYearHolidays.entries()) {
    if (info.name === holidayName) {
      return dateStr;
    }
  }
  return null;
}

// Determine the best comparison date for projections
// Returns: { comparisonDate: string, weight: number } 
// weight = how much to trust last year data (0-1, where 0 = ignore last year, 1 = normal blend)
function getHolidayAwareComparison(
  todayStr: string,
  lastYearSameDowStr: string
): { comparisonDate: string | null; lastYearWeight: number; reason: string } {
  const todayHoliday = getHolidayInfo(todayStr);
  const lastYearHoliday = getHolidayInfo(lastYearSameDowStr);
  
  // Case 1: Today IS a major holiday - compare to same holiday last year
  if (todayHoliday && todayHoliday.type === 'major') {
    const sameHolidayLastYear = getSameHolidayLastYear(todayStr, todayHoliday.name);
    if (sameHolidayLastYear) {
      console.log(`[HOLIDAY] Today is ${todayHoliday.name} - comparing to same holiday last year: ${sameHolidayLastYear}`);
      return { 
        comparisonDate: sameHolidayLastYear, 
        lastYearWeight: 1.0, 
        reason: `Comparing ${todayHoliday.name} to ${todayHoliday.name} last year` 
      };
    }
  }
  
  // Case 2: Today is a closed holiday - no projection needed (or very low)
  if (todayHoliday && todayHoliday.type === 'closed') {
    console.log(`[HOLIDAY] Today is ${todayHoliday.name} (closed) - minimal projection`);
    return { 
      comparisonDate: null, 
      lastYearWeight: 0, 
      reason: `${todayHoliday.name} - location likely closed` 
    };
  }
  
  // Case 3: Last year's comparison date is a major holiday - reduce its weight
  if (lastYearHoliday && lastYearHoliday.type === 'major') {
    console.log(`[HOLIDAY] Last year comparison (${lastYearSameDowStr}) was ${lastYearHoliday.name} - reducing weight to 20%`);
    return { 
      comparisonDate: lastYearSameDowStr, 
      lastYearWeight: 0.2, // Heavily favor 4-week average
      reason: `Last year was ${lastYearHoliday.name} - using mostly 4-week avg` 
    };
  }
  
  // Case 4: Last year's comparison date was a closed holiday - ignore it entirely
  if (lastYearHoliday && lastYearHoliday.type === 'closed') {
    console.log(`[HOLIDAY] Last year comparison (${lastYearSameDowStr}) was ${lastYearHoliday.name} (closed) - ignoring`);
    return { 
      comparisonDate: null, 
      lastYearWeight: 0, 
      reason: `Last year was ${lastYearHoliday.name} - using only 4-week avg` 
    };
  }
  
  // Case 5: Normal day - standard comparison
  return { 
    comparisonDate: lastYearSameDowStr, 
    lastYearWeight: 0.5, // Normal 50/50 blend
    reason: 'Normal day - standard blend' 
  };
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
    headers: getV4Headers(tokenGw),
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
    headers: getV4Headers(tokenGw),
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
      headers: getV4Headers(tokenGw),
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
          location: { operationalUnits: [parseInt(qbLocationId)] },
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
    console.log(`[TILLS] Requested location: ${qbLocationId}, date: ${dateStr}`);
    console.log('[TILLS] Full response:', JSON.stringify(data).substring(0, 1000));
    
    // Look for the totals or first item with endingCash
    let expectedCash = 0;
    let actualCash = 0;
    let overUnder = 0;
    
    if (data.totals) {
      console.log('[TILLS] Using totals from response');
      expectedCash = parseFloat(String(data.totals.endingCash || '0').replace(/[$,]/g, '')) || 0;
      actualCash = parseFloat(String(data.totals.actualCash || '0').replace(/[$,]/g, '')) || 0;
      overUnder = parseFloat(String(data.totals.overOrUnderAmount || '0').replace(/[$,]/g, '')) || 0;
    } else if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      // Log each item for debugging
      console.log(`[TILLS] Found ${data.items.length} individual till items:`);
      for (const item of data.items) {
        const itemLoc = item.location || item.locationName || 'unknown';
        const itemEmployee = item.employee || item.employeeName || 'unknown';
        const itemExpected = parseFloat(String(item.endingCash || '0').replace(/[$,]/g, '')) || 0;
        console.log(`[TILLS]   - ${itemEmployee} @ ${itemLoc}: expected=$${itemExpected}`);
        expectedCash += itemExpected;
        actualCash += parseFloat(String(item.actualCash || '0').replace(/[$,]/g, '')) || 0;
        overUnder += parseFloat(String(item.overOrUnderAmount || '0').replace(/[$,]/g, '')) || 0;
      }
    }
    
    console.log(`[TILLS] Final result: expectedCash=${expectedCash}, actualCash=${actualCash}, overUnder=${overUnder}`);
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
      headers: getV4Headers(tokenGw),
      body: JSON.stringify({
        fields: [
          { fieldName: "itemGroup" },
          { fieldName: "itemName" },
          { fieldName: "quantity" },
          { fieldName: "netSales" }
        ],
        filters: {
          date: { from: null, to: null, values: dates, type: "custom" },
          singleLocation: parseInt(qbLocationId),
          location: { operationalUnits: [parseInt(qbLocationId)] }
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
    
    return products;
  } catch (error) {
    console.error('Product mix fetch error:', error);
    return [];
  }
}

// Fetch payment types breakdown from QuBeyond using gateway API
// Qu's report endpoints vary by tenant; we try a small set of known candidates.
async function fetchPaymentTypes(
  tokenGw: string,
  dateStr: string,
  qbLocationId: string
): Promise<{ paymentType: string; amount: number }[]> {
  console.log(`[PAYMENTS] Fetching payment types for ${dateStr}`);

  const commonHeaders = getV4Headers(tokenGw);

  // Only use summary/payments - payments/main and payment-types/main always 404 for Blaze stores
  const candidates: Array<{ name: string; url: string; payload: unknown }> = [
    {
      name: 'summary/payments',
      url: 'https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/payments',
      payload: {
        fields: [{ fieldName: 'paymentType' }, { fieldName: 'total' }],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: 'custom' },
          location: { operationalUnits: [parseInt(qbLocationId)] },
        },
        params: { sectionId: 'main', pageNumber: 1, pageSize: 100, totalRecords: null, sort: null, showTotals: true },
      },
    },
  ];

  const parsePayments = (data: any): { paymentType: string; amount: number }[] => {
    const payments: { paymentType: string; amount: number }[] = [];
    const items = Array.isArray(data?.items) ? data.items : [];

    for (const item of items) {
      let rawName =
        item.paymentType ??
        item.tenderType ??
        item.tenderName ??
        item.name ??
        item.metric ??
        item.type ??
        '';

      // Handle nested objects (e.g. { name: "Cash" } from summary/payments endpoint)
      if (rawName && typeof rawName === 'object') {
        rawName = rawName.name ?? rawName.label ?? rawName.value ?? rawName.metric ?? JSON.stringify(rawName);
      }

      const paymentType = String(rawName || '').trim();
      if (!paymentType || paymentType === 'Total' || paymentType === 'Totals') continue;

      const rawAmount = item.amount ?? item.total ?? item.value ?? item.netSales ?? 0;
      const amount = parseFloat(String(rawAmount).replace(/[$,]/g, '')) || 0;
      payments.push({ paymentType, amount });
    }

    return payments;
  };

  // Fire all candidates in parallel instead of sequentially (~0.5-1.5s saved)
  const results = await Promise.allSettled(
    candidates.map(async (c) => {
      const resp = await fetch(c.url, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify(c.payload),
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.error(`[PAYMENTS] ${c.name} failed: ${resp.status} ${txt.substring(0, 120)}`);
        return { name: c.name, parsed: [] as { paymentType: string; amount: number }[], valid: false };
      }

      const data = await resp.json();
      const parsed = parsePayments(data);

      const looksLikePaymentMethods = parsed.some((p) =>
        /(cash|credit|card|visa|master|amex|doordash|uber|olo|delivery|online|grub|gift)/i.test(p.paymentType)
      );

      console.log(`[PAYMENTS] ${c.name} ok: items=${Array.isArray(data?.items) ? data.items.length : 0}, parsed=${parsed.length}, looksLikeMethods=${looksLikePaymentMethods}, types=${parsed.map(p => p.paymentType).join(',')}`);

      return { name: c.name, parsed, valid: looksLikePaymentMethods };
    })
  );

  // Pick the first valid result (preserving candidate priority order)
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.valid) {
      console.log(`[PAYMENTS] Using ${result.value.name}:`, JSON.stringify(result.value.parsed).substring(0, 800));
      return result.value.parsed;
    }
  }

  console.log('[PAYMENTS] No payment-method endpoint matched; returning empty.');
  return [];
}

// Fetch payment types for multiple dates and aggregate (PARALLEL)
async function fetchPaymentTypesForDates(
  tokenGw: string,
  dates: string[],
  qbLocationId: string
): Promise<{ paymentType: string; amount: number }[]> {
  console.log(`[PAYMENTS] Fetching payment types for ${dates.length} days (parallel)`);
  
  const aggregated: Map<string, number> = new Map();
  
  // Fetch ALL days in parallel instead of sequentially
  const results = await Promise.all(
    dates.map(dateStr => fetchPaymentTypes(tokenGw, dateStr, qbLocationId))
  );
  
  for (const dayPayments of results) {
    for (const p of dayPayments) {
      const current = aggregated.get(p.paymentType) || 0;
      aggregated.set(p.paymentType, current + p.amount);
    }
  }
  
  // Convert map to array
  const result: { paymentType: string; amount: number }[] = [];
  for (const [paymentType, amount] of aggregated.entries()) {
    result.push({ paymentType, amount });
  }
  
  return result;
}

// Get cached payment types from sales_cache for past days
async function getCachedPaymentTypes(
  supabase: any,
  locationId: string,
  dates: string[]
): Promise<{ paymentType: string; amount: number }[]> {
  if (dates.length === 0) return [];
  
  const { data, error } = await supabase
    .from('sales_cache')
    .select('sale_date, payments_data')
    .eq('location_id', locationId)
    .in('sale_date', dates);
  
  if (error || !data) {
    console.error('[PAYMENTS-CACHE] Error fetching cached payments:', error?.message);
    return [];
  }
  
  const aggregated = new Map<string, number>();
  let cachedCount = 0;
  
  for (const row of data) {
    if (row.payments_data && Array.isArray(row.payments_data)) {
      cachedCount++;
      for (const p of row.payments_data as { paymentType: string; amount: number }[]) {
        const current = aggregated.get(p.paymentType) || 0;
        aggregated.set(p.paymentType, current + p.amount);
      }
    }
  }
  
  console.log(`[PAYMENTS-CACHE] Got cached payments for ${cachedCount}/${dates.length} days`);
  
  return Array.from(aggregated.entries()).map(([paymentType, amount]) => ({ paymentType, amount }));
}

// Get cached tips from daily_tips table for past days
async function getCachedTipsData(
  supabase: any,
  locationId: string,
  dates: string[]
): Promise<{ ccTips: number; cashTips: number; dailyTips: { date: string; ccTips: number; cashTips: number }[] }> {
  if (dates.length === 0) return { ccTips: 0, cashTips: 0, dailyTips: [] };
  
  const { data, error } = await supabase
    .from('daily_tips')
    .select('tip_date, total_cc_tips, total_cash_tips')
    .eq('location_id', locationId)
    .in('tip_date', dates);
  
  if (error || !data) {
    console.error('[TIPS-CACHE] Error fetching cached tips:', error?.message);
    return { ccTips: 0, cashTips: 0, dailyTips: [] };
  }
  
  let totalCcTips = 0;
  let totalCashTips = 0;
  const dailyTips: { date: string; ccTips: number; cashTips: number }[] = [];
  
  for (const row of data) {
    const ccTips = row.total_cc_tips || 0;
    const cashTips = row.total_cash_tips || 0;
    totalCcTips += ccTips;
    totalCashTips += cashTips;
    dailyTips.push({ date: row.tip_date, ccTips, cashTips });
  }
  
  console.log(`[TIPS-CACHE] Got cached tips for ${data.length}/${dates.length} days: cc=$${totalCcTips}, cash=$${totalCashTips}`);
  return { ccTips: totalCcTips, cashTips: totalCashTips, dailyTips };
}

// Get cached hourly data for a specific date from sales_cache
async function getCachedHourlyData(
  supabase: any,
  locationId: string,
  dateStr: string
): Promise<{ hour: string; sales: number; checksCount: number }[] | null> {
  const { data, error } = await supabase
    .from('sales_cache')
    .select('hourly_data')
    .eq('location_id', locationId)
    .eq('sale_date', dateStr)
    .maybeSingle();
  
  if (error || !data?.hourly_data) return null;
  
  // hourly_data in sales_cache has hour, sales/projected, checksCount
  const hourlyData = data.hourly_data as any[];
  return hourlyData.map((h: any) => ({
    hour: h.hour || '',
    sales: h.sales || h.actual || 0,
    checksCount: h.checksCount || h.guestCount || 0
  }));
}

// Type for punch records
interface PunchRecord {
  id: string;
  user_id: string;
  punch_type: string;
  punch_time: string;
}

// Type for wage history
interface WageHistoryRecord {
  user_id: string;
  hourly_wage: number | null;
  effective_date: string;
}

// Type for profile with wage
interface ProfileWithWage {
  id: string;
  hourly_wage: number | null;
}

// Calculate labor from time_punches table (for locations using in-app punch clock)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function calculateLaborFromPunches(
  supabaseClient: any,
  locationId: string,
  dateStr: string,
  timezone: string
): Promise<{ laborPercent: number; laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; hourlyLaborCost?: Map<number, number> } | null> {
  console.log(`[PUNCH-LABOR] Calculating labor from punches for ${dateStr} location ${locationId}`);
  
  try {
    // Get all punches for this location and date
    // Use proper timezone-aware UTC range calculation
    const { startUtc, endUtc } = getUtcRangeForLocalDate(dateStr, timezone);
    
    console.log(`[PUNCH-LABOR] Querying punches for ${dateStr} (${timezone}): ${startUtc} to ${endUtc}`);
    
    const { data: punches, error: punchError } = await supabaseClient
      .from('time_punches')
      .select('id, user_id, punch_type, punch_time')
      .eq('location_id', locationId)
      .gte('punch_time', startUtc)
      .lte('punch_time', endUtc)
      .order('punch_time', { ascending: true });
    
    if (punchError) {
      console.error('[PUNCH-LABOR] Error fetching punches:', punchError);
      return null;
    }
    
    const punchRecords = (punches || []) as PunchRecord[];
    
    console.log(`[PUNCH-LABOR] Found ${punchRecords.length} punches for ${dateStr}`);
    
    if (punchRecords.length === 0) {
      console.log('[PUNCH-LABOR] No punches found for this date');
      return { laborPercent: 0, laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0 };
    }
    
    // Since we're now querying the exact UTC range for the local date,
    // all returned punches should be for the target date - use them directly
    const punchesOnDate = punchRecords;
    
    // Get unique user IDs
    const userIds = [...new Set(punchesOnDate.map(p => p.user_id))];
    
    // Fetch wages for all users (using RPC or fallback to profiles)
    const wageMap = new Map<string, number>();
    
    // First try wage_history
    const { data: wageHistoryData } = await supabaseClient
      .from('wage_history')
      .select('user_id, hourly_wage, effective_date')
      .in('user_id', userIds)
      .lte('effective_date', dateStr)
      .order('effective_date', { ascending: false });
    
    const wageHistory = (wageHistoryData || []) as WageHistoryRecord[];
    
    // Build wage map from wage_history (most recent effective_date first)
    for (const wh of wageHistory) {
      if (!wageMap.has(wh.user_id)) {
        wageMap.set(wh.user_id, wh.hourly_wage || 15);
      }
    }
    
    // Fallback to profiles.hourly_wage for users not in wage_history
    const usersWithoutWage = userIds.filter(id => !wageMap.has(id));
    if (usersWithoutWage.length > 0) {
      const { data: profilesData } = await supabaseClient
        .from('profiles')
        .select('id, hourly_wage')
        .in('id', usersWithoutWage);
      
      const profilesWithWage = (profilesData || []) as ProfileWithWage[];
      
      for (const p of profilesWithWage) {
        wageMap.set(p.id, p.hourly_wage || 15);
      }
    }
    
    // Group punches by user
    const punchesByUser = new Map<string, typeof punchesOnDate>();
    for (const punch of punchesOnDate) {
      if (!punchesByUser.has(punch.user_id)) {
        punchesByUser.set(punch.user_id, []);
      }
      punchesByUser.get(punch.user_id)!.push(punch);
    }
    
    let totalHoursWorked = 0;
    let totalLaborCost = 0;
    const now = new Date();
    // Track labor cost per hour (hour 0-23 in local timezone)
    const hourlyLaborCost = new Map<number, number>();
    
    // Helper: distribute a worked segment's cost across hours
    function distributeSegmentToHours(segStart: Date, segEnd: Date, wage: number, tz: string) {
      // Convert to local hour boundaries
      const startLocal = new Date(segStart.toLocaleString('en-US', { timeZone: tz }));
      const endLocal = new Date(segEnd.toLocaleString('en-US', { timeZone: tz }));
      
      let cursor = new Date(segStart);
      while (cursor < segEnd) {
        const cursorLocal = new Date(cursor.toLocaleString('en-US', { timeZone: tz }));
        const hour = cursorLocal.getHours();
        
        // Next hour boundary in local time
        const nextHourLocal = new Date(cursorLocal);
        nextHourLocal.setMinutes(0, 0, 0);
        nextHourLocal.setHours(hour + 1);
        
        // How many ms of this segment fall in this hour?
        const segEndInHour = segEnd < new Date(cursor.getTime() + (nextHourLocal.getTime() - cursorLocal.getTime()))
          ? segEnd
          : new Date(cursor.getTime() + (nextHourLocal.getTime() - cursorLocal.getTime()));
        
        const minutesInHour = (segEndInHour.getTime() - cursor.getTime()) / (1000 * 60);
        const costInHour = (minutesInHour / 60) * wage;
        
        hourlyLaborCost.set(hour, (hourlyLaborCost.get(hour) || 0) + costInHour);
        
        cursor = segEndInHour;
      }
    }
    
    // Calculate hours for each user
    for (const [userId, userPunches] of punchesByUser) {
      const wage = wageMap.get(userId) || 15;
      let clockInTime: Date | null = null;
      let breakStartTime: Date | null = null;
      let hoursWorked = 0;
      let breakMinutes = 0;
      // Track worked segments for hourly distribution
      const workedSegments: { start: Date; end: Date }[] = [];
      const breakSegments: { start: Date; end: Date }[] = [];
      
      for (const punch of userPunches) {
        const punchTime = new Date(punch.punch_time);
        
        switch (punch.punch_type) {
          case 'clock_in':
            if (breakStartTime) {
              const breakMs = punchTime.getTime() - breakStartTime.getTime();
              breakMinutes += breakMs / (1000 * 60);
              breakSegments.push({ start: breakStartTime, end: punchTime });
              breakStartTime = null;
            } else if (!clockInTime) {
              clockInTime = punchTime;
            }
            break;
          case 'clock_out':
            if (clockInTime) {
              const shiftMs = punchTime.getTime() - clockInTime.getTime();
              hoursWorked += shiftMs / (1000 * 60 * 60);
              workedSegments.push({ start: clockInTime, end: punchTime });
              clockInTime = null;
            }
            break;
          case 'break_start':
            breakStartTime = punchTime;
            break;
          case 'break_end':
            if (breakStartTime) {
              const breakMs = punchTime.getTime() - breakStartTime.getTime();
              breakMinutes += breakMs / (1000 * 60);
              breakSegments.push({ start: breakStartTime, end: punchTime });
              breakStartTime = null;
            }
            break;
        }
      }
      
      // Handle open punch (clocked in but not out yet) - LIVE calculation
      if (clockInTime) {
        const liveMs = now.getTime() - clockInTime.getTime();
        hoursWorked += liveMs / (1000 * 60 * 60);
        workedSegments.push({ start: clockInTime, end: now });
        console.log(`[PUNCH-LABOR] User ${userId} still clocked in - adding ${(liveMs / (1000 * 60 * 60)).toFixed(2)} live hours`);
      }
      
      // Handle open break
      if (breakStartTime) {
        const liveBreakMs = now.getTime() - breakStartTime.getTime();
        breakMinutes += liveBreakMs / (1000 * 60);
        breakSegments.push({ start: breakStartTime, end: now });
      }
      
      // Subtract breaks
      const breakHours = breakMinutes / 60;
      const netHours = Math.max(0, hoursWorked - breakHours);
      
      totalHoursWorked += netHours;
      totalLaborCost += netHours * wage;
      
      // Distribute worked segments to hourly buckets (then subtract breaks)
      for (const seg of workedSegments) {
        distributeSegmentToHours(seg.start, seg.end, wage, timezone);
      }
      for (const seg of breakSegments) {
        distributeSegmentToHours(seg.start, seg.end, -wage, timezone); // negative to subtract break cost
      }
      
      console.log(`[PUNCH-LABOR] User ${userId}: ${netHours.toFixed(2)} hours @ $${wage}/hr = $${(netHours * wage).toFixed(2)}`);
    }
    
    console.log(`[PUNCH-LABOR] Total: ${totalHoursWorked.toFixed(2)} hours, $${totalLaborCost.toFixed(2)} cost`);
    
    return {
      laborPercent: 0, // Will be calculated by caller with sales data
      laborCost: totalLaborCost,
      hoursWorked: totalHoursWorked,
      regularHours: totalHoursWorked,
      overtimeHours: 0,
      hourlyLaborCost
    };
  } catch (error) {
    console.error('[PUNCH-LABOR] Error calculating labor:', error);
    return null;
  }
}

// Calculate labor from punches for multiple dates
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function calculateLaborFromPunchesForDates(
  supabaseClient: any,
  locationId: string,
  dates: string[],
  timezone: string
): Promise<{ laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; dailyLabor: { date: string; laborPercent: number; laborCost: number }[] }> {
  console.log(`[PUNCH-LABOR] Calculating labor for ${dates.length} days`);
  
  let totalLaborCost = 0;
  let totalHoursWorked = 0;
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  const dailyLabor: { date: string; laborPercent: number; laborCost: number }[] = [];
  
  for (const dateStr of dates) {
    const labor = await calculateLaborFromPunches(supabaseClient, locationId, dateStr, timezone);
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

// QU labor fetch removed — all locations now use punch clock exclusively

// Get cached labor data from dedicated labor_cache table
// PRIORITIZES punch_clock over qubeyond (does NOT aggregate sources - picks the best one per date)
async function getCachedLaborData(
  supabase: any,
  locationId: string,
  dates: string[]
): Promise<Map<string, { laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number }>> {
  const cachedLabor = new Map<string, { laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number }>();
  
  try {
    const { data, error } = await supabase
      .from('labor_cache')
      .select('labor_date, labor_cost, labor_hours, regular_hours, overtime_hours, source')
      .eq('location_id', locationId)
      .in('labor_date', dates);
    
    if (error) {
      console.error('[LABOR-CACHE] Error fetching cached labor:', error.message);
      return cachedLabor;
    }
    
    if (data) {
      // Group by date, then pick best source: punch_clock > qubeyond (do NOT aggregate)
      const byDate = new Map<string, typeof data>();
      for (const row of data) {
        const existing = byDate.get(row.labor_date) || [];
        existing.push(row);
        byDate.set(row.labor_date, existing);
      }
      
      for (const [date, rows] of byDate) {
        // Pick punch_clock if it exists and has data, otherwise qubeyond
        const punchRow = rows.find((r: any) => r.source === 'punch_clock' && (parseFloat(r.labor_hours) > 0 || parseFloat(r.labor_cost) > 0));
        const qubeyondRow = rows.find((r: any) => r.source === 'qubeyond');
        const preferredRow = punchRow || qubeyondRow;
        
        if (preferredRow) {
          cachedLabor.set(date, {
            laborCost: parseFloat(preferredRow.labor_cost) || 0,
            hoursWorked: parseFloat(preferredRow.labor_hours) || 0,
            regularHours: parseFloat(preferredRow.regular_hours) || 0,
            overtimeHours: parseFloat(preferredRow.overtime_hours) || 0
          });
        }
      }
      console.log(`[LABOR-CACHE] Found ${data.length} labor_cache entries for ${dates.length} dates, selected ${cachedLabor.size} unique dates (prioritized punch_clock over qubeyond)`);
    }
  } catch (e) {
    console.error('[LABOR-CACHE] Exception fetching cached labor:', e);
  }
  
  return cachedLabor;
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
      headers: getV4Headers(tokenGw),
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

// Fetch historical projection data from sales_cache (NOT live API)
// This ensures projections always use your 365-day cached history
async function fetchHistoricalDataFromCache(
  supabase: any,
  locationId: string,
  todayStr: string,
  timezone: string
): Promise<{
  fourWeekAverage: {
    avgWeekTotal: number;
    avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[];
    weeks: { weekStart: string; total: number }[];
  } | undefined;
  fourWeekHourlyPattern: { hour: number; avgPercent: number }[] | undefined;
  lastYearData: {
    sameDay: number;
    sameWeek: number;
    sameMonth: number;
    weeklyBreakdown: { date: string; sales: number }[];
    monthlyBreakdown: { date: string; sales: number }[];
    hourlyData?: { hour: string; sales: number }[];
  } | undefined;
  prevWeekSales: number;
  prevMonthSales: number;
  holidayContext: { lastYearWeight: number; reason: string };
}> {
  const today = new Date(todayStr + 'T12:00:00');
  const dayOfWeek = today.getDay();
  
  // Calculate date ranges needed
  // Last 4 same-day-of-weeks (e.g., last 4 Fridays if today is Friday)
  // CUTOFF: only include days that are "yesterday or older" to avoid $0 incomplete days
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;
  
  const fourWeekDates: string[] = [];
  for (let i = 1; i <= 6; i++) { // Look back up to 6 weeks to find 4 valid same-DOW dates
    const d = new Date(today);
    d.setDate(d.getDate() - (i * 7));
    const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (dStr <= yesterdayStr) {
      fourWeekDates.push(dStr);
    }
    if (fourWeekDates.length >= 4) break;
  }
  
  // Last year same day of week
  const lastYearDate = new Date(today);
  lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
  const lastYearDayOfWeek = lastYearDate.getDay();
  const dayDiff = dayOfWeek - lastYearDayOfWeek;
  lastYearDate.setDate(lastYearDate.getDate() + dayDiff);
  const lastYearTodayStr = `${lastYearDate.getFullYear()}-${String(lastYearDate.getMonth() + 1).padStart(2, '0')}-${String(lastYearDate.getDate()).padStart(2, '0')}`;
  
  // Last year same week (Mon-Sun)
  const lastYearWeekStart = new Date(lastYearDate);
  const lyDow = lastYearWeekStart.getDay();
  const lyDiff = lyDow === 0 ? 6 : lyDow - 1;
  lastYearWeekStart.setDate(lastYearWeekStart.getDate() - lyDiff);
  const lastYearWeekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(lastYearWeekStart);
    d.setDate(d.getDate() + i);
    lastYearWeekDates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  
  // Last year same month
  const lastYearMonthStart = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const lastYearMonthEnd = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);
  const lastYearMonthDates: string[] = [];
  for (let d = new Date(lastYearMonthStart); d <= lastYearMonthEnd; d.setDate(d.getDate() + 1)) {
    lastYearMonthDates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  
  // Previous week (Mon-Sun of last week)
  const prevWeekStart = new Date(today);
  const todayDow = prevWeekStart.getDay();
  const todayDiff = todayDow === 0 ? 6 : todayDow - 1;
  prevWeekStart.setDate(prevWeekStart.getDate() - todayDiff - 7);
  const prevWeekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(prevWeekStart);
    d.setDate(d.getDate() + i);
    prevWeekDates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  
  // Previous month (full month)
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthDates: string[] = [];
  for (let d = new Date(prevMonthStart); d <= prevMonthEnd; d.setDate(d.getDate() + 1)) {
    prevMonthDates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  
  // Fetch all needed data from sales_cache in parallel
  const allDatesToFetch = [...new Set([
    ...fourWeekDates,
    lastYearTodayStr,
    ...lastYearWeekDates,
    ...lastYearMonthDates,
    ...prevWeekDates,
    ...prevMonthDates
  ])];
  
  console.log(`[CACHE] Fetching ${allDatesToFetch.length} dates from sales_cache for projections...`);
  console.log(`[CACHE] 4-week same-DOW dates: ${fourWeekDates.join(', ')}`);
  console.log(`[CACHE] Last year same day: ${lastYearTodayStr}`);
  console.log(`[CACHE] Last year week: ${lastYearWeekDates[0]} to ${lastYearWeekDates[6]}`);
  
  const { data: cacheData, error } = await supabase
    .from('sales_cache')
    .select('sale_date, net_sales, hourly_data')
    .eq('location_id', locationId)
    .in('sale_date', allDatesToFetch);
  
  if (error) {
    console.error('[CACHE] Failed to fetch from sales_cache:', error.message);
    return {
      fourWeekAverage: undefined,
      fourWeekHourlyPattern: undefined,
      lastYearData: undefined,
      prevWeekSales: 0,
      prevMonthSales: 0,
      holidayContext: { lastYearWeight: 0.5, reason: 'Cache error - using default' }
    };
  }
  
  const cacheMap = new Map<string, { net_sales: number; hourly_data: any }>();
  for (const row of (cacheData || []) as Array<{ sale_date: string; net_sales: number | null; hourly_data: any }>) {
    cacheMap.set(row.sale_date, { net_sales: row.net_sales || 0, hourly_data: row.hourly_data });
  }
  
  console.log(`[CACHE] Found ${cacheMap.size} cached days out of ${allDatesToFetch.length} requested`);
  
  // Process 4-week same-day-of-week average
  let fourWeekAverage: {
    avgWeekTotal: number;
    avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[];
    weeks: { weekStart: string; total: number }[];
  } | undefined;
  let fourWeekHourlyPattern: { hour: number; avgPercent: number }[] | undefined;
  
  const fourWeekSales = fourWeekDates.map(d => cacheMap.get(d)?.net_sales || 0).filter(s => s > 0);
  if (fourWeekSales.length > 0) {
    const avgSales = fourWeekSales.reduce((sum, s) => sum + s, 0) / fourWeekSales.length;
    
    // Calculate hourly pattern from cached hourly data
    const hourlyTotals = new Map<number, { sales: number; count: number }>();
    let totalDailySales = 0;
    let validDayCount = 0;
    
    for (const dateStr of fourWeekDates) {
      const cached = cacheMap.get(dateStr);
      if (cached && cached.net_sales > 0 && cached.hourly_data) {
        totalDailySales += cached.net_sales;
        validDayCount++;
        const hourlyData = cached.hourly_data as { hour: string; sales: number }[];
        for (const h of hourlyData) {
          const hourNum = parseInt(h.hour.split(':')[0]);
          const existing = hourlyTotals.get(hourNum) || { sales: 0, count: 0 };
          existing.sales += h.sales;
          existing.count += 1;
          hourlyTotals.set(hourNum, existing);
        }
      }
    }
    
    if (hourlyTotals.size > 0 && validDayCount > 0) {
      const avgDailyTotal = totalDailySales / validDayCount;
      fourWeekHourlyPattern = [];
      for (const [hour, data] of hourlyTotals.entries()) {
        const avgHourlySales = data.sales / data.count;
        fourWeekHourlyPattern.push({ 
          hour, 
          avgPercent: avgDailyTotal > 0 ? avgHourlySales / avgDailyTotal : 0 
        });
      }
      fourWeekHourlyPattern.sort((a, b) => a.hour - b.hour);
      console.log(`[CACHE] Hourly pattern: ${fourWeekHourlyPattern.map(p => `${p.hour}:00=${(p.avgPercent * 100).toFixed(1)}%`).join(', ')}`);
    }
    
    // Also calculate full week averages for week projection
    // Get last 4 full weeks of data
    const weekTotals: { weekStart: string; total: number }[] = [];
    for (let i = 1; i <= 4; i++) {
      const wStart = new Date(today);
      const wDow = wStart.getDay();
      const wDiff = wDow === 0 ? 6 : wDow - 1;
      wStart.setDate(wStart.getDate() - wDiff - (i * 7));
      const wStartStr = `${wStart.getFullYear()}-${String(wStart.getMonth() + 1).padStart(2, '0')}-${String(wStart.getDate()).padStart(2, '0')}`;
      
      let weekTotal = 0;
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(wStart);
        dayDate.setDate(dayDate.getDate() + d);
        const dayStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
        weekTotal += cacheMap.get(dayStr)?.net_sales || 0;
      }
      if (weekTotal > 0) {
        weekTotals.push({ weekStart: wStartStr, total: weekTotal });
      }
    }
    
    const avgWeekTotal = weekTotals.length > 0 
      ? weekTotals.reduce((sum, w) => sum + w.total, 0) / weekTotals.length 
      : avgSales * 7;
    
    // Build avgDailyByDayOfWeek for all days (using last 4 weeks of ALL days)
    const salesByDow: { [dow: number]: number[] } = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const wt of weekTotals) {
      const wStart = new Date(wt.weekStart + 'T12:00:00');
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(wStart);
        dayDate.setDate(dayDate.getDate() + d);
        const dayStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
        const sales = cacheMap.get(dayStr)?.net_sales || 0;
        if (sales > 0) {
          salesByDow[dayDate.getDay()].push(sales);
        }
      }
    }
    
    const avgDailyByDayOfWeek = Object.entries(salesByDow).map(([dow, sales]) => ({
      dayOfWeek: parseInt(dow),
      avgSales: sales.length > 0 ? sales.reduce((sum, s) => sum + s, 0) / sales.length : 0
    }));
    
    fourWeekAverage = { avgWeekTotal, avgDailyByDayOfWeek, weeks: weekTotals };
    
    console.log(`[CACHE] 4-week avg: daily for DOW ${dayOfWeek}=$${avgSales.toFixed(2)}, weekly=$${avgWeekTotal.toFixed(2)}`);
    console.log(`[CACHE] DOW averages: ${avgDailyByDayOfWeek.map(d => `${d.dayOfWeek}=$${d.avgSales.toFixed(0)}`).join(', ')}`);
  } else {
    console.log(`[CACHE] No 4-week data found for DOW ${dayOfWeek}`);
  }
  
  // Process last year data
  let lastYearData: {
    sameDay: number;
    sameWeek: number;
    sameMonth: number;
    weeklyBreakdown: { date: string; sales: number }[];
    monthlyBreakdown: { date: string; sales: number }[];
    hourlyData?: { hour: string; sales: number }[];
  } | undefined;
  
  const lastYearDayCached = cacheMap.get(lastYearTodayStr);
  const lastYearSameDay = lastYearDayCached?.net_sales || 0;
  const lastYearSameWeek = lastYearWeekDates.reduce((sum, d) => sum + (cacheMap.get(d)?.net_sales || 0), 0);
  const lastYearSameMonth = lastYearMonthDates.reduce((sum, d) => sum + (cacheMap.get(d)?.net_sales || 0), 0);
  
  if (lastYearSameDay > 0 || lastYearSameWeek > 0 || lastYearSameMonth > 0) {
    lastYearData = {
      sameDay: lastYearSameDay,
      sameWeek: lastYearSameWeek,
      sameMonth: lastYearSameMonth,
      weeklyBreakdown: lastYearWeekDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
      monthlyBreakdown: lastYearMonthDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
      hourlyData: lastYearDayCached?.hourly_data as { hour: string; sales: number }[] | undefined
    };
    console.log(`[CACHE] Last year: day=$${lastYearSameDay}, week=$${lastYearSameWeek}, month=$${lastYearSameMonth}`);
  } else {
    console.log(`[CACHE] No last year data found`);
  }
  
  // Get holiday-aware comparison context
  const holidayContext = getHolidayAwareComparison(todayStr, lastYearTodayStr);
  console.log(`[HOLIDAY] ${holidayContext.reason} (weight: ${holidayContext.lastYearWeight})`);
  
  // If holiday logic suggests a different comparison date, fetch and use that instead
  if (holidayContext.comparisonDate && holidayContext.comparisonDate !== lastYearTodayStr) {
    // Need to fetch the holiday comparison date if not already in cache
    const holidayDateCached = cacheMap.get(holidayContext.comparisonDate);
    if (holidayDateCached) {
      if (lastYearData) {
        lastYearData.sameDay = holidayDateCached.net_sales;
        lastYearData.hourlyData = holidayDateCached.hourly_data as { hour: string; sales: number }[] | undefined;
      } else {
        lastYearData = {
          sameDay: holidayDateCached.net_sales,
          sameWeek: lastYearSameWeek,
          sameMonth: lastYearSameMonth,
          weeklyBreakdown: lastYearWeekDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
          monthlyBreakdown: lastYearMonthDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
          hourlyData: holidayDateCached.hourly_data as { hour: string; sales: number }[] | undefined
        };
      }
      console.log(`[HOLIDAY] Using ${holidayContext.comparisonDate} data: $${holidayDateCached.net_sales}`);
    } else {
      // Fetch the holiday date separately
      const { data: holidayData } = await supabase
        .from('sales_cache')
        .select('net_sales, hourly_data')
        .eq('location_id', locationId)
        .eq('sale_date', holidayContext.comparisonDate)
        .single();
      
      if (holidayData) {
        if (lastYearData) {
          lastYearData.sameDay = holidayData.net_sales || 0;
          lastYearData.hourlyData = holidayData.hourly_data as { hour: string; sales: number }[] | undefined;
        } else {
          lastYearData = {
            sameDay: holidayData.net_sales || 0,
            sameWeek: lastYearSameWeek,
            sameMonth: lastYearSameMonth,
            weeklyBreakdown: lastYearWeekDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
            monthlyBreakdown: lastYearMonthDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
            hourlyData: holidayData.hourly_data as { hour: string; sales: number }[] | undefined
          };
        }
        console.log(`[HOLIDAY] Fetched ${holidayContext.comparisonDate} data: $${holidayData.net_sales}`);
      }
    }
  }
  
  // Previous week/month for comparison
  const prevWeekSales = prevWeekDates.reduce((sum, d) => sum + (cacheMap.get(d)?.net_sales || 0), 0);
  const prevMonthSales = prevMonthDates.reduce((sum, d) => sum + (cacheMap.get(d)?.net_sales || 0), 0);
  
  console.log(`[CACHE] Previous week: $${prevWeekSales}, Previous month: $${prevMonthSales}`);
  
  return { fourWeekAverage, fourWeekHourlyPattern, lastYearData, prevWeekSales, prevMonthSales, holidayContext };
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
  fourWeekAverage?: { avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[] },
  lastYearWeeklyBreakdown?: { date: string; sales: number }[]
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
    
    const actual = weeklyBreakdown.find(d => d.date === dateStr)?.sales || 0;
    
    // Prefer 4-week by-DOW average when available; otherwise fall back to observed week averages
    const fourWeekBase = fourWeekAverage
      ? (fourWeekAverage.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0)
      : 0;

    const base = fourWeekBase > 0 ? fourWeekBase : (avgByDow[dayOfWeek] || overallAvg);
    
    // Blend with last year same-day-of-week: (4wk avg + YOY) / 2
    // If no YOY data, use 4wk avg alone
    const lastYearDay = lastYearWeeklyBreakdown?.find(d => {
      const lyDow = new Date(d.date + 'T12:00:00').getDay();
      return lyDow === dayOfWeek;
    });
    const lastYearSales = lastYearDay?.sales || 0;
    
    const randomFactor = getSeededRandomFactor(`${dateStr}-${locationId}`);
    let projected: number;
    if (base > 0 && lastYearSales > 0) {
      projected = ((base + lastYearSales) / 2) * randomFactor;
    } else {
      projected = (base > 0 ? base : lastYearSales) * randomFactor;
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
  fourWeekAverage?: { avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[] },
  lastYearMonthlyBreakdown?: { date: string; sales: number }[]
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

  // Build last year lookup by day-of-week
  const lastYearByDow: Record<number, number[]> = {};
  if (lastYearMonthlyBreakdown) {
    for (const d of lastYearMonthlyBreakdown) {
      if (d.sales > 0) {
        const dow = new Date(d.date + 'T12:00:00').getDay();
        (lastYearByDow[dow] ||= []).push(d.sales);
      }
    }
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayOfWeek = date.getDay();

    const actual = monthlyBreakdown.find(d => d.date === dateStr)?.sales || 0;

    // Prefer 4-week by-DOW average when available; otherwise fall back to observed month averages
    const fourWeekBase = fourWeekAverage
      ? (fourWeekAverage.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0)
      : 0;

    const base = fourWeekBase > 0 ? fourWeekBase : (avgByDow[dayOfWeek] || overallAvg);
    
    // Blend with last year same DOW average for the month
    const lyVals = lastYearByDow[dayOfWeek];
    const lastYearAvg = lyVals && lyVals.length > 0 ? lyVals.reduce((a, b) => a + b, 0) / lyVals.length : 0;
    
    const randomFactor = getSeededRandomFactor(`${dateStr}-${locationId}`);
    let projected: number;
    if (base > 0 && lastYearAvg > 0) {
      projected = ((base + lastYearAvg) / 2) * randomFactor;
    } else {
      projected = (base > 0 ? base : lastYearAvg) * randomFactor;
    }

    result.push({ date: dateStr, sales: actual, projected: Math.round(projected) });
  }

  return result;
}

// Calculate pace-adjusted projection: actual sales + remaining hourly projections
// When <30 min into the current hour, use the full projection for that hour
// instead of partial actual, to avoid penalizing a slow start to an hour.
function calculatePaceAdjustedProjection(
  actualSales: number,
  currentHour: number,
  currentMinutes: number,
  hoursOpen: number,
  hoursClose: number,
  hourlyData: { hour: string; sales: number; projected: number }[]
): number {
  // If store is closed or hasn't opened yet, return actual sales
  if (currentHour < hoursOpen || currentHour >= hoursClose) {
    return actualSales;
  }
  
  const currentHourStr = `${currentHour.toString().padStart(2, '0')}:00`;
  const currentHourEntry = hourlyData.find(h => h.hour === currentHourStr);
  const currentHourProjection = currentHourEntry?.projected ?? 0;
  const currentHourActual = currentHourEntry?.sales ?? 0;
  
  // Under 30 minutes into the hour: treat current hour as a future hour
  // Use completed-hours actuals + full projection for current + future hours
  const usePartialHour = currentMinutes >= 30;
  
  let currentHourContribution = 0;
  if (usePartialHour) {
    // 30+ min in: actual is meaningful, add remaining fraction of projection
    const fractionRemaining = (60 - currentMinutes) / 60;
    currentHourContribution = currentHourActual + (currentHourProjection * fractionRemaining);
  } else {
    // <30 min in: use full projection for this hour (ignore partial actual)
    currentHourContribution = currentHourProjection;
  }
  
  // Sum completed hours actuals AND their projections (for trend calculation)
  let completedHoursActual = 0;
  let completedHoursProjected = 0;
  for (const entry of hourlyData) {
    const entryHour = parseInt(entry.hour.split(':')[0]);
    if (entryHour < currentHour) {
      completedHoursActual += entry.sales;
      completedHoursProjected += entry.projected;
    }
  }
  
  // Sum future hours projections (after current hour)
  let futureHoursProjected = 0;
  for (let hour = currentHour + 1; hour < hoursClose; hour++) {
    const hourStr = `${hour.toString().padStart(2, '0')}:00`;
    const entry = hourlyData.find(h => h.hour === hourStr);
    if (entry) {
      futureHoursProjected += entry.projected;
    }
  }
  
  // === SHIFT-AWARE PACE V3 ===
  // Shift boundary at 3 PM (hour 15). Before 3 PM: lunch trend. After: dinner trend.
  // If dinner has < 3 data points, carry lunch average at 50% weight.
  const SHIFT_BOUNDARY = 15;
  
  const lunchPcts: number[] = [];
  const dinnerPcts: number[] = [];
  for (const entry of hourlyData) {
    const entryHour = parseInt(entry.hour.split(':')[0]);
    if (entry.projected > 0) {
      const isCompleted = (entryHour < currentHour && entry.sales > 0) ||
                          (entryHour === currentHour && usePartialHour && entry.sales > 0);
      if (isCompleted) {
        if (entryHour < SHIFT_BOUNDARY) {
          lunchPcts.push((entry.sales - entry.projected) / entry.projected);
        } else {
          dinnerPcts.push((entry.sales - entry.projected) / entry.projected);
        }
      }
    }
  }
  
  let adjustmentFactor = 1.0;
  const isDinnerShift = currentHour >= SHIFT_BOUNDARY;
  let activeAvg: number | null = null;
  
  if (isDinnerShift) {
    if (dinnerPcts.length >= 3) {
      activeAvg = dinnerPcts.reduce((a, b) => a + b, 0) / dinnerPcts.length;
    } else if (lunchPcts.length >= 3) {
      // Carry lunch avg at 50% weight during dinner ramp-up
      activeAvg = (lunchPcts.reduce((a, b) => a + b, 0) / lunchPcts.length) * 0.5;
    }
  } else {
    if (lunchPcts.length >= 3) {
      activeAvg = lunchPcts.reduce((a, b) => a + b, 0) / lunchPcts.length;
    }
  }
  
  if (activeAvg !== null) {
    const severity = Math.min(Math.abs(activeAvg) / 0.50, 1.0);
    const rand = Math.random();
    const variant = activeAvg < 0 ? -(rand * 0.02 * severity) : rand * 0.03 * severity;
    adjustmentFactor = 1.0 + activeAvg + variant;
    console.log(`[PACE-V3] shift=${isDinnerShift ? 'dinner' : 'lunch'}, lunch=${lunchPcts.length}pts, dinner=${dinnerPcts.length}pts, avgPct: ${(activeAvg * 100).toFixed(1)}%, adjustment: ${(adjustmentFactor * 100).toFixed(1)}%`);
  }
  
  // Apply adjustment to current hour contribution and future projections
  const adjustedCurrentHour = currentHourContribution * adjustmentFactor;
  const adjustedFuture = futureHoursProjected * adjustmentFactor;
  
  const paceAdjusted = completedHoursActual + adjustedCurrentHour + adjustedFuture;
  
  // CRITICAL: Pacing should NEVER be below actual sales - clamp to floor
  const clampedPace = Math.max(paceAdjusted, actualSales);
  
  console.log(`Pace calculation: $${completedHoursActual.toFixed(0)} completed + $${adjustedCurrentHour.toFixed(0)} (hr ${currentHour}, ${usePartialHour ? (60 - currentMinutes) + 'min left' : 'full proj <30min'}) + $${adjustedFuture.toFixed(0)} future = $${clampedPace.toFixed(0)}`);
  
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
  hourlyProjections: { hour: string; sales: number; projected: number }[],
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
  },
  holidayContext?: { lastYearWeight: number; reason: string }
): { todayProjected: number; todayPaceAdjusted: number; weekProjected: number; monthProjected: number } {
  const today = new Date(todayStr + 'T12:00:00');
  const dayOfWeek = today.getDay();
  
  // Get consistent random factor for this date/location combination
  const randomFactor = getSeededRandomFactor(`${todayStr}-${locationId}`);
  console.log(`Projection random factor for ${todayStr}/${locationId}: ${randomFactor.toFixed(4)} (${((randomFactor - 1) * 100).toFixed(2)}%)`);
  
  // Holiday-aware weighting (default to 50/50 if not provided)
  const lyWeight = holidayContext?.lastYearWeight ?? 0.5;
  const fwWeight = 1 - lyWeight;
  
  // === DAILY PROJECTION (Historical-based starting projection) ===
  // Uses holiday-aware weighting instead of simple 50/50 blend
  let todayProjected = 0;
  const fourWeekDayAvg = fourWeekAverage?.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0;
  const lastYearSameDay = lastYearData?.sameDay || 0;
  
  if (fourWeekDayAvg > 0 && lastYearSameDay > 0) {
    // Both available: use holiday-aware weighted blend
    todayProjected = ((fourWeekDayAvg * fwWeight) + (lastYearSameDay * lyWeight)) * randomFactor;
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
  
  // === WEEKLY PROJECTION (Pace-adjusted) ===
  // Sum of: actuals for past days + MAX(actual, projection) for today + projections for future
  // NOTE: This will be recalculated after we have daily projections, for now use estimate
  let weekProjected = 0;
  const fourWeekAvgWeek = fourWeekAverage?.avgWeekTotal || 0;
  const lastYearSameWeek = lastYearData?.sameWeek || 0;
  
  if (fourWeekAvgWeek > 0 && lastYearSameWeek > 0) {
    weekProjected = ((fourWeekAvgWeek + lastYearSameWeek) / 2) * randomFactor;
  } else if (fourWeekAvgWeek > 0) {
    weekProjected = fourWeekAvgWeek * randomFactor;
  } else if (lastYearSameWeek > 0) {
    weekProjected = lastYearSameWeek * randomFactor;
  } else {
    const daysRemainingInWeek = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const avgDailySales = weeklyBreakdown.length > 0 ? weeklySales / weeklyBreakdown.length : todayProjected;
    weekProjected = (weeklySales + (avgDailySales * daysRemainingInWeek)) * randomFactor;
  }
  
  weekProjected = Math.max(weekProjected, weeklySales);
  
  // === MONTHLY PROJECTION (Pace-adjusted) ===
  // Sum of: actuals for past days + MAX(actual, projection) for today + projections for future
  // NOTE: This will be recalculated after we have daily projections, for now use estimate
  let monthProjected = 0;
  const lastYearSameMonth = lastYearData?.sameMonth || 0;
  const lastMonthSales = lastYearData?.lastMonth || 0;
  
  if (lastMonthSales > 0 && lastYearSameMonth > 0) {
    monthProjected = ((lastMonthSales + lastYearSameMonth) / 2) * randomFactor;
  } else if (lastYearSameMonth > 0) {
    monthProjected = lastYearSameMonth * randomFactor;
  } else if (lastMonthSales > 0) {
    monthProjected = lastMonthSales * randomFactor;
  } else {
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysRemainingInMonth = daysInMonth - today.getDate();
    const daysOfData = monthlyBreakdown.length;
    const monthAvgDaily = daysOfData > 0 ? monthlySales / daysOfData : todayProjected;
    monthProjected = (monthlySales + (monthAvgDaily * daysRemainingInMonth)) * randomFactor;
  }
  
  monthProjected = Math.max(monthProjected, monthlySales);
  
  console.log(`Deterministic projections: daily=${todayProjected.toFixed(2)}, pace=${todayPaceAdjusted}, weekly=${weekProjected.toFixed(2)}, monthly=${monthProjected.toFixed(2)}`);
  console.log(`  Inputs: 4wkDayAvg=${fourWeekDayAvg.toFixed(2)}, lastYrDay=${lastYearSameDay.toFixed(2)}, 4wkWeekAvg=${fourWeekAvgWeek.toFixed(2)}, lastYrWeek=${lastYearSameWeek.toFixed(2)}, lastYrMonth=${lastYearSameMonth.toFixed(2)}`);
  
  return { todayProjected, todayPaceAdjusted, weekProjected, monthProjected };
}

// Calculate pace-adjusted week/month projections
// Logic: past days use actuals, today uses MAX(actual, projection), future days use projections
function calculatePaceAdjustedTotals(
  weeklyWithProjections: { date: string; sales: number; projected: number }[],
  monthlyWithProjections: { date: string; sales: number; projected: number }[],
  todayStr: string,
  dailySales: number,
  todayProjected: number
): { weekProjected: number; monthProjected: number } {
  // For today: use MAX(actual, projection) - once you beat the target, the total adjusts up
  const todayContribution = Math.max(dailySales, todayProjected);
  
  // Calculate pace-adjusted weekly total
  let weekProjected = 0;
  for (const day of weeklyWithProjections) {
    if (day.date < todayStr) {
      // Past day: use actual sales
      weekProjected += day.sales;
    } else if (day.date === todayStr) {
      // Today: use MAX(actual, projection)
      weekProjected += todayContribution;
    } else {
      // Future day: use projection
      weekProjected += day.projected;
    }
  }
  
  // Calculate pace-adjusted monthly total
  let monthProjected = 0;
  for (const day of monthlyWithProjections) {
    if (day.date < todayStr) {
      // Past day: use actual sales
      monthProjected += day.sales;
    } else if (day.date === todayStr) {
      // Today: use MAX(actual, projection)
      monthProjected += todayContribution;
    } else {
      // Future day: use projection
      monthProjected += day.projected;
    }
  }
  
  console.log(`Pace-adjusted totals: week=$${weekProjected.toFixed(2)}, month=$${monthProjected.toFixed(2)} (today contribution: $${todayContribution.toFixed(2)} = max(${dailySales}, ${todayProjected.toFixed(2)}))`);
  
  return { weekProjected, monthProjected };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Require a real caller: service role (cron/edge-to-edge) or a signature-
  // verified session — a logged-in manager OR a paired punch-clock device.
  const authed = await requireCaller(req, corsHeaders);
  if ('response' in authed) return authed.response;

  try {

    const { locationId, targetDate, testCredentials, skipProjections } = await req.json().catch(() => ({}));
    
    let credentials: QuBeyondCredentials;
    let hoursOpen = 11;
    let hoursClose = 22;
    let integration: any = null;
    
    if (testCredentials) {
      credentials = {
        location_id: testCredentials.location_id,
        pull_labor: !!testCredentials.pull_labor,
      };
    } else if (locationId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const { data: integrationData, error } = await supabase
        .from('location_integrations')
        .select('id, credentials, is_active, cached_token_gw, token_expires_at')
        .eq('location_id', locationId)
        .eq('integration_type', 'qubeyond')
        .single();
      integration = integrationData;
      
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
      credentials = {};
    }

    // V4 OAuth2 Authentication (replaces legacy scraping)
    const v4Token = await authenticateV4();
    if (!v4Token) throw new Error('V4 OAuth2 authentication failed');
    
    let tokenGw: string = v4Token;
    let jwtPayload: any = {}; // Empty — V4 doesn't use JWT payload
    let bearerToken: string = v4Token; // For compatibility

    // Handle location_id being a number or string in credentials
    const qbLocationId = getQbLocationId(credentials);
    
    // Extract company ID from env var
    const companyId = Deno.env.get('QU_CID') || '';
    
    console.log('Using QuBeyond location ID:', qbLocationId);
    console.log('Using Company ID:', companyId);
    console.log('V4 Authentication successful');

    if (testCredentials) {
      // Probe the actual operationalUnit on QU's side so we can detect stores
      // that authenticate fine but are NOT on the API client's allow-list
      // (QU returns 403 "No operational units allowed for the current user").
      let authorized = true;
      let authorizationError: string | null = null;
      if (qbLocationId) {
        try {
          const probeBody = {
            fields: [{ fieldName: 'checkNumber' }],
            filters: {
              date: { from: null, to: null, values: [new Date().toISOString().slice(0, 10)], type: 'custom' },
              singleLocation: parseInt(qbLocationId),
              location: { operationalUnits: [parseInt(qbLocationId)] },
            },
            params: { sectionId: 'main', pageNumber: 1, pageSize: 1, totalRecords: null, sort: null, showTotals: false },
          };
          const probeRes = await fetch(
            'https://gateway-api.qubeyond.com/api/v4/data/reports/check-detail/sections/main',
            { method: 'POST', headers: getV4Headers(v4Token), body: JSON.stringify(probeBody) }
          );
          if (probeRes.status === 403) {
            const txt = await probeRes.text().catch(() => '');
            authorized = false;
            authorizationError = txt.includes('No operational units')
              ? 'STORE_NOT_PROVISIONED'
              : `QU 403: ${txt.slice(0, 200)}`;
          } else if (!probeRes.ok) {
            const txt = await probeRes.text().catch(() => '');
            authorized = false;
            authorizationError = `QU ${probeRes.status}: ${txt.slice(0, 200)}`;
          }
        } catch (e) {
          authorized = false;
          authorizationError = `Probe failed: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      }

      return new Response(JSON.stringify({
        authenticated: true,
        authorized,
        authorizationError,
        authMethod: 'V4 OAuth2',
        discoveredLocationId: qbLocationId,
        companyId,
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

    // === NEW APPROACH: Only fetch TODAY live, get past days from sales_cache ===
    // For WTD/MTD, we already save each day's data to sales_cache after fetching
    // So we only need to live-fetch today, then combine with cached past days
    
    // Get past WTD/MTD days from sales_cache (exclude today - we'll get that live)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cacheSupabase = createClient(supabaseUrl, supabaseKey);
    
    // Dates before today for WTD and MTD
    const pastWeekDates = weekDates.filter(d => d < todayStr);
    const pastMonthDates = monthDates.filter(d => d < todayStr);
    
    // Fetch cached data for past days (including pizza_count for aggregation)
    const allPastDates = [...new Set([...pastWeekDates, ...pastMonthDates])];
    let cachedPastData: { sale_date: string; net_sales: number; guest_count: number; pizza_count: number | null }[] = [];
    
    if (allPastDates.length > 0 && locationId) {
      const { data: pastCacheData } = await cacheSupabase
        .from('sales_cache')
        .select('sale_date, net_sales, guest_count, pizza_count')
        .eq('location_id', locationId)
        .in('sale_date', allPastDates);
      
      cachedPastData = pastCacheData || [];
      console.log(`[CACHE] Loaded ${cachedPastData.length} past days from sales_cache for WTD/MTD`);
    }
    
    // Build a quick lookup map for cached past days
    const pastCacheMap = new Map<string, { sales: number; guestCount: number; pizzaCount: number }>();
    for (const row of cachedPastData) {
      pastCacheMap.set(row.sale_date, { 
        sales: row.net_sales || 0, 
        guestCount: row.guest_count || 0,
        pizzaCount: row.pizza_count || 0
      });
    }

    // Fetch hourly data for today live; previous day from CACHE (already synced)
    // This eliminates one live QuBeyond API call (~1s saved)
    // === UNIFIED PARALLEL BLOCK: Live API calls + DB reads all at once ===
    const [
      todayHourly,
      cachedPrevDayHourly,
      productMix,
      tillsData,
      todayPayments,
      allWeekTips,
      historicalData
    ] = await Promise.all([
      fetchHourlySales(tokenGw, todayStr, qbLocationId),
      locationId ? getCachedHourlyData(cacheSupabase, locationId, prevDayStr) : Promise.resolve(null),
      fetchProductMix(tokenGw, [todayStr], qbLocationId),
      fetchTillsData(tokenGw, todayStr, qbLocationId),
      fetchPaymentTypes(tokenGw, todayStr, qbLocationId),
      // DB reads that previously ran sequentially - now parallel with API calls
      locationId ? getCachedTipsData(cacheSupabase, locationId, weekDates) : Promise.resolve({ ccTips: 0, cashTips: 0, dailyTips: [] }),
      locationId ? fetchHistoricalDataFromCache(cacheSupabase, locationId, todayStr, timezone) : Promise.resolve({
        fourWeekAverage: undefined, fourWeekHourlyPattern: undefined, lastYearData: undefined,
        prevWeekSales: 0, prevMonthSales: 0, holidayContext: { lastYearWeight: 0.5, reason: 'No location' }
      })
    ]);
    
    // If cache miss for prev day, fall back to live fetch
    const prevDayHourly = cachedPrevDayHourly || await fetchHourlySales(tokenGw, prevDayStr, qbLocationId);

    // Fetch labor data - from Qu if pull_labor enabled, otherwise from punches
    let laborData = null;
    let weeklyLaborData: { laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; dailyLabor: { date: string; laborPercent: number; laborCost: number }[] } | null = null;
    let monthlyLaborData: { laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number; dailyLabor: { date: string; laborPercent: number; laborCost: number }[] } | null = null;
    let laborSource: 'punches' | null = null;
    
    // Tips from DB cache (already fetched in parallel above)
    let tipsData = null;
    let weeklyTipsData: { ccTips: number; cashTips: number; dailyTips: { date: string; ccTips: number; cashTips: number }[] } | null = null;
    
    if (locationId && allWeekTips) {
      tipsData = allWeekTips.dailyTips.find(d => d.date === todayStr) 
        ? { ccTips: allWeekTips.dailyTips.find(d => d.date === todayStr)!.ccTips, cashTips: allWeekTips.dailyTips.find(d => d.date === todayStr)!.cashTips, totalTips: 0, byEmployee: [] as any[] }
        : null;
      if (tipsData) tipsData.totalTips = tipsData.ccTips + tipsData.cashTips;
      weeklyTipsData = allWeekTips;
      console.log(`[TIPS] Loaded from DB cache: ${allWeekTips.dailyTips.length} days, cc=$${allWeekTips.ccTips}, cash=$${allWeekTips.cashTips}`);
    }
    
    // Labor: always use punch clock (QU labor sync removed)
    console.log('Using punch clock for all labor data');
    
    if (locationId) {
      const pastMonthDates = monthDates.filter(d => d < todayStr);
      const cachedLabor = await getCachedLaborData(cacheSupabase, locationId, pastMonthDates);
      
      const cachedDates: string[] = [];
      const punchDates: string[] = [];
      
      for (const dateStr of pastMonthDates) {
        const cached = cachedLabor.get(dateStr);
        if (cached && cached.laborCost > 0) {
          cachedDates.push(dateStr);
        } else {
          punchDates.push(dateStr);
        }
      }
      
      console.log(`[LABOR] Cached dates (${cachedDates.length}), Punch dates (${punchDates.length + 1})`);
      
      const [todayPunchLabor, weekPunchLabor, punchMonthLabor] = await Promise.all([
        calculateLaborFromPunches(cacheSupabase, locationId, todayStr, timezone),
        calculateLaborFromPunchesForDates(cacheSupabase, locationId, weekDates, timezone),
        punchDates.length > 0
          ? calculateLaborFromPunchesForDates(cacheSupabase, locationId, punchDates, timezone)
          : Promise.resolve({ laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0, dailyLabor: [] }),
      ]);
      
      laborData = todayPunchLabor;
      weeklyLaborData = weekPunchLabor;
      
      // Calculate cached labor totals
      let cachedLaborCost = 0;
      let cachedHoursWorked = 0;
      let cachedRegularHours = 0;
      let cachedOvertimeHours = 0;
      const cachedDailyLabor: { date: string; laborPercent: number; laborCost: number }[] = [];
      
      for (const dateStr of cachedDates) {
        const cached = cachedLabor.get(dateStr);
        if (cached) {
          cachedLaborCost += cached.laborCost;
          cachedHoursWorked += cached.hoursWorked;
          cachedRegularHours += cached.regularHours;
          cachedOvertimeHours += cached.overtimeHours;
          cachedDailyLabor.push({ date: dateStr, laborPercent: 0, laborCost: cached.laborCost });
        }
      }
      
      const punchLabor = punchMonthLabor || { laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0, dailyLabor: [] };
      const todayLaborData = todayPunchLabor || { laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0 };
      
      monthlyLaborData = {
        laborCost: cachedLaborCost + punchLabor.laborCost + todayLaborData.laborCost,
        hoursWorked: cachedHoursWorked + punchLabor.hoursWorked + todayLaborData.hoursWorked,
        regularHours: cachedRegularHours + punchLabor.regularHours + todayLaborData.regularHours,
        overtimeHours: cachedOvertimeHours + punchLabor.overtimeHours + todayLaborData.overtimeHours,
        dailyLabor: [...cachedDailyLabor, ...punchLabor.dailyLabor]
      };
      
      console.log(`[LABOR] MTD: $${monthlyLaborData.laborCost.toFixed(2)} / ${monthlyLaborData.hoursWorked.toFixed(1)}h`);
      
      // REMOVED: cacheLaborData() call formerly lived here.
      // Reason: fetch-qubeyond-sales is read-only for labor. labor-service owns
      // labor_cache writes with proper overnight-shift handling and breakdown
      // validation. The simpler calculateLaborFromPunches here uses a narrow UTC
      // range that misses clock_outs past midnight, treating them as "still clocked
      // in" and inflating hours by (now - clockIn) which can be DAYS of phantom hours.
      
      laborSource = 'punches';
    } else {
      console.log('[LABOR] No location ID, skipping labor');
    }


    // === PAYMENT TYPES: Use DB cache for past days, only today from live API ===
    // This eliminates sequential per-day API calls (saves 3-6 seconds)
    const pastWeekPaymentDates = weekDates.filter(d => d !== todayStr);
    const pastMonthPaymentDates = monthDates.filter(d => d !== todayStr);
    
    const [weekPaymentsFromCache, monthPaymentsFromCache] = await Promise.all([
      locationId && pastWeekPaymentDates.length > 0
        ? getCachedPaymentTypes(cacheSupabase, locationId, pastWeekPaymentDates)
        : Promise.resolve([]),
      locationId && pastMonthPaymentDates.length > 0
        ? getCachedPaymentTypes(cacheSupabase, locationId, pastMonthPaymentDates)
        : Promise.resolve([])
    ]);
    
    // Merge today's live payments with cached past days
    const mergePayments = (existing: { paymentType: string; amount: number }[], today: { paymentType: string; amount: number }[]) => {
      const map = new Map<string, number>();
      for (const p of existing) {
        map.set(p.paymentType, (map.get(p.paymentType) || 0) + p.amount);
      }
      for (const p of today) {
        map.set(p.paymentType, (map.get(p.paymentType) || 0) + p.amount);
      }
      return Array.from(map.entries()).map(([paymentType, amount]) => ({ paymentType, amount }));
    };
    
    const weeklyPayments = mergePayments(weekPaymentsFromCache, todayPayments);
    const monthlyPayments = mergePayments(monthPaymentsFromCache, todayPayments);

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

    // === BUILD WTD/MTD FROM CACHE + TODAY ===
    // Calculate today's pizza count from product mix (will be estimated if no product mix)
    const todayPizzaCount = productMix
      .filter(item => item.category.toLowerCase() === 'crusts')
      .reduce((sum, item) => {
        const isHalf = item.name.includes('1/2') || item.name.includes('(1/2)');
        return sum + (isHalf ? item.quantity * 0.5 : item.quantity);
      }, 0);
    
    // Weekly breakdown: past days from cache + today live (now includes pizza count)
    const weeklyBreakdown: { date: string; sales: number; guestCount: number; pizzaCount: number }[] = [];
    for (const dateStr of weekDates) {
      if (dateStr === todayStr) {
        // Today - use live data
        weeklyBreakdown.push({ date: dateStr, sales: dailySales, guestCount: dailyGuestCount, pizzaCount: todayPizzaCount });
      } else {
        // Past day - use cache
        const cached = pastCacheMap.get(dateStr);
        weeklyBreakdown.push({ 
          date: dateStr, 
          sales: cached?.sales || 0, 
          guestCount: cached?.guestCount || 0,
          pizzaCount: cached?.pizzaCount || 0
        });
      }
    }
    
    // Monthly breakdown: past days from cache + today live (now includes pizza count)
    const monthlyBreakdown: { date: string; sales: number; guestCount: number; pizzaCount: number }[] = [];
    for (const dateStr of monthDates) {
      if (dateStr === todayStr) {
        // Today - use live data
        monthlyBreakdown.push({ date: dateStr, sales: dailySales, guestCount: dailyGuestCount, pizzaCount: todayPizzaCount });
      } else {
        // Past day - use cache
        const cached = pastCacheMap.get(dateStr);
        monthlyBreakdown.push({ 
          date: dateStr, 
          sales: cached?.sales || 0, 
          guestCount: cached?.guestCount || 0,
          pizzaCount: cached?.pizzaCount || 0
        });
      }
    }

    // Calculate weekly/monthly totals from combined breakdown (now includes pizza counts)
    const weeklySales = weeklyBreakdown.reduce((sum, d) => sum + d.sales, 0);
    const weeklyGuestCount = weeklyBreakdown.reduce((sum, d) => sum + d.guestCount, 0);
    const weeklyPizzaCount = weeklyBreakdown.reduce((sum, d) => sum + d.pizzaCount, 0);
    const monthlySales = monthlyBreakdown.reduce((sum, d) => sum + d.sales, 0);
    const monthlyGuestCount = monthlyBreakdown.reduce((sum, d) => sum + d.guestCount, 0);
    const monthlyPizzaCount = monthlyBreakdown.reduce((sum, d) => sum + d.pizzaCount, 0);
    
    console.log(`[OPTIMIZED] WTD: $${weeklySales}, ${weeklyGuestCount} guests, ${weeklyPizzaCount} pizzas`);
    console.log(`[OPTIMIZED] MTD: $${monthlySales}, ${monthlyGuestCount} guests, ${monthlyPizzaCount} pizzas`);

    const avgTicket = dailyGuestCount > 0 ? dailySales / dailyGuestCount : 0;

    // historicalData already fetched in the main parallel block above
    const { fourWeekAverage, fourWeekHourlyPattern, prevWeekSales, prevMonthSales, holidayContext } = historicalData;
    
    // Map lastYearData to expected shape
    const lastYearData = historicalData.lastYearData ? {
      sameDay: historicalData.lastYearData.sameDay,
      sameWeek: historicalData.lastYearData.sameWeek,
      sameMonth: historicalData.lastYearData.sameMonth,
      weeklyBreakdown: historicalData.lastYearData.weeklyBreakdown,
      monthlyBreakdown: historicalData.lastYearData.monthlyBreakdown
    } : undefined;

    // First, calculate preliminary daily projection for hourly distribution
    // This is needed before we can calculate pace-adjusted projection
    // Uses holiday-aware weighting for the blend
    let preliminaryTodayProjected = dailySales * 1.3; // Default fallback
    
    if (fourWeekAverage || lastYearData) {
      const today = new Date(todayStr + 'T12:00:00');
      const dayOfWeek = today.getDay();
      const fourWeekDayAvg = fourWeekAverage?.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0;
      const lastYearSameDay = lastYearData?.sameDay || 0;
      
      // Use holiday-aware weighting instead of simple 50/50 blend
      const lyWeight = holidayContext.lastYearWeight;
      const fwWeight = 1 - lyWeight;
      
      if (fourWeekDayAvg > 0 && lastYearSameDay > 0) {
        // Weighted blend based on holiday context
        preliminaryTodayProjected = (fourWeekDayAvg * fwWeight) + (lastYearSameDay * lyWeight);
        console.log(`[PROJECTION] Holiday-aware blend: 4wk($${fourWeekDayAvg.toFixed(0)} × ${(fwWeight * 100).toFixed(0)}%) + LY($${lastYearSameDay.toFixed(0)} × ${(lyWeight * 100).toFixed(0)}%) = $${preliminaryTodayProjected.toFixed(0)}`);
      } else if (fourWeekDayAvg > 0) {
        preliminaryTodayProjected = fourWeekDayAvg;
        console.log(`[PROJECTION] Using 4-week avg only: $${fourWeekDayAvg.toFixed(0)}`);
      } else if (lastYearSameDay > 0) {
        preliminaryTodayProjected = lastYearSameDay;
        console.log(`[PROJECTION] Using last year only: $${lastYearSameDay.toFixed(0)}`);
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
    let projections: any = { todayProjected: 0, todayPaceAdjusted: 0, weekProjected: 0, monthProjected: 0, todaySource: 'calculated' as string };
    
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
        fourWeekAverage,
        holidayContext
      );
      
      // === OVERRIDE CHECK ===
      // Check if there's a manager override for today's projection
      // Priority: override_projection > living_projection > initial_projection > calculated
      if (locationId) {
        const { data: todayCache } = await cacheSupabase
          .from('sales_cache')
          .select('override_projection, living_projection, initial_projection')
          .eq('location_id', locationId)
          .eq('sale_date', todayStr)
          .maybeSingle();
        
        if (todayCache) {
          // Use Source of Truth priority: override > living > initial > calculated
          let resolvedProjection = projections.todayProjected;
          let projectionSource = 'calculated';
          
          if (todayCache.override_projection && todayCache.override_projection > 0) {
            resolvedProjection = todayCache.override_projection;
            projectionSource = 'override';
          } else if (todayCache.living_projection && todayCache.living_projection > 0) {
            resolvedProjection = todayCache.living_projection;
            projectionSource = 'living';
          } else if (todayCache.initial_projection && todayCache.initial_projection > 0) {
            resolvedProjection = todayCache.initial_projection;
            projectionSource = 'initial';
          }
          
          // Update source even if projection matches (to track source correctly)
          projections.todaySource = projectionSource;
          
          if (resolvedProjection !== projections.todayProjected) {
            console.log(`[PROJECTION] Using ${projectionSource} projection: $${resolvedProjection} (was $${projections.todayProjected.toFixed(0)} calculated)`);
            projections.todayProjected = resolvedProjection;
            
            // Scale hourly projections IN-PLACE so the chart shows override-scaled values
            const origTotal = hourlyWithProjections.reduce((sum, h) => sum + (h.projected || 0), 0);
            const paceScaleFactor = origTotal > 0 ? resolvedProjection / origTotal : 1;
            if (Math.abs(paceScaleFactor - 1) > 0.01) {
              for (let i = 0; i < hourlyWithProjections.length; i++) {
                hourlyWithProjections[i] = {
                  ...hourlyWithProjections[i],
                  projected: Math.round((hourlyWithProjections[i].projected || 0) * paceScaleFactor)
                };
              }
              console.log(`[PROJECTION] Scaled hourly projections by ${paceScaleFactor.toFixed(3)}x for ${projectionSource} override`);
            }
            
            // Recalculate pace using the now-scaled hourly projections
            projections.todayPaceAdjusted = calculatePaceAdjustedProjection(
              dailySales,
              currentHour,
              currentMinutes,
              hoursOpen,
              hoursClose,
              hourlyWithProjections
            );
            console.log(`[PROJECTION] Recalculated pace with ${projectionSource}: $${projections.todayPaceAdjusted.toFixed(0)} (actual $${dailySales.toFixed(0)}, scale ${paceScaleFactor.toFixed(3)})`);
          }
        }
      }
    } else {
      console.log('Skipping projection totals - client has cached values');
      // projections will remain 0, client will use cached values
    }
    
    // === ALWAYS SCALE HOURLY PROJECTIONS FOR OVERRIDES ===
    // This must run even when skipProjections is true, so the chart hourly data
    // in the response (and saved to cache) reflects the override-scaled curve.
    if (locationId) {
      const { data: overrideCheck } = await cacheSupabase
        .from('sales_cache')
        .select('override_projection, living_projection, initial_projection')
        .eq('location_id', locationId)
        .eq('sale_date', todayStr)
        .maybeSingle();
      
      if (overrideCheck) {
        let scaleTarget = 0;
        if (overrideCheck.override_projection && overrideCheck.override_projection > 0) {
          scaleTarget = overrideCheck.override_projection;
        } else if (overrideCheck.living_projection && overrideCheck.living_projection > 0) {
          scaleTarget = overrideCheck.living_projection;
        } else if (overrideCheck.initial_projection && overrideCheck.initial_projection > 0) {
          scaleTarget = overrideCheck.initial_projection;
        }
        
        if (scaleTarget > 0) {
          const origTotal = hourlyWithProjections.reduce((sum, h) => sum + (h.projected || 0), 0);
          const paceScaleFactor = origTotal > 0 ? scaleTarget / origTotal : 1;
          if (Math.abs(paceScaleFactor - 1) > 0.01) {
            for (let i = 0; i < hourlyWithProjections.length; i++) {
              hourlyWithProjections[i] = {
                ...hourlyWithProjections[i],
                projected: Math.round((hourlyWithProjections[i].projected || 0) * paceScaleFactor)
              };
            }
            console.log(`[PROJECTION-SCALE] Scaled hourly projections by ${paceScaleFactor.toFixed(3)}x to match override target $${scaleTarget}`);
          }
        }
      }
    }
    
    // Generate daily projections for week (uses 4-week average + YOY blend)
    const weeklyWithProjections = generateDailyProjectionsForWeek(
      weeklyBreakdown,
      weekStartStr,
      locationId || 'default',
      fourWeekAverage,
      lastYearData?.weeklyBreakdown
    );
    
    // Generate daily projections for month (uses 4-week average + YOY blend)
    const lastYearMonthBreakdown = historicalData.lastYearData?.monthlyBreakdown;
    const monthlyWithProjections = generateDailyProjectionsForMonth(
      monthlyBreakdown,
      monthStartStr,
      locationId || 'default',
      fourWeekAverage,
      lastYearMonthBreakdown
    );
    
    // Recalculate week/month projections using pace logic:
    // Past days: actuals, Today: MAX(actual, projection), Future: projections
    if (!skipProjections && projections.todayProjected > 0) {
      const paceAdjusted = calculatePaceAdjustedTotals(
        weeklyWithProjections,
        monthlyWithProjections,
        todayStr,
        dailySales,
        projections.todayProjected
      );
      projections.weekProjected = paceAdjusted.weekProjected;
      projections.monthProjected = paceAdjusted.monthProjected;
    }
    // Calculate daily labor percent now that we have sales (for punch-based labor)
    // IMPORTANT: do this BEFORE we decorate hourly data, since the UI uses hourly.laborPercent.
    if (laborSource === 'punches' && laborData && dailySales > 0) {
      laborData.laborPercent = (laborData.laborCost / dailySales) * 100;
      console.log(`[PUNCH-LABOR] Daily labor percent: ${laborData.laborPercent.toFixed(1)}% ($${laborData.laborCost.toFixed(2)} / $${dailySales.toFixed(2)})`);
    }

    // For punch-based weekly/monthly labor, compute per-day laborPercent now that we have sales.
    // (The punch labor calculators return laborPercent=0 and expect the caller to compute % from sales.)
    if (laborSource === 'punches') {
      const salesByDate = new Map<string, number>();
      // Weekly breakdown contains all 7 days with actual sales (cached for past days).
      for (const d of weeklyBreakdown) salesByDate.set(d.date, d.sales);
      // Monthly breakdown contains all days in month with actual sales.
      for (const d of monthlyBreakdown) salesByDate.set(d.date, d.sales);

      if (weeklyLaborData?.dailyLabor?.length) {
        weeklyLaborData.dailyLabor = weeklyLaborData.dailyLabor.map((d) => {
          const sales = salesByDate.get(d.date) ?? 0;
          return {
            ...d,
            laborPercent: sales > 0 ? (d.laborCost / sales) * 100 : 0,
          };
        });
      }

      if (monthlyLaborData?.dailyLabor?.length) {
        monthlyLaborData.dailyLabor = monthlyLaborData.dailyLabor.map((d) => {
          const sales = salesByDate.get(d.date) ?? 0;
          return {
            ...d,
            laborPercent: sales > 0 ? (d.laborCost / sales) * 100 : 0,
          };
        });
      }
    }

    // Add labor % to hourly data — use per-hour labor cost from punches when available
    let hourlyWithLabor = hourlyWithProjections;
    if (laborData && laborData.laborPercent > 0) {
      const hourlyLaborMap = (laborData as any).hourlyLaborCost as Map<number, number> | undefined;
      hourlyWithLabor = hourlyWithProjections.map(h => {
        // Parse hour from the display string (e.g. "10 AM" or "2 PM" or "14:00")
        let hourNum = -1;
        if (hourlyLaborMap && hourlyLaborMap.size > 0) {
          const match = h.hour.match(/^(\d{1,2})\s*(AM|PM)?$/i);
          if (match) {
            let hr = parseInt(match[1], 10);
            const ampm = (match[2] || '').toUpperCase();
            if (ampm === 'PM' && hr !== 12) hr += 12;
            if (ampm === 'AM' && hr === 12) hr = 0;
            hourNum = hr;
          } else {
            // Try HH:MM format
            const hhmm = h.hour.match(/^(\d{1,2}):/);
            if (hhmm) hourNum = parseInt(hhmm[1], 10);
          }
        }
        
        if (hourNum >= 0 && hourlyLaborMap && hourlyLaborMap.has(hourNum)) {
          const laborCostForHour = Math.max(0, hourlyLaborMap.get(hourNum) || 0);
          const salesForHour = h.sales || 0;
          const laborPct = salesForHour > 0 ? (laborCostForHour / salesForHour) * 100 : (laborCostForHour > 0 ? 999 : 0);
          return { ...h, laborPercent: Math.min(laborPct, 999), laborCost: laborCostForHour };
        }
        // Fallback: if no hourly breakdown or hour not found, use daily %
        return { ...h, laborPercent: laborData.laborPercent };
      });
    }

    // Add labor % to weekly breakdown if we have weekly labor data
    // IMPORTANT: Calculate laborPercent from laborCost / sales since cache stores laborPercent as 0
    let weeklyWithLabor = weeklyWithProjections;
    if (weeklyLaborData && weeklyLaborData.dailyLabor.length > 0) {
      weeklyWithLabor = weeklyWithProjections.map(d => {
        const dayLabor = weeklyLaborData.dailyLabor.find(l => l.date === d.date);
        const laborCost = dayLabor?.laborCost || 0;
        // Calculate labor % from cost / sales (not from cached laborPercent which is always 0)
        const laborPercent = (laborCost > 0 && d.sales > 0) ? (laborCost / d.sales) * 100 : 0;
        return {
          ...d,
          laborPercent,
          laborCost
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

    // Calculate monthly labor totals
    const monthlyLaborTotals = monthlyLaborData && monthlySales > 0 ? {
      laborPercent: (monthlyLaborData.laborCost / monthlySales) * 100,
      laborCost: monthlyLaborData.laborCost,
      hoursWorked: monthlyLaborData.hoursWorked,
      regularHours: monthlyLaborData.regularHours,
      overtimeHours: monthlyLaborData.overtimeHours
    } : null;
    console.log(`[PUNCH-LABOR] MTD labor: ${monthlyLaborTotals ? `${monthlyLaborTotals.laborPercent.toFixed(1)}% ($${monthlyLaborTotals.laborCost.toFixed(2)} / $${monthlySales.toFixed(2)})` : 'null'}`);

    // pizzaCount for today already calculated above as todayPizzaCount
    const pizzaCount = todayPizzaCount;
    console.log(`Pizza count (Crusts category, 1/2 items counted as 0.5): ${pizzaCount}`);

    // === BACKGROUND TASK: Save projections and today's sales to DB ===
    // This runs asynchronously so response returns immediately
    const backgroundSaveTask = async () => {
      try {
        // Store calculated projections in sales_cache for FUTURE dates only
        if (locationId) {
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
            console.log(`[BACKGROUND] Saving ${allProjections.length} projections as living_projection...`);
            
            for (const proj of allProjections) {
              const { data: existing } = await cacheSupabase
                .from('sales_cache')
                .select('id, initial_projection')
                .eq('location_id', proj.location_id)
                .eq('sale_date', proj.sale_date)
                .single();
              
              if (existing) {
                // Update living_projection (recalculated daily)
                // If no initial_projection yet, also set it
                const updateData: Record<string, any> = { living_projection: proj.projected_sales };
                if (!existing.initial_projection || existing.initial_projection <= 0) {
                  updateData.initial_projection = proj.projected_sales;
                }
                await cacheSupabase
                  .from('sales_cache')
                  .update(updateData)
                  .eq('location_id', proj.location_id)
                  .eq('sale_date', proj.sale_date);
              } else {
                await cacheSupabase
                  .from('sales_cache')
                  .insert({
                    location_id: proj.location_id,
                    sale_date: proj.sale_date,
                    initial_projection: proj.projected_sales,
                    living_projection: proj.projected_sales,
                    projected_sales: proj.projected_sales,
                    net_sales: 0,
                    guest_count: 0
                  });
              }
            }
            console.log('[BACKGROUND] Living projections stored successfully');
          }
        }
        
        // Save today's actual sales to the cache
        if (locationId && dailySales > 0) {
          const { data: locSettings } = await cacheSupabase
            .from('location_settings')
            .select('pizza_sales_percentage, average_pizza_price')
            .eq('location_id', locationId)
            .single();
          
          const pizzaSalesPercentage = locSettings?.pizza_sales_percentage ?? 80;
          const averagePizzaPrice = locSettings?.average_pizza_price ?? 10.50;
          // Use actual pizza count from product mix if available, otherwise estimate
          const finalPizzaCount = pizzaCount > 0 ? pizzaCount : Math.round((dailySales * (pizzaSalesPercentage / 100)) / averagePizzaPrice);
          
          const { error: upsertError } = await cacheSupabase
            .from('sales_cache')
            .upsert({
              location_id: locationId,
              sale_date: todayStr,
              net_sales: dailySales,
              guest_count: dailyGuestCount,
              pizza_count: Math.round(finalPizzaCount),
              avg_ticket: avgTicket || null,
              hourly_data: hourlyWithLabor,
              ...(todayPayments.length > 0 ? { payments_data: todayPayments } : {}),
              validation_status: 'valid',
              validation_attempts: 1,
              flagged_no_sales: false,
              fetched_at: new Date().toISOString()
            }, {
              onConflict: 'location_id,sale_date'
            });
          
          if (upsertError) {
            console.error(`[BACKGROUND] Failed to save today's sales:`, upsertError.message);
          } else {
            console.log(`[BACKGROUND] Saved today's sales: $${dailySales}, ${dailyGuestCount} guests, ${finalPizzaCount} pizzas`);
          }
          
          // Fetch and save today's tips to daily_tips cache (tips only need live fetch at sync time, not on every dashboard load)
          try {
            const liveTips = await fetchTipsData(tokenGw, todayStr, qbLocationId);
            if (liveTips && (liveTips.ccTips > 0 || liveTips.cashTips > 0)) {
              const { error: tipsError } = await cacheSupabase
                .from('daily_tips')
                .upsert({
                  location_id: locationId,
                  tip_date: todayStr,
                  total_cc_tips: liveTips.ccTips,
                  total_cash_tips: liveTips.cashTips,
                  fetched_at: new Date().toISOString()
                }, {
                  onConflict: 'location_id,tip_date'
                });
              
              if (tipsError) {
                console.error(`[BACKGROUND] Failed to save tips to daily_tips:`, tipsError.message);
              } else {
                console.log(`[BACKGROUND] Saved tips: cc=$${liveTips.ccTips}, cash=$${liveTips.cashTips}`);
              }
            }
          } catch (tipsErr) {
            console.error(`[BACKGROUND] Tips fetch/save error:`, tipsErr);
          }

          // REMOVED: background labor_cache upsert block formerly lived here.
          // Reason: this function may calculate transient/open-shift labor for
          // response display, but it must not persist labor totals. Dedicated
          // labor-service writes labor_cache with source tracking and validated
          // employee breakdowns so historical reporting remains auditable.
        }
      } catch (bgError) {
        console.error('[BACKGROUND] Error in background save task:', bgError);
      }
    };
    
    // Start background task (doesn't block response)
    EdgeRuntime.waitUntil(backgroundSaveTask());

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
      pizzaCount: {
        daily: pizzaCount,
        weekly: weeklyPizzaCount,
        monthly: monthlyPizzaCount
      },
      comparison: {
        prevDay: prevDaySalesRealTime, // Real-time: same hours last week
        prevDayFullDay: prevDayTotalSales, // Full day total for reference
        prevWeek: prevWeekSales, // Week-to-date comparison
        prevMonth: prevMonthSales // Month-to-date comparison
      },
      lastYear: lastYearData ? {
        sameDay: lastYearData.sameDay,
        sameWeek: lastYearData.sameWeek,
        sameMonth: lastYearData.sameMonth
      } : undefined,
      projections, // AI-powered projections
      productMix,
      tills: tillsData, // Tills data for drawer count expected cash
      labor: laborData, // Labor data (from punch clock)
      laborSource: laborSource, // 'punches' - all locations use punch clock
      weeklyLabor: weeklyLaborTotals, // Weekly labor totals
      monthlyLabor: monthlyLaborTotals, // Monthly labor totals (MTD)
      tips: tipsData, // Today's tips data (CC + cash)
      weeklyTips: weeklyTipsData, // Weekly tips breakdown by day
      payments: {
        daily: todayPayments,
        weekly: weeklyPayments,
        monthly: monthlyPayments
      },
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
      weeklyTips: result.weeklyTips,
      labor: result.labor,
      laborSource: result.laborSource,
      weeklyLabor: result.weeklyLabor,
      monthlyLabor: result.monthlyLabor
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
