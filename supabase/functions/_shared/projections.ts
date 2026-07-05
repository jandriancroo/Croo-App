// _shared/projections.ts
// POS-agnostic projection + pace-adjusted engine.
// Extracted verbatim from supabase/functions/fetch-qubeyond-sales/index.ts so
// every POS adapter (Clover, QU, future POS) produces the same numbers.
//
// Rule: no adapter reimplements projection or pace math. Call the functions
// exported here; supply raw sales inputs only.

export interface HolidayInfo {
  name: string;
  type: 'major' | 'closed' | 'minor';
}

// ── Date helpers ────────────────────────────────────────────────────────────
export function getDateStringForTimezone(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getWeekStartDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

export function getMonthStartDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  date.setDate(1);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

export function adjustDate(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return getDateStringForTimezone(date, 'America/Los_Angeles');
}

// ── Holidays ────────────────────────────────────────────────────────────────
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const firstDay = new Date(year, month, 1);
  const dayOfWeek = firstDay.getDay();
  let daysToAdd = (weekday - dayOfWeek + 7) % 7;
  daysToAdd += (n - 1) * 7;
  const result = new Date(year, month, 1 + daysToAdd);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const lastDay = new Date(year, month + 1, 0);
  const dayOfWeek = lastDay.getDay();
  const daysToSubtract = (dayOfWeek - weekday + 7) % 7;
  const result = new Date(year, month + 1, -daysToSubtract);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

export function getHolidaysForYear(year: number): Map<string, HolidayInfo> {
  const holidays = new Map<string, HolidayInfo>();
  holidays.set(`${year}-01-01`, { name: "New Year's Day", type: 'major' });
  holidays.set(`${year}-12-31`, { name: "New Year's Eve", type: 'major' });
  holidays.set(`${year}-07-04`, { name: 'Independence Day', type: 'major' });
  holidays.set(`${year}-12-25`, { name: 'Christmas Day', type: 'closed' });
  holidays.set(`${year}-12-24`, { name: 'Christmas Eve', type: 'major' });
  holidays.set(`${year}-02-14`, { name: "Valentine's Day", type: 'major' });
  holidays.set(`${year}-10-31`, { name: 'Halloween', type: 'major' });
  holidays.set(`${year}-11-11`, { name: 'Veterans Day', type: 'minor' });
  holidays.set(getNthWeekdayOfMonth(year, 0, 1, 3), { name: 'Martin Luther King Jr. Day', type: 'minor' });
  holidays.set(getNthWeekdayOfMonth(year, 1, 1, 3), { name: 'Presidents Day', type: 'minor' });
  holidays.set(getLastWeekdayOfMonth(year, 4, 1), { name: 'Memorial Day', type: 'major' });
  holidays.set(getNthWeekdayOfMonth(year, 8, 1, 1), { name: 'Labor Day', type: 'major' });
  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4);
  holidays.set(thanksgiving, { name: 'Thanksgiving', type: 'closed' });
  holidays.set(adjustDate(thanksgiving, 1), { name: 'Black Friday', type: 'major' });
  holidays.set(getNthWeekdayOfMonth(year, 4, 0, 2), { name: "Mother's Day", type: 'major' });
  holidays.set(getNthWeekdayOfMonth(year, 5, 0, 3), { name: "Father's Day", type: 'major' });
  holidays.set(getNthWeekdayOfMonth(year, 1, 0, 2), { name: 'Super Bowl Sunday', type: 'major' });
  return holidays;
}

function getHolidayInfo(dateStr: string): HolidayInfo | null {
  const year = parseInt(dateStr.split('-')[0]);
  return getHolidaysForYear(year).get(dateStr) || null;
}

function getSameHolidayLastYear(todayStr: string, holidayName: string): string | null {
  const year = parseInt(todayStr.split('-')[0]);
  const lastYearHolidays = getHolidaysForYear(year - 1);
  for (const [dateStr, info] of lastYearHolidays.entries()) {
    if (info.name === holidayName) return dateStr;
  }
  return null;
}

