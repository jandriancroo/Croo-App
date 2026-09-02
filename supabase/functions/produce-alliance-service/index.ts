// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { isInventoryEnabled, filterEnabledLocations, inventoryDisabledResponse } from "../_shared/inventoryGate.ts";
import { requireAuthorizedCaller } from '../_shared/callerAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ============================================================================
// PRODUCE ALLIANCE SERVICE — Buyers Edge Platform
// Portal: https://producealliance.info
// Auth: OAuth2 Bearer token via POST /oauth/token (grant_type=password)
// API: REST endpoints at /api/... with Authorization: Bearer <token>
// Order list: POST /api/restaurant-dashboard/fetch-orders-for-restaurant-by-params
// ============================================================================

const PA_BASE_URL = 'https://www.producealliance.info';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Safari/605.1.15';

interface PACredentials {
  username: string;
  password: string;
  restaurant_id: string;
  // Legacy field — mapped to restaurant_id
  pa_location_id?: string;
}

interface PASession {
  accessToken: string;
  refreshToken: string;
  cookies: string;
  restaurantId: string;
}

// ============================================================================
// COOKIE HELPERS
// ============================================================================

function extractCookies(headers: Headers): string {
  const cookies: string[] = [];
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      cookies.push(value.split(';')[0].trim());
    }
  }
  if (cookies.length === 0) {
    const single = headers.get('set-cookie');
    if (single) return single.split(',').map(c => c.split(';')[0].trim()).join('; ');
    return '';
  }
  return cookies.join('; ');
}

function mergeCookies(existing: string, newCookies: string): string {
  if (!newCookies) return existing;
  if (!existing) return newCookies;
  const map = new Map<string, string>();
  for (const part of existing.split('; ')) {
    const [name] = part.split('=');
    if (name) map.set(name.trim(), part.trim());
  }
  for (const part of newCookies.split('; ')) {
    const [name] = part.split('=');
    if (name) map.set(name.trim(), part.trim());
  }
  return Array.from(map.values()).join('; ');
}

// ============================================================================
// AUTHENTICATION — OAuth2 Bearer Token
// ============================================================================

async function loginToPA(credentials: PACredentials): Promise<PASession | null> {
  const restaurantId = credentials.restaurant_id || credentials.pa_location_id || '';
  console.log('[PA Auth] Logging in as:', credentials.username, 'restaurantId:', restaurantId);

  try {
    // Step 1: GET the landing page to collect initial cookies (AWSALB, JSESSIONID)
    const homeResp = await fetch(PA_BASE_URL, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA },
    });
    await homeResp.text().catch(() => '');
    let allCookies = extractCookies(homeResp.headers);
    console.log('[PA Auth] Home page status:', homeResp.status, 'cookies:', allCookies ? 'yes' : 'none');

    // Step 2: OAuth2 token — Spring Security with client credentials
    // Source: Angular app bundle (FC_ui chunk 8792)
    // Client ID: fc-client-2.0, Client Secret: fc-client-secret
    // Authorization: Basic base64(fc-client-2.0:fc-client-secret)
    const PA_CLIENT_ID = 'fc-client-2.0';
    const PA_CLIENT_SECRET = 'fc-client-secret';
    const basicAuth = btoa(`${PA_CLIENT_ID}:${PA_CLIENT_SECRET}`);
    
    // Generate a device_id like the Angular app does
    const deviceId = crypto.randomUUID();
    
    // The Angular app's apiUrl is the base — token endpoint is at /api/oauth/token
    // Evidence: /oauth/token returns 302 redirect, /api/oauth/token returns 401 (actual API)
    const tokenUrl = `${PA_BASE_URL}/api/oauth/token`;
    const formBody = `username=${encodeURIComponent(credentials.username)}&password=${encodeURIComponent(credentials.password)}&grant_type=password&device_id=${deviceId}&client_id=${PA_CLIENT_ID}`;
    
    console.log('[PA Auth] POST', tokenUrl, 'with Basic auth + form body');
    
    try {
      const resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Authorization': `Basic ${basicAuth}`,
          'Cookie': allCookies,
          'User-Agent': UA,
          'Accept': 'application/json, */*',
          'Referer': `${PA_BASE_URL}/ng/`,
        },
        body: formBody,
        redirect: 'manual',
      });

      const newCookies = extractCookies(resp.headers);
      if (newCookies) allCookies = mergeCookies(allCookies, newCookies);
      
      const text = await resp.text();
      console.log('[PA Auth] OAuth2 response:', resp.status, 'len:', text.length);

      if (resp.status === 200 && text.length > 10) {
        try {
          const json = JSON.parse(text);
          if (json.access_token) {
            console.log('[PA Auth] ✅ OAuth2 login successful! Token type:', json.token_type || 'bearer', 'expires_in:', json.expires_in);
            
            // Hit session endpoint to get XSRF-TOKEN cookie (needed for POST requests)
            let sessionCookies = allCookies;
            try {
              const sessionResp = await fetch(`${PA_BASE_URL}/api/common/session`, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${json.access_token}`,
                  'Cookie': allCookies,
                  'User-Agent': UA,
                  'Accept': 'application/json',
                  'Referer': `${PA_BASE_URL}/ng/`,
                  'Origin': PA_BASE_URL,
                },
              });
              const sessionNewCookies = extractCookies(sessionResp.headers);
              if (sessionNewCookies) {
                sessionCookies = mergeCookies(allCookies, sessionNewCookies);
                console.log('[PA Auth] Session cookies updated, XSRF:', sessionCookies.includes('XSRF-TOKEN') ? 'present' : 'absent');
              }
              await sessionResp.text().catch(() => '');
            } catch (e) {
              console.warn('[PA Auth] Session probe failed:', e);
            }
            
            // Add tokenStore cookie — the JSP pages read this cookie to authenticate
            // (mirrors what the Angular app sets in the browser)
            const tokenStoreValue = encodeURIComponent(JSON.stringify({
              access_token: json.access_token,
              refresh_token: json.refresh_token || '',
              expires_by: String(Date.now() + (json.expires_in || 1800) * 1000),
            }));
            sessionCookies = mergeCookies(sessionCookies, `tokenStore=${tokenStoreValue}`);
            console.log('[PA Auth] Added tokenStore cookie for JSP auth');

            // Hit /ProduceAlliance.jsp to establish PA designation in server session.
            // The JSP pages now return a localStorage redirect script unless the
            // server-side session knows we're a PA user (set by visiting this page).
            try {
              const paDesigResp = await fetch(`${PA_BASE_URL}/ProduceAlliance.jsp`, {
                method: 'GET',
                headers: {
                  'Cookie': sessionCookies,
                  'User-Agent': UA,
                  'Accept': 'text/html,application/xhtml+xml,*/*',
                  'Referer': `${PA_BASE_URL}/ng/`,
                  'Authorization': `Bearer ${json.access_token}`,
                },
                redirect: 'follow',
              });
              const desigCookies = extractCookies(paDesigResp.headers);
              if (desigCookies) sessionCookies = mergeCookies(sessionCookies, desigCookies);
              await paDesigResp.text().catch(() => '');
              console.log('[PA Auth] PA designation page:', paDesigResp.status);
            } catch (e) {
              console.warn('[PA Auth] PA designation warmup failed:', e);
            }
            
            return {
              accessToken: json.access_token,
              refreshToken: json.refresh_token || '',
              cookies: sessionCookies,
              restaurantId,
            };
          }
        } catch { /* not JSON */ }
      }
      
      // Log failure details for debugging
      if (resp.status !== 200) {
        console.error('[PA Auth] OAuth2 failed:', resp.status, text.substring(0, 500));
      }
    } catch (e) {
      console.error('[PA Auth] OAuth2 error:', e);
    }

    // Step 3: Fallback — try J2EE form login (legacy approach)
    console.log('[PA Auth] OAuth2 attempts failed, trying form login fallback...');
    const formLoginAttempts = [
      {
        url: `${PA_BASE_URL}/j_security_check`,
        body: `j_username=${encodeURIComponent(credentials.username)}&j_password=${encodeURIComponent(credentials.password)}`,
      },
      {
        url: `${PA_BASE_URL}/login`,
        body: `username=${encodeURIComponent(credentials.username)}&password=${encodeURIComponent(credentials.password)}`,
      },
    ];

    for (const attempt of formLoginAttempts) {
      try {
        console.log('[PA Auth] Trying form login:', attempt.url);
        const loginResp = await fetch(attempt.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': allCookies,
            'User-Agent': UA,
            'Referer': PA_BASE_URL,
          },
          body: attempt.body,
          redirect: 'manual',
        });

        const newCookies = extractCookies(loginResp.headers);
        const mergedCookies = mergeCookies(allCookies, newCookies);
        const status = loginResp.status;
        const location = loginResp.headers.get('location') || '';
        await loginResp.text().catch(() => '');
        
        console.log('[PA Auth]', attempt.url, '→', status, 'redirect:', location || 'none');

        if ((status === 302 || status === 301) && !location.includes('login') && !location.includes('error') && !location.includes('logout')) {
          console.log('[PA Auth] Form login successful, following redirect...');
          
          const redirectUrl = location.startsWith('http') ? location : `${PA_BASE_URL}${location}`;
          const redirectResp = await fetch(redirectUrl, {
            method: 'GET',
            headers: { 'Cookie': mergedCookies, 'User-Agent': UA },
            redirect: 'manual',
          });
          const finalCookies = mergeCookies(mergedCookies, extractCookies(redirectResp.headers));
          await redirectResp.text().catch(() => '');
          
          // Extract tokenStore from cookies if available
          const tokenMatch = finalCookies.match(/tokenStore=([^;]+)/);
          if (tokenMatch) {
            try {
              const tokenStore = JSON.parse(decodeURIComponent(tokenMatch[1]));
              if (tokenStore.access_token) {
                console.log('[PA Auth] ✅ Extracted Bearer token from cookie');
                return {
                  accessToken: tokenStore.access_token,
                  refreshToken: tokenStore.refresh_token || '',
                  cookies: finalCookies,
                  restaurantId,
                };
              }
            } catch { /* parse error */ }
          }

          // Fall back to cookie-only session
          return { accessToken: '', refreshToken: '', cookies: finalCookies, restaurantId };
        }

        if (newCookies) allCookies = mergedCookies;
      } catch (e) {
        console.warn('[PA Auth] Error with', attempt.url, ':', e);
      }
    }

    console.error('[PA Auth] All login attempts failed');
    return null;
  } catch (error) {
    console.error('[PA Auth] Login error:', error);
    return null;
  }
}

// Build auth headers for API requests (matching Angular HttpClient behavior)
function getAuthHeaders(session: PASession, _isPost = false): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Referer': `${PA_BASE_URL}/ng/`,
    'Origin': PA_BASE_URL,
    'X-Requested-With': 'XMLHttpRequest',
  };
  
  if (session.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }
  if (session.cookies) {
    headers['Cookie'] = session.cookies;
    // Extract XSRF-TOKEN from cookies (Spring Security CSRF protection)
    const xsrfMatch = session.cookies.match(/XSRF-TOKEN=([^;]+)/);
    if (xsrfMatch) {
      headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrfMatch[1]);
    }
  }
  
  return headers;
}

// Verify session by hitting the session endpoint
async function verifySession(session: PASession): Promise<boolean> {
  try {
    const resp = await fetch(`${PA_BASE_URL}/api/common/session`, {
      method: 'GET',
      headers: getAuthHeaders(session),
      redirect: 'manual',
    });
    const text = await resp.text();
    console.log('[PA Verify] Session check:', resp.status, 'len:', text.length);
    
    if (resp.status === 200) {
      try {
        const json = JSON.parse(text);
        console.log('[PA Verify] Session valid, user:', json.username || json.userName || 'unknown');
        return true;
      } catch {
        return !text.includes('Sign in') && !text.includes('login');
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// ORDER LIST — Fetch orders from Angular API or scrape
// ============================================================================

interface PAOrderSummary {
  webOrderId: string;
  orderDate: string;
  deliveryDate: string | null;
  status: string;
  totalAmount: number | null;
  totalCases: number | null;
}

async function fetchOrderList(session: PASession, startDate: string, endDate: string): Promise<PAOrderSummary[]> {
  console.log('[PA Orders] Fetching order list, restaurant:', session.restaurantId, 'range:', startDate, '→', endDate);

  const authHeaders = getAuthHeaders(session);

  // From browser DevTools capture: dates go in query params (non-zero-padded),
  // POST body is pagination/filter only, X-UI-URL carries restaurant context
  const toNonPadded = (d: string) => {
    const [y, m, dd] = d.split('-');
    return `${y}-${parseInt(m)}-${parseInt(dd)}`;
  };
  const qStart = toNonPadded(startDate);
  const qEnd = toNonPadded(endDate);

  const orderUrl = `${PA_BASE_URL}/api/restaurant-dashboard/fetch-orders-for-restaurant-by-params?startDate=${qStart}&endDate=${qEnd}&restaurantId=${session.restaurantId}&includeOnlySubmit=false`;
  
  const postBody = JSON.stringify({
    limit: 100,
    offset: 0,
    filters: {},
    restaurantId: parseInt(session.restaurantId) || session.restaurantId,
    orderByFields: { DISTRIBUTOR_NAME: "ASC", RESTAURANT_ID: "DESC" },
  });

  const headers: Record<string, string> = {
    ...authHeaders,
    'Content-Type': 'application/json',
    'X-UI-URL': `${PA_BASE_URL}/ng/#/restaurantBackOffice/viewOrders?restaurantId=${session.restaurantId}&startDate=${qStart}&endDate=${qEnd}`,
  };

  console.log('[PA Orders] POST', orderUrl, 'body:', postBody);

  try {
    const resp = await fetch(orderUrl, {
      method: 'POST',
      headers,
      body: postBody,
      redirect: 'follow',
    });

    const text = await resp.text();
    console.log('[PA Orders] Response:', resp.status, 'len:', text.length);

    if (!resp.ok) {
      try {
        const errJson = JSON.parse(text);
        console.error('[PA Orders] Error:', resp.status, errJson.message || errJson.error || text.substring(0, 500));
      } catch {
        console.error('[PA Orders] Error body:', text.substring(0, 500));
      }
    } else if (text.length > 2) {
      try {
        const data = JSON.parse(text);
        console.log('[PA Orders] JSON keys:', Array.isArray(data) ? `array[${data.length}]` : Object.keys(data).join(', '));
        
        const orders = extractOrdersFromJson(data);
        if (orders.length > 0) {
          console.log('[PA Orders] ✅ Found', orders.length, 'orders');
          return orders;
        }
        
        if (Array.isArray(data) || data.data || data.orders || data.content) {
          console.log('[PA Orders] Valid response but 0 orders in range');
          return [];
        }
      } catch {
        console.log('[PA Orders] Response not JSON:', text.substring(0, 200));
      }
    }
  } catch (e) {
    console.error('[PA Orders] Fetch error:', e);
  }

  // Fallback: legacy JSP scraping (cookie-based)
  if (session.cookies) {
    const legacyUrls = [
      `${PA_BASE_URL}/viewOrders.jsp?restaurantId=${session.restaurantId}&startDate=${startDate}&endDate=${endDate}`,
      `${PA_BASE_URL}/viewOrder.jsp?restaurantId=${session.restaurantId}&startDate=${startDate}&endDate=${endDate}`,
    ];

    for (const url of legacyUrls) {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: authHeaders,
          redirect: 'follow',
        });

        const text = await resp.text();
        console.log('[PA Orders] Legacy', url.replace(PA_BASE_URL, ''), '→', resp.status, 'len:', text.length);

        if (!resp.ok || text.length < 100) continue;
        if (text.includes('Sign in') || text.includes('j_security_check')) continue;

        const orders = extractOrdersFromHtml(text);
        if (orders.length > 0) {
          console.log('[PA Orders] Found', orders.length, 'orders from HTML');
          return orders;
        }
      } catch (e) {
        console.warn('[PA Orders] Legacy error:', e);
      }
    }
  }

  console.log('[PA Orders] No orders found');
  return [];
}

