import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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
function getAuthHeaders(session: PASession, isPost = false): Record<string, string> {
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

async function fetchOrderDetail(session: PASession, webOrderId: string, startDate: string, endDate: string, credentials?: PACredentials | null): Promise<PAOrderDetail | null> {
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
  const authHeaders2 = getAuthHeaders(session);

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
  description: string;
  pack_size: string | null;
  category: string | null;
  unit_price: number | null;
  master_product_code: string | null;
  distributor_product_id: string | null;
}>> {
  console.log('[PA CurrentPrices] Fetching full catalog via current-prices API, restaurant:', session.restaurantId);

  const authHeaders = getAuthHeaders(session, true);
  const allItems: Array<{
    pa_item_id: string;
    description: string;
    pack_size: string | null;
    category: string | null;
    unit_price: number | null;
    master_product_code: string | null;
    distributor_product_id: string | null;
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

        allItems.push({
          pa_item_id: String(item.masterProductId || ''),
          description: name,
          pack_size: parsedPack.packSize,
          category: 'Produce',
          unit_price: item.pricePerCase != null ? Number(item.pricePerCase) : null,
          master_product_code: item.masterProductCode || null,
          distributor_product_id: item.distributorProductId || null,
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
function parsePackFromName(name: string): { packSize: string | null; packQuantity: number | null } {
  if (!name) return { packSize: null, packQuantity: null };
  const trimmed = name.trim();

  // "6/5#" → "6/5 LB" (count/weight# → standard LB format)
  const countSlashWeight = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*#(?!\d)/);
  if (countSlashWeight) {
    const qty = parseInt(countSlashWeight[1]);
    return { packSize: `${qty}/${countSlashWeight[2]} LB`, packQuantity: qty };
  }
  // "6/#10 CN" → can notation (keep as-is, client handles it)
  const countCan = trimmed.match(/(\d+)\/#(\d+)/);
  if (countCan) {
    const qty = parseInt(countCan[1]);
    return { packSize: `${qty}/#${countCan[2]} CN`, packQuantity: qty };
  }
  // "6/5 LB" → already standard
  const countSlashLb = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*(?:LB|lb)/);
  if (countSlashLb) {
    const qty = parseInt(countSlashLb[1]);
    return { packSize: `${qty}/${countSlashLb[2]} LB`, packQuantity: qty };
  }
  // "2/5 GA" or "1/128 OZ" → standard notation
  const countSlashUnit = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*(GA|OZ|ML|KG|G)\b/i);
  if (countSlashUnit) {
    const qty = parseInt(countSlashUnit[1]);
    return { packSize: `${qty}/${countSlashUnit[2]} ${countSlashUnit[3].toUpperCase()}`, packQuantity: qty };
  }
  const nCt = trimmed.match(/(\d+)\s*CT\b/i);
  if (nCt) {
    const qty = parseInt(nCt[1]);
    return { packSize: `${qty} CT`, packQuantity: qty };
  }
  // "25#" → "1/25 LB" (standalone weight → proper format for recipe costing)
  const standalone = trimmed.match(/\b(\d+(?:\.\d+)?)\s*#(?!\d)/);
  if (standalone) return { packSize: `1/${standalone[1]} LB`, packQuantity: 1 };
  const nLb = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:lb|LB)\b/);
  if (nLb) return { packSize: `1/${nLb[1]} LB`, packQuantity: 1 };

  return { packSize: null, packQuantity: null };
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

  // ── PRIMARY: Use current-prices REST API for full catalog with prices ──
  const catalogItems = await fetchCurrentPricesCatalog(session);
  
  // Convert catalog items to PALineItem format for the sync logic below
  const allItems = new Map<string, PALineItem>();
  for (const ci of catalogItems) {
    if (!ci.pa_item_id) continue;
    allItems.set(ci.pa_item_id, {
      item_code: ci.distributor_product_id || ci.master_product_code || '',
      description: ci.description,
      pa_product_id: ci.pa_item_id,
      unit_price: ci.unit_price || 0,
      quantity: 0,
      cost: 0,
    });
  }

  // Also fetch recent orders for persistence (COGS reconciliation)
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const startDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const endDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  
  const orderList = await fetchOrderList(session, startDate, endDate);
  let ordersProcessed = orderList.length;
  
  console.log('[PA Sync] Got', allItems.size, 'items from current-prices API,', orderList.length, 'orders');

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

  // Sync items to inventory
  let synced = 0;
  for (const [, item] of allItems) {
    const parsedPack = parsePackFromName(item.description);
    
    // Check if item exists by pa_item_id
    let existingItem = null;
    if (item.pa_product_id) {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, user_hidden')
        .eq('location_id', locationId)
        .eq('pa_item_id', item.pa_product_id)
        .maybeSingle();
      existingItem = data;
    }
    if (!existingItem) {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, user_hidden')
        .eq('location_id', locationId)
        .ilike('name', item.description)
        .maybeSingle();
      existingItem = data;
    }

    const itemData = {
      name: item.description.trim(),
      unit: 'case',
      cost_per_unit: item.unit_price,
      pack_size: parsedPack.packSize,
      pack_quantity: parsedPack.packQuantity,
      item_number: item.item_code || null,
      vendor_source: 'produce_alliance',
      is_active: true,
    };

    if (existingItem) {
      const updateData = { ...itemData };
      if (existingItem.user_hidden) {
        delete (updateData as any).is_active;
      }
      await supabase.from('inventory_items').update(updateData).eq('id', existingItem.id);
    } else {
      await supabase.from('inventory_items').insert({
        location_id: locationId,
        pa_item_id: item.pa_product_id || null,
        storage_location_id: null,
        ...itemData,
      });
    }
    synced++;
  }

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

    for (const [primaryId, hiddenPrices] of linkMap.entries()) {
      const { data: primary } = await supabase
        .from('inventory_items')
        .select('cost_per_unit')
        .eq('id', primaryId)
        .single();
      if (!primary?.cost_per_unit) continue;
      const allPrices = [Number(primary.cost_per_unit), ...hiddenPrices];
      const avg = allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length;
      const blended = Math.round(avg * 100) / 100;
      await supabase.from('inventory_items').update({ blended_price: blended }).eq('id', primaryId);
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

  const rid = restaurantId || paLocationId || '';
  if (!rid) {
    return jsonResponse({ success: false, error: 'Missing restaurantId — find it in the PA portal URL' }, 400);
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
  const stores = [
    { name: 'Hemet', storeNumber: '1341' },
    { name: 'Palm Desert', storeNumber: '1156' },
    { name: 'Palm Springs', storeNumber: '1223' },
  ];
  
  // Allow overriding with custom stores
  const customStores = body.stores || stores;
  const password = body.password || 'Produce#1';
  
  const results: any[] = [];
  
  for (const store of customStores) {
    const username = `Blaze-${store.storeNumber}`;
    console.log(`[PA Discover] Probing ${store.name} (${username})...`);
    
    const session = await loginToPA({
      username,
      password,
      restaurant_id: '',
    });
    
    if (!session || !session.accessToken) {
      results.push({ store: store.name, storeNumber: store.storeNumber, error: 'Login failed', hasToken: false });
      continue;
    }
    
    console.log(`[PA Discover] ✅ ${store.name} logged in, probing for restaurantId...`);
    
    // Probe the session endpoint to get user/restaurant info
    const probeEndpoints = [
      `${PA_BASE_URL}/api/common/session`,
      `${PA_BASE_URL}/api/restaurant-dashboard/get-restaurant-info`,
      `${PA_BASE_URL}/api/common/linked-users`,
    ];
    
    const probeResults: any[] = [];
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
            probeResults.push({ endpoint: url.replace(PA_BASE_URL, ''), status: resp.status, data: json });
            
            // Try to extract restaurantId from various fields
            const rid = json.restaurantId || json.restaurant_id || json.RestaurantId 
              || json.associatedDomainId || json.linkedUser?.[0]?.associatedDomainId
              || json.id;
            if (rid) {
              restaurantId = String(rid);
              console.log(`[PA Discover] Found restaurantId: ${restaurantId} from ${url.replace(PA_BASE_URL, '')}`);
            }
          } catch {
            probeResults.push({ endpoint: url.replace(PA_BASE_URL, ''), status: resp.status, raw: text.substring(0, 500) });
          }
        } else {
          probeResults.push({ endpoint: url.replace(PA_BASE_URL, ''), status: resp.status });
        }
      } catch (e) {
        probeResults.push({ endpoint: url.replace(PA_BASE_URL, ''), error: String(e) });
      }
    }
    
    results.push({
      store: store.name,
      storeNumber: store.storeNumber,
      username,
      loginSuccess: true,
      restaurantId,
      probes: probeResults,
    });
  }
  
  return jsonResponse({ success: true, results });
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
    const dayOfWeek = pst.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(pst);
    weekStart.setDate(pst.getDate() - mondayOffset);
    const weekStartStr = weekStart.toISOString().split('T')[0];

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

  // Create a support ticket for the failure
  try {
    await supabase.from('support_tickets').insert({
      title: 'Produce Alliance headless login failed',
      description: `Automated PA login failed for location ${locationId}: ${errorMsg}`,
      status: 'open',
      priority: 'high',
      category: 'integration',
    });
  } catch (e) {
    console.warn('[PA Scraper] Could not create support ticket:', e);
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
    const chunk = items.slice(i, i + 50).map((item: any) => ({
      location_id: locationId,
      pa_item_id: String(item.pa_item_id || '').trim(),
      description: String(item.description || '').trim(),
      pack_size: item.pack_size || null,
      category: item.category || null,
      unit_price: item.unit_price || null,
      last_seen_at: now,
    })).filter((item: any) => item.pa_item_id);

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
  return jsonResponse({ success: true, saved });
}


// ── CSV parser for download-sheet API responses ─────────────────
function parseCatalogCsv(csv: string): Array<{
  pa_item_id: string;
  description: string;
  pack_size: string | null;
  category: string | null;
  unit_price: number | null;
}> {
  const items: Array<{ pa_item_id: string; description: string; pack_size: string | null; category: string | null; unit_price: number | null }> = [];
  const lines = csv.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return items;

  // Parse header row
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  console.log(`[PA CSV] Headers: ${headers.join(', ')}`);

  const idIdx = headers.findIndex(h => h.includes('product id') || h.includes('item id') || h.includes('product code') || h === 'id');
  const nameIdx = headers.findIndex(h => h.includes('product name') || h.includes('description') || h.includes('name'));
  const packIdx = headers.findIndex(h => h.includes('pack') || h.includes('size') || h.includes('unit'));
  const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('cost'));
  const catIdx = headers.findIndex(h => h.includes('category') || h.includes('group'));

  if (idIdx < 0 && nameIdx < 0) {
    console.log('[PA CSV] Could not find id or name columns');
    return items;
  }

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV split (handles quoted fields)
    const cells = lines[i].match(/("([^"]*)")|([^,]+)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) || [];
    if (cells.length < 2) continue;

    const paItemId = idIdx >= 0 ? (cells[idIdx] || '') : '';
    const description = nameIdx >= 0 ? (cells[nameIdx] || '') : '';
    if (!paItemId && !description) continue;
    // Need at least an ID that looks numeric
    if (paItemId && !/^\d{3,}$/.test(paItemId)) continue;

    const packSize = packIdx >= 0 ? (cells[packIdx] || null) : null;
    const category = catIdx >= 0 ? (cells[catIdx] || 'Produce') : 'Produce';
    let unitPrice: number | null = null;
    if (priceIdx >= 0 && cells[priceIdx]) {
      const p = parseFloat(cells[priceIdx].replace(/[$,]/g, ''));
      if (!isNaN(p) && p > 0) unitPrice = p;
    }

    items.push({ pa_item_id: paItemId || description.substring(0, 20), description, pack_size: packSize, category, unit_price: unitPrice });
  }

  return items;
}