export function getHolidayAwareComparison(
  todayStr: string,
  lastYearSameDowStr: string,
): { comparisonDate: string | null; lastYearWeight: number; reason: string } {
  const todayHoliday = getHolidayInfo(todayStr);
  const lastYearHoliday = getHolidayInfo(lastYearSameDowStr);

  if (todayHoliday && todayHoliday.type === 'major') {
    const same = getSameHolidayLastYear(todayStr, todayHoliday.name);
    if (same) return { comparisonDate: same, lastYearWeight: 1.0, reason: `Comparing ${todayHoliday.name} to same holiday last year` };
  }
  if (todayHoliday && todayHoliday.type === 'closed') {
    return { comparisonDate: null, lastYearWeight: 0, reason: `${todayHoliday.name} - closed` };
  }
  if (lastYearHoliday && lastYearHoliday.type === 'major') {
    return { comparisonDate: lastYearSameDowStr, lastYearWeight: 0.2, reason: `Last year was ${lastYearHoliday.name} - using mostly 4-week avg` };
  }
  if (lastYearHoliday && lastYearHoliday.type === 'closed') {
    return { comparisonDate: null, lastYearWeight: 0, reason: `Last year was ${lastYearHoliday.name} - ignoring` };
  }
  return { comparisonDate: lastYearSameDowStr, lastYearWeight: 0.5, reason: 'Normal day - standard blend' };
}

// ── Time helpers ────────────────────────────────────────────────────────────
export function getCurrentHourInTimezone(timezone: string): number {
  const now = new Date();
  const tzTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return tzTime.getHours();
}

export function getCurrentMinutesInTimezone(timezone: string): number {
  const now = new Date();
  const tzTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return tzTime.getMinutes();
}

// ── Deterministic jitter ────────────────────────────────────────────────────
export function getSeededRandomFactor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const normalized = Math.abs(hash % 1000) / 1000;
  return 0.97 + (normalized * 0.05);
}