// ============================================================================
// INVOICES — fetch list + per-invoice details from PA portal
// (covers off-portal orders e.g. Worldwide Produce phone/app orders)
// ============================================================================

interface PAInvoiceSummary {
  invoiceNumber: string;
  invoiceMasterId: string;
  invoiceDate: string;        // MM/DD/YYYY from API
  uploadDate: string;         // MM/DD/YYYY from API
  invoiceTotal: number;
  distributorName: string;
  distributorId: string;      // vendorNumber
  clientId: string;
  totalQuantity: number;
  webOrderId: string | null;
}

interface PAInvoiceLineItem {
  pa_product_id: number | null;
  item_code: string;
  description: string;
  master_product_code: string | null;
  master_product_desc: string | null;
  quantity: number;
  unit_cost: number;
  extended_cost: number;
  vendor_name: string;
}

interface PAInvoiceDetail {
  invoiceNumber: string;
  invoiceDate: string;        // yyyy-MM-dd
  uploadDate: string;         // yyyy-MM-dd
  vendorName: string;
  totalAmount: number;
  lineItems: PAInvoiceLineItem[];
}

async function fetchInvoiceList(session: PASession, startDate: string, endDate: string): Promise<PAInvoiceSummary[]> {
  const url = `${PA_BASE_URL}/api/restaurant-dashboard/fetch-invoices-for-restaurant-by-params?startDate=${startDate}&endDate=${endDate}&filterStr=all`;
  const postBody = JSON.stringify({
    limit: 100,
    offset: 0,
    filters: {},
    restaurantId: parseInt(session.restaurantId) || session.restaurantId,
    orderByFields: { INVOICE_DATE: "DESC" },
  });
  const headers: Record<string, string> = {
    ...getAuthHeaders(session),
    'Content-Type': 'application/json',
    'X-UI-URL': `${PA_BASE_URL}/ng/#/restaurantBackOffice/viewInvoices?startDate=${startDate}&endDate=${endDate}&invoiceNumber=&originalInvoiceNumber=`,
  };

  console.log('[PA Invoices] POST', url);
  const resp = await fetch(url, { method: 'POST', headers, body: postBody, redirect: 'follow' });
  const text = await resp.text();
  if (!resp.ok) {
    console.error('[PA Invoices] list err:', resp.status, text.substring(0, 300));
    return [];
  }
  let data: any; try { data = JSON.parse(text); } catch { return []; }
  const list: any[] = data.dataList || [];
  console.log('[PA Invoices] got', list.length, 'invoices in range');

  return list.map((r: any) => ({
    invoiceNumber: String(r.invoiceNumber || ''),
    invoiceMasterId: String(r.invoiceMasterId || ''),
    invoiceDate: r.invoiceDate || '',
    uploadDate: r.uploadDate || '',
    invoiceTotal: Number(r.invoiceTotal || 0),
    distributorName: r.distributorName || '',
    distributorId: String(r.vendorNumber || ''),
    clientId: String(r.clientId || ''),
    totalQuantity: Number(r.totalQuantity || 0),
    webOrderId: r.webOrderId ? String(r.webOrderId) : null,
  })).filter(i => i.invoiceNumber);
}

async function fetchInvoiceDetail(session: PASession, inv: PAInvoiceSummary): Promise<PAInvoiceDetail | null> {
  const url = `${PA_BASE_URL}/api/view-invoice-details/get-detail-invoice?distributorId=${inv.distributorId}&restaurantId=${session.restaurantId}&invoiceNumber=${inv.invoiceNumber}&clientId=${inv.clientId}`;
  const headers: Record<string, string> = {
    ...getAuthHeaders(session),
    'X-UI-URL': `${PA_BASE_URL}/ng/#/restaurantBackOffice/view-invoice-details?invoiceNumber=${inv.invoiceNumber}&distributorId=${inv.distributorId}&restaurantId=${session.restaurantId}&clientId=${inv.clientId}`,
  };
  const resp = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
  const text = await resp.text();
  if (!resp.ok) {
    console.error('[PA InvDetail]', inv.invoiceNumber, 'err:', resp.status);
    return null;
  }
  let data: any; try { data = JSON.parse(text); } catch { return null; }
  const rows: any[] = Array.isArray(data) ? data : (data.dataList || data.data || []);
  if (!rows.length) return null;

  const first = rows[0];
  const lineItems: PAInvoiceLineItem[] = rows.map((r: any) => ({
    pa_product_id: r.paProductId != null ? Number(r.paProductId) : null,
    item_code: String(r.itemNum || ''),
    description: r.description || '',
    master_product_code: r.masterProductCode || null,
    master_product_desc: r.masterProductDesc || null,
    quantity: Number(r.quantity || 0),
    unit_cost: Number(r.unitCost || 0),
    extended_cost: Number(r.extendedCost || 0),
    vendor_name: r.vendorName || inv.distributorName,
  }));

  // invoiceDate from detail is already yyyy-MM-dd; uploadDate is "yyyy-MM-dd HH:mm:ss"
  return {
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: (first.invoiceDate || '').substring(0, 10),
    uploadDate: (first.uploadDate || '').substring(0, 10),
    vendorName: first.vendorName || inv.distributorName,
    totalAmount: inv.invoiceTotal,
    lineItems,
  };
}

async function handleInvoices(supabase: any, body: any): Promise<Response> {
  const { locationId, startDate, endDate, maxInvoices = 50 } = body;
  const invGate = await isInventoryEnabled(supabase, locationId);
  if (!invGate.enabled) {
    console.log(`[PA invoices] SKIPPED — inventory_enabled=false for ${locationId}`);
    return inventoryDisabledResponse(invGate, corsHeaders);
  }
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });
  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const sd = startDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const ed = endDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const list = await fetchInvoiceList(session, sd, ed);
  const toFetch = list.slice(0, maxInvoices);

  let persisted = 0;
  const persistedInvoices: string[] = [];
  const errors: string[] = [];

  for (const inv of toFetch) {
    const detail = await fetchInvoiceDetail(session, inv);
    await new Promise(r => setTimeout(r, 250));
    if (!detail) continue;

    const items = detail.lineItems.map(li => ({
      name: li.description,
      item_code: li.item_code,
      pa_product_id: li.pa_product_id,
      quantity: li.quantity,
      unit: 'case',
      price: li.unit_cost,
      total: li.extended_cost,
      master_product_code: li.master_product_code,
      master_product_desc: li.master_product_desc,
      // Force PA branding so existing pa_product_id mappings match cleanly.
      // Actual distributor (e.g. "Worldwide Produce") is preserved in raw_data.detail.
      vendor_name: 'Produce Alliance',
      actual_distributor: li.vendor_name,
    }));

    // pa_order_id namespaced so invoices never collide with web orders
    const paOrderId = `INV-${detail.invoiceNumber}`;

    const { error } = await supabase
      .from('pa_orders')
      .upsert({
        location_id: locationId,
        pa_order_id: paOrderId,
        order_number: detail.invoiceNumber,
        order_date: detail.uploadDate || detail.invoiceDate,
        delivery_date: detail.invoiceDate || detail.uploadDate,
        status: 'invoiced',
        total_amount: detail.totalAmount,
        items,
        raw_data: { source: 'pa_invoice', invoice: inv, detail },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'location_id,pa_order_id' });

    if (error) {
      console.error('[PA Invoices] upsert err', detail.invoiceNumber, error.message);
      errors.push(`${detail.invoiceNumber}: ${error.message}`);
    } else {
      persisted++;
      persistedInvoices.push(detail.invoiceNumber);
    }
  }

  return jsonResponse({
    success: true,
    range: { sd, ed },
    found: list.length,
    fetched: toFetch.length,
    persisted,
    persistedInvoices,
    errors,
  });
}



function extractOrdersFromJson(data: any): PAOrderSummary[] {
  // The PA API returns: { records, selectedProductCounts, extraParams, dataList }
  // Orders are in dataList (array of order objects)
  let items: any[];
  if (Array.isArray(data)) {
    items = data;
  } else {
    items = data.dataList || data.data || data.orders || data.content || data.Data || data.Orders || [];
  }
  if (!Array.isArray(items)) {
    console.log('[PA Orders] No array found in response. Top-level keys:', Object.keys(data).join(', '));
    // Log a sample of each top-level key to identify the right one
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (Array.isArray(val)) {
        console.log(`[PA Orders] "${key}" is array[${val.length}]`, val[0] ? 'sample keys: ' + Object.keys(val[0]).join(', ') : '(empty)');
      } else {
        console.log(`[PA Orders] "${key}" is ${typeof val}:`, JSON.stringify(val)?.substring(0, 200));
      }
    }
    return [];
  }
  
  console.log(`[PA Orders] Found ${items.length} items in response`);
  if (items[0]) console.log('[PA Orders] Sample item keys:', Object.keys(items[0]).join(', '));
  if (items[0]) console.log('[PA Orders] Sample item:', JSON.stringify(items[0]).substring(0, 500));

  return items.map((o: any) => ({
    webOrderId: String(o.webOrderId || o.WebOrderId || o.orderId || o.OrderId || o.id || ''),
    orderDate: o.orderDate || o.OrderDate || o.dateCreated || '',
    deliveryDate: o.deliveryDate || o.DeliveryDate || null,
    status: o.status || o.Status || 'unknown',
    totalAmount: o.orderTotal || o.totalAmount || o.TotalAmount || o.total || null,
    totalCases: o.caseCount || o.totalCases || o.TotalCases || null,
  })).filter((o: PAOrderSummary) => {
    // Only include submitted orders — SAVED orders are drafts not yet finalized
    if (!o.webOrderId) return false;
    const status = (o.status || '').toUpperCase();
    if (status === 'SAVED') {
      console.log('[PA Orders] Skipping SAVED order:', o.webOrderId);
      return false;
    }
    return true;
  });
}

function extractOrdersFromHtml(html: string): PAOrderSummary[] {
  const orders: PAOrderSummary[] = [];
  
  // Look for order links like viewOrder.jsp?webOrderId=XXXX
  const linkRegex = /webOrderId[=:]?\s*["']?(\d+)/gi;
  const orderIds = new Set<string>();
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    orderIds.add(m[1]);
  }

  // Also look for table rows with order data
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    
    // Look for rows containing an order ID
    for (const cell of cells) {
      const idMatch = cell.match(/^\d{5,}$/);
      if (idMatch && !orderIds.has(idMatch[0])) {
        orderIds.add(idMatch[0]);
      }
    }
  }

  for (const id of orderIds) {
    orders.push({
      webOrderId: id,
      orderDate: '',
      deliveryDate: null,
      status: 'unknown',
      totalAmount: null,
      totalCases: null,
    });
  }

  return orders;
}

// ============================================================================
// ORDER DETAIL — Parse JSP page for line items
// ============================================================================

interface PALineItem {
  item_code: string;
  description: string;
  pa_product_id: string;
  unit_price: number;
  quantity: number;
  cost: number;
}

interface PAOrderDetail {
  webOrderId: string;
  deliveryDate: string | null;
  totalCases: number | null;
  totalAmount: number | null;
  lineItems: PALineItem[];
}

async function fetchOrderDetail(session: PASession, webOrderId: string, startDate: string, endDate: string, _credentials?: PACredentials | null): Promise<PAOrderDetail | null> {
  console.log('[PA Detail] Fetching order:', webOrderId);

  const authHeaders = getAuthHeaders(session);

  // Primary: GET /api/order-details?webOrderId=X (discovered from Angular app network calls)
  try {
    const url = `${PA_BASE_URL}/api/order-details?webOrderId=${webOrderId}`;
    console.log('[PA Detail] GET', url);
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        ...authHeaders,
        'X-UI-URL': `${PA_BASE_URL}/ng/#/restaurantBackOffice/view-order?webOrderId=${webOrderId}&restaurantId=${session.restaurantId}`,
      },
    });

    const text = await resp.text();
    console.log('[PA Detail] Response:', resp.status, 'len:', text.length);

    if (resp.ok && text.length > 50) {
      try {
        const json = JSON.parse(text);
        // Response structure: { restaurant, client, distributor, order: { orderId, orderItemList, deliveryDate, orderTotal, ... } }
        const order = json.order;
        if (order && Array.isArray(order.orderItemList) && order.orderItemList.length > 0) {
          console.log('[PA Detail] ✅ Found', order.orderItemList.length, 'line items from REST API');
          return {
            webOrderId,
            deliveryDate: order.deliveryDate || null,
            totalCases: order.totalQuantity || null,
            totalAmount: order.orderTotal || null,
            lineItems: order.orderItemList.map((li: any) => ({
              item_code: String(li.distributorProductId || li.masterProductCode || ''),
              description: li.masterProductName || '',
              pa_product_id: String(li.masterProductId || ''),
              unit_price: parseFloat(li.pricePerUnit || 0),
              quantity: parseFloat(li.quantity || 0),
              cost: parseFloat(li.cost || 0),
            })),
          };
        } else if (order) {
          console.log('[PA Detail] Order found but no items (empty order):', webOrderId);
          return {
            webOrderId,
            deliveryDate: order.deliveryDate || null,
            totalCases: order.totalQuantity || null,
            totalAmount: order.orderTotal || null,
            lineItems: [],
          };
        }
      } catch (e) {
        console.warn('[PA Detail] JSON parse error:', e);
      }
    } else {
      console.warn('[PA Detail] Non-OK response:', resp.status, text.substring(0, 300));
    }
  } catch (e) {
    console.error('[PA Detail] REST API error:', e);
  }

  // Fallback: JSP scraping if REST API fails
  console.log('[PA Detail] REST API failed, trying JSP fallback...');

  // Fallback: JSP scraping — use non-zero-padded dates to match browser behavior
  const toNonPadded = (d: string) => {
    const [y, m, dd] = d.split('-');
    return `${y}-${parseInt(m)}-${parseInt(dd)}`;
  };
  const jspStart = toNonPadded(startDate);
  const jspEnd = toNonPadded(endDate);
  const url = `${PA_BASE_URL}/viewOrder.jsp?&webOrderId=${webOrderId}&startDate=${jspStart}&endDate=${jspEnd}&restaurantId=${session.restaurantId}&includeOnlySubmit=false`;

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        ...authHeaders,
        'Referer': `${PA_BASE_URL}/ng/`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      console.warn('[PA Detail] HTTP', resp.status, 'for order', webOrderId);
      await resp.text().catch(() => '');
      return null;
    }

    const html = await resp.text();
    console.log('[PA Detail] Got HTML for order', webOrderId, 'len:', html.length, 'preview:', html.substring(0, 500));

    if (html.includes('Sign in') || html.includes('j_security_check')) {
      console.warn('[PA Detail] Session expired — got login page');
      return null;
    }
    
    if (html.length < 1000) {
      console.warn('[PA Detail] HTML too short, likely not the order page. Full content:', html);
    }

    return parseOrderDetailJsp(html, webOrderId);
  } catch (e) {
    console.error('[PA Detail] Error fetching order', webOrderId, ':', e);
    return null;
  }
}