// ── Live catalog scrape (no Playwright needed) ──────────────────

function parseWeeklyPricesHtml(html: string): Array<{
  pa_item_id: string;
  description: string;
  pack_size: string | null;
  category: string | null;
  unit_price: number | null;
}> {
  const items: Array<{
    pa_item_id: string;
    description: string;
    pack_size: string | null;
    category: string | null;
    unit_price: number | null;
  }> = [];

  const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();

  // Parse header row to find column indices dynamically
  const headerRowMatch = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (!headerRowMatch) return items;

  // Find ALL table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let headerCells: string[] = [];
  let nameIdx = -1, paIdIdx = -1, packIdx = -1, priceIdx = -1, codeIdx = -1;
  let foundHeader = false;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1];
    
    // Check for header row (th cells)
    if (!foundHeader) {
      const thCells: string[] = [];
      const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
      let thMatch;
      while ((thMatch = thRegex.exec(rowHtml)) !== null) {
        thCells.push(stripTags(thMatch[1]).toLowerCase());
      }
      if (thCells.length >= 3) {
        headerCells = thCells;
        nameIdx = thCells.findIndex(h => h.includes('master product name') || h.includes('product name') || h.includes('description'));
        paIdIdx = thCells.findIndex(h => h.includes('pa product id') || (h.includes('product id') && !h.includes('name')));
        codeIdx = thCells.findIndex(h => h.includes('master product code') || h.includes('product code') || h.includes('item code'));
        packIdx = thCells.findIndex(h => h.includes('pack') || h.includes('size') || h.includes('unit'));
        priceIdx = thCells.findIndex(h => h.includes('price') || h.includes('cost'));
        foundHeader = true;
        continue;
      }
    }

    if (!foundHeader) continue;

    // Data rows (td cells)
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }

    if (cells.length < 3) continue;

    // Skip filter/input rows
    if (rowHtml.includes('<input') || rowHtml.includes('<select')) continue;

    // Extract PA Item ID - try mapped column first, then scan for numeric ID
    let paItemId = paIdIdx >= 0 && cells[paIdIdx] ? cells[paIdIdx] : '';
    if (!paItemId || !/^\d{3,}$/.test(paItemId)) {
      // Scan cells for a numeric ID (5+ digits typical for PA)
      for (let i = 0; i < cells.length; i++) {
        if (/^\d{4,}$/.test(cells[i].trim())) {
          paItemId = cells[i].trim();
          break;
        }
      }
    }
    if (!paItemId || !/^\d{3,}$/.test(paItemId)) continue;

    const description = nameIdx >= 0 ? (cells[nameIdx] || '') : (cells[1] || '');
    if (!description) continue;

    let packSize: string | null = null;
    if (packIdx >= 0 && cells[packIdx]) {
      packSize = cells[packIdx];
    } else {
      // Extract from description
      const parts = description.split(',');
      if (parts.length > 1) packSize = parts[parts.length - 1].trim();
    }

    let unitPrice: number | null = null;
    if (priceIdx >= 0 && cells[priceIdx]) {
      const parsed = parseFloat(cells[priceIdx].replace(/[$,]/g, ''));
      if (!isNaN(parsed) && parsed > 0) unitPrice = parsed;
    }

    items.push({
      pa_item_id: paItemId,
      description,
      pack_size: packSize,
      category: 'Produce',
      unit_price: unitPrice,
    });
  }

  return items;
}

