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

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = atob(base64);
  return JSON.parse(jsonPayload);
}

// Authenticate with QuBeyond using the same method as fetch-qubeyond-sales
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

  // Extract location from JWT
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

    // Process in batches to avoid overwhelming the API
    const BATCH_SIZE = 7; // 7 days at a time
    let daysCompleted = 0;

    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      
      // Fetch all days in batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (dateStr) => {
          try {
            const hourlyData = await fetchHourlySales(auth.tokenGw, dateStr, qbLocationId);
            const netSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
            const guestCount = hourlyData.reduce((sum, h) => sum + h.checksCount, 0);
            const avgTicket = guestCount > 0 ? netSales / guestCount : null;
            
            return {
              location_id: locationId,
              sale_date: dateStr,
              net_sales: netSales,
              guest_count: guestCount,
              pizza_count: 0, // We'll calculate this separately if needed
              avg_ticket: avgTicket,
              hourly_data: hourlyData,
              fetched_at: new Date().toISOString()
            };
          } catch (error) {
            console.error(`[BACKFILL] Error fetching ${dateStr}:`, error);
            return null;
          }
        })
      );

      // Filter out failed fetches and upsert to database
      const validResults = batchResults.filter(r => r !== null);
      
      if (validResults.length > 0) {
        const { error: upsertError } = await supabase
          .from('sales_cache')
          .upsert(validResults, { onConflict: 'location_id,sale_date' });
        
        if (upsertError) {
          console.error('[BACKFILL] Upsert error:', upsertError);
        }
      }

      daysCompleted += batch.length;
      
      // Update progress every batch
      await supabase
        .from('location_integrations')
        .update({ backfill_days_completed: daysCompleted })
        .eq('id', integrationId);
      
      console.log(`[BACKFILL] Progress: ${daysCompleted}/${dates.length} days`);
      
      // Small delay between batches to be nice to the API
      if (i + BATCH_SIZE < dates.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
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

    console.log(`[BACKFILL] Completed! Fetched ${dates.length} days of data`);

    return new Response(
      JSON.stringify({ success: true, daysProcessed: dates.length }),
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