function parseOrderDetailJsp(html: string, webOrderId: string): PAOrderDetail {
  const lineItems: PALineItem[] = [];

  // Extract delivery date: "Delivery Date: 03/06/2026"
  let deliveryDate: string | null = null;
  const deliveryMatch = html.match(/Delivery\s*Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (deliveryMatch) {
    const parts = deliveryMatch[1].split('/');
    deliveryDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }

  // Extract total cases: "Total Cases: 8.00"
  let totalCases: number | null = null;
  const casesMatch = html.match(/Total\s*Cases[:\s]*([\d.]+)/i);
  if (casesMatch) totalCases = parseFloat(casesMatch[1]);

  // Extract total amount: "Total: $190.50"
  let totalAmount: number | null = null;
  const totalMatch = html.match(/Total[:\s]*\$([\d,.]+)/i);
  if (totalMatch) totalAmount = parseFloat(totalMatch[1].replace(/,/g, ''));

  // Parse the line items table
  // Columns: Item | Description | PA Product ID | Unit Price | Quantity | Cost
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    
    // The viewOrder.jsp table may not have explicit headers — look for tables with
    // numeric item codes (5-digit patterns like 01212, 03792) in <td> cells
    const hasItemCodes = (tableHtml.match(/<td[^>]*>\d{4,5}<\/td>/g) || []).length >= 2;
    const hasHeaders = tableHtml.includes('PA Product ID') || tableHtml.includes('Unit Price') || tableHtml.includes('Description');
    if (!hasItemCodes && !hasHeaders) {
      continue;
    }

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let isHeader = true;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      
      // Skip header rows
      if (rowHtml.includes('<th') || rowHtml.includes('PA Product ID')) {
        isHeader = false;
        continue;
      }
      if (isHeader) continue;

      const cells: string[] = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      // viewOrder.jsp has 7 cells per row: spacer(&nbsp;) | item_code | description | pa_product_id | unit_price | qty | cost
      // Also handle 6-cell rows (no spacer)
      if (cells.length >= 6) {
        // Detect spacer: first cell is empty, &nbsp;, or non-numeric
        const hasSpacerCol = cells.length >= 7 && (
          cells[0] === '' || cells[0] === '&nbsp;' || cells[0] === '\u00a0' || !/\d/.test(cells[0])
        );
        const offset = hasSpacerCol ? 1 : 0;
        
        const itemCode = cells[offset];
        const description = cells[offset + 1];
        const paProductId = cells[offset + 2] || '';
        const unitPrice = parseFloat(cells[offset + 3]?.replace(/[$,]/g, '') || '0');
        const quantity = parseFloat(cells[offset + 4] || '0');
        const cost = parseFloat(cells[offset + 5]?.replace(/[$,]/g, '') || '0');

        if (itemCode && description && /^\d+/.test(itemCode) && (quantity > 0 || cost > 0)) {
          lineItems.push({
            item_code: itemCode,
            description,
            pa_product_id: paProductId,
            unit_price: unitPrice,
            quantity,
            cost,
          });
        }
      }
    }

    if (lineItems.length > 0) break; // Found the right table
  }

  // Fallback: try parsing without strict table detection
  if (lineItems.length === 0) {
    console.log('[PA Detail] Table parsing found 0 items, trying fallback regex');
    // Look for rows with item codes (numeric) followed by description and price
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      
      if (cells.length >= 5) {
        // Check for spacer column, then look for numeric item code
        const hasSpacerCol = cells[0] === '' || cells[0] === '&nbsp;' || cells[0] === '\u00a0';
        const offset = hasSpacerCol ? 1 : 0;
        const itemCode = cells[offset];
        if (/^\d{3,}$/.test(itemCode) && cells.length >= (offset + 5)) {
          const description = cells[offset + 1];
          const paProductId = cells[offset + 2] || '';
          const unitPrice = parseFloat(cells[offset + 3]?.replace(/[$,]/g, '') || '0');
          const quantity = parseFloat(cells[offset + 4] || '0');
          const cost = parseFloat(cells[offset + 5]?.replace(/[$,]/g, '') || '0');
          if (quantity > 0 || cost > 0) {
            lineItems.push({
              item_code: itemCode,
              description,
              pa_product_id: paProductId,
              unit_price: unitPrice,
              quantity,
              cost,
            });
          }
        }
      }
    }
  }

  console.log('[PA Detail] Order', webOrderId, ':', lineItems.length, 'line items, delivery:', deliveryDate, 'total:', totalAmount);
  return { webOrderId, deliveryDate, totalCases, totalAmount, lineItems };
}

// ============================================================================
// CURRENT PRICES — REST API for full product catalog (Angular order page)
// POST /api/restaurant-order/current-prices
// Returns: { records, dataList: [{ masterProductId, masterProductCode,
//            masterProductName, pricePerCase, distributorProductId, ... }] }
// ============================================================================

async function fetchCurrentPricesCatalog(session: PASession): Promise<Array<{
  pa_item_id: string;
  pa_internal_id: string | null;
  master_product_code: string | null;
  master_product_id: string | null;
  description: string;
  pack_size: string | null;
  category: string | null;
  unit_price: number | null;
}>> {
  console.log('[PA CurrentPrices] Fetching full catalog via current-prices API, restaurant:', session.restaurantId);

  const authHeaders = getAuthHeaders(session, true);
  const allItems: Array<{
    pa_item_id: string;
    pa_internal_id: string | null;
    master_product_code: string | null;
    master_product_id: string | null;
    description: string;
    pack_size: string | null;
    category: string | null;
    unit_price: number | null;
  }> = [];


  // Tomorrow's date for deliveryDate param (matches browser behavior — order page uses next delivery date)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  const deliveryDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

  let offset = 0;
  const limit = 100; // fetch more per page to minimize calls
  let totalRecords = Infinity;

  while (offset < totalRecords) {
    const postBody = JSON.stringify({
      deliveryDate,
      filters: null,
      sortByField: null,
      orderBy: null,
      limit,
      offset,
    });

    try {
      const resp = await fetch(`${PA_BASE_URL}/api/restaurant-order/current-prices`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          'X-UI-URL': `${PA_BASE_URL}/ng/#/restaurantBackOffice/restaurant-order/restaurant-order-selection?deliveryDate=${encodeURIComponent(deliveryDate)}&restRef=`,
        },
        body: postBody,
      });

      const text = await resp.text();
      console.log(`[PA CurrentPrices] offset=${offset} → ${resp.status}, ${text.length} chars`);

      if (!resp.ok || text.length < 10) {
        console.warn('[PA CurrentPrices] Non-OK response:', resp.status, text.substring(0, 300));
        break;
      }

      const json = JSON.parse(text);
      totalRecords = json.records || 0;
      const dataList = json.dataList || [];

      console.log(`[PA CurrentPrices] records=${totalRecords}, dataList=${dataList.length} items at offset=${offset}`);

      for (const item of dataList) {
        const name = item.masterProductName || '';
        if (!name) continue;

        const parsedPack = parsePackFromName(name);

        // Use masterProductCode (guide ID like 8515) as pa_item_id
        // Fall back to masterProductId (internal DB key like 1310) if no code available
        const guideId = item.masterProductCode ? String(item.masterProductCode) : '';
        const internalId = item.masterProductId ? String(item.masterProductId) : '';

        allItems.push({
          pa_item_id: guideId || internalId,           // LEGACY — masterProductCode
          pa_internal_id: internalId || null,          // LEGACY — masterProductId
          master_product_code: guideId || null,        // NEW — explicit
          master_product_id: internalId || null,       // NEW — explicit
          description: name,
          pack_size: parsedPack.packSize,
          category: 'Produce',
          unit_price: item.pricePerCase != null ? Number(item.pricePerCase) : null,
        });

      }

      offset += dataList.length;

      // Safety: if we got fewer items than limit, we've reached the end
      if (dataList.length < limit) break;

      // Brief pause between pages
      if (offset < totalRecords) await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error('[PA CurrentPrices] Error at offset', offset, ':', e);
      break;
    }
  }

  console.log(`[PA CurrentPrices] ✅ Total: ${allItems.length} items fetched`);
  return allItems;
}

// ============================================================================
// PRICING — parse weekly pricing from the portal (LEGACY — replaced by current-prices)
// ============================================================================

async function fetchPAPricing(session: PASession): Promise<any[]> {
  console.log('[PA Pricing] Fetching pricing for restaurant:', session.restaurantId);
  
  const authHeaders = getAuthHeaders(session);
  
  const pricingUrls = [
    `${PA_BASE_URL}/api/pricing?restaurantId=${session.restaurantId}`,
    `${PA_BASE_URL}/api/restaurant-dashboard/pricing?restaurantId=${session.restaurantId}`,
    `${PA_BASE_URL}/weeklyPricing.jsp?restaurantId=${session.restaurantId}`,
    `${PA_BASE_URL}/pricing.jsp?restaurantId=${session.restaurantId}`,
  ];

  for (const url of pricingUrls) {
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: authHeaders,
        redirect: 'follow',
      });
      
      if (!resp.ok) { await resp.text().catch(() => ''); continue; }
      
      const text = await resp.text();
      if (text.includes('Sign in') || text.length < 100) continue;
      
      console.log('[PA Pricing]', url.replace(PA_BASE_URL, ''), '→', resp.status, 'len:', text.length);
      
      try {
        const data = JSON.parse(text);
        const items = Array.isArray(data) ? data : data.data || data.items || data.Data || [];
        if (Array.isArray(items) && items.length > 0) {
          console.log('[PA Pricing] Got', items.length, 'items from API');
          return items;
        }
      } catch {
        const items = parsePricingHtml(text);
        if (items.length > 0) return items;
      }
    } catch (e) {
      console.warn('[PA Pricing] Error:', e);
    }
  }

  return [];
}

function parsePricingHtml(html: string): any[] {
  const items: any[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 3) {
      const priceVal = cells.find(c => /^\$?[\d.]+$/.test(c.replace(/[$,]/g, '')));
      if (priceVal) {
        items.push({
          id: cells[0],
          name: cells[1] || cells[0],
          price: parseFloat(priceVal.replace(/[$,]/g, '')),
          unit: cells.find(c => /^(cs|ea|lb|bg|ct|cn|bx|pk)$/i.test(c)) || 'case',
        });
      }
    }
  }
  return items;
}

// Parse pack size info from item name
function parsePackFromName(name: string): { packSize: string | null; packQuantity: number | null; packUnit: string | null } {
  if (!name) return { packSize: null, packQuantity: null, packUnit: null };
  const trimmed = name.trim();

  // "6/5#" → "6/5 LB" (count/weight# → standard LB format)
  const countSlashWeight = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*#(?!\d)/);
  if (countSlashWeight) {
    const qty = parseInt(countSlashWeight[1]);
    return { packSize: `${qty}/${countSlashWeight[2]} LB`, packQuantity: qty, packUnit: 'lb' };
  }
  // "6/#10 CN" → can notation (keep as-is, client handles it)
  const countCan = trimmed.match(/(\d+)\/#(\d+)/);
  if (countCan) {
    const qty = parseInt(countCan[1]);
    return { packSize: `${qty}/#${countCan[2]} CN`, packQuantity: qty, packUnit: 'can' };
  }
  // "6/5 LB" → already standard
  const countSlashLb = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*(?:LB|lb)/);
  if (countSlashLb) {
    const qty = parseInt(countSlashLb[1]);
    return { packSize: `${qty}/${countSlashLb[2]} LB`, packQuantity: qty, packUnit: 'lb' };
  }
  // "2/5 GA" or "1/128 OZ" → standard notation
  const countSlashUnit = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*(GA|OZ|ML|KG|G)\b/i);
  if (countSlashUnit) {
    const qty = parseInt(countSlashUnit[1]);
    const unit = countSlashUnit[3].toLowerCase();
    return { packSize: `${qty}/${countSlashUnit[2]} ${countSlashUnit[3].toUpperCase()}`, packQuantity: qty, packUnit: unit };
  }
  const nCt = trimmed.match(/(\d+)\s*CT\b/i);
  if (nCt) {
    const qty = parseInt(nCt[1]);
    return { packSize: `${qty} CT`, packQuantity: qty, packUnit: 'each' };
  }
  // "25#" → "1/25 LB" (standalone weight → proper format for recipe costing)
  const standalone = trimmed.match(/\b(\d+(?:\.\d+)?)\s*#(?!\d)/);
  if (standalone) return { packSize: `1/${standalone[1]} LB`, packQuantity: 1, packUnit: 'lb' };
  const nLb = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:lb|LB)\b/);
  if (nLb) return { packSize: `1/${nLb[1]} LB`, packQuantity: 1, packUnit: 'lb' };

  return { packSize: null, packQuantity: null, packUnit: null };
}