function parseOrderSortHtml(html: string): Array<{
  pa_item_id: string;
  description: string;
  pack_size: string | null;
  category: string | null;
  unit_price: number | null;
}> {
  const items: Array<{
    pa_item_id: string;
    description: string;
    pack_size: string | null;
    category: string | null;
    unit_price: number | null;
  }> = [];

  const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentCategory = '';
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1];
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }

    if (cells.length === 1 && cells[0].length > 0) {
      currentCategory = cells[0];
      continue;
    }

    if (cells.length < 3) continue;

    const hasSpacerCol = cells.length >= 5 && (
      cells[0] === '' || cells[0] === '\u00a0' || !/\d/.test(cells[0])
    );
    const offset = hasSpacerCol ? 1 : 0;

    const itemCode = cells[offset];
    if (!itemCode || !/^\d{3,}$/.test(itemCode)) continue;

    const description = cells[offset + 1] || '';
    const packSize = cells[offset + 2] || '';
    const priceStr = cells[offset + 3] || '0';
    const unitPrice = parseFloat(priceStr.replace(/[$,]/g, '')) || 0;

    items.push({
      pa_item_id: itemCode,
      description,
      pack_size: packSize || null,
      category: currentCategory || null,
      unit_price: unitPrice > 0 ? unitPrice : null,
    });
  }

  return items;
}

