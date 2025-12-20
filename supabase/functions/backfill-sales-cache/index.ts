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

interface DaySalesData {
  dateStr: string;
  dayOfWeek: number;
  hourlyData: { hour: string; sales: number; checksCount: number }[];
  netSales: number;
  guestCount: number;
  pizzaCount: number;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = atob(base64);
  return JSON.parse(jsonPayload);
}

// Generate deterministic seeded random factor between -2% and +3%
function getSeededRandomFactor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const normalized = Math.abs(hash % 1000) / 1000;
  return 0.98 + (normalized * 0.05);
}

// Authenticate with QuBeyond
async function authenticateQuBeyond(username: string, password: string): Promise<{ tokenGw: string; qbLocationId: string } | null> {
  console.log('[AUTH] Starting QuBeyond authentication...');
  
  const loginPayload = {
    payload: {
      username,
      password,
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
    console.error('[AUTH] Authentication failed:', loginResponse.status);
    return null;
  }

  const loginData = await loginResponse.json();
  if (!loginData.token) {
    console.error('[AUTH] No token in login response');
    return null;
  }

  const jwtPayload = decodeJwtPayload(loginData.token);
  const tokenGw = jwtPayload.tokenGw as string;
  if (!tokenGw) {
    console.error('[AUTH] No tokenGw found in JWT payload');
    return null;
  }

  let qbLocationId = (jwtPayload.locationId || jwtPayload.location_id || 
                     jwtPayload.storeId || jwtPayload.store_id ||
                     jwtPayload.singleLocation || jwtPayload.defaultLocation) as string || '';
  
  if (!qbLocationId && jwtPayload.user) {
    const user = jwtPayload.user as Record<string, unknown>;
    qbLocationId = (user.locationId || user.storeId || user.defaultLocation) as string || '';
  }
  
  console.log(`[AUTH] Authenticated successfully, location ID: ${qbLocationId}`);
  return { tokenGw, qbLocationId };
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

// Fetch product mix for a specific day to get pizza count
async function fetchProductMix(
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
          singleLocation: parseInt(qbLocationId)
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
    const products: { name: string; quantity: number; category: string }[] = [];

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

      if (quantity > 0) {
        products.push({ name, quantity, category });
      }
    };

    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
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
    
    // Calculate pizza count from "Crusts" category
    // Items with "1/2" in the name count as 0.5 pizzas each
    const pizzaCount = products
      .filter(item => item.category.toLowerCase() === 'crusts')
      .reduce((sum, item) => {
        const isHalf = item.name.includes('1/2') || item.name.includes('(1/2)');
        return sum + (isHalf ? item.quantity * 0.5 : item.quantity);
      }, 0);
    
    return Math.round(pizzaCount);
  } catch (error) {
    console.error(`[BACKFILL] Product mix fetch error for ${dateStr}:`, error);
    return 0;
  }
}

// Get dates for backfill (last 365 days)
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

