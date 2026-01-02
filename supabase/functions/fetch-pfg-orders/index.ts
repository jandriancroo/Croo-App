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
  username?: string; // For display only
  refresh_token: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
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

// Fetch product list with categories from PFG
async function fetchProductList(accessToken: string, searchTerm: string = ''): Promise<any> {
  console.log('[PFG API] Fetching product list, search:', searchTerm);
  
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
    const errorText = await response.text();
    console.error('[PFG API] Product search failed:', response.status, errorText);
    throw new Error(`PFG API error: ${response.status}`);
  }

  return response.json();
}

// Fetch product categories (storage locations) from PFG
async function fetchProductCategories(accessToken: string): Promise<any> {
  console.log('[PFG API] Fetching product categories');
  
  // Use empty search to get all categories
  const response = await fetch(`${PFG_API_BASE}/ProductListSearch/V1/SearchProductList`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      searchTerm: '',
      pageNumber: 1,
      pageSize: 1000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[PFG API] Categories fetch failed:', response.status, errorText);
    throw new Error(`PFG API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Log the raw response structure for debugging
  console.log('[PFG API] Raw response keys:', Object.keys(data || {}));
  console.log('[PFG API] ResultObject keys:', Object.keys(data?.ResultObject || {}));
  
  // Extract unique categories from the response
  const rawCategories = data?.ResultObject?.ProductListCategories || [];
  console.log('[PFG API] Found', rawCategories.length, 'categories');
  
  if (rawCategories.length > 0) {
    console.log('[PFG API] First category sample:', JSON.stringify(rawCategories[0]).substring(0, 500));
  }
  
  return {
    categories: rawCategories.map((cat: any) => ({
      id: cat.ProductListCategoryId,
      name: cat.CategoryTitle,
      productCount: cat.Products?.length || 0,
      products: cat.Products?.map((p: any) => ({
        id: p.ProductListDetailId,
        name: p.ProductName || p.Description,
        unit: p.UnitOfMeasure,
      })) || []
    }))
  };
}

// Fetch order history from PFG
async function fetchOrderHistory(accessToken: string): Promise<any> {
  console.log('[PFG API] Fetching order history');
  
  const response = await fetch(`${PFG_API_BASE}/OrderHistory/V1/GetOrderHistory`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[PFG API] Order history failed:', response.status, errorText);
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
      console.log('[PFG] Using test credentials');
    } else if (locationId) {
      console.log('[PFG] Fetching credentials for location:', locationId);
      
      const { data: integration, error } = await supabase
        .from('location_integrations')
        .select('id, credentials')
        .eq('location_id', locationId)
        .eq('integration_type', 'pfg')
        .eq('is_active', true)
        .maybeSingle();

      if (error || !integration) {
        console.log('[PFG] No integration found:', error?.message);
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

    if (!credentials.refresh_token) {
      return new Response(JSON.stringify({ 
        error: 'No refresh token provided',
        authenticated: false 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Refresh the token
    const tokenData = await refreshAccessToken(credentials.refresh_token);
    
    if (!tokenData) {
      return new Response(JSON.stringify({ 
        error: 'Token refresh failed - the refresh token may have expired. Please log in to PFG again and get a new refresh token.',
        authenticated: false 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update stored refresh token if we got a new one
    if (integrationId && tokenData.refresh_token) {
      console.log('[PFG] Updating stored refresh token');
      await supabase
        .from('location_integrations')
        .update({
          credentials: {
            ...credentials,
            refresh_token: tokenData.refresh_token,
          },
        })
        .eq('id', integrationId);
    }

    // For test action, just return success
    if (action === 'test') {
      console.log('[PFG] Test successful');
      return new Response(JSON.stringify({ 
        authenticated: true,
        message: 'PFG authentication successful! Token is valid.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For other actions, fetch data
    if (action === 'orders') {
      const orders = await fetchOrderHistory(tokenData.access_token);
      return new Response(JSON.stringify({ 
        authenticated: true,
        data: orders 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'products') {
      const products = await fetchProductList(tokenData.access_token, '');
      return new Response(JSON.stringify({ 
        authenticated: true,
        data: products 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'categories') {
      const categories = await fetchProductCategories(tokenData.access_token);
      return new Response(JSON.stringify({ 
        authenticated: true,
        data: categories 
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
