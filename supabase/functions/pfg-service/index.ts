import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// PFG SERVICE - Consolidated service for all PFG operations
// Actions: fetch_orders, fetch_products, fetch_categories, test, sync_orders
// ============================================================================

// PFG Azure AD B2C Configuration
const PFG_B2C_TENANT = 'pfgcustomerfirst';
const PFG_B2C_POLICY = 'b2c_1a_signup_signin';
const PFG_CLIENT_ID = 'c68e7fae-80a1-42db-bd89-3fb37d1224a2';
const PFG_SCOPE = 'https://pfgcustomerfirst.onmicrosoft.com/api/customer-first-site-api openid profile offline_access';
const PFG_TOKEN_URL = `https://${PFG_B2C_TENANT}.b2clogin.com/${PFG_B2C_TENANT}.onmicrosoft.com/${PFG_B2C_POLICY}/oauth2/v2.0/token`;

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
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
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

// Extract cookies from response headers
function extractCookies(response: Response): string {
  const cookies: string[] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const cookiePart = value.split(';')[0];
      cookies.push(cookiePart);
    }
  });
  return cookies.join('; ');
}

// Headless browser OAuth login - mimics the B2C login page flow
async function loginWithPassword(username: string, password: string): Promise<TokenResponse | null> {
  try {
    console.log('[PFG Auth] Starting headless OAuth flow for:', username);

    // Step 1: Generate PKCE
    const pkce = await generatePKCE();
    const state = btoa(JSON.stringify({ id: crypto.randomUUID(), meta: { interactionType: 'redirect' } }));
    const nonce = crypto.randomUUID();
    
    const redirectUri = 'https://www.customerfirstsolutions.com';
    
    const authorizeUrl = `https://${PFG_B2C_TENANT}.b2clogin.com/${PFG_B2C_TENANT}.onmicrosoft.com/${PFG_B2C_POLICY}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id: PFG_CLIENT_ID,
        scope: 'openid profile offline_access',
        redirect_uri: redirectUri,
        response_mode: 'fragment',
        response_type: 'code',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        nonce,
        state,
      }).toString();

    console.log('[PFG Auth] Step 1: GET authorize page');
    const authResponse = await fetch(authorizeUrl, { redirect: 'manual' });
    
    // Collect cookies from all set-cookie headers
    const rawHeaders = authResponse.headers;
    let cookies = '';
    const cookieArr: string[] = [];
    // Response.headers.getSetCookie() may be available in Deno
    try {
      const setCookies = (rawHeaders as any).getSetCookie?.() || [];
      for (const sc of setCookies) {
        cookieArr.push(sc.split(';')[0]);
      }
    } catch {
      // Fallback: try forEach
      rawHeaders.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          cookieArr.push(value.split(';')[0]);
        }
      });
    }
    cookies = cookieArr.join('; ');
    
    const authHtml = await authResponse.text();
    console.log('[PFG Auth] Got authorize page, status:', authResponse.status, 'cookies:', cookieArr.length);
    // Log a large chunk of the HTML to understand the page structure
    console.log('[PFG Auth] HTML chunk 1:', authHtml.substring(0, 3000));
    console.log('[PFG Auth] HTML chunk 2:', authHtml.substring(3000, 6000));

    // Step 2: Extract CSRF token and transId from the HTML/settings
    // Look for the settings JSON in the page
    const settingsMatch = authHtml.match(/var SETTINGS\s*=\s*(\{[^;]+\});/);
    const csrfMatch = authHtml.match(/"csrf"\s*:\s*"([^"]+)"/);
    const transIdMatch = authHtml.match(/"transId"\s*:\s*"([^"]+)"/);
    
    let csrf = csrfMatch?.[1] || '';
    let transId = transIdMatch?.[1] || '';
    
    // Also try to extract from meta tags or hidden inputs
    if (!csrf) {
      const csrfMeta = authHtml.match(/name="x-ms-cpim-csrf"\s+content="([^"]+)"/);
      csrf = csrfMeta?.[1] || '';
    }
    if (!transId) {
      const transMatch = authHtml.match(/transId=([^&"]+)/);
      transId = transMatch?.[1] || '';
    }
    
    // Extract the API URL for SelfAsserted
    const apiMatch = authHtml.match(/"api"\s*:\s*"([^"]+)"/);
    const apiPath = apiMatch?.[1] || '/SelfAsserted';
    
    // Also look for the full settings block to understand the URL pattern
    const settingsSnippet = settingsMatch?.[1]?.substring(0, 500) || 'no SETTINGS found';
    console.log('[PFG Auth] Step 2: csrf:', csrf ? 'found' : 'MISSING', 'transId:', transId ? 'found' : 'MISSING', 'apiPath:', apiPath, 'settings:', settingsSnippet);
    
    if (!csrf || !transId) {
      // Log some of the HTML to help debug
      console.error('[PFG Auth] Could not extract csrf/transId. HTML snippet:', authHtml.substring(0, 2000));
      return null;
    }

    // Step 3: POST credentials
    // Extract the exact tenant host path from settings (includes correct casing)
    const hostsMatch = authHtml.match(/"hosts"\s*:\s*\{[^}]*"tenant"\s*:\s*"([^"]+)"/);
    const tenantPath = hostsMatch?.[1] || `/${PFG_B2C_TENANT}.onmicrosoft.com/${PFG_B2C_POLICY}`;
    
    // B2C SelfAsserted endpoint - use the api path from settings (e.g. CombinedSigninAndSignup)
    const selfAssertedUrl = `https://${PFG_B2C_TENANT}.b2clogin.com${tenantPath}/api/${apiPath}?` +
      new URLSearchParams({
        tx: transId,
        p: PFG_B2C_POLICY,
      }).toString();

    console.log('[PFG Auth] SelfAsserted URL:', selfAssertedUrl);

    const formData = new URLSearchParams({
      request_type: 'RESPONSE',
      signInName: username,
      password: password,
    });

    console.log('[PFG Auth] Step 3: POST credentials to SelfAsserted');
    const selfAssertedResponse = await fetch(selfAssertedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRF-TOKEN': csrf,
        'Cookie': cookies,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    const selfAssertedText = await selfAssertedResponse.text();
    console.log('[PFG Auth] SelfAsserted response:', selfAssertedResponse.status, selfAssertedText.substring(0, 500));

    // Collect any new cookies
    try {
      const newCookies = (selfAssertedResponse.headers as any).getSetCookie?.() || [];
      for (const sc of newCookies) {
        cookieArr.push(sc.split(';')[0]);
      }
      cookies = cookieArr.join('; ');
    } catch {}

    // Check for error in the response
    if (selfAssertedResponse.status !== 200 || selfAssertedText.includes('"status":"FAIL"')) {
      console.error('[PFG Auth] SelfAsserted login failed:', selfAssertedText.substring(0, 500));
      return null;
    }

    // Step 4: GET the confirmed endpoint to get the redirect with auth code
    const confirmedUrl = `https://${PFG_B2C_TENANT}.b2clogin.com${tenantPath}/api/${apiPath}/confirmed?` +
      new URLSearchParams({
        rememberMe: 'false',
        csrf_token: csrf,
        tx: transId,
        p: PFG_B2C_POLICY,
      }).toString();

    console.log('[PFG Auth] Step 4: GET confirmed endpoint');
    const confirmedResponse = await fetch(confirmedUrl, {
      headers: {
        'Cookie': cookies,
      },
      redirect: 'manual',
    });

    const location = confirmedResponse.headers.get('location') || '';
    console.log('[PFG Auth] Confirmed response:', confirmedResponse.status, 'redirect:', location.substring(0, 200));

    // The redirect URL should contain the authorization code in the fragment
    // e.g., https://www.customerfirstsolutions.com#code=XXXXX&state=...
    const codeMatch = location.match(/[#&?]code=([^&]+)/);
    
    if (!codeMatch) {
      const confirmedText = await confirmedResponse.text();
      console.error('[PFG Auth] No auth code in redirect. Location:', location, 'Body:', confirmedText.substring(0, 500));
      return null;
    }

    const authCode = decodeURIComponent(codeMatch[1]);
    console.log('[PFG Auth] Step 4: Got authorization code!');

    // Step 5: Exchange the code for tokens
    const tokenParams = new URLSearchParams({
      client_id: PFG_CLIENT_ID,
      scope: 'openid profile offline_access',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code: authCode,
      code_verifier: pkce.verifier,
    });

    console.log('[PFG Auth] Step 5: Exchanging code for tokens');
    const tokenResponse = await fetch(PFG_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[PFG Auth] Token exchange failed:', tokenResponse.status, errorText);
      return null;
    }

    const tokenData = await tokenResponse.json();
    console.log('[PFG Auth] Headless OAuth flow COMPLETE! Token acquired.');
    console.log('[PFG Auth] Token expires_in:', tokenData.expires_in, 'refresh_token_expires_in:', tokenData.refresh_token_expires_in);
    return tokenData;
  } catch (error) {
    console.error('[PFG Auth] Headless login error:', error);
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

/**
 * Returns a valid access token, using the cached one when possible.
 * Only refreshes when the cached token is within 2 hours of expiry.
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
    if (expiresAt - now > TOKEN_REFRESH_BUFFER_MS) {
      console.log('[PFG Auth] Using cached access token (expires in', Math.round((expiresAt - now) / 60000), 'min)');
      return { accessToken: credentials.access_token, updatedCredentials: credentials };
    }
    console.log('[PFG Auth] Cached token near expiry — refreshing');
  }

  // 2. Try refresh_token
  let tokenData = credentials.refresh_token
    ? await refreshAccessToken(credentials.refresh_token)
    : null;

  // 3. Fallback: re-login with stored password
  if (!tokenData && credentials.username && credentials.password) {
    console.log('[PFG Auth] Refresh failed, attempting auto-re-login…');
    tokenData = await loginWithPassword(credentials.username, credentials.password);
  }

  if (!tokenData) return null;

  // 4. Build updated credentials with cached access_token + expiry
  const expiresAtIso = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const updatedCredentials: PFGCredentials = {
    ...credentials,
    refresh_token: tokenData.refresh_token,
    access_token: tokenData.access_token,
    token_expires_at: expiresAtIso,
  };

  // 5. Persist
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

  if (!credentials.refresh_token && !credentials.password) {
    return new Response(JSON.stringify({ 
      error: 'No refresh token or password stored — please log in to PFG.',
      authenticated: false 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const tokenResult = await getValidAccessToken(supabase, credentials, integrationId);

  if (!tokenResult) {
    return new Response(JSON.stringify({ 
      error: 'Token refresh failed and auto-login failed — please log in to PFG again.',
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
    
    if (!credentials?.refresh_token && !credentials?.password) {
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

async function handleLogin(supabase: any, body: any): Promise<Response> {
  const { locationId, username, password } = body;

  if (!locationId || !username || !password) {
    return new Response(JSON.stringify({ 
      error: 'Missing locationId, username, or password',
      authenticated: false 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const tokenData = await loginWithPassword(username, password);

  if (!tokenData) {
    return new Response(JSON.stringify({ 
      error: 'PFG login failed — check your email and password.',
      authenticated: false 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Save/update the integration with the new refresh token
  const credentials = {
    username,
    password,
    refresh_token: tokenData.refresh_token,
  };

  const { data: existing } = await supabase
    .from('location_integrations')
    .select('id')
    .eq('location_id', locationId)
    .eq('integration_type', 'pfg')
    .maybeSingle();

  if (existing) {
    await supabase
      .from('location_integrations')
      .update({ credentials, is_active: true })
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
    message: 'PFG login successful! Token saved.',
  }), {
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
      case 'login':
        return await handleLogin(supabase, body);
      
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
