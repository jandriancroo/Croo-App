import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return new Response(JSON.stringify({ authenticated: false, error: 'Missing credentials' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const response = await fetch('https://admin.qubeyond.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ payload: { username, password, captchaToken: '' } }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ authenticated: false, error: 'Authentication failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const token = data?.token;

    if (!token) {
      return new Response(JSON.stringify({ authenticated: false, error: 'No token received' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Decode JWT to get tokenGw
    const parts = token.split('.');
    if (parts.length !== 3) {
      return new Response(JSON.stringify({ authenticated: false, error: 'Invalid token format' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const tokenGw = payload?.tokenGw;

    if (!tokenGw) {
      return new Response(JSON.stringify({ authenticated: false, error: 'No gateway token' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ authenticated: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      authenticated: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
