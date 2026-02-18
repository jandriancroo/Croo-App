import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// PFG SERVICE - Consolidated service for all PFG operations
// Actions: oauth_start, oauth_exchange, fetch, test, sync_orders, refresh_keep_alive
// ============================================================================

// PFG Azure AD B2C Configuration
const PFG_B2C_TENANT = 'pfgcustomerfirst';
const PFG_B2C_POLICY = 'b2c_1a_signup_signin';
const PFG_CLIENT_ID = 'c68e7fae-80a1-42db-bd89-3fb37d1224a2';
const PFG_SCOPE = 'https://pfgcustomerfirst.onmicrosoft.com/api/customer-first-site-api openid profile offline_access';
const PFG_TOKEN_URL = `https://${PFG_B2C_TENANT}.b2clogin.com/${PFG_B2C_TENANT}.onmicrosoft.com/${PFG_B2C_POLICY}/oauth2/v2.0/token`;
const PFG_REDIRECT_URI = 'https://www.customerfirstsolutions.com';

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

    if (res.status === 404) continue;
    throw new Error(`PFG API error: ${res.status}${lastText ? ` - ${lastText.slice(0, 200)}` : ''}`);
  }

  throw new Error(`PFG API error: ${lastStatus || 404}${lastText ? ` - ${lastText.slice(0, 200)}` : ''}`);
}

interface PFGCredentials {
  username?: string;
  password?: string;
  refresh_token: string;
  customer_id?: string;
  access_token?: string;
  token_expires_at?: string;
  refresh_token_updated_at?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  refresh_token_expires_in?: number;
}

// Generate PKCE code verifier and challenge
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  return { verifier, challenge };
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PFG Auth] Token refresh failed:', response.status, errorText);
      return null;
    }

    const tokenData = await response.json();
    console.log('[PFG Auth] Token refresh successful. expires_in:', tokenData.expires_in, 'refresh_token_expires_in:', tokenData.refresh_token_expires_in);
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

