import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { period } = await req.json();
    const username = Deno.env.get('QU_USERNAME');
    const password = Deno.env.get('QU_PASSWORD');
    const cid = Deno.env.get('QU_CID');
    const sid = Deno.env.get('QU_SID');

    if (!username || !password || !cid || !sid) {
      throw new Error('QuBeyond credentials not configured');
    }

    console.log('Authenticating with QuBeyond for period:', period);

    const baseUrl = 'https://admin.qubeyond.com';
    
    // Step 1: Attempt to log in with credentials
    const loginResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: new URLSearchParams({
        username: username,
        password: password,
        cid: cid,
      }).toString(),
      redirect: 'manual',
    });

    console.log('Login response status:', loginResponse.status);
    
    // Extract ALL cookies from login response
    const cookieHeaders = loginResponse.headers.getSetCookie?.() || [];
    console.log('Received cookies count:', cookieHeaders.length);
    
    // Build cookie string from all Set-Cookie headers
    let cookieString = '';
    if (cookieHeaders.length > 0) {
      cookieString = cookieHeaders.map(cookie => {
        const match = cookie.match(/^([^;]+)/);
        return match ? match[1] : '';
      }).filter(c => c).join('; ');
    } else {
      cookieString = `CID=${cid}; SID=${sid}`;
    }
    
    console.log('Using cookie string (length):', cookieString.length);
    
    // Step 2: Fetch from the correct endpoints
    const hourlyUrl = `${baseUrl}/reports/sales/hourly-sales`;
    const dailyUrl = `${baseUrl}/reports/overview/real-time-summary`;
    const weeklyUrl = `${baseUrl}/reports/overview/summary`;
    
    console.log('Fetching hourly data from:', hourlyUrl);
    const hourlyResponse = await fetch(hourlyUrl, {
      method: 'GET',
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    console.log('Fetching daily data from:', dailyUrl);
    const dailyResponse = await fetch(dailyUrl, {
      method: 'GET',
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    console.log('Fetching weekly data from:', weeklyUrl);
    const weeklyResponse = await fetch(weeklyUrl, {
      method: 'GET',
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const hourlyHtml = await hourlyResponse.text();
    const dailyHtml = await dailyResponse.text();
    const weeklyHtml = await weeklyResponse.text();
    
    console.log('Hourly HTML length:', hourlyHtml.length);
    console.log('Daily HTML length:', dailyHtml.length);
    console.log('Weekly HTML length:', weeklyHtml.length);
    
    // Log samples to inspect structure
    console.log('Hourly HTML sample:', hourlyHtml.substring(0, 1000));
    console.log('Daily HTML sample:', dailyHtml.substring(0, 1000));
    console.log('Weekly HTML sample:', weeklyHtml.substring(0, 1000));

    // TODO: Parse the HTML to extract actual sales data
    // For now, returning mock data until we can inspect the HTML structure
    const mockData = {
      hourly: [
        { hour: '9:00 AM', sales: 245.50 },
        { hour: '10:00 AM', sales: 389.75 },
        { hour: '11:00 AM', sales: 567.25 },
        { hour: '12:00 PM', sales: 892.00 },
        { hour: '1:00 PM', sales: 1024.50 },
        { hour: '2:00 PM', sales: 745.25 },
        { hour: '3:00 PM', sales: 523.75 },
        { hour: '4:00 PM', sales: 678.50 },
      ],
      daily: 5066.50,
      weekly: 28450.75,
    };

    return new Response(JSON.stringify(mockData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in fetch-qubeyond-sales:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