// ── Historical data loader (reads sales_cache; POS-agnostic) ────────────────
export async function fetchHistoricalDataFromCache(
  supabase: any,
  locationId: string,
  todayStr: string,
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

  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;

  const fourWeekDates: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (i * 7));
    const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (dStr <= yesterdayStr) fourWeekDates.push(dStr);
    if (fourWeekDates.length >= 4) break;
  }

  const lastYearDate = new Date(today);
  lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
  const lastYearDayOfWeek = lastYearDate.getDay();
  const dayDiff = dayOfWeek - lastYearDayOfWeek;
  lastYearDate.setDate(lastYearDate.getDate() + dayDiff);
  const lastYearTodayStr = `${lastYearDate.getFullYear()}-${String(lastYearDate.getMonth() + 1).padStart(2, '0')}-${String(lastYearDate.getDate()).padStart(2, '0')}`;

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

  const lastYearMonthStart = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const lastYearMonthEnd = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);
  const lastYearMonthDates: string[] = [];
  for (let d = new Date(lastYearMonthStart); d <= lastYearMonthEnd; d.setDate(d.getDate() + 1)) {
    lastYearMonthDates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }

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

  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthDates: string[] = [];
  for (let d = new Date(prevMonthStart); d <= prevMonthEnd; d.setDate(d.getDate() + 1)) {
    prevMonthDates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }

  const allDatesToFetch = [...new Set([
    ...fourWeekDates,
    lastYearTodayStr,
    ...lastYearWeekDates,
    ...lastYearMonthDates,
    ...prevWeekDates,
    ...prevMonthDates,
  ])];

  const { data: cacheData, error } = await supabase
    .from('sales_cache')
    .select('sale_date, net_sales, hourly_data')
    .eq('location_id', locationId)
    .in('sale_date', allDatesToFetch);

  if (error) {
    console.error('[projections] cache read failed:', error.message);
    return {
      fourWeekAverage: undefined,
      fourWeekHourlyPattern: undefined,
      lastYearData: undefined,
      prevWeekSales: 0,
      prevMonthSales: 0,
      holidayContext: { lastYearWeight: 0.5, reason: 'Cache error - default' },
    };
  }

  const cacheMap = new Map<string, { net_sales: number; hourly_data: any }>();
  for (const row of (cacheData || []) as Array<{ sale_date: string; net_sales: number | null; hourly_data: any }>) {
    cacheMap.set(row.sale_date, { net_sales: row.net_sales || 0, hourly_data: row.hourly_data });
  }

  let fourWeekAverage: {
    avgWeekTotal: number;
    avgDailyByDayOfWeek: { dayOfWeek: number; avgSales: number }[];
    weeks: { weekStart: string; total: number }[];
  } | undefined;
  let fourWeekHourlyPattern: { hour: number; avgPercent: number }[] | undefined;

  const fourWeekSales = fourWeekDates.map(d => cacheMap.get(d)?.net_sales || 0).filter(s => s > 0);
  if (fourWeekSales.length > 0) {
    const avgSales = fourWeekSales.reduce((sum, s) => sum + s, 0) / fourWeekSales.length;

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
          avgPercent: avgDailyTotal > 0 ? avgHourlySales / avgDailyTotal : 0,
        });
      }
      fourWeekHourlyPattern.sort((a, b) => a.hour - b.hour);
    }

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
      if (weekTotal > 0) weekTotals.push({ weekStart: wStartStr, total: weekTotal });
    }
    const avgWeekTotal = weekTotals.length > 0
      ? weekTotals.reduce((sum, w) => sum + w.total, 0) / weekTotals.length
      : avgSales * 7;

    const salesByDow: { [dow: number]: number[] } = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const wt of weekTotals) {
      const wStart = new Date(wt.weekStart + 'T12:00:00');
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(wStart);
        dayDate.setDate(dayDate.getDate() + d);
        const dayStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
        const sales = cacheMap.get(dayStr)?.net_sales || 0;
        if (sales > 0) salesByDow[dayDate.getDay()].push(sales);
      }
    }
    const avgDailyByDayOfWeek = Object.entries(salesByDow).map(([dow, sales]) => ({
      dayOfWeek: parseInt(dow),
      avgSales: sales.length > 0 ? sales.reduce((sum, s) => sum + s, 0) / sales.length : 0,
    }));
    fourWeekAverage = { avgWeekTotal, avgDailyByDayOfWeek, weeks: weekTotals };
  }

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
      hourlyData: lastYearDayCached?.hourly_data as { hour: string; sales: number }[] | undefined,
    };
  }

  const holidayContext = getHolidayAwareComparison(todayStr, lastYearTodayStr);

  if (holidayContext.comparisonDate && holidayContext.comparisonDate !== lastYearTodayStr) {
    const holidayDateCached = cacheMap.get(holidayContext.comparisonDate);
    if (holidayDateCached) {
      if (lastYearData) {
        lastYearData.sameDay = holidayDateCached.net_sales;
        lastYearData.hourlyData = holidayDateCached.hourly_data as any;
      } else {
        lastYearData = {
          sameDay: holidayDateCached.net_sales,
          sameWeek: lastYearSameWeek,
          sameMonth: lastYearSameMonth,
          weeklyBreakdown: lastYearWeekDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
          monthlyBreakdown: lastYearMonthDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
          hourlyData: holidayDateCached.hourly_data as any,
        };
      }
    } else {
      const { data: holidayData } = await supabase
        .from('sales_cache')
        .select('net_sales, hourly_data')
        .eq('location_id', locationId)
        .eq('sale_date', holidayContext.comparisonDate)
        .maybeSingle();
      if (holidayData) {
        if (lastYearData) {
          lastYearData.sameDay = holidayData.net_sales || 0;
          lastYearData.hourlyData = holidayData.hourly_data as any;
        } else {
          lastYearData = {
            sameDay: holidayData.net_sales || 0,
            sameWeek: lastYearSameWeek,
            sameMonth: lastYearSameMonth,
            weeklyBreakdown: lastYearWeekDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
            monthlyBreakdown: lastYearMonthDates.map(d => ({ date: d, sales: cacheMap.get(d)?.net_sales || 0 })),
            hourlyData: holidayData.hourly_data as any,
          };
        }
      }
    }
  }

  const prevWeekSales = prevWeekDates.reduce((sum, d) => sum + (cacheMap.get(d)?.net_sales || 0), 0);
  const prevMonthSales = prevMonthDates.reduce((sum, d) => sum + (cacheMap.get(d)?.net_sales || 0), 0);

  return { fourWeekAverage, fourWeekHourlyPattern, lastYearData, prevWeekSales, prevMonthSales, holidayContext };
}