// Parse the inner-pack quantity (sleeves / bundles / inner boxes) from a free-form
// description or item name. Mirrors the PFG parser. Patterns:
//   "50/slv", "50/sleeve", "50 per sleeve"
//   "25/bundle", "25/bdl", "25/bx"
//   "100/pk", "100/pack", "100/inner"
// Conservative: returns null when no clear "<N>/<word>" or "<N> per <word>" hit.
function parseInnerPackQuantity(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = text.match(
    /(\d+)\s*(?:\/|\s+per\s+)\s*(slv|sleeve|sleeves|bdl|bundle|bundles|inner(?:\s+pack)?|pk|pack|packs|bx|box|boxes)\b/i,
  );
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 1 && n <= 10000) return n;
  }
  const m2 = text.match(/(\d+)\s+inner\b/i);
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (Number.isFinite(n) && n > 1 && n <= 10000) return n;
  }
  return null;
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function handleTest(supabase: any, body: any): Promise<Response> {
  const { locationId, testCredentials } = body;
  
  let credentials: PACredentials | null = null;
  if (testCredentials?.username && testCredentials?.password) {
    credentials = {
      username: testCredentials.username,
      password: testCredentials.password,
      restaurant_id: testCredentials.restaurant_id || testCredentials.pa_location_id || '',
    };
  } else {
    credentials = await getCredentials(supabase, locationId);
  }
  
  if (!credentials) return jsonResponse({ authenticated: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ authenticated: false, error: 'Login failed — check credentials' });

  // Verify we can actually access data
  const verified = await verifySession(session);
  return jsonResponse({
    authenticated: true,
    verified,
    success: true,
    message: verified ? 'Produce Alliance connection successful!' : 'Login succeeded but session verification failed — may need to check restaurantId',
  });
}

