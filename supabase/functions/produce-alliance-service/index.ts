import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const PA_BASE_URL = 'https://producealliance.info';
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

    // Step 2: Try OAuth2 token endpoints (Spring Security OAuth2 standard)
    const oauthAttempts = [
      // Standard Spring OAuth2
      `${PA_BASE_URL}/oauth/token`,
      // Common alternatives
      `${PA_BASE_URL}/api/oauth/token`,
      `${PA_BASE_URL}/api/auth/token`,
      `${PA_BASE_URL}/api/authenticate`,
      `${PA_BASE_URL}/api/login`,
    ];

    for (const tokenUrl of oauthAttempts) {
      // Try form-encoded password grant (most common Spring OAuth2 pattern)
      try {
        console.log('[PA Auth] Trying OAuth2:', tokenUrl);
        const formBody = `grant_type=password&username=${encodeURIComponent(credentials.username)}&password=${encodeURIComponent(credentials.password)}`;
        
        const resp = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
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
        console.log('[PA Auth]', tokenUrl, '→', resp.status, 'len:', text.length);

        if (resp.status === 200 && text.length > 10) {
          try {
            const json = JSON.parse(text);
            if (json.access_token) {
              console.log('[PA Auth] ✅ OAuth2 login successful! Token type:', json.token_type || 'bearer');
              return {
                accessToken: json.access_token,
                refreshToken: json.refresh_token || '',
                cookies: allCookies,
                restaurantId,
              };
            }
          } catch { /* not JSON */ }
        }
      } catch (e) {
        console.warn('[PA Auth] Error with', tokenUrl, ':', e);
      }

      // Also try JSON body variant
      try {
        const resp = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': allCookies,
            'User-Agent': UA,
            'Accept': 'application/json, */*',
            'Referer': `${PA_BASE_URL}/ng/`,
          },
          body: JSON.stringify({
            username: credentials.username,
            password: credentials.password,
            grant_type: 'password',
          }),
          redirect: 'manual',
        });

        const newCookies = extractCookies(resp.headers);
        if (newCookies) allCookies = mergeCookies(allCookies, newCookies);
        
        const text = await resp.text();
        console.log('[PA Auth] JSON variant', tokenUrl, '→', resp.status, 'len:', text.length);

        if (resp.status === 200 && text.length > 10) {
          try {
            const json = JSON.parse(text);
            if (json.access_token) {
              console.log('[PA Auth] ✅ OAuth2 login successful (JSON)! Token type:', json.token_type || 'bearer');
              return {
                accessToken: json.access_token,
                refreshToken: json.refresh_token || '',
                cookies: allCookies,
                restaurantId,
              };
            }
            // Some APIs return token in different field
            if (json.token || json.sessionToken || json.jwt) {
              const token = json.token || json.sessionToken || json.jwt;
              console.log('[PA Auth] ✅ Login successful (alt token field)');
              return {
                accessToken: token,
                refreshToken: json.refresh_token || json.refreshToken || '',
                cookies: allCookies,
                restaurantId,
              };
            }
          } catch { /* not JSON */ }
        }
      } catch (e) {
        console.warn('[PA Auth] JSON error with', tokenUrl, ':', e);
      }
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

        if ((status === 302 || status === 301) && !location.includes('login') && !location.includes('error')) {
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

// Build auth headers for API requests
function getAuthHeaders(session: PASession): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Referer': `${PA_BASE_URL}/ng/`,
  };
  
  if (session.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }
  if (session.cookies) {
    headers['Cookie'] = session.cookies;
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

  // Try the actual Buyers Edge REST API first (discovered from DevTools)
  const restApiAttempts = [
    // Primary: POST with filter params (Angular app uses this)
    {
      url: `${PA_BASE_URL}/api/restaurant-dashboard/fetch-orders-for-restaurant-by-params`,
      method: 'POST',
      body: JSON.stringify({
        restaurantId: parseInt(session.restaurantId) || session.restaurantId,
        startDate,
        endDate,
        includeOnlySubmit: false,
      }),
      contentType: 'application/json',
    },
    // Alt: query params  
    {
      url: `${PA_BASE_URL}/api/restaurant-dashboard/fetch-orders-for-restaurant-by-params?restaurantId=${session.restaurantId}&startDate=${startDate}&endDate=${endDate}`,
      method: 'GET',
      body: null,
      contentType: null,
    },
    // Alt: different endpoint naming
    {
      url: `${PA_BASE_URL}/api/orders?restaurantId=${session.restaurantId}&startDate=${startDate}&endDate=${endDate}`,
      method: 'GET',
      body: null,
      contentType: null,
    },
  ];

  for (const attempt of restApiAttempts) {
    try {
      const headers: Record<string, string> = { ...authHeaders };
      if (attempt.contentType) headers['Content-Type'] = attempt.contentType;
      
      const resp = await fetch(attempt.url, {
        method: attempt.method,
        headers,
        body: attempt.body,
        redirect: 'follow',
      });

      const text = await resp.text();
      console.log('[PA Orders]', attempt.method, attempt.url.replace(PA_BASE_URL, ''), '→', resp.status, 'len:', text.length);

      if (!resp.ok || text.length < 10) continue;

      try {
        const data = JSON.parse(text);
        console.log('[PA Orders] JSON response keys:', Object.keys(data).join(', '));
        
        const orders = extractOrdersFromJson(data);
        if (orders.length > 0) {
          console.log('[PA Orders] ✅ Found', orders.length, 'orders from REST API');
          return orders;
        }
        
        // Even if 0 orders, if we got a valid JSON response the endpoint works
        if (Array.isArray(data) || data.data || data.orders) {
          console.log('[PA Orders] Valid API response but 0 orders in range');
          return [];
        }
      } catch {
        console.log('[PA Orders] Response not JSON');
      }
    } catch (e) {
      console.warn('[PA Orders] Error:', e);
    }
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
  // Handle various JSON structures
  const items = Array.isArray(data) ? data : data.data || data.orders || data.Data || data.Orders || [];
  if (!Array.isArray(items)) return [];
  
  console.log('[PA Orders] JSON keys:', Object.keys(Array.isArray(data) ? (data[0] || {}) : data).join(', '));
  if (items[0]) console.log('[PA Orders] Sample item keys:', Object.keys(items[0]).join(', '));

  return items.map((o: any) => ({
    webOrderId: String(o.webOrderId || o.WebOrderId || o.orderId || o.OrderId || o.id || o.Id || ''),
    orderDate: o.orderDate || o.OrderDate || o.dateCreated || o.DateCreated || '',
    deliveryDate: o.deliveryDate || o.DeliveryDate || null,
    status: o.status || o.Status || 'unknown',
    totalAmount: o.totalAmount || o.TotalAmount || o.orderTotal || o.OrderTotal || o.total || null,
    totalCases: o.totalCases || o.TotalCases || null,
  })).filter((o: PAOrderSummary) => o.webOrderId);
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

async function fetchOrderDetail(session: PASession, webOrderId: string, startDate: string, endDate: string): Promise<PAOrderDetail | null> {
  console.log('[PA Detail] Fetching order:', webOrderId);

  const authHeaders = getAuthHeaders(session);

  // Try REST API first
  try {
    const apiResp = await fetch(`${PA_BASE_URL}/api/restaurant-dashboard/fetch-order-detail`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ webOrderId, restaurantId: parseInt(session.restaurantId) || session.restaurantId }),
    });
    
    if (apiResp.ok) {
      const text = await apiResp.text();
      try {
        const json = JSON.parse(text);
        console.log('[PA Detail] Got JSON detail for order', webOrderId, 'keys:', Object.keys(json).join(', '));
        // If the API returns structured order data, parse it
        if (json.lineItems || json.items || json.orderLines || json.data) {
          const items = json.lineItems || json.items || json.orderLines || json.data?.lineItems || [];
          return {
            webOrderId,
            deliveryDate: json.deliveryDate || json.delivery_date || null,
            totalCases: json.totalCases || json.total_cases || null,
            totalAmount: json.totalAmount || json.total_amount || json.orderTotal || null,
            lineItems: Array.isArray(items) ? items.map((li: any) => ({
              item_code: String(li.itemCode || li.item_code || li.productCode || ''),
              description: li.description || li.name || li.productName || '',
              pa_product_id: String(li.paProductId || li.pa_product_id || li.productId || ''),
              unit_price: parseFloat(li.unitPrice || li.unit_price || li.price || 0),
              quantity: parseFloat(li.quantity || li.qty || 0),
              cost: parseFloat(li.cost || li.total || li.lineTotal || 0),
            })) : [],
          };
        }
      } catch { /* not JSON */ }
    } else {
      await apiResp.text().catch(() => '');
    }
  } catch (e) {
    console.warn('[PA Detail] REST API error:', e);
  }

  // Fallback: JSP scraping
  const url = `${PA_BASE_URL}/viewOrder.jsp?webOrderId=${webOrderId}&startDate=${startDate}&endDate=${endDate}&restaurantId=${session.restaurantId}&includeOnlySubmit=false`;

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: authHeaders,
      redirect: 'follow',
    });

    if (!resp.ok) {
      console.warn('[PA Detail] HTTP', resp.status, 'for order', webOrderId);
      await resp.text().catch(() => '');
      return null;
    }

    const html = await resp.text();
    console.log('[PA Detail] Got HTML for order', webOrderId, 'len:', html.length);

    if (html.includes('Sign in') || html.includes('j_security_check')) {
      console.warn('[PA Detail] Session expired — got login page');
      return null;
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
    
    // Check if this table has the expected headers
    if (!tableHtml.includes('PA Product ID') && !tableHtml.includes('Unit Price') && !tableHtml.includes('Description')) {
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

      // Expected columns: Item(0), Description(1), PA Product ID(2), Unit Price(3), Quantity(4), Cost(5)
      if (cells.length >= 6) {
        const unitPrice = parseFloat(cells[3]?.replace(/[$,]/g, '') || '0');
        const quantity = parseFloat(cells[4] || '0');
        const cost = parseFloat(cells[5]?.replace(/[$,]/g, '') || '0');

        if (cells[0] && cells[1] && (quantity > 0 || cost > 0)) {
          lineItems.push({
            item_code: cells[0],
            description: cells[1],
            pa_product_id: cells[2] || '',
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
        // Check if first cell looks like an item code (numeric)
        const itemCode = cells[0];
        if (/^\d{3,}$/.test(itemCode)) {
          const prices = cells.filter(c => /^\d+\.?\d*$/.test(c));
          if (prices.length >= 2) {
            lineItems.push({
              item_code: itemCode,
              description: cells[1],
              pa_product_id: cells[2] || '',
              unit_price: parseFloat(prices[0]) || 0,
              quantity: parseFloat(prices[1]) || 0,
              cost: parseFloat(prices[2] || prices[0]) || 0,
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
// PRICING — parse weekly pricing from the portal
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

  const countSlashWeight = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*#(?!\d)/);
  if (countSlashWeight) {
    const qty = parseInt(countSlashWeight[1]);
    return { packSize: `${qty}/${countSlashWeight[2]}#`, packQuantity: qty };
  }
  const countCan = trimmed.match(/(\d+)\/#(\d+)/);
  if (countCan) {
    const qty = parseInt(countCan[1]);
    return { packSize: `${qty}/#${countCan[2]}`, packQuantity: qty };
  }
  const countSlashLb = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*(?:LB|lb)/);
  if (countSlashLb) {
    const qty = parseInt(countSlashLb[1]);
    return { packSize: `${qty}/${countSlashLb[2]} LB`, packQuantity: qty };
  }
  const nCt = trimmed.match(/(\d+)\s*CT\b/i);
  if (nCt) {
    const qty = parseInt(nCt[1]);
    return { packSize: `${qty} CT`, packQuantity: qty };
  }
  const standalone = trimmed.match(/\b(\d+(?:\.\d+)?)\s*#(?!\d)/);
  if (standalone) return { packSize: `${standalone[1]}#`, packQuantity: 1 };
  const nLb = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:lb|LB)\b/);
  if (nLb) return { packSize: `${nLb[1]} LB`, packQuantity: 1 };

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

  // Get items from recent orders (the Buyers Edge portal shows items via orders)
  const now = new Date();
  const startDate = `${now.getFullYear()}-${now.getMonth()}-${now.getDate() - 30}`;
  const endDate = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  
  const orders = await fetchOrderList(session, startDate, endDate);
  
  // Also try pricing
  const pricing = await fetchPAPricing(session);
  
  // Collect unique items from pricing
  const items = pricing.length > 0 ? pricing : [];

  return jsonResponse({ success: true, data: { items, count: items.length, orderCount: orders.length } });
}

async function handleOrders(supabase: any, body: any): Promise<Response> {
  const { locationId, startDate, endDate, fetchDetails = true, maxDetails = 10 } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  // Calculate date range
  const now = new Date();
  const sd = startDate || `${now.getFullYear()}-${now.getMonth()}-1`;
  const ed = endDate || `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

  const orderList = await fetchOrderList(session, sd, ed);
  console.log('[PA Orders] Got', orderList.length, 'orders in range');

  // Fetch details for orders
  const orderDetails: PAOrderDetail[] = [];
  if (fetchDetails && orderList.length > 0) {
    const toFetch = orderList.slice(0, maxDetails);
    for (const order of toFetch) {
      const detail = await fetchOrderDetail(session, order.webOrderId, sd, ed);
      if (detail) {
        orderDetails.push(detail);
        // Brief pause to avoid hammering
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  // Persist to pa_orders
  let persisted = 0;
  for (const detail of orderDetails) {
    const items = detail.lineItems.map(li => ({
      name: li.description,
      item_code: li.item_code,
      pa_product_id: li.pa_product_id,
      quantity: li.quantity,
      unit: 'case',
      price: li.unit_price,
      total: li.cost,
    }));

    const { error } = await supabase
      .from('pa_orders')
      .upsert({
        location_id: locationId,
        pa_order_id: detail.webOrderId,
        order_number: detail.webOrderId,
        order_date: detail.deliveryDate || new Date().toISOString().split('T')[0],
        delivery_date: detail.deliveryDate,
        status: 'delivered',
        total_amount: detail.totalAmount,
        items,
        raw_data: detail,
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

  // Fetch recent orders to get latest items and prices
  const now = new Date();
  const startDate = `${now.getFullYear()}-${now.getMonth()}-1`;
  const endDate = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  
  const orderList = await fetchOrderList(session, startDate, endDate);
  
  // Fetch details for recent orders
  const allItems = new Map<string, PALineItem>();
  let ordersProcessed = 0;
  
  for (const order of orderList.slice(0, 5)) {
    const detail = await fetchOrderDetail(session, order.webOrderId, startDate, endDate);
    if (detail) {
      for (const li of detail.lineItems) {
        // Use pa_product_id as unique key
        allItems.set(li.pa_product_id || li.item_code, li);
      }
      ordersProcessed++;
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Also try pricing
  const pricing = await fetchPAPricing(session);
  
  console.log('[PA Sync] Got', allItems.size, 'unique items from', ordersProcessed, 'orders,', pricing.length, 'from pricing');

  if (allItems.size === 0 && pricing.length === 0) {
    await updateSyncLog(supabase, syncLogId, 'completed', 0, 0, [], { message: 'No items found' });
    return jsonResponse({ success: true, message: 'No items found', synced: 0 });
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
  const sd = startDate || `${now.getFullYear()}-${now.getMonth()}-1`;
  const ed = endDate || `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

  const detail = await fetchOrderDetail(session, webOrderId, sd, ed);
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