// ── Hourly projections ──────────────────────────────────────────────────────
export function generateHourlyProjections(
  hourlyActuals: { hour: string; sales: number }[],
  hoursOpen: number,
  hoursClose: number,
  todayStr: string,
  locationId: string,
  todayProjectedTotal: number,
  fourWeekHourlyPattern?: { hour: number; avgPercent: number }[],
  yoyHourlyData?: { hour: string; sales: number }[],
): { hour: string; sales: number; projected: number }[] {
  const result: { hour: string; sales: number; projected: number }[] = [];
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
  const defaultPattern: { [hour: number]: number } = {
    10: 0.02, 11: 0.07, 12: 0.14, 13: 0.11, 14: 0.05, 15: 0.04,
    16: 0.06, 17: 0.11, 18: 0.13, 19: 0.10, 20: 0.07, 21: 0.05,
    22: 0.03, 23: 0.02,
  };
  for (let hour = hoursOpen; hour < hoursClose; hour++) {
    const hourStr = `${hour.toString().padStart(2, '0')}:00`;
    const actual = hourlyActuals.find(h => parseInt(h.hour.split(':')[0]) === hour)?.sales || 0;
    const randomFactor = getSeededRandomFactor(`${todayStr}-${locationId}-hr${hour}`);
    const fourWeekPercent = fourWeekHourlyPattern?.find(p => p.hour === hour)?.avgPercent || 0;
    const yoyPercent = yoyHourlyPattern[hour] || 0;
    let hourlyProjected = 0;
    if (fourWeekPercent > 0 && yoyPercent > 0) {
      hourlyProjected = todayProjectedTotal * ((fourWeekPercent + yoyPercent) / 2) * randomFactor;
    } else if (fourWeekPercent > 0) {
      hourlyProjected = todayProjectedTotal * fourWeekPercent * randomFactor;
    } else if (yoyPercent > 0) {
      hourlyProjected = todayProjectedTotal * yoyPercent * randomFactor;
    } else {
      hourlyProjected = todayProjectedTotal * (defaultPattern[hour] || 0.05) * randomFactor;
    }
    result.push({ hour: hourStr, sales: actual, projected: Math.round(hourlyProjected) });
  }
  return result;
}