// Calculate 4-week rolling average for each day of week
function calculate4WeekAverages(
  allData: DaySalesData[],
  targetDateStr: string,
  locationId: string
): { avgByDayOfWeek: Map<number, number>; hourlyPatternByDayOfWeek: Map<number, { hour: number; avgPercent: number }[]> } {
  const targetDate = new Date(targetDateStr + 'T12:00:00');
  
  // Get data from 4 weeks before target date
  const fourWeeksAgo = new Date(targetDate);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  
  const relevantData = allData.filter(d => {
    const date = new Date(d.dateStr + 'T12:00:00');
    return date >= fourWeeksAgo && date < targetDate && d.netSales > 0;
  });
  
  // Group by day of week
  const byDayOfWeek = new Map<number, DaySalesData[]>();
  for (let dow = 0; dow < 7; dow++) {
    byDayOfWeek.set(dow, []);
  }
  
  for (const d of relevantData) {
    const arr = byDayOfWeek.get(d.dayOfWeek) || [];
    arr.push(d);
    byDayOfWeek.set(d.dayOfWeek, arr);
  }
  
  // Calculate averages
  const avgByDayOfWeek = new Map<number, number>();
  const hourlyPatternByDayOfWeek = new Map<number, { hour: number; avgPercent: number }[]>();
  
  for (let dow = 0; dow < 7; dow++) {
    const days = byDayOfWeek.get(dow) || [];
    if (days.length === 0) {
      avgByDayOfWeek.set(dow, 0);
      hourlyPatternByDayOfWeek.set(dow, []);
      continue;
    }
    
    const totalSales = days.reduce((sum, d) => sum + d.netSales, 0);
    const avgSales = totalSales / days.length;
    avgByDayOfWeek.set(dow, avgSales);
    
    // Calculate hourly pattern as percentage of daily total
    const hourlyTotals = new Map<number, { sales: number; count: number }>();
    for (const d of days) {
      for (const h of d.hourlyData) {
        const hourNum = parseInt(h.hour.split(':')[0]);
        const existing = hourlyTotals.get(hourNum) || { sales: 0, count: 0 };
        existing.sales += h.sales;
        existing.count += 1;
        hourlyTotals.set(hourNum, existing);
      }
    }
    
    const pattern: { hour: number; avgPercent: number }[] = [];
    for (const [hour, data] of hourlyTotals.entries()) {
      const avgHourlySales = data.sales / data.count;
      const percent = avgSales > 0 ? avgHourlySales / avgSales : 0;
      pattern.push({ hour, avgPercent: percent });
    }
    hourlyPatternByDayOfWeek.set(dow, pattern.sort((a, b) => a.hour - b.hour));
  }
  
  return { avgByDayOfWeek, hourlyPatternByDayOfWeek };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { locationId, integrationId } = await req.json();
    
    if (!locationId || !integrationId) {
      return new Response(
        JSON.stringify({ error: 'Missing locationId or integrationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[BACKFILL] Starting backfill for location ${locationId}`);

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
      console.error('[BACKFILL] Failed to get integration:', intError);
      return new Response(
        JSON.stringify({ error: 'Integration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials = integration.credentials as QuBeyondCredentials;

    // Update status to in_progress
    await supabase
      .from('location_integrations')
      .update({
        backfill_status: 'in_progress',
        backfill_started_at: new Date().toISOString(),
        backfill_error: null
      })
      .eq('id', integrationId);

    // Authenticate with QuBeyond
    const auth = await authenticateQuBeyond(credentials.username, credentials.password);
    if (!auth) {
      await supabase
        .from('location_integrations')
        .update({ backfill_status: 'failed', backfill_error: 'Authentication failed' })
        .eq('id', integrationId);
      
      return new Response(
        JSON.stringify({ error: 'QuBeyond authentication failed' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const qbLocationId = credentials.location_id || auth.qbLocationId;
    const dates = getBackfillDates(365);
    
    console.log(`[BACKFILL] Will fetch ${dates.length} days of data`);

    // PHASE 1: Fetch all raw data first
    const allRawData: DaySalesData[] = [];
    const BATCH_SIZE = 7;
    let daysCompleted = 0;

    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(
        batch.map(async (dateStr) => {
          try {
            const [hourlyData, pizzaCount] = await Promise.all([
              fetchHourlySales(auth.tokenGw, dateStr, qbLocationId),
              fetchProductMix(auth.tokenGw, dateStr, qbLocationId)
            ]);
            const netSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
            const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
            const date = new Date(dateStr + 'T12:00:00');
            
            return {
              dateStr,
              dayOfWeek: date.getDay(),
              hourlyData,
              netSales,
              guestCount,
              pizzaCount
            };
          } catch (error) {
            console.error(`[BACKFILL] Error fetching ${dateStr}:`, error);
            return null;
          }
        })
      );

      for (const result of batchResults) {
        if (result) allRawData.push(result);
      }

      daysCompleted += batch.length;
      
      await supabase
        .from('location_integrations')
        .update({ backfill_days_completed: Math.floor(daysCompleted / 2) }) // Show as 50% during fetch phase
        .eq('id', integrationId);
      
      console.log(`[BACKFILL] Fetch progress: ${daysCompleted}/${dates.length} days`);
      
      if (i + BATCH_SIZE < dates.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    console.log(`[BACKFILL] Fetched ${allRawData.length} days, now calculating projections...`);

    // Sort by date (oldest first) for proper 4-week lookback
    allRawData.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    // PHASE 2: Calculate projections and save to database
    const cacheRecords = [];
    
    for (let i = 0; i < allRawData.length; i++) {
      const dayData = allRawData[i];
      
      // Calculate 4-week average for this date
      const { avgByDayOfWeek, hourlyPatternByDayOfWeek } = calculate4WeekAverages(
        allRawData,
        dayData.dateStr,
        locationId
      );
      
      const avgForDayOfWeek = avgByDayOfWeek.get(dayData.dayOfWeek) || 0;
      const hourlyPattern = hourlyPatternByDayOfWeek.get(dayData.dayOfWeek) || [];
      
      // Apply seeded random factor for projected sales
      const randomFactor = getSeededRandomFactor(`${dayData.dateStr}-${locationId}`);
      const projectedSales = Math.round(avgForDayOfWeek * randomFactor);
      
      // Add projections to hourly data
      const hourlyWithProjections = dayData.hourlyData.map(h => {
        const hourNum = parseInt(h.hour.split(':')[0]);
        const pattern = hourlyPattern.find(p => p.hour === hourNum);
        const hourlyProjected = pattern ? Math.round(projectedSales * pattern.avgPercent) : 0;
        return { ...h, projected: hourlyProjected };
      });
      
      const avgTicket = dayData.guestCount > 0 ? dayData.netSales / dayData.guestCount : null;
      
      cacheRecords.push({
        location_id: locationId,
        sale_date: dayData.dateStr,
        net_sales: dayData.netSales,
        guest_count: dayData.guestCount,
        pizza_count: dayData.pizzaCount,
        avg_ticket: avgTicket,
        hourly_data: hourlyWithProjections,
        projected_sales: projectedSales,
        fetched_at: new Date().toISOString()
      });
    }

    // Save in batches
    const SAVE_BATCH_SIZE = 50;
    for (let i = 0; i < cacheRecords.length; i += SAVE_BATCH_SIZE) {
      const batch = cacheRecords.slice(i, i + SAVE_BATCH_SIZE);
      
      const { error: upsertError } = await supabase
        .from('sales_cache')
        .upsert(batch, { onConflict: 'location_id,sale_date' });
      
      if (upsertError) {
        console.error('[BACKFILL] Upsert error:', upsertError);
      }
      
      const progress = Math.floor(50 + (i / cacheRecords.length) * 50);
      await supabase
        .from('location_integrations')
        .update({ backfill_days_completed: progress })
        .eq('id', integrationId);
    }

    // Mark as complete
    await supabase
      .from('location_integrations')
      .update({
        backfill_status: 'completed',
        backfill_completed_at: new Date().toISOString(),
        backfill_days_completed: dates.length
      })
      .eq('id', integrationId);

    console.log(`[BACKFILL] Completed! Processed ${allRawData.length} days with projections`);

    return new Response(
      JSON.stringify({ success: true, daysProcessed: allRawData.length }),
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