// Helper to parse pack quantity from pack size string (e.g., "48/2 OZ" -> 48)
const parsePackQuantity = (packSize: string | undefined): number | null => {
  if (!packSize) return null;
  const match = packSize.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

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

  const rawCategories = data?.ResultObject?.ProductListCategories || [];
  console.log('[PFG API] Found', rawCategories.length, 'categories in list');

  const categories = rawCategories.map((cat: any) => ({
    id: cat.ProductListCategoryId,
    name: cat.CategoryTitle || cat.Name || 'Unnamed',
    productCount: cat.Products?.length || 0,
    products: (cat.Products || []).map((p: any) => {
      const product = p.Product || {};
      const uomList = product.UnitOfMeasureOrderQuantities || [];
      const uom = uomList[0] || {};
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

// Fetch customer info to get CustomerId
async function fetchCustomerInfo(accessToken: string): Promise<any> {
  console.log('[PFG API] Fetching customer info');
  
  const endpoints = [
    '/Customer/V1/GetCustomer',
    '/Customer/V1/GetCustomers',
    '/Customer/V1/GetCurrentCustomer',
    '/Customer/V1/GetAllCustomers',
    '/Customer/V1/GetCustomerList',
    '/Account/V1/GetCustomerInfo',
  ];
  
  for (const path of endpoints) {
    try {
      const data = await fetchPfgJson(path, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });
      console.log('[PFG API] Customer response from', path, '→', JSON.stringify(data).slice(0, 1200));
      const result = data?.ResultObject || data;
      // If it's an array of customers, return the full list
      if (Array.isArray(result)) {
        console.log('[PFG API] Found', result.length, 'customers');
        return result;
      }
      return result;
    } catch (err) {
      console.warn('[PFG API] Customer endpoint failed:', path, (err as Error).message?.slice(0, 100));
    }
  }
  return null;
}

// Fetch available order guides / product list headers
async function fetchProductListHeaders(accessToken: string, customerId?: string): Promise<{ guides: any[]; customerId?: string }> {
  console.log('[PFG API] Fetching product list headers');

  // First, get the customer ID if not provided
  let resolvedCustomerId = customerId;
  if (!resolvedCustomerId) {
    const customerInfo = await fetchCustomerInfo(accessToken);
    if (customerInfo) {
      resolvedCustomerId = customerInfo.CustomerId || customerInfo.Id || customerInfo.CustomerNumber;
      console.log('[PFG API] Resolved customer ID:', resolvedCustomerId);
    }
  }

  // Try multiple known endpoints
  const endpoints = [
    { path: '/ProductList/V1/GetProductListHeaders', method: 'GET' },
    { path: '/ProductListHeader/V1/GetProductListHeaders', method: 'GET' },
    { path: '/Customer/V1/GetCustomerProductListHeaders', method: 'GET' },
  ];

  for (const ep of endpoints) {
    try {
      const url = resolvedCustomerId ? `${ep.path}?CustomerId=${resolvedCustomerId}` : ep.path;
      const data = await fetchPfgJson(url, {
        method: ep.method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });
      console.log('[PFG API] Headers response from', ep.path, '→', JSON.stringify(data).slice(0, 500));
      const result = data?.ResultObject || data;
      if (Array.isArray(result) && result.length > 0) {
        console.log('[PFG API] Found', result.length, 'product list headers via', ep.path);
        return { guides: result, customerId: resolvedCustomerId };
      }
      // If ResultObject is an object with nested arrays, try common patterns
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const keys = Object.keys(result);
        console.log('[PFG API] ResultObject keys:', keys.join(', '));
        for (const key of keys) {
          if (Array.isArray(result[key]) && result[key].length > 0) {
            console.log('[PFG API] Found array at key', key, 'with', result[key].length, 'items');
            console.log('[PFG API] First item sample:', JSON.stringify(result[key][0]).slice(0, 300));
            return { guides: result[key], customerId: resolvedCustomerId };
          }
        }
      }
    } catch (err) {
      console.warn('[PFG API] Headers endpoint failed:', ep.path, (err as Error).message?.slice(0, 100));
    }
  }

  // Fallback: call SearchProductList with no search and extract from raw response
  console.log('[PFG API] Trying SearchProductList fallback for headers');
  try {
    const data = await fetchPfgJson(
      '/ProductListSearch/V1/SearchProductList',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ searchTerm: '', pageNumber: 1, pageSize: 1 }),
      },
    );
    console.log('[PFG API] SearchProductList response keys:', JSON.stringify(Object.keys(data?.ResultObject || {})));
    console.log('[PFG API] Full SupportMessages:', JSON.stringify(data?.SupportMessages));
    console.log('[PFG API] Full ResultObject:', JSON.stringify(data?.ResultObject).slice(0, 1000));
    
    if (data?.ResultObject?.ProductListHeaders) {
      return { guides: data.ResultObject.ProductListHeaders, customerId: resolvedCustomerId };
    }
  } catch (err) {
    console.warn('[PFG API] SearchProductList fallback failed:', (err as Error).message?.slice(0, 100));
  }

  return { guides: [], customerId: resolvedCustomerId };
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

// Parse date from PFG format
function parsePfgDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // Continue to other formats
  }
  
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return null;
}

// ============================================================================
// TOKEN CACHING — inline check-and-refresh pattern
// ============================================================================

const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 60 * 1000; // 2 hours before expiry
const TOKEN_PROACTIVE_REFRESH_MS = 18 * 60 * 60 * 1000; // 18 hours — backup refresh threshold

/**
 * Returns a valid access token, using the cached one when possible.
 * Only refreshes when the cached token is within 2 hours of expiry.
 * Also proactively refreshes if the refresh_token is >18 hours old (backup for cron).
 * Persists the new tokens back to location_integrations.
 */