// ── Pace-adjusted projection (shift-aware V3) ───────────────────────────────
export function calculatePaceAdjustedProjection(
  actualSales: number,
  currentHour: number,
  currentMinutes: number,
  hoursOpen: number,
  hoursClose: number,
  hourlyData: { hour: string; sales: number; projected: number }[],
): number {
  if (currentHour < hoursOpen || currentHour >= hoursClose) return actualSales;

  const currentHourStr = `${currentHour.toString().padStart(2, '0')}:00`;
  const currentHourEntry = hourlyData.find(h => h.hour === currentHourStr);
  const currentHourProjection = currentHourEntry?.projected ?? 0;
  const currentHourActual = currentHourEntry?.sales ?? 0;
  const usePartialHour = currentMinutes >= 30;

  let currentHourContribution = 0;
  if (usePartialHour) {
    const fractionRemaining = (60 - currentMinutes) / 60;
    currentHourContribution = currentHourActual + (currentHourProjection * fractionRemaining);
  } else {
    currentHourContribution = currentHourProjection;
  }

  let completedHoursActual = 0;
  for (const entry of hourlyData) {
    const entryHour = parseInt(entry.hour.split(':')[0]);
    if (entryHour < currentHour) completedHoursActual += entry.sales;
  }

  let futureHoursProjected = 0;
  for (let hour = currentHour + 1; hour < hoursClose; hour++) {
    const entry = hourlyData.find(h => h.hour === `${hour.toString().padStart(2, '0')}:00`);
    if (entry) futureHoursProjected += entry.projected;
  }

  const SHIFT_BOUNDARY = 15;
  const lunchPcts: number[] = [];
  const dinnerPcts: number[] = [];
  for (const entry of hourlyData) {
    const entryHour = parseInt(entry.hour.split(':')[0]);
    if (entry.projected > 0) {
      const isCompleted = (entryHour < currentHour && entry.sales > 0) ||
                          (entryHour === currentHour && usePartialHour && entry.sales > 0);
      if (isCompleted) {
        if (entryHour < SHIFT_BOUNDARY) lunchPcts.push((entry.sales - entry.projected) / entry.projected);
        else dinnerPcts.push((entry.sales - entry.projected) / entry.projected);
      }
    }
  }

  let adjustmentFactor = 1.0;
  const isDinnerShift = currentHour >= SHIFT_BOUNDARY;
  let activeAvg: number | null = null;
  if (isDinnerShift) {
    if (dinnerPcts.length >= 3) activeAvg = dinnerPcts.reduce((a, b) => a + b, 0) / dinnerPcts.length;
    else if (lunchPcts.length >= 3) activeAvg = (lunchPcts.reduce((a, b) => a + b, 0) / lunchPcts.length) * 0.5;
  } else {
    if (lunchPcts.length >= 3) activeAvg = lunchPcts.reduce((a, b) => a + b, 0) / lunchPcts.length;
  }
  if (activeAvg !== null) {
    const severity = Math.min(Math.abs(activeAvg) / 0.50, 1.0);
    const rand = Math.random();
    const variant = activeAvg < 0 ? -(rand * 0.02 * severity) : rand * 0.03 * severity;
    adjustmentFactor = 1.0 + activeAvg + variant;
  }

  const adjustedCurrentHour = currentHourContribution * adjustmentFactor;
  const adjustedFuture = futureHoursProjected * adjustmentFactor;
  const paceAdjusted = completedHoursActual + adjustedCurrentHour + adjustedFuture;
  return Math.round(Math.max(paceAdjusted, actualSales));
}

// ── Orchestrator ────────────────────────────────────────────────────────────
export function generateProjections(
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
  holidayContext?: { lastYearWeight: number; reason: string },
): { todayProjected: number; todayPaceAdjusted: number; weekProjected: number; monthProjected: number } {
  const today = new Date(todayStr + 'T12:00:00');
  const dayOfWeek = today.getDay();
  const randomFactor = getSeededRandomFactor(`${todayStr}-${locationId}`);
  const lyWeight = holidayContext?.lastYearWeight ?? 0.5;
  const fwWeight = 1 - lyWeight;

  let todayProjected = 0;
  const fourWeekDayAvg = fourWeekAverage?.avgDailyByDayOfWeek.find(d => d.dayOfWeek === dayOfWeek)?.avgSales || 0;
  const lastYearSameDay = lastYearData?.sameDay || 0;
  if (fourWeekDayAvg > 0 && lastYearSameDay > 0) {
    todayProjected = ((fourWeekDayAvg * fwWeight) + (lastYearSameDay * lyWeight)) * randomFactor;
  } else if (fourWeekDayAvg > 0) {
    todayProjected = fourWeekDayAvg * randomFactor;
  } else if (lastYearSameDay > 0) {
    todayProjected = lastYearSameDay * randomFactor;
  } else {
    const completedDays = weeklyBreakdown.filter(d => d.sales > 0);
    if (completedDays.length > 0) {
      todayProjected = (completedDays.reduce((sum, d) => sum + d.sales, 0) / completedDays.length) * randomFactor;
    } else {
      todayProjected = dailySales;
    }
  }

  const todayPaceAdjusted = calculatePaceAdjustedProjection(
    dailySales, currentHour, currentMinutes, hoursOpen, hoursClose, hourlyProjections,
  );

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

  return { todayProjected, todayPaceAdjusted, weekProjected, monthProjected };
}
