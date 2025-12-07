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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { period } = await req.json();
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

    // Step 3: Get today's date in Pacific timezone
    const today = new Date();
    const pacificDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const year = pacificDate.getFullYear();
    const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
    const day = String(pacificDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD format in Pacific
    
    console.log('Querying QuBeyond for date (Pacific):', dateStr);

    // Step 4: Fetch sales summary data from gateway API
    const dataResponse = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': tokenGw, // tokenGw already includes "Bearer " prefix
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

    if (!dataResponse.ok) {
      const errorText = await dataResponse.text();
      console.error('Data fetch failed:', dataResponse.status, errorText);
      throw new Error(`Data fetch failed: ${dataResponse.status}`);
    }

    const salesData = await dataResponse.json();
    console.log('Sales data received:', JSON.stringify(salesData).substring(0, 1000));

    // Parse the response to extract sales figures
    let dailySales = 0;
    let guestCount = 0;
    let avgTicket = 0;

    // The response has items array with metric names and totals
    if (salesData.items && Array.isArray(salesData.items)) {
      for (const item of salesData.items) {
        const metricName = (item.metric || '').toLowerCase();
        const total = parseFloat(item.total) || 0;
        
        // metricTypeId 1 = Net Sales
        if (item.metricTypeId === 1 || metricName === 'net sales') {
          dailySales = total;
        }
      }
    }

    // Return structured data
    const result = {
      daily: dailySales,
      guestCount: guestCount,
      avgTicket: avgTicket,
      authenticated: true,
      rawData: salesData, // Include raw data for debugging
      timestamp: new Date().toISOString(),
    };

    console.log('Returning sales data:', JSON.stringify(result));

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
