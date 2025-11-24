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

    console.log('Starting QuBeyond authentication flow');

    const baseUrl = 'https://admin.qubeyond.com';
    
    // Step 1: Fetch the login page to get any CSRF tokens and initial cookies
    console.log('Step 1: Fetching login page');
    const loginPageResponse = await fetch(`${baseUrl}/login`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    const loginPageHtml = await loginPageResponse.text();
    const initialCookies = loginPageResponse.headers.getSetCookie?.() || [];
    console.log('Initial cookies received:', initialCookies.length);
    
    // Extract CSRF token if present
    const csrfMatch = loginPageHtml.match(/csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)["']/i);
    const csrfToken = csrfMatch ? csrfMatch[1] : null;
    console.log('CSRF token found:', csrfToken ? 'yes' : 'no');
    
    // Build initial cookie string
    let cookieString = initialCookies.map(c => c.split(';')[0]).join('; ');
    if (!cookieString) {
      cookieString = `CID=${cid}; SID=${sid}`;
    }
    
    // Step 2: Submit login form
    console.log('Step 2: Submitting login credentials');
    const loginFormData = new URLSearchParams({
      username: username,
      password: password,
      cid: cid,
    });
    
    if (csrfToken) {
      loginFormData.append('_csrf', csrfToken);
      loginFormData.append('csrf_token', csrfToken);
    }
    
    const loginResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieString,
        'Referer': `${baseUrl}/login`,
        'Origin': baseUrl,
      },
      body: loginFormData.toString(),
      redirect: 'manual',
    });

    console.log('Login response status:', loginResponse.status);
    console.log('Login response redirect:', loginResponse.headers.get('location'));
    
    // Step 3: Update cookies from login response
    const loginCookies = loginResponse.headers.getSetCookie?.() || [];
    console.log('Login cookies received:', loginCookies.length);
    
    if (loginCookies.length > 0) {
      const newCookies = loginCookies.map(c => c.split(';')[0]);
      // Merge cookies, preferring newer ones
      const cookieMap = new Map();
      cookieString.split('; ').forEach(c => {
        const [key, value] = c.split('=');
        if (key && value) cookieMap.set(key, value);
      });
      newCookies.forEach(c => {
        const [key, value] = c.split('=');
        if (key && value) cookieMap.set(key, value);
      });
      cookieString = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    
    console.log('Final cookie count:', cookieString.split('; ').length);
    
    // Step 4: Fetch sales data with authenticated session
    const hourlyUrl = `${baseUrl}/reports/sales/hourly-sales`;
    const dailyUrl = `${baseUrl}/reports/overview/real-time-summary`;
    const weeklyUrl = `${baseUrl}/reports/overview/summary`;
    
    console.log('Step 4: Fetching sales data');
    
    const fetchWithAuth = async (url: string) => {
      return await fetch(url, {
        method: 'GET',
        headers: {
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': `${baseUrl}/dashboard`,
        },
      });
    };
    
    const [hourlyResponse, dailyResponse, weeklyResponse] = await Promise.all([
      fetchWithAuth(hourlyUrl),
      fetchWithAuth(dailyUrl),
      fetchWithAuth(weeklyUrl),
    ]);

    const hourlyHtml = await hourlyResponse.text();
    const dailyHtml = await dailyResponse.text();
    const weeklyHtml = await weeklyResponse.text();
    
    console.log('Hourly HTML length:', hourlyHtml.length, '- Is login page:', hourlyHtml.includes('<!doctype html>') && hourlyHtml.includes('Enterprise Intelligence'));
    console.log('Daily HTML length:', dailyHtml.length, '- Is login page:', dailyHtml.includes('<!doctype html>') && dailyHtml.includes('Enterprise Intelligence'));
    console.log('Weekly HTML length:', weeklyHtml.length, '- Is login page:', weeklyHtml.includes('<!doctype html>') && weeklyHtml.includes('Enterprise Intelligence'));
    
    // Check if we're still on login page
    const stillOnLoginPage = hourlyHtml.includes('Enterprise Intelligence') && hourlyHtml.length < 10000;
    
    if (stillOnLoginPage) {
      console.log('ERROR: Still getting login page after authentication');
      console.log('Hourly sample:', hourlyHtml.substring(0, 500));
    } else {
      console.log('SUCCESS: Got actual data pages');
      console.log('Hourly sample:', hourlyHtml.substring(0, 500));
    }

    // TODO: Parse the HTML to extract actual sales data
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
      authenticated: !stillOnLoginPage,
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