async function handleItems(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  // Get items from extended order history (6 months) + pricing for full catalog coverage
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const sixMonthsAgo = new Date(now.getTime() - 180 * 86400000);
  const startDate = `${sixMonthsAgo.getFullYear()}-${pad(sixMonthsAgo.getMonth() + 1)}-${pad(sixMonthsAgo.getDate())}`;
  const endDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  
  const orders = await fetchOrderList(session, startDate, endDate);
  
  // Fetch pricing (may contain full catalog)
  const pricing = await fetchPAPricing(session);
  
  // Also extract items from order details (up to 10 orders)
  const orderItems = new Map<string, any>();
  for (const order of orders.slice(0, 10)) {
    try {
      const detail = await fetchOrderDetail(session, order.webOrderId, startDate, endDate, credentials);
      if (detail?.lineItems?.length) {
        for (const li of detail.lineItems) {
          const id = li.pa_product_id || li.item_code || '';
          if (id && !orderItems.has(id)) {
            orderItems.set(id, {
              itemId: li.pa_product_id,
              description: li.description,
              packSize: li.pack_size,
              category: li.category || '',
            });
          }
        }
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn('[PA Items] Error fetching order detail:', e);
    }
  }

  // Merge pricing + order items into a single list
  const allItems = new Map<string, any>();
  
  for (const item of pricing) {
    const id = String(item.itemId || item.item_id || item.productId || '').trim();
    if (id) allItems.set(id, item);
  }
  
  for (const [id, item] of orderItems) {
    if (!allItems.has(id)) allItems.set(id, item);
  }

  const items = Array.from(allItems.values());
  console.log('[PA Items] Total unique items:', items.length, '(pricing:', pricing.length, ', orders:', orderItems.size, ')');

  return jsonResponse({ success: true, data: { items, count: items.length, orderCount: orders.length } });
}

async function handleOrders(supabase: any, body: any): Promise<Response> {
  const { locationId, startDate, endDate, fetchDetails = true, maxDetails = 10 } = body;
  const ordGate = await isInventoryEnabled(supabase, locationId);
  if (!ordGate.enabled) {
    console.log(`[PA orders] SKIPPED — inventory_enabled=false for ${locationId}`);
    return inventoryDisabledResponse(ordGate, corsHeaders);
  }
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  // Calculate date range (ISO format: YYYY-MM-DD)
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const sd = startDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const ed = endDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const orderList = await fetchOrderList(session, sd, ed);
  console.log('[PA Orders] Got', orderList.length, 'orders in range');

  // Fetch details for orders — carry orderDate from summary
  const orderDetailsWithDate: Array<PAOrderDetail & { summaryOrderDate: string }> = [];
  if (fetchDetails && orderList.length > 0) {
    const toFetch = orderList.slice(0, maxDetails);
    for (const order of toFetch) {
      const detail = await fetchOrderDetail(session, order.webOrderId, sd, ed, credentials);
      if (detail) {
        orderDetailsWithDate.push({ ...detail, summaryOrderDate: order.orderDate });
        // Brief pause to avoid hammering
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  // Helper: derive delivery_date as order_date + 1 day (all Blaze locations are next-day delivery)
  const nextDay = (dateStr: string): string => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };

  // Persist to pa_orders — save from details when available, otherwise from summary
  let persisted = 0;
  const orderDetails = orderDetailsWithDate; // keep variable name for response
  const persistedOrderIds = new Set<string>();

  for (const detail of orderDetailsWithDate) {
    const items = detail.lineItems.map(li => ({
      name: li.description,
      item_code: li.item_code,
      pa_product_id: li.pa_product_id,
      quantity: li.quantity,
      unit: 'case',
      price: li.unit_price,
      total: li.cost,
    }));

    const orderDate = detail.summaryOrderDate || new Date().toISOString().split('T')[0];
    // Use the actual delivery date from the detail scrape/API; only fall back to nextDay if missing
    const deliveryDate = detail.deliveryDate || nextDay(orderDate);

    const { error } = await supabase
      .from('pa_orders')
      .upsert({
        location_id: locationId,
        pa_order_id: detail.webOrderId,
        order_number: detail.webOrderId,
        order_date: orderDate,
        delivery_date: deliveryDate,
        status: 'delivered',
        total_amount: detail.totalAmount,
        items,
        raw_data: detail,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'location_id,pa_order_id' });

    if (!error) { persisted++; persistedOrderIds.add(detail.webOrderId); }
  }

  // Fallback: persist orders from summary data when detail fetch failed
  for (const order of orderList) {
    if (persistedOrderIds.has(order.webOrderId)) continue;
    
    const orderDateRaw = order.orderDate?.split(' ')[0] || new Date().toISOString().split('T')[0];
    const deliveryDate = order.deliveryDate || nextDay(orderDateRaw);

    const { error } = await supabase
      .from('pa_orders')
      .upsert({
        location_id: locationId,
        pa_order_id: order.webOrderId,
        order_number: order.webOrderId,
        order_date: orderDateRaw,
        delivery_date: deliveryDate,
        status: order.status || 'delivered',
        total_amount: order.totalAmount,
        items: [],
        raw_data: order,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'location_id,pa_order_id' });

    if (!error) persisted++;
  }

  return jsonResponse({
    success: true,
    data: {
      orderSummaries: orderList,
      orderDetails,
      count: orderList.length,
      detailsFetched: orderDetails.length,
      persisted,
    }
  });
}

async function handleSyncItems(supabase: any, body: any): Promise<Response> {
  const { locationId, triggeredBy } = body;

  const syncGate = await isInventoryEnabled(supabase, locationId);
  if (!syncGate.enabled) {
    console.log(`[PA sync_items] SKIPPED — inventory_enabled=false for ${locationId}`);
    return inventoryDisabledResponse(syncGate, corsHeaders);
  }


  const { data: syncLog } = await supabase
    .from('inventory_sync_logs')
    .insert({
      location_id: locationId,
      sync_source: 'produce_alliance',
      sync_type: 'manual',
      status: 'in_progress',
      triggered_by: triggeredBy || null,
      metadata: { method: 'buyers_edge' },
    })
    .select('id')
    .single();
  const syncLogId = syncLog?.id;

  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) {
    await updateSyncLog(supabase, syncLogId, 'failed', 0, 0, ['PA integration not configured']);
    return jsonResponse({ success: false, error: 'PA integration not configured' });
  }

  const session = await loginToPA(credentials);
  if (!session) {
    await updateSyncLog(supabase, syncLogId, 'failed', 0, 0, ['PA login failed']);
    return jsonResponse({ success: false, error: 'PA login failed' });
  }

  // ── PRIMARY: Use current-prices REST API for live prices, but merge in cached PA catalog rows
  // because some locations expose only a partial live feed while pa_catalog_items already contains
  // the full priced catalog discovered by the catalog scraper.
  const catalogItems = await fetchCurrentPricesCatalog(session);
  const { data: cachedCatalogRows } = await supabase
    .from('pa_catalog_items')
    .select('pa_item_id, pa_internal_id, description, pack_size, category, unit_price')
    .eq('location_id', locationId)
    .gt('unit_price', 0);

  const allItems = new Map<string, PALineItem>();
  const upsertCatalogItem = (
    item: {
      pa_item_id: string;
      description: string;
      unit_price: number | null;
      distributor_product_id?: string | null;
      master_product_code?: string | null;
      pa_internal_id?: string | null;
    },
    preferIncoming = false,
  ) => {
    if (!item.pa_item_id || !item.description) return;

    const normalized: PALineItem = {
      item_code: item.distributor_product_id || item.master_product_code || item.pa_internal_id || '',
      description: item.description,
      pa_product_id: item.pa_item_id,
      unit_price: item.unit_price || 0,
      quantity: 0,
      cost: 0,
    };

    const existing = allItems.get(item.pa_item_id);
    if (!existing) {
      allItems.set(item.pa_item_id, normalized);
      return;
    }

    const nextPrice = preferIncoming && normalized.unit_price > 0
      ? normalized.unit_price
      : (existing.unit_price > 0 ? existing.unit_price : normalized.unit_price);

    allItems.set(item.pa_item_id, {
      ...existing,
      ...normalized,
      item_code: existing.item_code || normalized.item_code,
      description: existing.description || normalized.description,
      unit_price: nextPrice,
    });
  };

  for (const row of cachedCatalogRows || []) {
    upsertCatalogItem(row, false);
  }
  for (const ci of catalogItems) {
    upsertCatalogItem(ci, true);
  }

  // Also fetch recent orders for persistence (COGS reconciliation)
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  // Fetch from the 1st of the PRIOR month to catch orders near month boundaries
  const priorMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startDate = `${priorMonth.getFullYear()}-${pad2(priorMonth.getMonth() + 1)}-01`;
  const endDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  
  const orderList = await fetchOrderList(session, startDate, endDate);
  let ordersProcessed = orderList.length;
  
  console.log('[PA Sync] Catalog merge — live:', catalogItems.length, 'cached:', cachedCatalogRows?.length || 0, 'merged:', allItems.size, 'orders:', orderList.length);

  // Persist orders to pa_orders from summary data (even without line items)
  // This ensures they show up in the Order Reconciliation Picker for COGS
  const nextDay = (dateStr: string): string => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };
  
  let ordersPersisted = 0;
  for (const order of orderList) {
    const orderDateRaw = order.orderDate?.split(' ')[0] || new Date().toISOString().split('T')[0];
    const deliveryDate = order.deliveryDate || nextDay(orderDateRaw);

    const { error } = await supabase
      .from('pa_orders')
      .upsert({
        location_id: locationId,
        pa_order_id: order.webOrderId,
        order_number: order.webOrderId,
        order_date: orderDateRaw,
        delivery_date: deliveryDate,
        status: order.status || 'delivered',
        total_amount: order.totalAmount,
        items: [],
        raw_data: order,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'location_id,pa_order_id' });

    if (!error) ordersPersisted++;
  }
  console.log('[PA Sync] Persisted', ordersPersisted, 'orders to pa_orders');

  if (allItems.size === 0) {
    await updateSyncLog(supabase, syncLogId, 'completed', 0, ordersPersisted, [], { message: ordersPersisted > 0 ? `${ordersPersisted} orders saved (no items from current-prices API)` : 'No items found' });
    return jsonResponse({ success: true, message: ordersPersisted > 0 ? `${ordersPersisted} orders saved` : 'No items found', synced: 0, ordersPersisted });
  }

  // Get brand_id + location name for this location (for gap alerts with location tags)
  const { data: locOrg } = await supabase.from('locations').select('organization_id, name').eq('id', locationId).single();
  const { data: orgBrand } = await supabase.from('organizations').select('brand_id').eq('id', locOrg?.organization_id).single();
  const brandId = orgBrand?.brand_id;
  const locationName = locOrg?.name || 'Unknown';

  // Build brand_vendor_mappings → brand_inventory_deployments lookup for this location
  // Step 4: Smart matching through the mapping table
  const { data: vmRows } = await supabase
    .from('brand_vendor_mappings')
    .select('brand_template_id, vendor_item_id')
    .in('vendor', ['produce_alliance', 'pa']);

  const { data: deployRows } = await supabase
    .from('brand_inventory_deployments')
    .select('template_id, inventory_item_id')
    .eq('location_id', locationId);

  // template_id → local inventory_item_id
  const deployByTemplate = new Map<string, string>();
  for (const d of (deployRows || [])) {
    deployByTemplate.set(d.template_id, d.inventory_item_id);
  }
  // pa vendor_item_id → local inventory_item_id (via template)
  const paIdToLocalItem = new Map<string, string>();
  // pa vendor_item_id → brand_template_id (for step 3.5 brand_item_id fallback)
  const paIdToTemplateId = new Map<string, string>();
  for (const vm of (vmRows || [])) {
    paIdToTemplateId.set(vm.vendor_item_id, vm.brand_template_id);
    const localId = deployByTemplate.get(vm.brand_template_id);
    if (localId) paIdToLocalItem.set(vm.vendor_item_id, localId);
  }

  console.log('[PA Sync] Built mapping lookup:', paIdToLocalItem.size, 'PA IDs → local items');

  // Sync items to inventory — pre-fetch all local items for in-memory matching
  const { data: allLocalItems } = await supabase
    .from('inventory_items')
    .select('id, pa_item_id, name, user_hidden, brand_item_id, cost_per_unit')
    .eq('location_id', locationId);

  const localById = new Map((allLocalItems || []).map(i => [i.id, i]));
  // brand_item_id → local item (for step 3.5: prevent duplicates when brand template already has a local item)
  const localByBrandItemId = new Map((allLocalItems || []).filter(i => i.brand_item_id).map(i => [i.brand_item_id!, i]));

  console.log('[PA Sync] Pre-fetched', allLocalItems?.length ?? 0, 'local items for in-memory matching');

  let synced = 0;
  const syncMatchLog = { mapping: 0, fallback_brand_item: 0, new_item: 0, gap_alert: 0 };
  const toUpsert: any[] = [];
  const gapAlerts: any[] = [];

  for (const [, item] of allItems) {
    const parsedPack = parsePackFromName(item.description);

    // Step 4: Try brand_vendor_mappings → deployment first (in-memory)
    let existingItemId = item.pa_product_id ? paIdToLocalItem.get(item.pa_product_id) : null;
    let existingItem: { id: string; user_hidden: boolean } | null = null;
    let matchSource = 'new';

    if (existingItemId) {
      existingItem = localById.get(existingItemId) || null;
      if (existingItem) matchSource = 'mapping';
    }

    // VENDOR GATE: Tier 2 (fallback_pa_id) and Tier 3 (fallback_name) REMOVED.
    // Only brand_vendor_mappings (Tier 1) and fallback_brand_item (Tier 3.5) are allowed.

    // Step 3.5: brand_item_id match — if this PA item maps to a brand template
    // that already has a local item at this location, UPDATE that item instead of creating a duplicate.
    // This prevents duplicates when a product has multiple PA supplier IDs in brand_vendor_mappings.
    if (!existingItem && item.pa_product_id) {
      const templateId = paIdToTemplateId.get(item.pa_product_id);
      if (templateId) {
        existingItem = localByBrandItemId.get(templateId) || null;
        if (existingItem) matchSource = 'fallback_brand_item';
      }
    }

    if (matchSource === 'mapping') syncMatchLog.mapping++;
    else if (matchSource === 'fallback_brand_item') syncMatchLog.fallback_brand_item++;
    else if (existingItem) syncMatchLog.mapping++; // shouldn't happen but safe
    else syncMatchLog.new_item++;

    const itemData: any = {
      cost_per_unit: item.unit_price,
      pack_size: parsedPack.packSize,
      pack_quantity: parsedPack.packQuantity,
      item_number: item.item_code || null,
      vendor_source: 'produce_alliance',
      is_active: true,
    };
    // Auto-populate count config from parsed pack data
    if (parsedPack.packUnit) {
      itemData.count_unit = parsedPack.packUnit;
    }
    if (parsedPack.packQuantity) {
      itemData.count_units_per_case = parsedPack.packQuantity;
    }

    if (existingItem) {
      const updateData: any = { ...itemData, id: existingItem.id };
      if (existingItem.user_hidden) {
        delete updateData.is_active;
      }
      // When matched via brand_item_id fallback, stamp pa_item_id on the surviving item
      // so future syncs find it directly via step 2 (pa_item_id lookup)
      if (matchSource === 'fallback_brand_item' && item.pa_product_id) {
        updateData.pa_item_id = item.pa_product_id;
      }
      // Carry brand_item_id forward so trg_validate_active_brand_link doesn't reject the row.
      // PostgREST upsert with onConflict:'id' can cause the trigger to evaluate NEW.brand_item_id
      // as NULL when the column is omitted from the payload — explicitly include it.
      const localFull = localById.get(existingItem.id) as any;
      if (localFull?.brand_item_id) {
        updateData.brand_item_id = localFull.brand_item_id;
      } else if (matchSource === 'fallback_brand_item' && item.pa_product_id) {
        // fallback_brand_item match means we matched by brand template — use that template id
        const templateId = paIdToTemplateId.get(item.pa_product_id);
        if (templateId) updateData.brand_item_id = templateId;
      }
      toUpsert.push(updateData);

      // Phase 5: queue an inner-pack patch only when we confidently parsed one.
      // Done as a separate guarded update so we never overwrite a manual edit.
      const innerPackQty = parseInnerPackQuantity(item.description);
      if (innerPackQty) {
        (updateData as any).__innerPackQty = innerPackQty;
      }
    } else {
      // VENDOR GATE: Do NOT create new inventory_items.
      // Route unmatched PA items to vendor_gap_alerts for brand-level resolution.
      if (brandId) {
        gapAlerts.push({
          brand_id: brandId,
          vendor_source: 'produce_alliance',
          item_number: item.pa_product_id || item.item_code || `pa-unknown-${synced}`,
          vendor_name: item.description.trim(),
          vendor_description: item.description.trim(),
          pack_size: parsedPack.packSize || null,
          category_name: null,
          status: 'new',
        });
      }
      console.log(`[PA Sync] Unmatched item → gap alert: "${item.description}" (PA ID: ${item.pa_product_id})`);
    }
    synced++;
  }

  // Existing local items only: use UPDATE, not UPSERT.
  // UPSERT can hit the trigger path with a partial NEW row and null out brand_item_id.
  const updateFailures: Array<{ id: string; message: string }> = [];
  for (let i = 0; i < toUpsert.length; i += 50) {
    const chunk = toUpsert.slice(i, i + 50);
    const results = await Promise.all(
      chunk.map(async ({ id, __innerPackQty, ...payload }: any) => {
        const { error } = await supabase
          .from('inventory_items')
          .update(payload)
          .eq('id', id);

        if (error) {
          updateFailures.push({ id, message: error.message });
        }

        // Phase 5: inner-pack patch — only when parsed AND currently null.
        // Guarded so manual edits are never overwritten.
        if (__innerPackQty) {
          await supabase
            .from('inventory_items')
            .update({ inner_pack_quantity: __innerPackQty })
            .eq('id', id)
            .is('inner_pack_quantity', null);
        }
      })
    );
    await Promise.all(results);
  }

  if (updateFailures.length > 0) {
    console.warn('[PA Sync] Item update failures:', updateFailures.slice(0, 20));
  }

  // Write gap alerts for unmatched items via RPC (atomic location-merge).
  // Parallelized in chunks of 20 — single-threaded JS keeps the dedup map safe,
  // and each RPC keys on (brand_id, vendor_source, item_number) so even racing
  // calls converge to the same row. Drops ~20 sequential roundtrips → 1 round.
  if (gapAlerts.length > 0) {
    for (let i = 0; i < gapAlerts.length; i += 20) {
      const batch = gapAlerts.slice(i, i + 20);
      await Promise.all(batch.map(async (gap) => {
        const { error } = await supabase.rpc('upsert_vendor_gap_with_location', {
          _brand_id: gap.brand_id,
          _vendor_source: gap.vendor_source,
          _item_number: gap.item_number,
          _vendor_name: gap.vendor_name,
          _vendor_description: gap.vendor_description,
          _pack_size: gap.pack_size,
          _category_name: gap.category_name,
          _location_id: locationId,
          _location_name: locationName,
        });
        if (error) console.warn('[PA Sync] Gap alert write error:', error.message);
      }));
    }
    console.log(`[PA Sync] Routed ${gapAlerts.length} unmatched items to vendor_gap_alerts`);
  }

  console.log('[PA Sync] Bulk write complete — updated:', toUpsert.length - updateFailures.length, 'failed:', updateFailures.length, 'gap alerts:', gapAlerts.length);

  // Propagate count_unit + count_units_per_case to brand templates
  const brandTemplateUpdates = new Map<string, { count_unit: string; count_units_per_case: number }>();
  for (const upsertItem of toUpsert) {
    if (!upsertItem.count_unit || !upsertItem.count_units_per_case) continue;
    const local = localById.get(upsertItem.id);
    if (local?.brand_item_id) {
      brandTemplateUpdates.set(local.brand_item_id, {
        count_unit: upsertItem.count_unit,
        count_units_per_case: upsertItem.count_units_per_case,
      });
    }
  }
  if (brandTemplateUpdates.size > 0) {
    const entries = Array.from(brandTemplateUpdates.entries());
    for (const [templateId, data] of entries) {
      await supabase.from('brand_inventory_templates')
        .update({ count_unit: data.count_unit, count_units_per_case: data.count_units_per_case })
        .eq('id', templateId)
        .is('count_unit', null); // Only set if not already manually configured
    }
    console.log('[PA Sync] Updated count config on', entries.length, 'brand templates');
  }

  console.log('[PA Sync] Match-source audit:', JSON.stringify(syncMatchLog));

  // Blended price calculation for linked items
  const { data: linkedItems } = await supabase
    .from('inventory_items')
    .select('id, linked_item_id, cost_per_unit')
    .eq('location_id', locationId)
    .eq('user_hidden', true)
    .not('linked_item_id', 'is', null);

  if (linkedItems && linkedItems.length > 0) {
    const linkMap = new Map<string, number[]>();
    for (const li of linkedItems) {
      if (!li.linked_item_id || li.cost_per_unit == null) continue;
      const existing = linkMap.get(li.linked_item_id) || [];
      existing.push(Number(li.cost_per_unit));
      linkMap.set(li.linked_item_id, existing);
    }

    const blendedUpdates: { id: string; blended_price: number }[] = [];
    for (const [primaryId, hiddenPrices] of linkMap.entries()) {
      const primary = localById.get(primaryId);
      const primaryCost = primary?.cost_per_unit != null ? Number(primary.cost_per_unit) : null;
      if (!primaryCost) continue;
      const allPrices = [primaryCost, ...hiddenPrices];
      const avg = allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length;
      blendedUpdates.push({ id: primaryId, blended_price: Math.round(avg * 100) / 100 });
    }
    for (let i = 0; i < blendedUpdates.length; i += 100) {
      const chunk = blendedUpdates.slice(i, i + 100);
      await supabase.from('inventory_items').upsert(chunk, { onConflict: 'id' });
    }
  }

  await updateSyncLog(supabase, syncLogId, 'completed', synced, ordersProcessed, []);
  return jsonResponse({ success: true, synced, ordersProcessed });
}

async function handleSaveCredentials(supabase: any, body: any): Promise<Response> {
  const { locationId, username, password, restaurantId, paLocationId } = body;

  if (!locationId || !username || !password) {
    return jsonResponse({ success: false, error: 'Missing locationId, username, or password' }, 400);
  }

  let rid = restaurantId || paLocationId || '';
  
  // Auto-discover restaurantId if not provided
  if (!rid) {
    console.log('[PA Save] No restaurantId provided, auto-discovering...');
    const discoverSession = await loginToPA({ username, password, restaurant_id: '' });
    if (discoverSession?.restaurantId) {
      rid = discoverSession.restaurantId;
      console.log('[PA Save] Auto-discovered restaurantId:', rid);
    } else {
      return jsonResponse({ success: false, error: 'Could not auto-discover restaurantId. Click Discover first or find it in the PA portal URL.' }, 400);
    }
  }

  // Test credentials
  const testSession = await loginToPA({ username, password, restaurant_id: rid });
  if (!testSession) {
    return jsonResponse({ success: false, error: 'Login failed — invalid credentials' });
  }

  const credentials: PACredentials = { username, password, restaurant_id: rid };

  const { error } = await supabase
    .from('location_integrations')
    .upsert({
      location_id: locationId,
      integration_type: 'produce_alliance',
      credentials,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,integration_type' });

  if (error) throw error;

  return jsonResponse({ success: true, message: 'Produce Alliance connected!' });
}

// ============================================================================
// SET SYNC MODE — toggle between 'orders' (default) and 'invoices'
// Stores on 'invoices' get nightly + manual invoice pulls from PA portal.
// Stores on 'orders' use the legacy orders endpoint + manual PDF upload fallback.
// Mutually exclusive — never both at once.
// ============================================================================
async function handleSetSyncMode(supabase: any, body: any): Promise<Response> {
  const { locationId, syncMode } = body;
  if (!locationId) return jsonResponse({ success: false, error: 'Missing locationId' }, 400);
  if (syncMode !== 'orders' && syncMode !== 'invoices') {
    return jsonResponse({ success: false, error: "syncMode must be 'orders' or 'invoices'" }, 400);
  }

  const { data: row, error: readErr } = await supabase
    .from('location_integrations')
    .select('credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'produce_alliance')
    .maybeSingle();

  if (readErr || !row) {
    return jsonResponse({ success: false, error: 'PA integration not found for this location' }, 404);
  }

  const creds = { ...(row.credentials as any), sync_mode: syncMode };
  const { error: writeErr } = await supabase
    .from('location_integrations')
    .update({ credentials: creds, updated_at: new Date().toISOString() })
    .eq('location_id', locationId)
    .eq('integration_type', 'produce_alliance');

  if (writeErr) return jsonResponse({ success: false, error: writeErr.message }, 500);
  return jsonResponse({ success: true, syncMode });
}

// ============================================================================
// NIGHTLY INVOICE SYNC — called by pg_cron @ 3:30 AM PST
// Iterates every location with sync_mode='invoices' and pulls last 3 days of invoices
// (overlap window catches late-posting WW Produce phone orders).
// ============================================================================
async function handleNightlyInvoiceSync(supabase: any, _body: any): Promise<Response> {
  console.log('[PA Nightly] starting invoice sync for all invoices-mode locations');

  const { data: locs, error } = await supabase
    .from('location_integrations')
    .select('location_id, credentials')
    .eq('integration_type', 'produce_alliance')
    .eq('is_active', true);

  if (error) return jsonResponse({ success: false, error: error.message }, 500);

  const invoicesMode = (locs || []).filter((l: any) => (l.credentials as any)?.sync_mode === 'invoices');
  const nightlyEnabledIds = await filterEnabledLocations(supabase, invoicesMode.map((l: any) => l.location_id));
  const targets = invoicesMode.filter((l: any) => nightlyEnabledIds.has(l.location_id));
  const nightlySkipped = invoicesMode.length - targets.length;
  if (nightlySkipped > 0) console.log(`[PA Nightly] Skipped ${nightlySkipped} location(s) — inventory_enabled=false`);
  console.log(`[PA Nightly] ${targets.length} location(s) on invoices mode (of ${locs?.length || 0} total)`);

  // Last 3 days (overlap catches late portal posts)
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const end = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const past = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const start = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`;

  const results: any[] = [];
  for (const loc of targets) {
    try {
      const res = await handleInvoices(supabase, {
        locationId: loc.location_id,
        startDate: start,
        endDate: end,
        maxInvoices: 50,
      });
      const json = await res.json();
      results.push({ locationId: loc.location_id, ...json });
    } catch (e) {
      results.push({ locationId: loc.location_id, success: false, error: (e as Error).message });
    }
    // light throttle between locations
    await new Promise(r => setTimeout(r, 500));
  }

  return jsonResponse({ success: true, range: { start, end }, processed: targets.length, results });
}

async function handleExplore(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  // Explore the portal to discover endpoints
  const pagesToTry = [
    `${PA_BASE_URL}/ng/`,
    `${PA_BASE_URL}/ng/index.html`,
    `${PA_BASE_URL}/viewOrders.jsp?restaurantId=${session.restaurantId}`,
  ];

  const results: any[] = [];
  for (const url of pagesToTry) {
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Cookie': session.cookies, 'User-Agent': UA },
        redirect: 'follow',
      });
      const text = await resp.text();
      
      // Extract API endpoints from JS
      const apiRegex = /(?:url|api|endpoint|service)[:\s]*['"]([^'"]*(?:order|pricing|restaurant|invoice)[^'"]*)['"]/gi;
      const endpoints: string[] = [];
      let m;
      while ((m = apiRegex.exec(text)) !== null) {
        if (!endpoints.includes(m[1])) endpoints.push(m[1]);
      }

      // Extract links
      const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
      const links: string[] = [];
      while ((m = linkRegex.exec(text)) !== null) {
        if (!links.includes(m[1])) links.push(m[1]);
      }

      results.push({
        url: url.replace(PA_BASE_URL, ''),
        status: resp.status,
        contentLength: text.length,
        endpoints,
        links: links.slice(0, 20),
        sample: text.replace(/\s+/g, ' ').slice(0, 2000),
      });
    } catch (e) {
      results.push({ url: url.replace(PA_BASE_URL, ''), error: String(e) });
    }
  }

  return jsonResponse({ success: true, data: { pages: results } });
}

// Fetch a single order detail — lightweight action for testing
async function handleFetchOrder(supabase: any, body: any): Promise<Response> {
  const { locationId, webOrderId, startDate, endDate } = body;
  
  if (!webOrderId) return jsonResponse({ success: false, error: 'webOrderId is required' }, 400);
  
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const now = new Date();
  const pad3 = (n: number) => String(n).padStart(2, '0');
  const sd = startDate || `${now.getFullYear()}-${pad3(now.getMonth() + 1)}-01`;
  const ed = endDate || `${now.getFullYear()}-${pad3(now.getMonth() + 1)}-${pad3(now.getDate())}`;

  const detail = await fetchOrderDetail(session, webOrderId, sd, ed, credentials);
  if (!detail) return jsonResponse({ success: false, error: 'Could not fetch order detail' });

  return jsonResponse({ success: true, data: detail });
}

// ============================================================================
// HELPERS
// ============================================================================

async function getCredentials(supabase: any, locationId: string): Promise<PACredentials | null> {
  if (!locationId) return null;
  const { data, error } = await supabase
    .from('location_integrations')
    .select('credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'produce_alliance')
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  const creds = data.credentials as unknown as PACredentials;
  // Migrate legacy pa_location_id to restaurant_id
  if (!creds.restaurant_id && creds.pa_location_id) {
    creds.restaurant_id = creds.pa_location_id;
  }
  return creds;
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function updateSyncLog(
  supabase: any, syncLogId: string | null, status: string, 
  itemsSynced: number, ordersProcessed: number, errors: string[], metadata?: any
) {
  if (!syncLogId) return;
  await supabase.from('inventory_sync_logs').update({
    status,
    items_synced: itemsSynced,
    orders_processed: ordersProcessed,
    errors,
    completed_at: new Date().toISOString(),
    metadata: metadata || {},
  }).eq('id', syncLogId);
}

// ============================================================================
// DISCOVER RESTAURANT ID — Login as each location and probe session/dashboard
// ============================================================================

async function handleDiscoverRestaurantId(_supabase: any, body: any): Promise<Response> {
  const { username, password } = body;
  
  if (!username || !password) {
    return jsonResponse({ success: false, error: 'Username and password required' }, 400);
  }

  console.log(`[PA Discover] Probing with username: ${username}`);
  
  const session = await loginToPA({
    username,
    password,
    restaurant_id: '',
  });
  
  if (!session || !session.accessToken) {
    return jsonResponse({ success: false, error: 'Login failed — check credentials' });
  }
  
  console.log(`[PA Discover] ✅ Logged in as ${username}, probing for restaurantId...`);
  
  // Probe the session endpoint to get user/restaurant info
  const probeEndpoints = [
    `${PA_BASE_URL}/api/common/session`,
    `${PA_BASE_URL}/api/restaurant-dashboard/get-restaurant-info`,
    `${PA_BASE_URL}/api/common/linked-users`,
  ];
  
  let restaurantId: string | null = null;
  
  for (const url of probeEndpoints) {
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.accessToken}`,
          'User-Agent': UA,
          'Accept': 'application/json',
          'Cookie': session.cookies,
          'Referer': `${PA_BASE_URL}/ng/`,
        },
      });
      const text = await resp.text();
      console.log(`[PA Discover] ${url.replace(PA_BASE_URL, '')} → ${resp.status} len:${text.length}`);
      
      if (resp.ok && text.length > 5) {
        try {
          const json = JSON.parse(text);
          const rid = json.restaurantId || json.restaurant_id || json.RestaurantId 
            || json.associatedDomainId || json.linkedUser?.[0]?.associatedDomainId
            || json.id;
          if (rid) {
            restaurantId = String(rid);
            console.log(`[PA Discover] Found restaurantId: ${restaurantId} from ${url.replace(PA_BASE_URL, '')}`);
            break;
          }
        } catch { /* not JSON */ }
      }
    } catch (e) {
      console.error(`[PA Discover] Error probing ${url}:`, e);
    }
  }
  
  // Also check if session itself has the restaurantId
  if (!restaurantId && session.restaurantId) {
    restaurantId = session.restaurantId;
  }
  
  if (restaurantId) {
    return jsonResponse({ success: true, restaurantId });
  }
  
  return jsonResponse({ success: false, error: 'Login succeeded but could not find restaurantId' });
}

