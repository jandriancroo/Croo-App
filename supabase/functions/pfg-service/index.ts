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
  'https://apps-zz-cusfst-mw-p-eus01.azurewebsites.net/api',
  'https://www.customerfirstsolutions.com/api/v1',
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
  pfg_username?: string;
  pfg_password?: string;
  refresh_token: string;
  customer_id?: string;
  access_token?: string;
  token_expires_at?: string;
  refresh_token_updated_at?: string;
  ropc_last_success?: string;
  ropc_last_failure?: string;
  ropc_failure_reason?: string;
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

// ROPC (Resource Owner Password Credentials) — re-authenticate using stored username/password
async function ropcAuthenticate(username: string, password: string): Promise<TokenResponse | null> {
  try {
    console.log('[PFG ROPC] Attempting password grant for user:', username);
    const params = new URLSearchParams({
      client_id: PFG_CLIENT_ID,
      scope: PFG_SCOPE,
      grant_type: 'password',
      username,
      password,
      response_type: 'token',
    });

    const response = await fetch(PFG_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error('[PFG ROPC] Failed:', response.status, text.slice(0, 500));
      return null;
    }

    const tokenData = JSON.parse(text);
    console.log('[PFG ROPC] Success! expires_in:', tokenData.expires_in);
    return tokenData;
  } catch (error) {
    console.error('[PFG ROPC] Error:', error);
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

// Set selected customer context (needed for TRACS Direct accounts)
async function setSelectedCustomer(accessToken: string, customerId: string): Promise<boolean> {
  console.log('[PFG API] Setting selected customer:', customerId);
  
  const endpoints = [
    { path: '/Customer/V1/SetSelectedCustomer', body: { CustomerId: customerId } },
    { path: '/Customer/V1/SelectCustomer', body: { CustomerId: customerId } },
    { path: '/Customer/V1/SwitchCustomer', body: { CustomerId: customerId } },
  ];
  
  for (const ep of endpoints) {
    try {
      const data = await fetchPfgJson(ep.path, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(ep.body),
      });
      console.log('[PFG API] SetCustomer response from', ep.path, '→', JSON.stringify(data).slice(0, 500));
      if (data?.IsSuccess !== false) {
        console.log('[PFG API] Successfully set customer context via', ep.path);
        return true;
      }
    } catch (err) {
      console.warn('[PFG API] SetCustomer failed:', ep.path, (err as Error).message?.slice(0, 100));
    }
  }
  return false;
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
      // Guard: API sometimes returns error strings inside arrays
      if (typeof result === 'string') {
        console.warn('[PFG API] Got string response from', ep.path, ':', result.slice(0, 200));
        continue;
      }
      if (Array.isArray(result)) {
        const validGuides = result.filter((g: any) => g && typeof g === 'object' && !Array.isArray(g));
        if (validGuides.length > 0) {
          console.log('[PFG API] Found', validGuides.length, 'product list headers via', ep.path);
          return { guides: validGuides, customerId: resolvedCustomerId };
        }
        if (result.length > 0 && validGuides.length === 0) {
          console.warn('[PFG API] Array from', ep.path, 'contained no valid objects, first item:', JSON.stringify(result[0]).slice(0, 200));
        }
        continue;
      }
      // If ResultObject is an object with nested arrays, try common patterns
      if (result && typeof result === 'object') {
        const keys = Object.keys(result);
        console.log('[PFG API] ResultObject keys:', keys.join(', '));
        for (const key of keys) {
          if (Array.isArray(result[key]) && result[key].length > 0) {
            const validItems = result[key].filter((g: any) => g && typeof g === 'object');
            if (validItems.length > 0) {
              console.log('[PFG API] Found array at key', key, 'with', validItems.length, 'items');
              console.log('[PFG API] First item sample:', JSON.stringify(validItems[0]).slice(0, 300));
              return { guides: validItems, customerId: resolvedCustomerId };
            }
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

// Fetch order history from PFG — queries BOTH endpoints and merges results
async function fetchOrderHistory(accessToken: string, customerId?: string): Promise<any> {
  console.log('[PFG API] Fetching order history (merged strategy)');

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 14);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 7);

  const requestBody: any = {
    StartDate: startDate.toISOString(),
    EndDate: endDate.toISOString(),
  };
  if (customerId) {
    requestBody.CustomerIds = [customerId];
  }

  let submittedOrders: any[] = [];
  let deliveryOrders: any[] = [];

  // 1. Try GetSubmittedOrderHeaders (portal orders)
  try {
    console.log('[PFG API] Trying GetSubmittedOrderHeaders');
    const primaryResult = await fetchPfgJson(
      '/SubmittedOrder/V1/GetSubmittedOrderHeaders',
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

    const primaryArr = primaryResult?.ResultObject;
    if (Array.isArray(primaryArr) && primaryArr.length > 0) {
      submittedOrders = primaryArr;
      console.log(`[PFG API] Got ${submittedOrders.length} orders from GetSubmittedOrderHeaders`);
    }
  } catch (err) {
    console.warn('[PFG API] GetSubmittedOrderHeaders failed:', (err as Error).message?.slice(0, 200));
  }

  // 2. Try GetDeliveries (TRACS Direct / warehouse-confirmed)
  try {
    console.log('[PFG API] Trying GetDeliveries (TRACS Direct endpoint)');
    const deliveryResult = await fetchPfgJson(
      '/Delivery/V1/GetDeliveries',
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

    const deliveries = deliveryResult?.ResultObject;
    if (Array.isArray(deliveries) && deliveries.length > 0) {
      deliveryOrders = deliveries;
      console.log(`[PFG API] Got ${deliveryOrders.length} deliveries from GetDeliveries`);
    }
  } catch (err) {
    console.warn('[PFG API] GetDeliveries failed:', (err as Error).message?.slice(0, 200));
  }

  // 3. Merge: TRACS deliveries take priority (more accurate invoices/amounts),
  //    then append portal orders that don't overlap by delivery date + customer number
  if (deliveryOrders.length > 0 && submittedOrders.length > 0) {
    // Build a set of delivery dates from TRACS to detect overlaps
    const tracsDateSet = new Set<string>();
    for (const d of deliveryOrders) {
      const dt = parsePfgDate(d.DeliveryDate);
      const custNum = String(d.CustomerNumber || '');
      if (dt) tracsDateSet.add(`${custNum}_${dt}`);
    }

    // Only keep submitted orders whose delivery date is NOT already covered by TRACS
    const uniqueSubmitted = submittedOrders.filter(o => {
      const dt = parsePfgDate(o.DeliveryDate);
      const custNum = String(o.DeliverToCustomerNumber || '');
      return dt && !tracsDateSet.has(`${custNum}_${dt}`);
    });

    console.log(`[PFG API] Merged: ${deliveryOrders.length} TRACS + ${uniqueSubmitted.length} portal-only = ${deliveryOrders.length + uniqueSubmitted.length} total`);

    // Return as a combined result with mixed sources
    // Tag each order so the sync handler knows the field mapping
    const taggedDeliveries = deliveryOrders.map(o => ({ ...o, _orderSource: 'GetDeliveries' }));
    const taggedSubmitted = uniqueSubmitted.map(o => ({ ...o, _orderSource: 'GetSubmittedOrderHeaders' }));

    return {
      ResultObject: [...taggedDeliveries, ...taggedSubmitted],
      IsSuccess: true,
      _source: 'merged',
    };
  }

  if (deliveryOrders.length > 0) {
    return { ResultObject: deliveryOrders, IsSuccess: true, _source: 'GetDeliveries' };
  }

  if (submittedOrders.length > 0) {
    return { ResultObject: submittedOrders, IsSuccess: true };
  }

  console.log('[PFG API] All order history endpoints returned empty');
  return { ResultObject: [], IsSuccess: true };
}

// Fetch delivery detail (line items) for a specific order
async function fetchDeliveryDetail(
  accessToken: string,
  order: any,
  customerId: string,
): Promise<any[]> {
  // Build DeliveryKey: {OpCoNumber}_{CustomerNumber}_{DeliveryDate YYYY-MM-DD}_{OrderKey}
  const opCo = order.OrderOperationCompanyNumber || '428';
  const custNum = order.DeliverToCustomerNumber || '';
  const deliveryDateRaw = order.DeliveryDate;
  const orderKey = order.OrderKey || order.OrderNumber;

  if (!custNum || !deliveryDateRaw || !orderKey) {
    console.warn('[PFG API] Cannot build DeliveryKey — missing fields');
    return [];
  }

  const deliveryDateFormatted = parsePfgDate(deliveryDateRaw);
  if (!deliveryDateFormatted) {
    console.warn('[PFG API] Cannot parse delivery date for DeliveryKey:', deliveryDateRaw);
    return [];
  }

  const deliveryKey = `${opCo}_${custNum}_${deliveryDateFormatted}_${orderKey}`;
  console.log('[PFG API] Fetching delivery detail, key:', deliveryKey);

  try {
    const data = await fetchPfgJson(
      '/Delivery/V1/GetDeliveryDetail',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          DeliveryBusinessUnitERPKey: order.OrderBusinessUnitERPKey || 0,
          DeliveryKey: deliveryKey,
          DeliveryOperationCompanyNumber: opCo,
          CustomerId: customerId,
        }),
      },
    );

    const items = data?.ResultObject;
    if (!Array.isArray(items)) {
      console.warn('[PFG API] DeliveryDetail ResultObject is not an array');
      return [];
    }

    console.log(`[PFG API] Got ${items.length} line items for order ${orderKey}`);
    return items;
  } catch (err) {
    console.warn('[PFG API] DeliveryDetail failed for key', deliveryKey, ':', (err as Error).message?.slice(0, 200));
    return [];
  }
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

    // Fetch existing credentials to preserve order guide IDs
    const { data: existing } = await supabase
      .from('location_integrations')
      .select('credentials')
      .eq('location_id', locationId)
      .eq('integration_type', 'pfg')
      .maybeSingle();

    const existingCreds = (existing?.credentials as Record<string, unknown>) || {};

    // Merge: preserve product_list_header_id, customer_id, etc.
    const mergedCredentials = {
      ...existingCreds,
      refresh_token: newRefreshToken,
      refresh_token_updated_at: new Date().toISOString(),
    };

    // Upsert the integration
    const { error: upsertError } = await supabase
      .from('location_integrations')
      .upsert({
        location_id: locationId,
        integration_type: 'pfg',
        credentials: mergedCredentials,
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
  const expiresIn = tokenData.expires_in || 3600; // Default 1 hour if missing
  const credentials: PFGCredentials = {
    refresh_token: tokenData.refresh_token,
    access_token: tokenData.access_token,
    token_expires_at: new Date(now.getTime() + expiresIn * 1000).toISOString(),
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
        // ROPC FALLBACK: try password grant if credentials are stored
        const pfgUser = creds.pfg_username;
        const pfgPass = creds.pfg_password;
        
        if (pfgUser && pfgPass) {
          console.log(`[PFG Keep-Alive] Refresh failed for ${integration.location_id}, attempting ROPC fallback...`);
          const ropcData = await ropcAuthenticate(pfgUser, pfgPass);
          
          if (ropcData) {
            const now = new Date();
            const updatedCreds: PFGCredentials = {
              ...creds,
              refresh_token: ropcData.refresh_token,
              access_token: ropcData.access_token,
              token_expires_at: new Date(now.getTime() + ropcData.expires_in * 1000).toISOString(),
              refresh_token_updated_at: now.toISOString(),
              ropc_last_success: now.toISOString(),
            };
            await supabase
              .from('location_integrations')
              .update({ credentials: updatedCreds })
              .eq('id', integration.id);
            results.push({ locationId: integration.location_id, success: true, error: 'Recovered via ROPC' });
            console.log(`[PFG Keep-Alive] ✓ ROPC recovery successful for ${integration.location_id}`);
            continue;
          } else {
            // ROPC also failed — update failure tracking
            const now = new Date();
            await supabase
              .from('location_integrations')
              .update({ credentials: { ...creds, ropc_last_failure: now.toISOString(), ropc_failure_reason: 'ROPC auth failed after grant expiry' } })
              .eq('id', integration.id);
            results.push({ locationId: integration.location_id, success: false, error: 'Both refresh and ROPC failed — check credentials' });
            console.error(`[PFG Keep-Alive] ✗ ROPC also failed for ${integration.location_id}`);
            continue;
          }
        }
        
        results.push({ locationId: integration.location_id, success: false, error: 'Refresh failed — no ROPC credentials stored' });
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

  if (action === 'customers') {
    const customerData = await fetchCustomerInfo(accessToken);
    return new Response(JSON.stringify({ authenticated: true, data: customerData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'orders') {
    const customerIdToUse = customerId || credentials.customer_id;
    const orders = await fetchOrderHistory(accessToken, customerIdToUse);
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

  if (action === 'search_bid_guide') {
    const bidGuideId = body.bidGuideHeaderId;
    const searchQuery = body.searchQuery || '';
    const customerIdToUse = customerId || credentials.customer_id;
    
    if (!bidGuideId || !customerIdToUse) {
      return new Response(JSON.stringify({ 
        error: 'bidGuideHeaderId and customerId are required',
        authenticated: true
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Search the All Bids guide with a query filter
    const requestBody: any = {
      CustomerId: customerIdToUse,
      ProductListHeaderId: bidGuideId,
      QueryText: searchQuery,
      SortByType: 0,
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
    
    // Flatten all products from all categories for search results
    const allProducts: any[] = [];
    for (const cat of rawCategories) {
      for (const p of (cat.Products || [])) {
        const product = p.Product || {};
        const uomList = product.UnitOfMeasureOrderQuantities || [];
        const uom = uomList[0] || {};
        const price = uom.Price || uom.UnitPrice || uom.ListPrice || product.Price || null;
        const packSize = uom.PackSize || product.ProductPackSizes?.[0];
        
        allProducts.push({
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
          categoryName: cat.CategoryTitle || cat.Name || 'Uncategorized',
        });
      }
    }

    return new Response(JSON.stringify({ 
      authenticated: true,
      data: { products: allProducts, totalFound: allProducts.length }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'list_guides') {
    const customerIdToUse = customerId || credentials.customer_id;
    const result = await fetchProductListHeaders(accessToken, customerIdToUse);
    if (result.guides.length > 0) {
      console.log('[PFG list_guides] First guide keys:', JSON.stringify(Object.keys(result.guides[0])));
      console.log('[PFG list_guides] First guide sample:', JSON.stringify(result.guides[0]).slice(0, 500));
    } else {
      console.log('[PFG list_guides] No guides returned');
    }
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

      const customerIdToUse = credentials.customer_id;
      const orderData = await fetchOrderHistory(accessToken, customerIdToUse);
      
      console.log('[PFG Sync] Raw response keys:', JSON.stringify(Object.keys(orderData || {})));
      console.log('[PFG Sync] IsSuccess:', orderData?.IsSuccess);
      console.log('[PFG Sync] ErrorMessages:', JSON.stringify(orderData?.ErrorMessages));
      console.log('[PFG Sync] ResultObject type:', typeof orderData?.ResultObject, Array.isArray(orderData?.ResultObject) ? 'array' : '', 'length:', Array.isArray(orderData?.ResultObject) ? orderData.ResultObject.length : 'n/a');
      if (orderData?.ResultObject && !Array.isArray(orderData.ResultObject)) {
        console.log('[PFG Sync] ResultObject keys:', JSON.stringify(Object.keys(orderData.ResultObject)).slice(0, 500));
      }
      console.log('[PFG Sync] CustomerId used:', customerIdToUse);
      
      // Response can be: 
      // 1. { ResultObject: [...orders...], IsSuccess: true } — array of orders
      // 2. { ResultObject: { OrderKey: "...", ... }, IsSuccess: true } — single order
      // 3. { ResultObject: { SubmittedOrderHeaders: [...] }, IsSuccess: true } — nested array
      let rawOrders: any[];
      const resultObj = orderData?.ResultObject;
      if (Array.isArray(resultObj)) {
        rawOrders = resultObj;
      } else if (resultObj && typeof resultObj === 'object' && resultObj.OrderKey) {
        // Single order wrapped in ResultObject
        rawOrders = [resultObj];
      } else if (resultObj && typeof resultObj === 'object') {
        // Try nested patterns
        rawOrders = resultObj.SubmittedOrderHeaders || resultObj.Orders || resultObj.Items || [];
        // If still empty but has order-like fields, treat as single order
        if (rawOrders.length === 0 && (resultObj.OrderNumber || resultObj.DeliveryDate)) {
          rawOrders = [resultObj];
        }
      } else {
        rawOrders = [];
      }
      
      console.log(`[PFG Sync] Found ${rawOrders.length} total orders for location ${integration.location_id}`);
      if (rawOrders.length > 0) {
        console.log('[PFG Sync] Sample order keys:', JSON.stringify(Object.keys(rawOrders[0])).slice(0, 500));
      }

      // Detect if data came from GetDeliveries (TRACS Direct) vs GetSubmittedOrderHeaders
      // When _source is 'merged', each order has its own _orderSource tag
      const globalSource = orderData?._source;
      const isGlobalDeliveries = globalSource === 'GetDeliveries';
      console.log(`[PFG Sync] Data source: ${globalSource || 'GetSubmittedOrderHeaders'}`);

      // Filter orders by delivery customer number if configured
      const deliverToFilter = (credentials as any).deliver_to_customer_number;
      if (deliverToFilter) {
        const beforeCount = rawOrders.length;
        rawOrders = rawOrders.filter((o: any) => {
          // GetDeliveries uses CustomerNumber, GetSubmittedOrderHeaders uses DeliverToCustomerNumber
          const orderCustNum = String(o.CustomerNumber || o.DeliverToCustomerNumber || '');
          return orderCustNum === String(deliverToFilter);
        });
        console.log(`[PFG Sync] Filtered by delivery number ${deliverToFilter}: ${beforeCount} → ${rawOrders.length} orders`);
      } else {
        console.log('[PFG Sync] No deliver_to_customer_number filter set — importing all orders');
      }

      let importedCount = 0;

      // Parse order metadata for all orders first
      const parsedOrders = rawOrders.map(order => {
        const isDeliveryOrder = order._orderSource === 'GetDeliveries' || (isGlobalDeliveries && !order._orderSource);
        let pfgOrderId: string;
        let orderDate: string | null;
        let deliveryDate: string | null;
        let orderNumber: string;
        let totalAmount: number | null;

        if (isDeliveryOrder) {
          pfgOrderId = order.DeliveryKey || order.Invoices?.[0]?.InvoiceNumber || '';
          deliveryDate = parsePfgDate(order.DeliveryDate);
          orderDate = parsePfgDate(order.ShippedDate) || deliveryDate;
          orderNumber = order.Invoices?.[0]?.InvoiceNumber || order.DeliveryKey || '';
          totalAmount = order.TotalDollars ?? null;
        } else {
          pfgOrderId = order.OrderKey || order.OrderNumber || order.OrderId || order.SubmittedOrderId || '';
          deliveryDate = parsePfgDate(order.DeliveryDate);
          orderDate = deliveryDate || parsePfgDate(order.OrderDate || order.SubmittedDate || order.CreatedDate);
          orderNumber = order.OrderNumber || order.PurchaseOrderNumber || String(pfgOrderId);
          totalAmount = order.OrderTotalSales || order.TotalAmount || order.OrderTotal || order.Total || null;
        }

        const customerIdForDetail = customerIdToUse || order.CustomerId;
        const orderForDetail = isDeliveryOrder ? {
          OrderOperationCompanyNumber: order.DeliveryOperationCompanyNumber,
          DeliverToCustomerNumber: order.CustomerNumber,
          DeliveryDate: order.DeliveryDate,
          OrderKey: order.Invoices?.[0]?.InvoiceHeaderKey || order.Invoices?.[0]?.InvoiceNumber,
          OrderBusinessUnitERPKey: order.DeliveryBusinessUnitERPKey || 0,
        } : order;

        return { order, pfgOrderId, orderDate, deliveryDate, orderNumber, totalAmount, customerIdForDetail, orderForDetail, isDeliveryOrder };
      }).filter(p => p.pfgOrderId && p.orderDate);

      // Fetch delivery details in parallel batches of 5
      const BATCH_SIZE = 5;
      const orderDetails: (any[] | null)[] = new Array(parsedOrders.length).fill(null);

      for (let i = 0; i < parsedOrders.length; i += BATCH_SIZE) {
        const batch = parsedOrders.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(p => {
            if (!p.customerIdForDetail) return Promise.resolve([]);
            return fetchDeliveryDetail(accessToken, p.orderForDetail, p.customerIdForDetail);
          })
        );
        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          orderDetails[i + j] = r.status === 'fulfilled' ? r.value : [];
          if (r.status === 'rejected') {
            console.warn(`[PFG Sync] Detail fetch failed for order ${batch[j].pfgOrderId}:`, r.reason);
          }
        }
      }

      // Build bulk upsert payloads
      const upsertBatch: any[] = [];
      for (let i = 0; i < parsedOrders.length; i++) {
        const p = parsedOrders[i];
        const detailItems = orderDetails[i] || [];
        const items = detailItems.map((item: any) => {
          const uom = item.DeliveryDetailUnitOfMeasures?.[0] || {};
          return {
            productId: item.ProductKey || item.DeliveryDetailProductKey,
            itemNumber: uom.ProductNumber || item.ProductKey,
            name: item.ProductDescription || 'Unknown',
            brand: item.ProductBrand || null,
            quantity: uom.QuantityOrdered || 0,
            quantityShipped: uom.QuantityShipped || 0,
            unit: 'CS',
            packSize: uom.ProductPackSize || null,
            price: uom.UnitPrice || 0,
            total: item.ExtendedPrice || 0,
            isCatchWeight: uom.IsCatchWeight || false,
            isShorted: item.IsProductShorted || false,
          };
        });
        if (items.length > 0) {
          console.log(`[PFG Sync] Order ${p.pfgOrderId}: ${items.length} line items fetched`);
        }

        upsertBatch.push({
          location_id: integration.location_id,
          pfg_order_id: String(p.pfgOrderId),
          order_number: p.orderNumber,
          order_date: p.orderDate,
          delivery_date: p.deliveryDate,
          status: String(p.order.DeliveryStatus ?? p.order.OrderStatus ?? p.order.Status ?? ''),
          total_amount: p.totalAmount,
          items: items.length > 0 ? items : null,
          raw_data: p.order,
          updated_at: new Date().toISOString(),
        });
      }

      // Bulk upsert in chunks of 50
      for (let i = 0; i < upsertBatch.length; i += 50) {
        const chunk = upsertBatch.slice(i, i + 50);
        const { error: upsertError } = await supabase
          .from('pfg_orders')
          .upsert(chunk, { onConflict: 'location_id,pfg_order_id' });
        if (upsertError) {
          console.warn(`[PFG Sync] Bulk upsert error:`, upsertError.message);
        } else {
          importedCount += chunk.length;
        }
      }

      // --- Post-sync cleanup: remove portal duplicates when TRACS data exists ---
      // Portal orders have short numeric IDs, TRACS orders have composite IDs like "428_55067468_..."
      const { data: allOrders } = await supabase
        .from('pfg_orders')
        .select('id, pfg_order_id, delivery_date')
        .eq('location_id', integration.location_id);

      if (allOrders && allOrders.length > 0) {
        // Group by delivery_date, find dates that have both TRACS and portal orders
        const byDate = new Map<string, { tracs: string[]; portal: string[] }>();
        for (const o of allOrders) {
          const dt = o.delivery_date || '';
          if (!byDate.has(dt)) byDate.set(dt, { tracs: [], portal: [] });
          const group = byDate.get(dt)!;
          // TRACS IDs contain underscores (composite key), portal IDs are simple numbers
          if (String(o.pfg_order_id).includes('_')) {
            group.tracs.push(o.id);
          } else {
            group.portal.push(o.id);
          }
        }

        const idsToDelete: string[] = [];
        for (const [, group] of byDate) {
          if (group.tracs.length > 0 && group.portal.length > 0) {
            idsToDelete.push(...group.portal);
          }
        }

        if (idsToDelete.length > 0) {
          console.log(`[PFG Sync] Cleaning up ${idsToDelete.length} portal duplicates superseded by TRACS data`);
          await supabase.from('pfg_orders').delete().in('id', idsToDelete);
        }
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
// DELIVERY LOCATION DISCOVERY & ASSIGNMENT
// ============================================================================

async function handleListDeliveryLocations(supabase: any, body: any): Promise<Response> {
  const locationId = body?.locationId;
  if (!locationId) {
    return new Response(JSON.stringify({ error: 'locationId required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: integration, error } = await supabase
    .from('location_integrations')
    .select('id, credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'pfg')
    .eq('is_active', true)
    .single();

  if (error || !integration) {
    return new Response(JSON.stringify({ error: 'No active PFG integration found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const credentials = integration.credentials as unknown as PFGCredentials;
  const tokenResult = await getValidAccessToken(supabase, credentials, integration.id);
  if (!tokenResult) {
    return new Response(JSON.stringify({ error: 'Auth failed — re-login needed' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { accessToken } = tokenResult;
  const orderData = await fetchOrderHistory(accessToken, credentials.customer_id);
  
  let rawOrders: any[];
  const resultObj = orderData?.ResultObject;
  if (Array.isArray(resultObj)) {
    rawOrders = resultObj;
  } else if (resultObj && typeof resultObj === 'object') {
    rawOrders = resultObj.SubmittedOrderHeaders || resultObj.Orders || resultObj.Items || [];
    if (rawOrders.length === 0 && (resultObj.OrderNumber || resultObj.DeliveryDate)) {
      rawOrders = [resultObj];
    }
  } else {
    rawOrders = [];
  }

  // Extract unique delivery locations (handle both GetSubmittedOrderHeaders and GetDeliveries field names)
  const deliveryLocations = new Map<string, { number: string; name: string; orderCount: number }>();
  for (const order of rawOrders) {
    const num = order.DeliverToCustomerNumber || order.CustomerNumber;
    const name = order.DeliverToCustomerName || order.CustomerName || 'Unknown';
    if (num) {
      const existing = deliveryLocations.get(String(num));
      if (existing) {
        existing.orderCount++;
      } else {
        deliveryLocations.set(String(num), { number: String(num), name: name.trim(), orderCount: 1 });
      }
    }
  }

  const currentDeliverTo = (credentials as any).deliver_to_customer_number || null;

  return new Response(JSON.stringify({
    success: true,
    deliveryLocations: Array.from(deliveryLocations.values()),
    currentDeliverTo,
    totalOrders: rawOrders.length,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleSetDeliveryLocation(supabase: any, body: any): Promise<Response> {
  const { locationId, deliverToCustomerNumber } = body || {};
  if (!locationId || !deliverToCustomerNumber) {
    return new Response(JSON.stringify({ error: 'locationId and deliverToCustomerNumber required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: integration, error } = await supabase
    .from('location_integrations')
    .select('id, credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'pfg')
    .eq('is_active', true)
    .single();

  if (error || !integration) {
    return new Response(JSON.stringify({ error: 'No active PFG integration found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const updatedCredentials = {
    ...integration.credentials,
    deliver_to_customer_number: deliverToCustomerNumber,
  };

  const { error: updateError } = await supabase
    .from('location_integrations')
    .update({ credentials: updatedCredentials })
    .eq('id', integration.id);

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, deliverToCustomerNumber }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleCustomerInfo(supabase: any, body: any): Promise<Response> {
  const locationId = body?.locationId;
  if (!locationId) {
    return new Response(JSON.stringify({ error: 'locationId required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: integration, error } = await supabase
    .from('location_integrations')
    .select('id, credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'pfg')
    .eq('is_active', true)
    .single();

  if (error || !integration) {
    return new Response(JSON.stringify({ error: 'No active PFG integration found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const credentials = integration.credentials as unknown as PFGCredentials;
  const tokenResult = await getValidAccessToken(supabase, credentials, integration.id);
  if (!tokenResult) {
    return new Response(JSON.stringify({ error: 'Auth failed' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const customerInfo = await fetchCustomerInfo(tokenResult.accessToken);
  const productListHeaders = await fetchProductListHeaders(tokenResult.accessToken, credentials.customer_id);

  return new Response(JSON.stringify({
    success: true,
    customerInfo,
    productListHeaders: productListHeaders.guides?.map((g: any) => ({
      id: g.ProductListHeaderId || g.Id,
      name: g.ProductListName || g.Name || g.Title,
      customerId: g.CustomerId,
      customerName: g.CustomerName,
      customerNumber: g.CustomerNumber,
    })),
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
      case 'test_ropc': {
        // Test ROPC with real credentials for a specific location
        const { locationId: testLocId } = body;
        if (!testLocId) {
          return new Response(JSON.stringify({ error: 'Missing locationId' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const { data: testInt } = await supabase
          .from('location_integrations')
          .select('id, credentials')
          .eq('location_id', testLocId)
          .eq('integration_type', 'pfg')
          .eq('is_active', true)
          .maybeSingle();
        if (!testInt) {
          return new Response(JSON.stringify({ error: 'No PFG integration found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const testCreds = testInt.credentials as any;
        if (!testCreds?.pfg_username || !testCreds?.pfg_password) {
          return new Response(JSON.stringify({ error: 'No PFG credentials stored — save username/password first', ropc_supported: false }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.log('[PFG ROPC Test] Testing real credentials for location:', testLocId);
        const ropcResult = await ropcAuthenticate(testCreds.pfg_username, testCreds.pfg_password);
        if (ropcResult) {
          // Save the new tokens
          const now = new Date();
          const updatedCreds = {
            ...testCreds,
            refresh_token: ropcResult.refresh_token,
            access_token: ropcResult.access_token,
            token_expires_at: new Date(now.getTime() + ropcResult.expires_in * 1000).toISOString(),
            refresh_token_updated_at: now.toISOString(),
            ropc_last_success: now.toISOString(),
          };
          await supabase
            .from('location_integrations')
            .update({ credentials: updatedCreds })
            .eq('id', testInt.id);
          return new Response(JSON.stringify({ 
            success: true, 
            ropc_supported: true,
            message: 'ROPC authentication successful! Tokens refreshed.',
            expires_in: ropcResult.expires_in,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else {
          return new Response(JSON.stringify({ 
            success: false, 
            ropc_supported: false,
            message: 'ROPC failed — credentials may be wrong or ROPC not supported for this account.',
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      case 'save_pfg_credentials': {
        const { locationId: credLocId, pfg_username, pfg_password } = body;
        if (!credLocId || !pfg_username || !pfg_password) {
          return new Response(JSON.stringify({ error: 'Missing locationId, pfg_username, or pfg_password' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const { data: credInt } = await supabase
          .from('location_integrations')
          .select('id, credentials')
          .eq('location_id', credLocId)
          .eq('integration_type', 'pfg')
          .maybeSingle();
        if (!credInt) {
          return new Response(JSON.stringify({ error: 'No PFG integration found — connect PFG first' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const existingCreds = (credInt.credentials as any) || {};
        const merged = { ...existingCreds, pfg_username, pfg_password };
        await supabase
          .from('location_integrations')
          .update({ credentials: merged })
          .eq('id', credInt.id);
        console.log('[PFG] Saved ROPC credentials for location:', credLocId);
        return new Response(JSON.stringify({ success: true, message: 'PFG credentials saved' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save_token':
        return await handleSaveToken(supabase, body);

      case 'oauth_start':
        return await handleOAuthStart();
      
      case 'oauth_exchange':
        return await handleOAuthExchange(supabase, body);
      
      case 'refresh_keep_alive':
        return await handleRefreshKeepAlive(supabase, body);
      
      case 'list_active_integrations': {
        // Used by GitHub Actions headless login to get all PFG-connected locations
        const { data: activeInts, error: listErr } = await supabase
          .from('location_integrations')
          .select('location_id, credentials')
          .eq('integration_type', 'pfg')
          .eq('is_active', true);
        
        if (listErr) {
          return new Response(JSON.stringify({ error: listErr.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        const locations = (activeInts || [])
          .filter((i: any) => i.credentials?.pfg_username && i.credentials?.pfg_password)
          .map((i: any) => ({
            locationId: i.location_id,
            username: i.credentials.pfg_username,
            password: i.credentials.pfg_password,
          }));
        
        return new Response(JSON.stringify({ locations }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      case 'headless_login_failed': {
        // GitHub Actions headless login failed — create support ticket
        const failLocationId = body?.locationId;
        const failError = body?.error || 'Unknown headless login failure';
        console.error('[PFG Headless] Login failed for location:', failLocationId, failError);
        
        if (failLocationId) {
          await supabase.from('support_tickets').insert({
            title: 'PFG Headless Login Failed',
            description: `The automated PFG token refresh via GitHub Actions failed.\n\nLocation: ${failLocationId}\nError: ${failError}\n\nA manager may need to manually reconnect PFG in Settings → Integrations.`,
            status: 'open',
            priority: 'high',
            source: 'system',
          });
        }
        
        return new Response(JSON.stringify({ success: true, message: 'Failure logged' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      case 'sync_orders':
        return await handleSyncOrders(supabase, body);
      
      case 'list_delivery_locations':
        return await handleListDeliveryLocations(supabase, body);
      
      case 'set_delivery_location':
        return await handleSetDeliveryLocation(supabase, body);
      
      case 'customer_info':
        return await handleCustomerInfo(supabase, body);
      
      case 'list_guides':
      case 'fetch':
      default:
        return await handleFetchAction(supabase, { ...body, action: action || body?.action || 'fetch' });
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