async function getValidAccessToken(
  supabase: any,
  credentials: PFGCredentials,
  integrationId: string | null,
): Promise<{ accessToken: string; updatedCredentials: PFGCredentials } | null> {

  // 1. Check if cached access_token is still fresh
  if (credentials.access_token && credentials.token_expires_at) {
    const expiresAt = new Date(credentials.token_expires_at).getTime();
    const now = Date.now();
    
    // Also check if refresh token is getting old (>18h) — proactive backup refresh
    const refreshAge = credentials.refresh_token_updated_at 
      ? now - new Date(credentials.refresh_token_updated_at).getTime()
      : Infinity;
    
    if (expiresAt - now > TOKEN_REFRESH_BUFFER_MS && refreshAge < TOKEN_PROACTIVE_REFRESH_MS) {
      console.log('[PFG Auth] Using cached access token (expires in', Math.round((expiresAt - now) / 60000), 'min, refresh age:', Math.round(refreshAge / 3600000), 'h)');
      return { accessToken: credentials.access_token, updatedCredentials: credentials };
    }
    
    if (refreshAge >= TOKEN_PROACTIVE_REFRESH_MS) {
      console.log('[PFG Auth] Refresh token is', Math.round(refreshAge / 3600000), 'h old — proactive refresh (backup for cron)');
    } else {
      console.log('[PFG Auth] Cached token near expiry — refreshing');
    }
  }

  // 2. Try refresh_token
  const tokenData = credentials.refresh_token
    ? await refreshAccessToken(credentials.refresh_token)
    : null;

  if (!tokenData) {
    console.error('[PFG Auth] Token refresh failed — manual re-login required via OAuth popup');
    return null;
  }

  // 3. Build updated credentials with cached access_token + expiry
  const now = new Date();
  const expiresAtIso = new Date(now.getTime() + tokenData.expires_in * 1000).toISOString();
  const updatedCredentials: PFGCredentials = {
    ...credentials,
    refresh_token: tokenData.refresh_token,
    access_token: tokenData.access_token,
    token_expires_at: expiresAtIso,
    refresh_token_updated_at: now.toISOString(),
  };

  // 4. Persist
  if (integrationId) {
    await supabase
      .from('location_integrations')
      .update({ credentials: updatedCredentials })
      .eq('id', integrationId);
    console.log('[PFG Auth] Tokens cached until', expiresAtIso);
  }

  return { accessToken: tokenData.access_token, updatedCredentials };
}

// ============================================================================
// SAVE TOKEN — manually pasted refresh token
// ============================================================================

