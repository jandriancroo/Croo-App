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
    });

    // Extract cookies from login response
    const setCookieHeaders = loginResponse.headers.get('set-cookie');
    console.log('Login response status:', loginResponse.status);
    
    // Step 2: Fetch sales data with authenticated session
    const cookieString = setCookieHeaders || `CID=${cid}; SID=${sid}`;
    
    const salesResponse = await fetch(`${baseUrl}/reports/sales`, {
      method: 'GET',
      headers: {
        'Cookie': cookieString,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!salesResponse.ok) {
      console.error('QuBeyond sales fetch failed:', salesResponse.status);
      throw new Error(`Failed to fetch sales: ${salesResponse.status}`);
    }

    const html = await salesResponse.text();
    console.log('Received sales data (length):', html.length);
    console.log('HTML sample (first 2000 chars):', html.substring(0, 2000));
    console.log('HTML sample (search for sales/revenue):', html.substring(html.indexOf('sale'), html.indexOf('sale') + 500));

    // Parse HTML to extract actual sales data
    // For now, returning mock data until we can inspect the actual HTML structure
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