async function handleScrapeCatalogLive(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  if (!locationId) return jsonResponse({ success: false, error: 'Missing locationId' }, 400);

  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA not configured for this location' });

  console.log(`[PA Catalog Live] Starting live scrape for location ${locationId}`);

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  let items: any[] = [];

  // ── PRIMARY: current-prices REST API (clean JSON, no scraping needed) ──
  console.log(`[PA Catalog Live] Trying current-prices REST API...`);
  try {
    const catalogItems = await fetchCurrentPricesCatalog(session);
    if (catalogItems.length > 0) {
      items = catalogItems;
      console.log(`[PA Catalog Live] ✅ current-prices API returned ${items.length} items`);
    }
  } catch (e) {
    console.warn('[PA Catalog Live] current-prices API error:', e);
  }

  // ── FALLBACK 1: JSP page (legacy — slower, requires HTML parsing) ──
  if (items.length === 0) {
  const weeklyUrl = `${PA_BASE_URL}/reports/restaurantWeeklyProducePricesReport.jsp?restaurantId=${session.restaurantId}`;
  console.log(`[PA Catalog Live] Trying Weekly Prices JSP page...`);
  try {
    const resp = await fetch(weeklyUrl, {
      method: 'GET',
      headers: {
        ...getAuthHeaders(session),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `${PA_BASE_URL}/ng/`,
      },
      redirect: 'follow',
    });
    const html = await resp.text();
    const isRedirectStub = html.includes('localStorage.setItem') && html.length < 1000;
    console.log(`[PA Catalog Live] Weekly Prices JSP: ${resp.status}, ${html.length} chars, redirect_stub: ${isRedirectStub}`);
    if (!isRedirectStub) {
      console.log(`[PA Catalog Live] HTML preview: ${html.substring(0, 500)}`);
    }

    if (resp.status === 200 && !isRedirectStub && !html.includes('j_security_check') && !html.includes('Sign in') && html.length > 500) {
      items = parseWeeklyPricesHtml(html);
      console.log(`[PA Catalog Live] ✅ Weekly Prices JSP parsed: ${items.length} items`);
    }
  } catch (e) {
    console.warn('[PA Catalog Live] Weekly Prices JSP error:', e);
  }
  } // end FALLBACK 1: JSP

  // ── ATTEMPT 2: download-sheet API ──
  if (items.length === 0) {
  const authHeaders = getAuthHeaders(session, true);
  const downloadSheetBodies = [
    { reportConfigName: 'REPORT_CONFIG_RESTAURANT_WEEKLY_PRODUCE_PRICES', restaurantId: parseInt(session.restaurantId), params: { restaurantId: parseInt(session.restaurantId) } },
    { configName: 'REPORT_CONFIG_RESTAURANT_WEEKLY_PRODUCE_PRICES', restaurantId: parseInt(session.restaurantId) },
    { reportName: 'restaurantWeeklyProducePricesReport', restaurantId: parseInt(session.restaurantId) },
    { reportType: 'WEEKLY_PRICES', restaurantId: parseInt(session.restaurantId) },
  ];

  for (const postBody of downloadSheetBodies) {
    if (items.length > 0) break;
    const downloadUrl = `${PA_BASE_URL}/api/common/download-sheet`;
    console.log(`[PA Catalog Live] Trying download-sheet body: ${JSON.stringify(postBody).substring(0, 200)}`);
    try {
      const resp = await fetch(downloadUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody),
      });
      const text = await resp.text();
      const isError = text.includes('stackTrace') || text.includes('exception');
      console.log(`[PA Catalog Live] download-sheet: ${resp.status}, ${text.length} chars, error: ${isError}`);
      if (!isError && resp.status === 200 && text.length > 100) {
        console.log(`[PA Catalog Live] Response preview: ${text.substring(0, 500)}`);
        items = parseCatalogCsv(text);
        if (items.length === 0) items = parseWeeklyPricesHtml(text);
        if (items.length === 0) {
          try {
            const json = JSON.parse(text);
            const arr = Array.isArray(json) ? json : json.data || json.items || json.dataList || [];
            if (Array.isArray(arr) && arr.length > 0) {
              console.log(`[PA Catalog Live] JSON sample:`, JSON.stringify(arr[0]).substring(0, 300));
              items = arr.map((r: any) => ({
                pa_item_id: String(r.paProductId || r.productId || r.itemId || r.id || r.masterProductCode || ''),
                description: r.masterProductName || r.productName || r.description || r.name || '',
                pack_size: r.packSize || r.pack || null,
                category: r.category || r.productCategory || 'Produce',
                unit_price: parseFloat(r.price || r.unitPrice || r.cost || 0) || null,
              })).filter((i: any) => i.pa_item_id && i.description);
            }
          } catch { /* not JSON */ }
        }
        if (items.length > 0) console.log(`[PA Catalog Live] ✅ Found ${items.length} items from download-sheet`);
      }
    } catch (e) {
      console.warn(`[PA Catalog Live] download-sheet error:`, e);
    }
  }
  } // close download-sheet if block

  // Attempt 3: Try various product/catalog REST endpoints
  if (items.length === 0) {
    const apiUrls = [
      { url: `${PA_BASE_URL}/api/restaurant-dashboard/fetch-products-for-restaurant-by-params?restaurantId=${session.restaurantId}`, method: 'POST', body: JSON.stringify({ restaurantId: parseInt(session.restaurantId), limit: 1000, offset: 0 }) },
      { url: `${PA_BASE_URL}/api/restaurant-dashboard/fetch-restaurant-products?restaurantId=${session.restaurantId}`, method: 'POST', body: JSON.stringify({ restaurantId: parseInt(session.restaurantId) }) },
      { url: `${PA_BASE_URL}/api/restaurant-dashboard/products?restaurantId=${session.restaurantId}`, method: 'GET', body: undefined },
      { url: `${PA_BASE_URL}/api/restaurant-dashboard/fetch-products-for-restaurant?restaurantId=${session.restaurantId}`, method: 'GET', body: undefined },
      { url: `${PA_BASE_URL}/api/product/list?restaurantId=${session.restaurantId}`, method: 'GET', body: undefined },
      { url: `${PA_BASE_URL}/api/reports/weekly-prices?restaurantId=${session.restaurantId}`, method: 'GET', body: undefined },
    ];

    for (const ep of apiUrls) {
      if (items.length > 0) break;
      console.log(`[PA Catalog Live] Trying: ${ep.method} ${ep.url.replace(PA_BASE_URL, '')}`);
      try {
        const resp = await fetch(ep.url, {
          method: ep.method,
          headers: ep.body ? { ...getAuthHeaders(session, true), 'Content-Type': 'application/json' } : getAuthHeaders(session),
          body: ep.body,
        });
        const text = await resp.text();
        console.log(`[PA Catalog Live] ${resp.status}, ${text.length} chars`);
        if (resp.status === 200 && text.length > 50 && !text.includes('stackTrace')) {
          console.log(`[PA Catalog Live] Preview: ${text.substring(0, 500)}`);
          try {
            const json = JSON.parse(text);
            const possibleArrays = [json, json.data, json.items, json.dataList, json.products, json.content, json.records];
            for (const arr of possibleArrays) {
              if (Array.isArray(arr) && arr.length > 0) {
                console.log(`[PA Catalog Live] Array[${arr.length}] sample keys: ${Object.keys(arr[0]).join(', ')}`);
                const mapped = arr.map((r: any) => ({
                  pa_item_id: String(r.paProductId || r.productId || r.itemId || r.id || r.masterProductCode || r.itemCode || ''),
                  description: r.masterProductName || r.productName || r.description || r.name || r.itemName || '',
                  pack_size: r.packSize || r.pack || r.unitSize || null,
                  category: r.category || r.productCategory || r.categoryName || 'Produce',
                  unit_price: parseFloat(r.price || r.unitPrice || r.cost || r.weeklyPrice || 0) || null,
                })).filter((i: any) => i.pa_item_id && i.description);
                if (mapped.length > 0) {
                  items = mapped;
                  console.log(`[PA Catalog Live] ✅ Found ${items.length} items`);
                  break;
                }
              }
            }
          } catch {
            items = parseCatalogCsv(text);
          }
        }
      } catch (e) {
        console.warn(`[PA Catalog Live] Error:`, e);
      }
    }
  }

  // Attempt 3: Extract full product list from order history (PROVEN WORKING approach)
  // The order sync works perfectly — so we can use 6 months of orders to build the catalog
  // Attempt 3: Build catalog from EXISTING pa_orders data in database
  // The order sync already stores line items — no need to re-scrape
  if (items.length === 0) {
    console.log(`[PA Catalog Live] All API endpoints failed. Building catalog from existing pa_orders data...`);
    
    const { data: orders } = await supabase
      .from('pa_orders')
      .select('items')
      .eq('location_id', locationId)
      .not('items', 'eq', '[]')
      .order('order_date', { ascending: false })
      .limit(100);

    if (orders?.length) {
      const productMap = new Map<string, any>();
      for (const order of orders) {
        const orderItems = Array.isArray(order.items) ? order.items : [];
        for (const li of orderItems) {
          const id = li.pa_product_id || li.item_code || '';
          if (id && !productMap.has(id) && li.name) {
            const parsedPack = parsePackFromName(li.name);
            productMap.set(id, {
              pa_item_id: id,
              description: li.name,
              pack_size: parsedPack.packSize || li.pack_size || null,
              category: 'Produce',
              unit_price: parseFloat(li.price || 0) || null,
            });
          }
        }
      }
      items = Array.from(productMap.values());
      console.log(`[PA Catalog Live] Built catalog from ${orders.length} existing orders: ${items.length} unique items`);
    }
  }

  // ── FALLBACK: Try GET-based download endpoints ──
  if (items.length === 0) {
    const fallbackUrls = [
      `${PA_BASE_URL}/api/reports/weekly-prices?restaurantId=${session.restaurantId}`,
      `${PA_BASE_URL}/api/reports/restaurant-weekly-produce-prices?restaurantId=${session.restaurantId}`,
      `${PA_BASE_URL}/api/restaurant-dashboard/fetch-products-for-restaurant?restaurantId=${session.restaurantId}`,
      `${PA_BASE_URL}/api/restaurant-dashboard/products?restaurantId=${session.restaurantId}`,
    ];

    for (const url of fallbackUrls) {
      if (items.length > 0) break;
      console.log(`[PA Catalog Live] Trying fallback: ${url.replace(PA_BASE_URL, '')}`);
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: getAuthHeaders(session),
        });
        const text = await resp.text();
        console.log(`[PA Catalog Live] ${resp.status}, ${text.length} chars, preview: ${text.substring(0, 300)}`);

        if (resp.status === 200 && text.length > 50) {
          // Try JSON
          try {
            const json = JSON.parse(text);
            const arr = Array.isArray(json) ? json : json.data || json.items || json.dataList || json.products || [];
            if (Array.isArray(arr) && arr.length > 0) {
              console.log(`[PA Catalog Live] JSON keys sample:`, Object.keys(arr[0]).join(', '));
              items = arr.map((r: any) => ({
                pa_item_id: String(r.paProductId || r.productId || r.itemId || r.id || r.masterProductCode || ''),
                description: r.masterProductName || r.productName || r.description || r.name || '',
                pack_size: r.packSize || r.pack || null,
                category: r.category || r.productCategory || 'Produce',
                unit_price: parseFloat(r.price || r.unitPrice || r.cost || 0) || null,
              })).filter((i: any) => i.pa_item_id && i.description);
              if (items.length > 0) {
                console.log(`[PA Catalog Live] ✅ Found ${items.length} items from ${url.replace(PA_BASE_URL, '')}`);
              }
            }
          } catch {
            // Try CSV
            items = parseCatalogCsv(text);
            if (items.length > 0) {
              console.log(`[PA Catalog Live] ✅ CSV parsed ${items.length} items from fallback`);
            }
          }
        }
      } catch (e) {
        console.warn(`[PA Catalog Live] Fallback error:`, e);
      }
    }
  }

  // ── LAST RESORT: JSP pages (may work if session is strong enough) ──
  if (items.length === 0) {
    console.log(`[PA Catalog Live] All API endpoints failed, trying JSP fallback...`);
    const jspUrls = [
      `${PA_BASE_URL}/reports/restaurantWeeklyProducePricesReport.jsp?restaurantId=${session.restaurantId}`,
      `${PA_BASE_URL}/restaurantOrderSort.jsp?restaurantId=${session.restaurantId}`,
    ];
    for (const url of jspUrls) {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: { ...getAuthHeaders(session), 'Accept': 'text/html,application/xhtml+xml,*/*' },
          redirect: 'follow',
        });
        const html = await resp.text();
        if (resp.status === 200 && !html.includes('j_security_check') && !html.includes('Sign in') && html.length > 500) {
          items = url.includes('OrderSort') ? parseOrderSortHtml(html) : parseWeeklyPricesHtml(html);
          if (items.length > 0) {
            console.log(`[PA Catalog Live] ✅ JSP fallback found ${items.length} items`);
            break;
          }
        }
      } catch (e) {
        console.warn('[PA Catalog Live] JSP fallback error:', e);
      }
    }
  }

  if (items.length === 0) {
    return jsonResponse({ success: true, message: 'No items found from any endpoint — check logs for API response details', saved: 0 });
  }

  // Save to pa_catalog_items
  const now = new Date().toISOString();
  let saved = 0;
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50).map(item => ({
      location_id: locationId,
      pa_item_id: item.pa_item_id,
      description: item.description,
      pack_size: item.pack_size,
      category: item.category,
      unit_price: item.unit_price,
      last_seen_at: now,
    }));

    const { error } = await supabase
      .from('pa_catalog_items')
      .upsert(chunk, { onConflict: 'location_id,pa_item_id' });

    if (error) {
      console.error('[PA Catalog Live] Upsert error:', error);
    } else {
      saved += chunk.length;
    }
  }

  console.log(`[PA Catalog Live] ✅ Saved ${saved} items for location ${locationId}`);
  return jsonResponse({ success: true, saved, total: items.length });
}

// ── Scrape all PA locations' catalogs (called by GitHub Action) ──
async function handleScrapeAllCatalogs(supabase: any, _body: any): Promise<Response> {
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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }

    const action = body.action || 'test';
    console.log('[PA Service] Action:', action, 'locationId:', body.locationId);

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
