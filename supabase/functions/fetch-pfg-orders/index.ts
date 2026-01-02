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

// PFG API base URLs
// Note: PFG appears to serve different endpoints from different hosts/environments.
// We try the primary (customerfirstsolutions) first, and fall back to the Azure host.
const PFG_API_BASES = [
  'https://www.customerfirstsolutions.com/api/v1',
  'https://apps-zz-cusfst-mw-p-eus01.azurewebsites.net/api',
] as const;

type PfgApiBase = typeof PFG_API_BASES[number];

function joinUrl(base: string, path: string) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

async function fetchPfgJson(
  path: string,
  init: RequestInit,
  bases: readonly PfgApiBase[] = PFG_API_BASES,
): Promise<any> {
  let lastText = '';
  let lastStatus = 0;

  for (const base of bases) {
    const url = joinUrl(base, path);
    console.log('[PFG API] Request →', init.method || 'GET', url);

    const res = await fetch(url, init);

    if (res.ok) {
      const json = await res.json();
      console.log('[PFG API] Success ←', res.status, url);
      return json;
    }

    lastStatus = res.status;
    lastText = await res.text().catch(() => '');
    console.warn('[PFG API] Failed ←', res.status, url, (lastText || '').slice(0, 200));

    // If the endpoint isn't found on this host, try the next one.
    if (res.status === 404) continue;

    // For other failures (401/403/500/etc), stop here.
    throw new Error(`PFG API error: ${res.status}${lastText ? ` - ${lastText.slice(0, 200)}` : ''}`);
  }

  throw new Error(`PFG API error: ${lastStatus || 404}${lastText ? ` - ${lastText.slice(0, 200)}` : ''}`);
}

interface PFGCredentials {
  username?: string; // For display only
  refresh_token: string;
  customer_id?: string; // PFG customer ID
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

  return fetchPfgJson(
    '/ProductListSearch/V1/SearchProductList',
    {
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
    },
  );
}

// Fetch product list items from a specific list (using ProductListHeaderId)
async function fetchProductListItems(accessToken: string, productListHeaderId: string, customerId: string): Promise<any> {
  console.log('[PFG API] Fetching product list items for list:', productListHeaderId, 'customer:', customerId);

  const requestBody = {
    CustomerId: customerId,
    ProductListHeaderId: productListHeaderId,
    QueryText: "",
    SortByType: 5,
    IncludeRecipeItems: true
  };

  console.log('[PFG API] Request body:', JSON.stringify(requestBody));

  const data = await fetchPfgJson(
    '/ProductListSearch/V1/SearchProductList',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
  );

  // Log the raw response structure for debugging
  console.log('[PFG API] Raw response keys:', Object.keys(data || {}));
  console.log('[PFG API] ResultObject keys:', Object.keys(data?.ResultObject || {}));

  // The response should have ProductListCategories which are the storage locations
  const rawCategories = data?.ResultObject?.ProductListCategories || [];
  console.log('[PFG API] Found', rawCategories.length, 'categories in list');

  if (rawCategories.length > 0) {
    console.log('[PFG API] First category sample:', JSON.stringify(rawCategories[0]).substring(0, 500));
    // Log first product in detail to see all available fields
    const firstCatProducts = rawCategories[0]?.Products || [];
    if (firstCatProducts.length > 0) {
      console.log('[PFG API] First product FULL structure:', JSON.stringify(firstCatProducts[0], null, 2));
    }
  }

  // Helper to parse pack quantity from pack size string (e.g., "48/2 OZ" -> 48)
  const parsePackQuantity = (packSize: string | undefined): number | null => {
    if (!packSize) return null;
    const match = packSize.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  // Build categories with their products
  const categories = rawCategories.map((cat: any) => ({
    id: cat.ProductListCategoryId,
    name: cat.CategoryTitle || cat.Name || 'Unnamed',
    productCount: cat.Products?.length || 0,
    products: (cat.Products || []).map((p: any) => {
      const product = p.Product || {};
      const uomList = product.UnitOfMeasureOrderQuantities || [];
      const uom = uomList[0] || {};
      
      // Extract price - check various possible price fields
      const price = uom.Price || uom.UnitPrice || uom.ListPrice || product.Price || null;
      const packSize = uom.PackSize || product.ProductPackSizes?.[0];
      
      return {
        id: product.ProductKey || product.Id,
        itemNumber: product.DisplayProductNumber || product.ProductNumber || product.ProductKey,
        name: product.CustomProductDescription || product.DisplayProductDescription || product.ProductDescription || 'Unknown',
        fullDescription: product.ProductDescription,
        brand: product.ProductBrand,
        packSize: packSize,
        packQuantity: parsePackQuantity(packSize),
        unit: uom.UnitOfMeasureAbbreviation || 'CS',
        imageUrl: product.ProductImageUrlThumbnail,
        price: price,
      };
    }),
  }));

  return { categories };
}

// Fetch product detail (with pricing) from PFG
async function fetchProductDetail(accessToken: string, productKey: string, customerId: string): Promise<any> {
  console.log('[PFG API] Fetching product detail for:', productKey);

  const data = await fetchPfgJson(
    `/ProductDetail/V1/GetProductDetail?ProductKey=${productKey}&CustomerId=${customerId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    },
  );

  const result = data?.ResultObject;
  if (!result) return null;

  const uom = result.UnitOfMeasureOrderQuantities?.[0] || {};
  return {
    id: result.ProductKey || result.Id,
    price: uom.Price || null,
    packSize: uom.PackSize,
    unit: uom.UnitOfMeasureAbbreviation || 'CS',
  };
}

// Fetch order history from PFG
async function fetchOrderHistory(accessToken: string): Promise<any> {
  console.log('[PFG API] Fetching order history');

  return fetchPfgJson(
    '/OrderHistory/V1/GetOrderHistory',
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    },
  );
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

    const body = await req.json();
    const { locationId, testCredentials, action = 'test', productListHeaderId, customerId } = body;

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
      if (!productListHeaderId) {
        return new Response(JSON.stringify({ 
          error: 'productListHeaderId is required for categories action',
          authenticated: true
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Get customer ID from request or stored credentials
      const customerIdToUse = customerId || credentials.customer_id;
      if (!customerIdToUse) {
        return new Response(JSON.stringify({ 
          error: 'customerId is required for categories action',
          authenticated: true
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      const categoriesData = await fetchProductListItems(tokenData.access_token, productListHeaderId, customerIdToUse);
      const categories = categoriesData.categories || [];
      
      // Count products with prices from the list response
      let productsWithPrice = 0;
      for (const cat of categories) {
        for (const p of cat.products || []) {
          if (p.price) productsWithPrice++;
        }
      }
      console.log('[PFG API] Products with price from list:', productsWithPrice);
      
      return new Response(JSON.stringify({ 
        authenticated: true,
        data: { categories } 
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
