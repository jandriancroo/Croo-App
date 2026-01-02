import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// PFG Azure AD B2C Configuration
const PFG_B2C_TENANT = 'pfgcustomerfirst';
const PFG_B2C_POLICY = 'b2c_1a_signup_signin';
const PFG_CLIENT_ID = 'c68e7fae-80a1-42db-bd89-3fb37d1224a2';
const PFG_SCOPE = 'https://pfgcustomerfirst.onmicrosoft.com/api/customer-first-site-api openid profile offline_access';
const PFG_TOKEN_URL = `https://${PFG_B2C_TENANT}.b2clogin.com/${PFG_B2C_TENANT}.onmicrosoft.com/${PFG_B2C_POLICY}/oauth2/v2.0/token`;
const PFG_API_BASE = 'https://apps-zz-cusfst-mw-p-eus01.azurewebsites.net/api';

interface PFGCredentials {
  username: string;
  password: string;
  refresh_token?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

// Authenticate using ROPC (Resource Owner Password Credentials) flow
async function authenticateWithPassword(username: string, password: string): Promise<TokenResponse | null> {
  try {
    console.log('[PFG Auth] Attempting ROPC authentication for:', username);
    
    const params = new URLSearchParams({
      client_id: PFG_CLIENT_ID,
      scope: PFG_SCOPE,
      grant_type: 'password',
      username: username,
      password: password,
      client_info: '1',
    });

    const response = await fetch(PFG_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PFG Auth] ROPC failed:', response.status, errorText);
      return null;
    }

    const tokenData = await response.json();
    console.log('[PFG Auth] ROPC authentication successful');
    return tokenData;
  } catch (error) {
    console.error('[PFG Auth] ROPC error:', error);
    return null;
  }
}

// Refresh an existing token
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse | null> {
  try {
    console.log('[PFG Auth] Refreshing access token');
    
    const params = new URLSearchParams({
      client_id: PFG_CLIENT_ID,
      scope: PFG_SCOPE,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_info: '1',
    });

    const response = await fetch(PFG_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PFG Auth] Token refresh failed:', response.status, errorText);
      return null;
    }

    const tokenData = await response.json();
    console.log('[PFG Auth] Token refresh successful');
    return tokenData;
  } catch (error) {
    console.error('[PFG Auth] Refresh error:', error);
    return null;
  }
}

// Get a valid access token (try refresh first, then password auth)
async function getAccessToken(credentials: PFGCredentials): Promise<{ token: string; newRefreshToken?: string } | null> {
  // Try refresh token first if available
  if (credentials.refresh_token) {
    const refreshed = await refreshAccessToken(credentials.refresh_token);
    if (refreshed) {
      return { 
        token: refreshed.access_token, 
        newRefreshToken: refreshed.refresh_token 
      };
    }
    console.log('[PFG Auth] Refresh failed, falling back to password auth');
  }

  // Fall back to password authentication
  const tokenData = await authenticateWithPassword(credentials.username, credentials.password);
  if (tokenData) {
    return { 
      token: tokenData.access_token, 
      newRefreshToken: tokenData.refresh_token 
    };
  }

  return null;
}

// Fetch product search results from PFG
async function fetchProductList(accessToken: string, searchTerm: string = ''): Promise<any> {
  const response = await fetch(`${PFG_API_BASE}/ProductListSearch/V1/SearchProductList`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      searchTerm: searchTerm,
      pageNumber: 1,
      pageSize: 50,
    }),
  });

  if (!response.ok) {
    throw new Error(`PFG API error: ${response.status}`);
  }

  return response.json();
}

// Fetch order history from PFG
async function fetchOrderHistory(accessToken: string): Promise<any> {
  const response = await fetch(`${PFG_API_BASE}/OrderHistory/V1/GetOrderHistory`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`PFG API error: ${response.status}`);
  }

  return response.json();
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { locationId, testCredentials, action = 'test' } = await req.json();

    let credentials: PFGCredentials;
    let integrationId: string | null = null;

    // Use test credentials or fetch from database
    if (testCredentials) {
      credentials = testCredentials;
    } else if (locationId) {
      const { data: integration, error } = await supabase
        .from('location_integrations')
        .select('id, credentials')
        .eq('location_id', locationId)
        .eq('integration_type', 'pfg')
        .eq('is_active', true)
        .maybeSingle();

      if (error || !integration) {
        return new Response(JSON.stringify({ 
          error: 'PFG integration not configured',
          authenticated: false 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      credentials = integration.credentials as unknown as PFGCredentials;
      integrationId = integration.id;
    } else {
      return new Response(JSON.stringify({ 
        error: 'Missing locationId or testCredentials',
        authenticated: false 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get access token
    const authResult = await getAccessToken(credentials);
    
    if (!authResult) {
      return new Response(JSON.stringify({ 
        error: 'Authentication failed - check username and password',
        authenticated: false 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update stored refresh token if we got a new one
    if (integrationId && authResult.newRefreshToken) {
      await supabase
        .from('location_integrations')
        .update({
          credentials: {
            ...credentials,
            refresh_token: authResult.newRefreshToken,
          },
        })
        .eq('id', integrationId);
    }

    // For test action, just return success
    if (action === 'test') {
      return new Response(JSON.stringify({ 
        authenticated: true,
        message: 'PFG authentication successful'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For other actions, fetch data
    if (action === 'orders') {
      const orders = await fetchOrderHistory(authResult.token);
      return new Response(JSON.stringify({ 
        authenticated: true,
        data: orders 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'products') {
      const { searchTerm } = await req.json();
      const products = await fetchProductList(authResult.token, searchTerm);
      return new Response(JSON.stringify({ 
        authenticated: true,
        data: products 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      authenticated: true,
      message: 'Unknown action' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[PFG] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      authenticated: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
