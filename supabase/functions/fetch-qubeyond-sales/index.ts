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
      redirect: 'manual', // Don't follow redirects automatically
    });

    console.log('Login response status:', loginResponse.status);
    
    // Extract ALL cookies from login response
    const cookieHeaders = loginResponse.headers.getSetCookie?.() || [];
    console.log('Received cookies:', cookieHeaders.length);
    
    // Build cookie string from all Set-Cookie headers
    let cookieString = '';
    if (cookieHeaders.length > 0) {
      cookieString = cookieHeaders.map(cookie => {
        // Extract just the name=value part before the first semicolon
        const match = cookie.match(/^([^;]+)/);
        return match ? match[1] : '';
      }).filter(c => c).join('; ');
    } else {
      // Fallback to the original CID/SID
      cookieString = `CID=${cid}; SID=${sid}`;
    }
    
    console.log('Using cookies:', cookieString);
    
    // Step 2: Try different possible sales endpoints
    const endpoints = [
      '/dashboard',
      '/reports',
      '/sales',
      '/api/sales',
      '/reports/sales'
    ];
    
    let salesHtml = '';
    let successfulEndpoint = '';
    
    for (const endpoint of endpoints) {
      console.log(`Trying endpoint: ${endpoint}`);
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'GET',
        headers: {
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      const html = await response.text();
      
      // Check if this looks like sales data (not a login page)
      if (!html.includes('<!doctype html>') || html.includes('sales') || html.includes('revenue') || html.includes('total')) {
        salesHtml = html;
        successfulEndpoint = endpoint;
        console.log(`Found data at endpoint: ${endpoint}, length: ${html.length}`);
        break;
      }
    }
    
    if (!salesHtml && successfulEndpoint === '') {
      console.log('All endpoints returned login page, authentication may have failed');
    }

    console.log('HTML sample (first 500 chars):', salesHtml.substring(0, 500));

    // For now, return mock data until we can properly parse the HTML
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
      debug: {
        endpoint: successfulEndpoint,
        htmlLength: salesHtml.length,
        hasLoginPage: salesHtml.includes('<!doctype html>'),
      }
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