// Debug action: capture full session + error response for troubleshooting
async function handleDebug(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'Login failed' });

  const results: any = { cookies: session.cookies, token: session.accessToken?.substring(0, 20) + '...' };

  // 1. Full session response
  try {
    const sessionResp = await fetch(`${PA_BASE_URL}/api/common/session`, {
      method: 'GET',
      headers: getAuthHeaders(session),
    });
    results.sessionStatus = sessionResp.status;
    results.sessionBody = await sessionResp.text();
  } catch (e) { results.sessionError = String(e); }

  // 2. Linked users
  try {
    const linkedResp = await fetch(`${PA_BASE_URL}/api/common/linked-users`, {
      method: 'GET',
      headers: getAuthHeaders(session),
    });
    results.linkedUsersStatus = linkedResp.status;
    const text = await linkedResp.text();
    try { results.linkedUsers = JSON.parse(text); } catch { results.linkedUsersRaw = text.substring(0, 2000); }
  } catch (e) { results.linkedUsersError = String(e); }

  // 3. Try order fetch - get FULL error body
  const orderPayload = {
    restaurantId: parseInt(session.restaurantId) || session.restaurantId,
    startDate: '3/1/2026',
    endDate: '3/6/2026',
    includeOnlySubmit: false,
  };
  try {
    const orderResp = await fetch(`${PA_BASE_URL}/api/restaurant-dashboard/fetch-orders-for-restaurant-by-params`, {
      method: 'POST',
      headers: { ...getAuthHeaders(session, true), 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(orderPayload),
    });
    results.orderStatus = orderResp.status;
    const text = await orderResp.text();
    try {
      const errJson = JSON.parse(text);
      // Extract the actual exception class and message from the Java stack trace
      results.orderError = {
        message: errJson.message || errJson.localizedMessage,
        exceptionClass: errJson.stackTrace?.[0]?.className,
        cause: errJson.cause,
        status: errJson.status,
        error: errJson.error,
        // Get the first few stack frames
        topFrames: errJson.stackTrace?.slice(0, 5)?.map((f: any) => `${f.className}.${f.methodName}(${f.fileName}:${f.lineNumber})`),
      };
    } catch {
      results.orderErrorRaw = text.substring(0, 3000);
    }
  } catch (e) { results.orderFetchError = String(e); }

  // 4. Fetch Angular app HTML and find JS bundle URLs, then search for API endpoints
  try {
    const ngResp = await fetch(`${PA_BASE_URL}/ng/`, {
      method: 'GET',
      headers: { ...getAuthHeaders(session), 'Accept': 'text/html' },
    });
    const ngHtml = await ngResp.text();
    
    // Extract script src URLs
    const scriptRegex = /src="([^"]*\.js[^"]*)"/g;
    const scripts: string[] = [];
    let sm;
    while ((sm = scriptRegex.exec(ngHtml)) !== null) {
      scripts.push(sm[1]);
    }
    results.angularScripts = scripts;
    
    // Fetch the main JS bundle and search for API endpoints
    const mainScript = scripts.find(s => s.includes('main'));
    if (mainScript) {
      const scriptUrl = mainScript.startsWith('http') ? mainScript : `${PA_BASE_URL}/ng/${mainScript}`;
      const jsResp = await fetch(scriptUrl, {
        method: 'GET',
        headers: { 'User-Agent': UA },
      });
      const jsText = await jsResp.text();
      
      // Search for order-related API endpoints
      const apiPatterns = [
        /["']([^"']*(?:order|Order)[^"']*?)["']/g,
        /["']([^"']*restaurant-dashboard[^"']*?)["']/g,
        /["']\/api\/([^"']*?)["']/g,
      ];
      
      const foundEndpoints: string[] = [];
      for (const pattern of apiPatterns) {
        let m;
        while ((m = pattern.exec(jsText)) !== null) {
          const ep = m[1] || m[0];
          if (ep.length < 200 && !ep.includes('{') && !foundEndpoints.includes(ep)) {
            foundEndpoints.push(ep);
          }
        }
      }
      results.discoveredEndpoints = foundEndpoints;
    }
  } catch (e) { results.angularError = String(e); }

  // 5. Try alternative order endpoints
  const altEndpoints = [
    { url: `/api/restaurant-dashboard/get-orders`, method: 'POST', body: { restaurantId: parseInt(session.restaurantId), startDate: '3/1/2026', endDate: '3/6/2026' } },
    { url: `/api/restaurant-dashboard/orders`, method: 'POST', body: { restaurantId: parseInt(session.restaurantId) } },
    { url: `/api/restaurant-dashboard/get-order-list`, method: 'POST', body: { restaurantId: parseInt(session.restaurantId) } },
    { url: `/api/weborder/list`, method: 'POST', body: { restaurantId: parseInt(session.restaurantId) } },
    { url: `/api/order/list?restaurantId=${session.restaurantId}`, method: 'GET', body: null },
  ];
  
  results.altEndpoints = [];
  for (const alt of altEndpoints) {
    try {
      const resp = await fetch(`${PA_BASE_URL}${alt.url}`, {
        method: alt.method,
        headers: { ...getAuthHeaders(session, true), 'Content-Type': 'application/json; charset=UTF-8' },
        body: alt.body ? JSON.stringify(alt.body) : undefined,
      });
      const text = await resp.text();
      results.altEndpoints.push({
        url: alt.url,
        status: resp.status,
        len: text.length,
        preview: text.substring(0, 500),
      });
    } catch (e) {
      results.altEndpoints.push({ url: alt.url, error: String(e) });
    }
  }

  return jsonResponse({ success: true, debug: results });
}

// ============================================================================
// HEADLESS SCRAPER SUPPORT — Actions called by GitHub Actions Playwright script
// ============================================================================

async function handleListPendingScrapes(supabase: any, _body: any): Promise<Response> {
  // Find all active PA integrations
  const { data: integrations, error: intError } = await supabase
    .from('location_integrations')
    .select('location_id, credentials')
    .eq('integration_type', 'produce_alliance')
    .eq('is_active', true);

  if (intError || !integrations?.length) {
    return jsonResponse({ success: true, locations: [] });
  }

  const locations: any[] = [];

  for (const integration of integrations) {
    const creds = integration.credentials as unknown as PACredentials;
    if (!creds?.username || !creds?.password) continue;

    const restaurantId = creds.restaurant_id || creds.pa_location_id || '';

    // Current week start (Monday) in PST
    const now = new Date();
    const pst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    // Find pa_orders with no items: only orders from last 30 days, limit 4
    // Skip orders older than 30 days to prevent infinite zombie retries
    const thirtyDaysAgo = new Date(pst);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];

    const { data: orders } = await supabase
      .from('pa_orders')
      .select('id, pa_order_id, order_date, delivery_date')
      .eq('location_id', integration.location_id)
      .or('items.is.null,items.eq.[]')
      .gte('order_date', cutoffDate)
      .order('order_date', { ascending: false })
      .limit(4);

    if (!orders?.length) continue;

    locations.push({
      locationId: integration.location_id,
      username: creds.username,
      password: creds.password,
      restaurantId,
      pendingOrders: orders,
    });
  }

  console.log('[PA Scraper] Found', locations.length, 'location(s) with pending orders');
  return jsonResponse({ success: true, locations });
}