async function handleSaveToken(supabase: any, body: any): Promise<Response> {
  const { locationId, refreshToken } = body;

  if (!locationId || !refreshToken) {
    return new Response(JSON.stringify({ error: 'Missing locationId or refreshToken', success: false }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[PFG] Saving manually-pasted refresh token for location:', locationId);

  // Try refreshing the token to validate it works
  try {
    const tokenParams = new URLSearchParams({
      client_id: PFG_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: PFG_SCOPE,
    });

    const tokenResp = await fetch(PFG_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error('[PFG] Token validation failed:', errText);
      return new Response(JSON.stringify({ error: 'Invalid token — could not refresh. Please try again.', success: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokenData = await tokenResp.json();
    const newRefreshToken = tokenData.refresh_token || refreshToken;

    // Upsert the integration
    const { error: upsertError } = await supabase
      .from('location_integrations')
      .upsert({
        location_id: locationId,
        integration_type: 'pfg',
        credentials: {
          refresh_token: newRefreshToken,
          refresh_token_updated_at: new Date().toISOString(),
        },
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'location_id,integration_type' });

    if (upsertError) throw upsertError;

    console.log('[PFG] Token saved and validated successfully');
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[PFG] Save token error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error', success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ============================================================================
// OAUTH FLOW — popup-based login (legacy, may not work with PFG's B2C config)
// ============================================================================

/**
 * Generate the OAuth authorize URL + PKCE verifier for the popup flow.
 * The client opens this URL in a popup. After login, PFG redirects to
 * PFG_REDIRECT_URI#code=XXX&state=YYY. The client captures the code
 * and sends it back via oauth_exchange.
 */
async function handleOAuthStart(): Promise<Response> {
  const pkce = await generatePKCE();
  const state = crypto.randomUUID();

  const authorizeUrl = `https://${PFG_B2C_TENANT}.b2clogin.com/${PFG_B2C_TENANT}.onmicrosoft.com/${PFG_B2C_POLICY}/oauth2/v2.0/authorize?` +
    new URLSearchParams({
      client_id: PFG_CLIENT_ID,
      scope: 'openid profile offline_access',
      redirect_uri: PFG_REDIRECT_URI,
      response_mode: 'fragment',
      response_type: 'code',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      nonce: crypto.randomUUID(),
      state,
    }).toString();

  return new Response(JSON.stringify({
    authorizeUrl,
    codeVerifier: pkce.verifier,
    state,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Exchange the auth code from the popup redirect for tokens.
 * Saves the tokens to location_integrations.
 */
async function handleOAuthExchange(supabase: any, body: any): Promise<Response> {
  const { locationId, code, codeVerifier } = body;

  if (!locationId || !code || !codeVerifier) {
    return new Response(JSON.stringify({
      error: 'Missing locationId, code, or codeVerifier',
      authenticated: false,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[PFG OAuth] Exchanging code for tokens, location:', locationId);

  // Exchange code for tokens
  const tokenParams = new URLSearchParams({
    client_id: PFG_CLIENT_ID,
    scope: 'openid profile offline_access',
    redirect_uri: PFG_REDIRECT_URI,
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
  });

  const tokenResponse = await fetch(PFG_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('[PFG OAuth] Token exchange failed:', tokenResponse.status, errorText);
    return new Response(JSON.stringify({
      error: 'Token exchange failed — please try again.',
      authenticated: false,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const tokenData: TokenResponse = await tokenResponse.json();
  console.log('[PFG OAuth] Token exchange successful! expires_in:', tokenData.expires_in);

  // Save/update the integration
  const now = new Date();
  const credentials: PFGCredentials = {
    refresh_token: tokenData.refresh_token,
    access_token: tokenData.access_token,
    token_expires_at: new Date(now.getTime() + tokenData.expires_in * 1000).toISOString(),
    refresh_token_updated_at: now.toISOString(),
  };

  const { data: existing } = await supabase
    .from('location_integrations')
    .select('id, credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'pfg')
    .maybeSingle();

  if (existing) {
    // Preserve existing fields like customer_id, username
    const existingCreds = existing.credentials as any || {};
    const mergedCreds = {
      ...existingCreds,
      ...credentials,
    };
    await supabase
      .from('location_integrations')
      .update({ credentials: mergedCreds, is_active: true })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('location_integrations')
      .insert({
        location_id: locationId,
        integration_type: 'pfg',
        credentials,
        is_active: true,
      });
  }

  return new Response(JSON.stringify({
    authenticated: true,
    message: 'PFG connected via OAuth! Token saved.',
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// KEEP-ALIVE — proactive token refresh for cron
// ============================================================================

async function handleRefreshKeepAlive(supabase: any, body: any): Promise<Response> {
  const locationId = body?.locationId;
  
  // If locationId specified, refresh just that one; otherwise refresh ALL active PFG integrations
  let query = supabase
    .from('location_integrations')
    .select('id, location_id, credentials')
    .eq('integration_type', 'pfg')
    .eq('is_active', true);
  
  if (locationId) {
    query = query.eq('location_id', locationId);
  }

  const { data: integrations, error } = await query;

  if (error) throw new Error(`Failed to fetch PFG integrations: ${error.message}`);
  if (!integrations || integrations.length === 0) {
    return new Response(JSON.stringify({ success: true, refreshed: 0, message: 'No active PFG integrations' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[PFG Keep-Alive] Refreshing ${integrations.length} integrations`);
  const results: { locationId: string; success: boolean; error?: string }[] = [];

  for (const integration of integrations) {
    const creds = integration.credentials as unknown as PFGCredentials;
    
    if (!creds?.refresh_token) {
      results.push({ locationId: integration.location_id, success: false, error: 'No refresh token' });
      continue;
    }

    try {
      const tokenData = await refreshAccessToken(creds.refresh_token);
      
      if (!tokenData) {
        results.push({ locationId: integration.location_id, success: false, error: 'Refresh failed — manual re-login needed' });
        continue;
      }

      const now = new Date();
      const updatedCreds: PFGCredentials = {
        ...creds,
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        token_expires_at: new Date(now.getTime() + tokenData.expires_in * 1000).toISOString(),
        refresh_token_updated_at: now.toISOString(),
      };

      await supabase
        .from('location_integrations')
        .update({ credentials: updatedCreds })
        .eq('id', integration.id);

      results.push({ locationId: integration.location_id, success: true });
      console.log(`[PFG Keep-Alive] ✓ Refreshed token for location ${integration.location_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ locationId: integration.location_id, success: false, error: msg });
      console.error(`[PFG Keep-Alive] ✗ Failed for location ${integration.location_id}:`, msg);
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return new Response(JSON.stringify({
    success: true,
    refreshed: succeeded,
    failed,
    results,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function handleFetchAction(supabase: any, body: any): Promise<Response> {
  const { locationId, testCredentials, action = 'test', productListHeaderId, customerId } = body;

  let credentials: PFGCredentials;
  let integrationId: string | null = null;

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
      error: 'No refresh token stored — please connect to PFG via the login button.',
      authenticated: false 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const tokenResult = await getValidAccessToken(supabase, credentials, integrationId);

  if (!tokenResult) {
    return new Response(JSON.stringify({ 
      error: 'Token refresh failed — please reconnect to PFG.',
      authenticated: false 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { accessToken } = tokenResult;

  // Handle different fetch actions
  if (action === 'test') {
    return new Response(JSON.stringify({ 
      authenticated: true,
      message: 'PFG authentication successful!'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'orders') {
    const orders = await fetchOrderHistory(accessToken);
    return new Response(JSON.stringify({ authenticated: true, data: orders }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'products') {
    const products = await fetchProductList(accessToken, '');
    return new Response(JSON.stringify({ authenticated: true, data: products }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'categories') {
    if (!productListHeaderId) {
      return new Response(JSON.stringify({ 
        error: 'productListHeaderId is required',
        authenticated: true
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const customerIdToUse = customerId || credentials.customer_id;
    if (!customerIdToUse) {
      return new Response(JSON.stringify({ 
        error: 'customerId is required',
        authenticated: true
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const categoriesData = await fetchProductListItems(accessToken, productListHeaderId, customerIdToUse);
    const categories = categoriesData.categories || [];
    
    // Fetch missing prices
    const productsNeedingPrice: { category: any; product: any }[] = [];
    
    for (const cat of categories) {
      for (const p of cat.products || []) {
        if (!(p.price && p.price > 0) && p.id) {
          productsNeedingPrice.push({ category: cat, product: p });
        }
      }
    }
    
    const BATCH_SIZE = 10;
    for (let i = 0; i < productsNeedingPrice.length; i += BATCH_SIZE) {
      const batch = productsNeedingPrice.slice(i, i + BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(({ product }) => 
          fetchProductDetail(accessToken, product.id, customerIdToUse)
        )
      );
      
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value?.price && result.value.price > 0) {
          batch[idx].product.price = result.value.price;
          if (!batch[idx].product.packSize && result.value.packSize) {
            batch[idx].product.packSize = result.value.packSize;
          }
        }
      });
    }
    
    return new Response(JSON.stringify({ 
      authenticated: true,
      data: { categories } 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'list_guides') {
    const customerIdToUse = customerId || credentials.customer_id;
    const result = await fetchProductListHeaders(accessToken, customerIdToUse);
    return new Response(JSON.stringify({ 
      authenticated: true,
      data: result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ authenticated: true, message: 'Unknown action' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleSyncOrders(supabase: any, body: any): Promise<Response> {
  let locationIds: string[] = [];
  
  if (body?.locationId) {
    locationIds = [body.locationId];
  }

  let query = supabase
    .from('location_integrations')
    .select('id, location_id, credentials')
    .eq('integration_type', 'pfg')
    .eq('is_active', true);
  
  if (locationIds.length > 0) {
    query = query.in('location_id', locationIds);
  }

  const { data: integrations, error: intError } = await query;

  if (intError) {
    throw new Error(`Failed to fetch integrations: ${intError.message}`);
  }

  if (!integrations || integrations.length === 0) {
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'No active PFG integrations',
      synced: 0 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[PFG Sync] Found ${integrations.length} active integrations`);

  const results: { locationId: string; success: boolean; ordersImported: number; error?: string }[] = [];

  for (const integration of integrations) {
    const credentials = integration.credentials as unknown as PFGCredentials;
    
    if (!credentials?.refresh_token) {
      results.push({ locationId: integration.location_id, success: false, ordersImported: 0, error: 'No credentials stored' });
      continue;
    }

    try {
      const tokenResult = await getValidAccessToken(supabase, credentials, integration.id);

      if (!tokenResult) {
        results.push({ locationId: integration.location_id, success: false, ordersImported: 0, error: 'Auth failed — re-login needed' });
        continue;
      }

      const { accessToken } = tokenResult;

      const orderData = await fetchOrderHistory(accessToken);
      const rawOrders = orderData?.ResultObject?.Orders || orderData?.Orders || orderData?.ResultObject || [];
      const orders = Array.isArray(rawOrders) ? rawOrders : [];
      
      console.log(`[PFG Sync] Found ${orders.length} orders for location ${integration.location_id}`);

      let importedCount = 0;

      for (const order of orders) {
        const pfgOrderId = order.OrderId || order.OrderNumber || order.Id || order.ConfirmationNumber;
        if (!pfgOrderId) continue;

        const orderDate = parsePfgDate(order.OrderDate || order.CreatedDate || order.SubmittedDate);
        const deliveryDate = parsePfgDate(order.DeliveryDate || order.RequestedDeliveryDate);

        if (!orderDate) continue;

        const items = (order.Items || order.OrderItems || order.LineItems || []).map((item: any) => ({
          productId: item.ProductKey || item.ProductId || item.ItemNumber,
          itemNumber: item.DisplayProductNumber || item.ProductNumber || item.ItemNumber,
          name: item.ProductDescription || item.Description || item.Name,
          quantity: item.Quantity || item.OrderQuantity || 0,
          unit: item.UnitOfMeasure || item.UOM || 'CS',
          price: item.Price || item.UnitPrice || 0,
          total: item.ExtendedPrice || item.LineTotal || 0,
        }));

        const { error: upsertError } = await supabase
          .from('pfg_orders')
          .upsert({
            location_id: integration.location_id,
            pfg_order_id: String(pfgOrderId),
            order_number: order.OrderNumber || order.ConfirmationNumber,
            order_date: orderDate,
            delivery_date: deliveryDate,
            status: order.Status || order.OrderStatus,
            total_amount: order.TotalAmount || order.OrderTotal || order.Total,
            items: items,
            raw_data: order,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'location_id,pfg_order_id' });

        if (!upsertError) importedCount++;
      }

      results.push({ locationId: integration.location_id, success: true, ordersImported: importedCount });

    } catch (error) {
      console.error(`[PFG Sync] Error for location ${integration.location_id}:`, error);
      results.push({ 
        locationId: integration.location_id, 
        success: false, 
        ordersImported: 0, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  const totalImported = results.reduce((sum, r) => sum + r.ordersImported, 0);

  return new Response(JSON.stringify({ success: true, results, totalImported }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON
    }

    console.log('[PFG Service] Action:', action || 'fetch');

    switch (action) {
      case 'save_token':
        return await handleSaveToken(supabase, body);

      case 'oauth_start':
        return await handleOAuthStart();
      
      case 'oauth_exchange':
        return await handleOAuthExchange(supabase, body);
      
      case 'refresh_keep_alive':
        return await handleRefreshKeepAlive(supabase, body);
      
      case 'sync_orders':
        return await handleSyncOrders(supabase, body);
      
      case 'fetch':
      default:
        return await handleFetchAction(supabase, body);
    }

  } catch (error) {
    console.error('[PFG Service] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      authenticated: false,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