async function handleSaveScrapedOrder(supabase: any, body: any): Promise<Response> {
  const { locationId, webOrderId, lineItems, deliveryDate, totalCases, totalAmount, orderDate: bodyOrderDate } = body;

  if (!locationId || !webOrderId) {
    return jsonResponse({ success: false, error: 'Missing locationId or webOrderId' }, 400);
  }

  if (!lineItems || lineItems.length === 0) {
    return jsonResponse({ success: false, error: 'No line items to save' });
  }

  // Map line items to the pa_orders items format
  const items = lineItems.map((li: PALineItem) => ({
    name: li.description,
    item_code: li.item_code,
    pa_product_id: li.pa_product_id,
    quantity: li.quantity,
    unit: 'case',
    price: li.unit_price,
    total: li.cost,
  }));

  // Use provided orderDate, or fall back to today
  const orderDateFinal = bodyOrderDate || new Date().toISOString().split('T')[0];
  // Derive delivery_date as next day (all Blaze locations are next-day delivery)
  const nextDay = (dateStr: string): string => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };
  const deliveryDateFinal = deliveryDate || nextDay(orderDateFinal);

  const { error } = await supabase
    .from('pa_orders')
    .upsert({
      location_id: locationId,
      pa_order_id: webOrderId,
      order_number: webOrderId,
      order_date: orderDateFinal,
      delivery_date: deliveryDateFinal,
      status: 'delivered',
      total_amount: totalAmount,
      items,
      raw_data: { lineItems, deliveryDate, totalCases, totalAmount, orderDate: bodyOrderDate, source: 'headless_scraper' },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,pa_order_id' });

  if (error) {
    console.error('[PA Scraper] Save error:', error);
    return jsonResponse({ success: false, error: error.message });
  }

  console.log('[PA Scraper] ✅ Saved order', webOrderId, 'with', items.length, 'line items');
  return jsonResponse({ success: true, saved: items.length });
}

async function handleHeadlessLoginFailed(supabase: any, body: any): Promise<Response> {
  const { locationId, error: errorMsg } = body;
  console.error('[PA Scraper] ❌ Headless login failed for location', locationId, ':', errorMsg);

  // Record the failure where the vendor sync history lives. (The old
  // support_tickets insert could never work — that table requires a user_id
  // and has no title/priority columns, so every failure was swallowed.)
  try {
    await supabase.from('inventory_sync_logs').insert({
      location_id: locationId,
      sync_source: 'produce_alliance',
      sync_type: 'headless_login',
      status: 'failed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      errors: { message: String(errorMsg || 'login failed') },
      triggered_by: 'pa-headless-scraper',
    });
  } catch (e) {
    console.warn('[PA Scraper] Could not log login failure:', e);
  }


  return jsonResponse({ success: true, message: 'Failure logged' });
}

async function handleProbeCatalog(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const results: any = {};

  // 1. Hit restaurantOrderSort.jsp
  const catalogPages = [
    `/restaurantOrderSort.jsp?restaurantId=${session.restaurantId}`,
    `/restaurantOrderSort.jsp`,
  ];

  for (const path of catalogPages) {
    try {
      const resp = await fetch(`${PA_BASE_URL}${path}`, {
        method: 'GET',
        headers: { ...getAuthHeaders(session), 'Accept': 'text/html,application/json,*/*' },
        redirect: 'manual',
      });
      const text = await resp.text();
      results[path] = { status: resp.status, len: text.length, redirect: resp.headers.get('location') || null, preview: text.substring(0, 2000) };
    } catch (e) { results[path] = { error: String(e) }; }
  }

  // 2. Try API endpoints that might back the order sort page
  const apiEndpoints = [
    { url: `/api/restaurant-dashboard/order-sort?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/restaurant-dashboard/get-order-sort?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/restaurant-dashboard/get-order-guide?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/order-guide?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/order-guide/items?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/product/list?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/product/search?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/weborder/products?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/weborder/order-guide?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/restaurant-dashboard/fetch-order-guide-for-restaurant`, method: 'POST', body: { restaurantId: parseInt(session.restaurantId) } },
    { url: `/api/restaurant-dashboard/fetch-products-for-restaurant`, method: 'POST', body: { restaurantId: parseInt(session.restaurantId) } },
    { url: `/api/common/order-guide?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/restaurant-dashboard/get-restaurant-order-sort?restaurantId=${session.restaurantId}`, method: 'GET' },
    { url: `/api/restaurant-dashboard/fetch-restaurant-order-sort`, method: 'POST', body: { restaurantId: parseInt(session.restaurantId) } },
  ];

  results.apiProbes = [];
  for (const ep of apiEndpoints) {
    try {
      const resp = await fetch(`${PA_BASE_URL}${ep.url}`, {
        method: ep.method,
        headers: { ...getAuthHeaders(session, true), 'Content-Type': 'application/json; charset=UTF-8' },
        body: (ep as any).body ? JSON.stringify((ep as any).body) : undefined,
      });
      const text = await resp.text();
      let preview = text.substring(0, 500);
      try { preview = JSON.stringify(JSON.parse(text)).substring(0, 500); } catch {}
      results.apiProbes.push({ url: ep.url, method: ep.method, status: resp.status, len: text.length, preview });
    } catch (e) {
      results.apiProbes.push({ url: ep.url, error: String(e) });
    }
  }

  // 3. Scan Angular main.js for order-sort / order-guide related API paths
  try {
    const ngResp = await fetch(`${PA_BASE_URL}/ng/`, { method: 'GET', headers: getAuthHeaders(session) });
    const ngHtml = await ngResp.text();
    const scriptMatch = ngHtml.match(/src="(main\.[^"]+\.js)"/);
    if (scriptMatch) {
      const jsResp = await fetch(`${PA_BASE_URL}/ng/${scriptMatch[1]}`, { method: 'GET', headers: { 'User-Agent': UA } });
      const jsText = await jsResp.text();
      const patterns = [
        /["']([^"']*(?:order[-_]?sort|order[-_]?guide|product[-_]?list|catalog|item[-_]?list)[^"']*?)["']/gi,
        /["'](\/api\/[^"']*?)["']/g,
      ];
      const found: string[] = [];
      for (const p of patterns) {
        let m;
        while ((m = p.exec(jsText)) !== null) {
          const ep = m[1];
          if (ep.length < 200 && !found.includes(ep)) found.push(ep);
        }
      }
      results.jsEndpoints = found;
    }
  } catch (e) { results.jsError = String(e); }

  return jsonResponse({ success: true, data: results });
}

// ── List all PA locations for catalog scrape ─────────────────────
async function handleListCatalogLocations(supabase: any, _body: any): Promise<Response> {
  const { data: integrations } = await supabase
    .from('location_integrations')
    .select('location_id, credentials')
    .eq('integration_type', 'produce_alliance')
    .eq('is_active', true);

  if (!integrations?.length) {
    return jsonResponse({ success: true, locations: [] });
  }

  const locations = integrations
    .filter((i: any) => i.credentials?.username && i.credentials?.password)
    .map((i: any) => ({
      locationId: i.location_id,
      username: i.credentials.username,
      password: i.credentials.password,
      restaurantId: i.credentials.restaurant_id || i.credentials.pa_location_id || '',
    }));

  return jsonResponse({ success: true, locations });
}

// ── Save scraped catalog items ───────────────────────────────────
async function handleSaveCatalog(supabase: any, body: any): Promise<Response> {
  const { locationId, items } = body;
  if (!locationId || !items?.length) {
    return jsonResponse({ success: false, error: 'Missing locationId or items' }, 400);
  }

  console.log(`[PA Catalog] Saving ${items.length} items for location ${locationId}`);

  let saved = 0;
  const now = new Date().toISOString();

  // Batch upsert in chunks of 50
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50).map((item: any) => {
      const paProductId = String(item.pa_product_id || item.pa_item_id || '').trim();
      return {
        location_id: locationId,
        pa_item_id: paProductId,                                                  // legacy column mirrors PA Product ID
        pa_product_id: paProductId || null,                                       // NEW authoritative column
        pa_internal_id: item.pa_internal_id ? String(item.pa_internal_id).trim() : null,
        master_product_code: item.master_product_code ? String(item.master_product_code).trim() : null,
        master_product_id: item.master_product_id ? String(item.master_product_id).trim() : (item.pa_internal_id ? String(item.pa_internal_id).trim() : null),
        description: String(item.description || '').trim(),
        pack_size: item.pack_size || null,
        category: item.category || null,
        unit_price: item.unit_price || null,
        last_seen_at: now,
      };
    }).filter((item: any) => item.pa_item_id);


    const { error } = await supabase
      .from('pa_catalog_items')
      .upsert(chunk, { onConflict: 'location_id,pa_item_id' });

    if (error) {
      console.error('[PA Catalog] Upsert error:', error);
    } else {
      saved += chunk.length;
    }
  }

  console.log(`[PA Catalog] ✅ Saved ${saved} catalog items`);

  // Auto-seed alternate PA IDs into brand_vendor_mappings
  await autoSeedPaVendorMappings(supabase, items);

  return jsonResponse({ success: true, saved });
}


// ── Auto-seed PA catalog IDs into brand_vendor_mappings ─────────
async function autoSeedPaVendorMappings(supabase: any, items: Array<{ pa_item_id: string; description: string; [key: string]: any }>) {
  try {
    if (!items?.length) return;

    // Get all live PA brand templates
    const { data: templates } = await supabase
      .from('brand_inventory_templates')
      .select('id, product_name, pa_item_id')
      .eq('vendor_source', 'produce_alliance')
      .eq('status', 'live');

    if (!templates?.length) return;

    // Get existing vendor mappings to avoid duplicates
    const templateIds = templates.map((t: any) => t.id);
    const { data: existingMappings } = await supabase
      .from('brand_vendor_mappings')
      .select('brand_template_id, vendor_item_id')
      .in('vendor', ['produce_alliance', 'pa'])
      .in('brand_template_id', templateIds);

    const existingSet = new Set(
      (existingMappings || []).map((m: any) => `${m.brand_template_id}:${m.vendor_item_id}`)
    );

    // Build name-matching map (brand product_name → template)
    // Include common PA naming convention mappings
    const nameMap = new Map<string, { id: string; pa_item_id: string }>();
    for (const t of templates) {
      nameMap.set(t.product_name.toLowerCase(), t);
    }

    // PA uses "Category, Description" format — build reverse lookup patterns
    const paNamePatterns: Array<{ pattern: string; templateName: string }> = [
      { pattern: 'lettuce, romaine', templateName: 'romaine' },
      { pattern: 'lettuce, arcadian', templateName: 'spring mix' },
      { pattern: 'herbs, basil', templateName: 'fresh basil' },
      { pattern: 'spinach, flat leaf', templateName: 'baby spinach' },
      { pattern: 'tomatoes, grape', templateName: 'grape tomatoes' },
      { pattern: 'tomatoes, cherry', templateName: 'cherry tomatoes' },
      { pattern: 'peppers, green', templateName: 'green bell peppers' },
      { pattern: 'onions, red', templateName: 'red onions' },
      { pattern: 'mushrooms, sliced', templateName: 'sliced mushrooms' },
      { pattern: 'pineapple, tidbit', templateName: 'pineapple tidbits' },
      { pattern: 'broccoli, florets', templateName: 'roasted broccoli' },
      { pattern: 'squash, zucchini', templateName: 'diced zucchini' },
    ];

    const inserts: Array<{ brand_template_id: string; vendor: string; vendor_item_id: string }> = [];

    for (const item of items) {
      const paId = String(item.pa_item_id || '').trim();
      if (!paId) continue;

      const desc = (item.description || '').toLowerCase();
      const firstName = desc.split(',')[0]?.trim() || '';

      // Try direct name match first
      let matched = nameMap.get(firstName);

      // Then try PA naming convention patterns
      if (!matched) {
        for (const { pattern, templateName } of paNamePatterns) {
          if (desc.startsWith(pattern)) {
            matched = nameMap.get(templateName);
            if (matched) break;
          }
        }
      }

      if (!matched) continue;
      // Skip if this is the primary PA ID
      if (paId === matched.pa_item_id) continue;
      // Skip if already exists
      const key = `${matched.id}:${paId}`;
      if (existingSet.has(key)) continue;

      existingSet.add(key);
      inserts.push({ brand_template_id: matched.id, vendor: 'produce_alliance', vendor_item_id: paId });
    }

    if (inserts.length > 0) {
      for (let i = 0; i < inserts.length; i += 50) {
        const chunk = inserts.slice(i, i + 50);
        const { error } = await supabase
          .from('brand_vendor_mappings')
          .upsert(chunk, { onConflict: 'brand_template_id,vendor,vendor_item_id', ignoreDuplicates: true });
        if (error) {
          console.error('[PA Auto-Seed] Upsert error:', error);
        }
      }
      console.log(`[PA Auto-Seed] ✅ Seeded ${inserts.length} alternate PA IDs into brand_vendor_mappings`);
    }
  } catch (err) {
    console.error('[PA Auto-Seed] Error:', err);
  }
}

// (Removed legacy parsers: parseCatalogCsv, parseWeeklyPricesHtml, parseOrderSortHtml.
//  Catalog sync is now XLSX-based — see handleScrapeCatalogLive below.)

async function handleDumpWeeklyPricesHtml(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  if (!locationId) return jsonResponse({ success: false, error: 'Missing locationId' }, 400);
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA not configured' });
  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const urls = [
    `${PA_BASE_URL}/reports/restaurantWeeklyProducePricesReport.jsp?restaurantId=${session.restaurantId}`,
    `${PA_BASE_URL}/api/reports/restaurant-weekly-produce-prices?restaurantId=${session.restaurantId}`,
    `${PA_BASE_URL}/api/reports/weekly-prices?restaurantId=${session.restaurantId}`,
  ];

  const downloadBodies = [
    { reportConfigName: 'REPORT_CONFIG_RESTAURANT_WEEKLY_PRODUCE_PRICES', restaurantId: parseInt(session.restaurantId), params: { restaurantId: parseInt(session.restaurantId) } },
    { configName: 'REPORT_CONFIG_RESTAURANT_WEEKLY_PRODUCE_PRICES', restaurantId: parseInt(session.restaurantId) },
  ];

  const attempts: any[] = [];
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          ...getAuthHeaders(session),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': `${PA_BASE_URL}/ng/`,
        },
        redirect: 'follow',
      });
      const text = await resp.text();
      const isRedirectStub = text.includes('localStorage.setItem') && text.length < 1000;

      // Extract header row (first <tr> containing <th>)
      const headerMatch = text.match(/<tr[^>]*>[\s\S]*?<th[\s\S]*?<\/tr>/i);
      // Extract first 2 data rows (<tr> with <td>, after header)
      const dataRows: string[] = [];
      const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let m;
      let sawHeader = false;
      while ((m = trRe.exec(text)) !== null && dataRows.length < 3) {
        if (m[0].includes('<th')) { sawHeader = true; continue; }
        if (!sawHeader) continue;
        if (m[0].includes('<input') || m[0].includes('<select')) continue;
        if (!/<td/i.test(m[0])) continue;
        dataRows.push(m[0]);
      }

      attempts.push({
        url: url.replace(PA_BASE_URL, ''),
        status: resp.status,
        contentType: resp.headers.get('content-type'),
        length: text.length,
        isRedirectStub,
        headerRowVerbatim: headerMatch ? headerMatch[0] : null,
        firstDataRows: dataRows,
        rawPreview: text.substring(0, 2000),
      });
    } catch (e) {
      attempts.push({ url: url.replace(PA_BASE_URL, ''), error: String(e) });
    }
  }

  const authHeaders = getAuthHeaders(session, true);
  for (const postBody of downloadBodies) {
    try {
      const resp = await fetch(`${PA_BASE_URL}/api/common/download-sheet`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json', 'Accept': '*/*' },
        body: JSON.stringify(postBody),
      });
      const ct = resp.headers.get('content-type') || '';
      const isBinary = /spreadsheet|excel|octet-stream|xlsx/i.test(ct);
      let preview = '';
      let firstKeys: string[] = [];
      let firstRowSample: any = null;
      if (isBinary) {
        const buf = await resp.arrayBuffer();
        preview = `[binary ${buf.byteLength} bytes, content-type=${ct}]`;
      } else {
        const text = await resp.text();
        preview = text.substring(0, 3000);
        try {
          const json = JSON.parse(text);
          const arr = Array.isArray(json) ? json : json.data || json.items || json.dataList || json.rows || [];
          if (Array.isArray(arr) && arr.length > 0) {
            firstKeys = Object.keys(arr[0]);
            firstRowSample = arr[0];
          }
        } catch { /* not json */ }
      }
      attempts.push({
        url: '/api/common/download-sheet',
        body: postBody,
        status: resp.status,
        contentType: ct,
        firstKeys,
        firstRowSample,
        preview,
      });
    } catch (e) {
      attempts.push({ url: '/api/common/download-sheet', body: postBody, error: String(e) });
    }
  }

  return jsonResponse({ success: true, restaurantId: session.restaurantId, attempts });
}

// ────────────────────────────────────────────────────────────────────────────
// Weekly Pricing JSP scrape — the authoritative PA catalog source.
//
// Flow:
//   1. Login (OAuth2 + session cookies)
//   2. Prime session: GET /ProduceAlliance.jsp to set urlDesignation=PA server-side
//   3. GET /reports/restaurantWeeklyProducePricesReport.jsp?restaurantId=<rid>
//      → returns the live HTML table that PA's UI renders. Columns:
//        MASTER PRODUCT NAME | PA PRODUCT ID | MASTER PRODUCT CODE
//        | DISTRIBUTOR PRODUCT ID | PRICE
//   4. Parse the table (skip header + filter/input rows).
//   5. Wipe-and-reload pa_catalog_items for this location, keyed on pa_product_id.
//      pa_item_id (legacy NOT NULL) is mirrored from pa_product_id.
// ────────────────────────────────────────────────────────────────────────────

async function handleScrapeCatalogLive(supabase: any, body: any): Promise<Response> {
  // ⚠️ HEADLESS-ONLY — DO NOT AUTO-TRIGGER.
  // The Weekly Pricing JSP returns a 555-byte client-side redirect stub when
  // fetched server-side (the urlDesignation flag lives in browser localStorage
  // and is set by the Angular bundle). Only `.github/scripts/pa-headless-scraper.mjs`
  // can scrape the real table. Edge-function callers must pass _headless: true
  // to acknowledge they understand this and have already obtained the HTML elsewhere.
  if (!body?._headless) {
    return jsonResponse({
      success: false,
      disabled: true,
      error: 'JSP scrape from edge function is disabled. Use pa-headless-scraper.mjs (Playwright) → save_catalog instead.',
    }, 410);
  }
  const { locationId } = body;
  if (!locationId) return jsonResponse({ success: false, error: 'Missing locationId' }, 400);



  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA not configured for this location' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const restId = String(session.restaurantId);

  // Prime: visit /ProduceAlliance.jsp so server-side session has urlDesignation=PA.
  // Without this the report JSP returns a 492-byte localStorage redirect stub.
  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${PA_BASE_URL}/ng/`,
  };

  for (const primeUrl of [
    `${PA_BASE_URL}/ProduceAlliance.jsp`,
  ]) {
    try {
      const r = await fetch(primeUrl, {
        method: 'GET',
        headers: { ...baseHeaders, 'Cookie': session.cookies },
        redirect: 'follow',
      });
      const extra = extractCookies(r.headers);
      if (extra) session.cookies = mergeCookies(session.cookies, extra);
      console.log(`[PA Weekly JSP] prime ${primeUrl.replace(PA_BASE_URL, '')} → ${r.status}`);
    } catch (e) {
      console.warn('[PA Weekly JSP] prime error:', e);
    }
  }

  // Fetch the report JSP (with retry if we get the stub).
  const reportUrl = `${PA_BASE_URL}/reports/restaurantWeeklyProducePricesReport.jsp?restaurantId=${restId}`;
  let html = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(reportUrl, {
        method: 'GET',
        headers: { ...baseHeaders, 'Cookie': session.cookies, 'Referer': reportUrl },
        redirect: 'follow',
      });
      const extra = extractCookies(resp.headers);
      if (extra) session.cookies = mergeCookies(session.cookies, extra);
      const text = await resp.text();
      console.log(`[PA Weekly JSP] report attempt ${attempt} → ${resp.status}, ${text.length}B`);
      const isStub = text.includes('localStorage.setItem') && text.length < 1500;
      if (!isStub && /<tr[\s\S]*?<td/i.test(text)) { html = text; break; }
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.warn(`[PA Weekly JSP] fetch error:`, e);
    }
  }

  if (!html) {
    return jsonResponse({ success: false, error: 'Failed to load Weekly Pricing JSP (got redirect stub or empty)', restaurant_id: restId });
  }

  // Parse all tables; locate the one with PA PRODUCT ID + MASTER PRODUCT NAME headers.
  const items: Array<{
    pa_product_id: string;
    master_product_code: string | null;
    description: string;
    pack_size: string | null;
    category: string;
    unit_price: number | null;
    distributor_item_id: string | null;
  }> = [];

  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tMatch;
  while ((tMatch = tableRe.exec(html)) !== null) {
    const tableHtml = tMatch[0];
    const upper = tableHtml.toUpperCase();
    if (!upper.includes('PA PRODUCT ID')) continue;

    // Pull cell text out of each row.
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const parsedRows: { cells: string[]; hasInput: boolean; hasTh: boolean }[] = [];
    let rMatch;
    while ((rMatch = rowRe.exec(tableHtml)) !== null) {
      const rowHtml = rMatch[1];
      const cells: string[] = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cMatch;
      while ((cMatch = cellRe.exec(rowHtml)) !== null) {
        cells.push(cMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
      }
      parsedRows.push({
        cells,
        hasInput: /<input|<select/i.test(rowHtml),
        hasTh: /<th/i.test(rowHtml),
      });
    }

    // Find the header row.
    let headerIdx = -1;
    let colName = -1, colPpid = -1, colMpc = -1, colDist = -1, colPrice = -1;
    for (let i = 0; i < parsedRows.length; i++) {
      const r = parsedRows[i];
      if (!r.hasTh && r.cells.every(c => /^[A-Z0-9 \/.\-]*$/i.test(c) === false)) continue;
      const upper = r.cells.map(c => c.toUpperCase());
      const ppidI = upper.findIndex(c => c.includes('PA PRODUCT ID'));
      if (ppidI < 0) continue;
      headerIdx = i;
      colPpid = ppidI;
      colName = upper.findIndex(c => c.includes('MASTER PRODUCT NAME') || c.includes('PRODUCT NAME'));
      colMpc  = upper.findIndex(c => c.includes('MASTER PRODUCT CODE') || c === 'PRODUCT CODE');
      colDist = upper.findIndex(c => c.includes('DISTRIBUTOR PRODUCT ID') || c.includes('DISTRIBUTOR ID'));
      colPrice = upper.findIndex(c => c.includes('PRICE') || c.includes('CASE SELL') || c === 'COST');
      break;
    }
    if (headerIdx < 0 || colPpid < 0 || colName < 0) continue;

    for (let i = headerIdx + 1; i < parsedRows.length; i++) {
      const r = parsedRows[i];
      if (r.hasInput) continue;
      if (r.cells.length < Math.max(colPpid, colName) + 1) continue;
      const ppid = (r.cells[colPpid] || '').trim();
      const name = (r.cells[colName] || '').trim();
      if (!ppid || !/^\d+$/.test(ppid)) continue;
      if (!name) continue;

      const mpc = colMpc >= 0 ? (r.cells[colMpc] || '').trim() : '';
      const distItem = colDist >= 0 ? (r.cells[colDist] || '').trim() : '';
      const priceRaw = colPrice >= 0 ? (r.cells[colPrice] || '') : '';
      const priceParsed = priceRaw ? Number(priceRaw.replace(/[^0-9.\-]/g, '')) : null;
      const unitPrice = priceParsed != null && !Number.isNaN(priceParsed) && priceParsed > 0 ? priceParsed : null;

      // Pack size = last comma-segment of the name (e.g. "Onions, Red, Slivered, 3/16, 5 lb." → "5 lb.")
      let packSize: string | null = null;
      const parts = name.split(',');
      if (parts.length > 1) packSize = parts[parts.length - 1].trim() || null;

      items.push({
        pa_product_id: ppid,
        master_product_code: mpc || null,
        description: name,
        pack_size: packSize,
        category: 'Produce',
        unit_price: unitPrice,
        distributor_item_id: distItem || null,
      });
    }

    if (items.length > 0) break;
  }

  console.log(`[PA Weekly JSP] Parsed ${items.length} catalog rows for location ${locationId}`);

  if (items.length === 0) {
    return jsonResponse({ success: false, message: 'JSP returned no item rows', saved: 0, restaurant_id: restId });
  }

  if (body?.dryRun) {
    const sample = items.slice(0, 5).map(it => ({
      pa_product_id: it.pa_product_id,
      master_product_code: it.master_product_code,
      description: it.description,
      unit_price: it.unit_price,
    }));
    return jsonResponse({
      success: true,
      dryRun: true,
      total: items.length,
      restaurant_id: restId,
      sample,
      source: 'weekly_jsp',
    });
  }

  // Full refresh — delete this location's catalog and reinsert from JSP.
  const now = new Date().toISOString();
  const { error: deleteErr } = await supabase
    .from('pa_catalog_items')
    .delete()
    .eq('location_id', locationId);
  if (deleteErr) {
    console.error('[PA Weekly JSP] Delete-before-insert error:', deleteErr);
    return jsonResponse({ success: false, error: `Failed to clear existing catalog: ${deleteErr.message}` });
  }

  let saved = 0;
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100).map(item => ({
      location_id: locationId,
      pa_item_id: item.pa_product_id,           // legacy NOT NULL — mirror authoritative ID
      pa_product_id: item.pa_product_id,        // AUTHORITATIVE
      master_product_code: item.master_product_code,
      master_product_id: null,
      pa_internal_id: null,
      description: item.description,
      pack_size: item.pack_size,
      category: item.category,
      unit_price: item.unit_price,
      last_seen_at: now,
    }));
    const { error } = await supabase.from('pa_catalog_items').insert(chunk);
    if (error) {
      console.error('[PA Weekly JSP] Insert error:', error);
    } else {
      saved += chunk.length;
    }
  }
  console.log(`[PA Weekly JSP] ✅ Saved ${saved} items for location ${locationId}`);

  await autoSeedPaVendorMappings(supabase, items.map(it => ({
    pa_item_id: it.pa_product_id,
    description: it.description,
  })));

  return jsonResponse({
    success: true,
    saved,
    total: items.length,
    restaurant_id: restId,
    source: 'weekly_jsp',
  });
}



// (Removed: handleProbeDesignation — proved no server-side endpoint flips the
//  Weekly Pricing JSP from stub→table. The urlDesignation flag is set client-
//  side via localStorage and the Angular bundle. JSP scrape is now headless-only.)


// ── Scrape all PA locations' catalogs (called by GitHub Action) ──
async function handleScrapeAllCatalogs(supabase: any, _body: any): Promise<Response> {
  // ⚠️ HEADLESS-ONLY — see handleScrapeCatalogLive. Disabled to prevent accidental
  // auto-triggers (e.g. from cron, retries, or upstream callers). Use the
  // GitHub Action / Playwright scraper instead.
  return jsonResponse({
    success: false,
    disabled: true,
    error: 'scrape_all_catalogs is disabled. Use pa-headless-scraper.mjs (Playwright) → save_catalog instead.',
  }, 410);
}

// (Original loop kept below for reference inside the headless workflow if ever re-enabled.)
async function _handleScrapeAllCatalogs_disabled(supabase: any, _body: any): Promise<Response> {
  const { data: integrations } = await supabase
    .from('location_integrations')
    .select('location_id, credentials')
    .eq('integration_type', 'produce_alliance')
    .eq('is_active', true);

  if (!integrations?.length) {
    return jsonResponse({ success: true, message: 'No PA locations configured', results: [] });
  }

  const results: any[] = [];

  for (const integration of integrations) {
    const creds = integration.credentials as unknown as PACredentials;
    if (!creds?.username || !creds?.password) continue;

    const locationId = integration.location_id;
    console.log(`[PA Catalog All] Processing location ${locationId}`);

    // Delegate to handleScrapeCatalogLive which has all the API logic
    try {
      const result = await handleScrapeCatalogLive(supabase, { locationId });
      const body = await result.clone().json();
      results.push({ locationId, ...body });
    } catch (e) {
      results.push({ locationId, success: false, error: String(e), items: 0 });
    }
  }

  const totalSaved = results.reduce((sum: number, r: any) => sum + (r.saved || 0), 0);
  console.log(`[PA Catalog All] ✅ Done. ${results.length} locations, ${totalSaved} total items saved`);
  return jsonResponse({ success: true, results, totalSaved });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireAuthorizedCaller(req, corsHeaders, {});
  if (denied) return denied;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }

    const action = body.action || 'test';
    console.log('[PA Service] Action:', action, 'locationId:', body.locationId);

    const PRIVILEGED_PA_ACTIONS = ['save_credentials', 'list_pending_scrapes', 'debug', 'explore'];
    if (PRIVILEGED_PA_ACTIONS.includes(action)) {
      const adminDenied = await requireAuthorizedCaller(req, corsHeaders, { minRole: 'admin' });
      if (adminDenied) return adminDenied;
    }

    switch (action) {
      case 'test': return await handleTest(supabase, body);
      case 'items': return await handleItems(supabase, body);
      case 'orders': return await handleOrders(supabase, body);
      case 'sync_items': return await handleSyncItems(supabase, body);
      case 'save_credentials': return await handleSaveCredentials(supabase, body);
      case 'explore': return await handleExplore(supabase, body);
      case 'fetch_order': return await handleFetchOrder(supabase, body);
      case 'discover_restaurant_id': return await handleDiscoverRestaurantId(supabase, body);
      case 'debug': return await handleDebug(supabase, body);
      case 'list_pending_scrapes': return await handleListPendingScrapes(supabase, body);
      case 'save_scraped_order': return await handleSaveScrapedOrder(supabase, body);
      case 'headless_login_failed': return await handleHeadlessLoginFailed(supabase, body);
      case 'probe_catalog': return await handleProbeCatalog(supabase, body);
      case 'list_catalog_locations': return await handleListCatalogLocations(supabase, body);
      case 'save_catalog': return await handleSaveCatalog(supabase, body);
      case 'scrape_catalog_live': return await handleScrapeCatalogLive(supabase, body);
      case 'scrape_all_catalogs': return await handleScrapeAllCatalogs(supabase, body);
      case 'invoices': return await handleInvoices(supabase, body);
      case 'set_sync_mode': return await handleSetSyncMode(supabase, body);
      case 'nightly_invoice_sync': return await handleNightlyInvoiceSync(supabase, body);
      case 'dump_weekly_prices_html': return await handleDumpWeeklyPricesHtml(supabase, body);
      default: return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    console.error('[PA Service] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
