import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ============================================================================
// PRODUCE ALLIANCE SERVICE
// Actions: test, items, orders, sync_items, save_credentials
// Portal: https://pos.producealliance.com
// Auth: username/password form login → cookie session
// AJAX endpoints discovered: GetInvoiceProducts, GetInvoices, VerifyOrderGuideByLocation
// ============================================================================

const PA_BASE_URL = 'https://pos.producealliance.com';

interface PACredentials {
  username: string;
  password: string;
  pa_location_id?: string;
}

interface PASession {
  cookies: string;
  locationId: string;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

async function loginToPA(credentials: PACredentials): Promise<PASession | null> {
  console.log('[PA Auth] Logging in as:', credentials.username);

  try {
    // Step 1: GET login page for anti-forgery token + cookies
    const loginPageResp = await fetch(`${PA_BASE_URL}/account/login`, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    const loginPageHtml = await loginPageResp.text();
    const loginCookies = extractCookies(loginPageResp.headers);
    
    let verificationToken = '';
    const tokenMatch = loginPageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    if (tokenMatch) verificationToken = tokenMatch[1];

    // Step 2: POST credentials
    const formData = new URLSearchParams();
    formData.append('Username', credentials.username);
    formData.append('Password', credentials.password);
    if (verificationToken) formData.append('__RequestVerificationToken', verificationToken);

    const loginResp = await fetch(`${PA_BASE_URL}/Account/Login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': loginCookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${PA_BASE_URL}/account/login`,
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    const postCookies = extractCookies(loginResp.headers);
    const allCookies = mergeCookies(loginCookies, postCookies);
    console.log('[PA Auth] Login response status:', loginResp.status);

    if (loginResp.status === 302 || loginResp.status === 301) {
      const redirectUrl = loginResp.headers.get('location') || '';
      console.log('[PA Auth] Login successful, redirect to:', redirectUrl);

      const redirectResp = await fetch(
        redirectUrl.startsWith('http') ? redirectUrl : `${PA_BASE_URL}${redirectUrl}`,
        {
          method: 'GET',
          headers: { 'Cookie': allCookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          redirect: 'manual',
        }
      );
      const finalCookies = mergeCookies(allCookies, extractCookies(redirectResp.headers));
      await redirectResp.text().catch(() => '');

      return { cookies: finalCookies, locationId: credentials.pa_location_id || '18046' };
    }

    if (loginResp.status === 200) {
      const body = await loginResp.text();
      if (body.includes('Invalid') || body.includes('Login to get started')) {
        console.error('[PA Auth] Login failed — invalid credentials');
        return null;
      }
      return { cookies: allCookies, locationId: credentials.pa_location_id || '18046' };
    }

    await loginResp.text().catch(() => '');
    return null;
  } catch (error) {
    console.error('[PA Auth] Login error:', error);
    return null;
  }
}

function extractCookies(headers: Headers): string {
  // Deno doesn't support getAll on Headers, use workaround
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
// DATA FETCHING — AJAX endpoints
// ============================================================================

async function fetchPAItems(session: PASession): Promise<any[]> {
  console.log('[PA API] Fetching Order Guide items, location:', session.locationId);

  // Load ordering page first to establish session state
  const homeResp = await fetch(`${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`, {
    method: 'GET',
    headers: {
      'Cookie': session.cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });
  const homeHtml = await homeResp.text();
  if (homeHtml.includes('Login to get started')) {
    throw new Error('PA session expired');
  }
  const updatedCookies = mergeCookies(session.cookies, extractCookies(homeResp.headers));

  // Strategy: Use the PRICING PAGE as the source of truth for Order Guide items.
  // The pricing page returns exactly the items on the Order Guide (LineCount matches).
  // GetInvoiceProducts returns the FULL catalog (all 58+ items) which includes items
  // not on the order guide. The pricing page is the most reliable filter.
  
  // First get pricing items (= order guide items with actual data)
  const pricingItems = await fetchPAPricing(session);
  
  if (pricingItems.length > 0) {
    console.log(`[PA API] Using ${pricingItems.length} items from pricing page (= Order Guide items)`);
    // The pricing page items are the order guide items - normalize and return them
    return pricingItems.map((p: any) => ({
      id: p.id,
      name: p.name,
      unit: p.unit?.toLowerCase() || 'case',
      price: p.price,
      itemNumber: p.itemNumber || null,
      brand: p.brand || null,
      packSize: p.packSize || null,
      packQuantity: p.packQuantity || null,
      category: p.category || null,
      imageUrl: null,
    }));
  }

  // Fallback: if pricing page fails, use AJAX catalog 
  console.log('[PA API] Pricing page returned 0 items, falling back to AJAX catalog fetch');
  return await fetchPAItemsAjax(session, updatedCookies);
}

function parseOrderGuideHtml(html: string): any[] {
  const items: any[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let rowCount = 0;
  
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(tdMatch[1].trim());
    }
    if (cells.length < 4) continue;
    rowCount++;
    
    const displayHtml = cells[1];
    const isDisplayed = /checked/i.test(displayHtml);
    let productId = cells[2].replace(/<[^>]*>/g, '').trim();
    let description = cells[3].replace(/<[^>]*>/g, '').trim();
    
    if (!productId || !description || /^PA Product/i.test(productId) || /^Description$/i.test(description)) continue;
    if (!isDisplayed) continue;
    
    items.push({ id: productId, name: description, unit: 'case', itemNumber: productId });
  }
  
  console.log(`[PA API] Order Guide parse: ${rowCount} total rows, ${items.length} displayed items`);
  return items;
}

// Fallback AJAX catalog fetch (old method)
async function fetchPAItemsAjax(session: PASession, cookies: string): Promise<any[]> {
  const baseHeaders: Record<string, string> = {
    'Cookie': cookies,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': `${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`,
  };

  const attempts = [
    { ct: 'application/json', body: JSON.stringify({ locationId: session.locationId, DDLLocationID: session.locationId }) },
    { ct: 'application/x-www-form-urlencoded', body: `DDLLocationID=${session.locationId}&page=1&pageSize=1000` },
    { ct: 'application/x-www-form-urlencoded', body: `sort=&group=&filter=&DDLLocationID=${session.locationId}` },
  ];

  for (const { ct, body } of attempts) {
    try {
      const resp = await fetch(`${PA_BASE_URL}/Ordering/GetInvoiceProducts`, {
        method: 'POST',
        headers: { ...baseHeaders, 'Content-Type': ct },
        body,
        redirect: 'follow',
      });
      if (resp.ok) {
        const text = await resp.text();
        const result = tryParseItems(text, 'GetInvoiceProducts');
        if (result.length > 0) return result;
      } else {
        await resp.text().catch(() => '');
      }
    } catch (e) {
      console.warn('[PA API] AJAX fallback error:', e);
    }
  }
  return [];
}

function tryParseItems(text: string, source: string): any[] {
  try {
    const data = JSON.parse(text);
    console.log(`[PA API] ${source} JSON keys:`, Object.keys(data).join(', '));

    // Direct array
    if (Array.isArray(data) && data.length > 0) {
      logSampleItem(data[0], source);
      return data.map(normalizeItem);
    }

    // Kendo format { Data: [...], Total: N }
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        console.log(`[PA API] Found ${data[key].length} items at ${source}.${key}`);
        logSampleItem(data[key][0], source);
        return data[key].map(normalizeItem);
      }
    }

    console.log(`[PA API] ${source} response sample:`, JSON.stringify(data).slice(0, 500));
  } catch {
    console.log(`[PA API] ${source} non-JSON, length:`, text.length);
  }
  return [];
}

function logSampleItem(item: any, source: string) {
  console.log(`[PA API] ${source} sample item keys:`, Object.keys(item).join(', '));
  console.log(`[PA API] ${source} sample item:`, JSON.stringify(item).slice(0, 500));
}

// Parse pack size info from item name
// Patterns: "4/5#" → qty=4, size="4/5#"  |  "5#" → qty=1, size="5#"  |  "12 CT" → qty=12, size="12 CT"
// "#10" is a can size, not weight. "6/#10" → qty=6, size="6/#10"
function parsePackFromName(name: string): { packSize: string | null; packQuantity: number | null } {
  if (!name) return { packSize: null, packQuantity: null };
  const trimmed = name.trim();

  // Match count/weight# pattern: "4/5#", "6/2#", "4/1#", "8/1#", "16/1 QT"
  const countSlashWeight = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*#(?!\d)/);
  if (countSlashWeight) {
    const qty = parseInt(countSlashWeight[1]);
    return { packSize: `${qty}/${countSlashWeight[2]}#`, packQuantity: qty };
  }

  // Match count/#10 (can size): "6/#10"
  const countCan = trimmed.match(/(\d+)\/#(\d+)/);
  if (countCan) {
    const qty = parseInt(countCan[1]);
    return { packSize: `${qty}/#${countCan[2]}`, packQuantity: qty };
  }

  // Match count/weight LB: "4/3 LB"
  const countSlashLb = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*(?:LB|lb)/);
  if (countSlashLb) {
    const qty = parseInt(countSlashLb[1]);
    return { packSize: `${qty}/${countSlashLb[2]} LB`, packQuantity: qty };
  }

  // Match count/weight QT: "16/1 QT"
  const countSlashQt = trimmed.match(/(\d+)\/(\d+(?:\.\d+)?)\s*QT/i);
  if (countSlashQt) {
    const qty = parseInt(countSlashQt[1]);
    return { packSize: `${qty}/${countSlashQt[2]} QT`, packQuantity: qty };
  }

  // Match N CT pattern: "12 CT", "24 CT", "3 CT"
  const nCt = trimmed.match(/(\d+)\s*CT\b/i);
  if (nCt) {
    const qty = parseInt(nCt[1]);
    return { packSize: `${qty} CT`, packQuantity: qty };
  }

  // Match N PINT: "12 PINT"
  const nPint = trimmed.match(/(\d+)\s*PINT\b/i);
  if (nPint) {
    const qty = parseInt(nPint[1]);
    return { packSize: `${qty} PINT`, packQuantity: qty };
  }

  // Match standalone weight#: "5#", "10#", "2.5#", "1#" (but NOT dimension like 1/8")
  const standalone = trimmed.match(/\b(\d+(?:\.\d+)?)\s*#(?!\d)/);
  if (standalone) {
    return { packSize: `${standalone[1]}#`, packQuantity: 1 };
  }

  // Match N OZ: "4 OZ", "6 OZ"
  const nOz = trimmed.match(/(\d+(?:\.\d+)?)\s*OZ\b/i);
  if (nOz) {
    return { packSize: `${nOz[1]} OZ`, packQuantity: 1 };
  }

  return { packSize: null, packQuantity: null };
}

function normalizeItem(raw: any): any {
  const name = (raw.PADescription || raw.Description || raw.Name || raw.ProductName || raw.ProductDescription || raw.name || raw.ItemName || '').trim();
  const parsed = parsePackFromName(name);
  
  return {
    id: raw.PAProductID || raw.Id || raw.ItemId || raw.ProductId || raw.ProductID || raw.id || raw.InvoiceProductID || '',
    name,
    itemNumber: raw.ItemNumber || raw.ProductNumber || raw.ItemNo || raw.Code || raw.itemNumber || raw.ProductCode || raw.SpecificationID || null,
    brand: raw.Brand || raw.BrandName || raw.brand || null,
    price: raw.Price || raw.UnitPrice || raw.CurrentPrice || raw.price || raw.Cost || raw.ExtPrice || raw.LastPrice || null,
    unit: raw.Unit || raw.UOM || raw.UnitOfMeasure || raw.unit || raw.Pack || 'case',
    packSize: raw.PackSize || raw.Size || raw.PackDescription || raw.packSize || raw.Sizing || raw.SizeDiameter || parsed.packSize || null,
    packQuantity: parsed.packQuantity || null,
    category: raw.Category || raw.CategoryName || raw.GroupName || raw.category || raw.ProductCategory || raw.StorageZone || null,
    imageUrl: raw.ImageURL || raw.imageUrl || null,
    variety: raw.Variety || null,
  };
}

// ============================================================================
// ORDER HISTORY — /Ordering/GetInvoices
// ============================================================================

async function fetchPAOrders(session: PASession): Promise<any[]> {
  console.log('[PA API] Fetching invoices/orders');

  // First load the ordering page to establish session state
  const pageResp = await fetch(`${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`, {
    method: 'GET',
    headers: {
      'Cookie': session.cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });
  const pageHtml = await pageResp.text();
  const updatedCookies = mergeCookies(session.cookies, extractCookies(pageResp.headers));

  // Log order/invoice related AJAX endpoints from the page JS
  const ajaxUrlRegex = /url[:\s]*["']([^"']*(?:order|invoice|Order|Invoice)[^"']*)["']/gi;
  const foundEndpoints: string[] = [];
  let m;
  while ((m = ajaxUrlRegex.exec(pageHtml)) !== null) {
    if (!foundEndpoints.includes(m[1])) foundEndpoints.push(m[1]);
  }
  console.log('[PA API] Found order/invoice endpoints:', JSON.stringify(foundEndpoints));

  // Also look for the order/invoice table setup 
  const orderTableRegex = /(?:tblorder|tblinvoice|storeHomeOrder|storeHomeInvoice|GetOrder|GetInvoice)[^;]{0,500}/gi;
  const orderTableMatches: string[] = [];
  while ((m = orderTableRegex.exec(pageHtml)) !== null) {
    orderTableMatches.push(m[0].replace(/\s+/g, ' ').trim().slice(0, 200));
  }
  console.log('[PA API] Order/invoice table JS:', JSON.stringify(orderTableMatches.slice(0, 10)));

  // Use the correct partial data endpoints discovered from page JS
  const endpoints = [
    { url: '/Ordering/GetOrdersPartialData', body: `locationid=${session.locationId}` },
    { url: '/Ordering/GetInvoicesPartialData', body: `locationid=${session.locationId}` },
    { url: '/Ordering/GetInvoices', body: `DDLLocationID=${session.locationId}` },
    { url: '/Ordering/GetOrders', body: `DDLLocationID=${session.locationId}` },
  ];

  for (const endpoint of endpoints) {
    try {
      console.log('[PA API] Trying', endpoint.url);
      const resp = await fetch(`${PA_BASE_URL}${endpoint.url}`, {
        method: 'POST',
        headers: {
          'Cookie': updatedCookies,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': `${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`,
        },
        body: endpoint.body,
        redirect: 'follow',
      });

      const text = await resp.text();
      console.log('[PA API]', endpoint.url, '→', resp.status, 'len:', text.length);
      
      if (resp.ok && text.length > 5) {
        try {
          const data = JSON.parse(text);
          console.log('[PA API]', endpoint.url, 'keys:', Object.keys(data).join(', '));
          
          const items = data.Data || data.data || data.Invoices || data.Orders || data;
          if (Array.isArray(items) && items.length > 0) {
            console.log('[PA API] Found', items.length, 'from', endpoint.url);
            if (items[0]) console.log('[PA API] Sample:', JSON.stringify(items[0]).slice(0, 500));
            return items;
          }
          
          for (const key of Object.keys(data)) {
            if (Array.isArray(data[key]) && data[key].length > 0) {
              console.log('[PA API] Found', data[key].length, 'at', key);
              return data[key];
            }
          }
          
          console.log('[PA API]', endpoint.url, ':', JSON.stringify(data).slice(0, 300));
        } catch {
          console.log('[PA API]', endpoint.url, 'non-JSON:', text.slice(0, 200));
        }
      }
    } catch (e) {
      console.warn('[PA API]', endpoint.url, 'error:', e);
    }
  }

  return [];
}

// ============================================================================
// PRICING — fetch current prices via PricesDetailPage
// ============================================================================

async function fetchPAPricing(session: PASession): Promise<any[]> {
  try {
    console.log('[PA Pricing] Starting pricing fetch for location:', session.locationId);
    
    // Load ordering page first
    const pageResp = await fetch(`${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`, {
      method: 'GET',
      headers: { 'Cookie': session.cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    await pageResp.text();
    const updatedCookies = mergeCookies(session.cookies, extractCookies(pageResp.headers));

    // Get price list dates
    const priceListResp = await fetch(`${PA_BASE_URL}/Ordering/GetPriceListPartialData`, {
      method: 'POST',
      headers: {
        'Cookie': updatedCookies,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`,
      },
      body: `locationid=${session.locationId}`,
    });

    console.log('[PA Pricing] GetPriceListPartialData status:', priceListResp.status);
    if (!priceListResp.ok) {
      console.log('[PA Pricing] Failed to fetch price list dates');
      return [];
    }
    const priceListData = await priceListResp.json();
    const priceDates = priceListData.Data || priceListData.data || [];
    console.log('[PA Pricing] Price dates count:', priceDates.length);
    if (!Array.isArray(priceDates) || priceDates.length === 0) return [];

    const dateBegin = priceDates[0].DateBegin || priceDates[0].dateBegin;
    console.log('[PA Pricing] Using date:', dateBegin);

    // Fetch pricing HTML page
    const pricingResp = await fetch(
      `${PA_BASE_URL}/Ordering/PricesDetailPage?date=${encodeURIComponent(dateBegin)}&locationid=${session.locationId}&download=false`,
      {
        method: 'GET',
        headers: { 'Cookie': updatedCookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        redirect: 'follow',
      }
    );

    console.log('[PA Pricing] PricesDetailPage status:', pricingResp.status);
    if (!pricingResp.ok) {
      console.log('[PA Pricing] PricesDetailPage failed');
      return [];
    }
    const html = await pricingResp.text();
    console.log('[PA Pricing] HTML length:', html.length, 'first 500:', html.slice(0, 500).replace(/\s+/g, ' '));
    const items = parsePricingHtml(html);
    console.log('[PA Pricing] Parsed', items.length, 'items from pricing HTML');
    if (items.length > 0) {
      console.log('[PA Pricing] Sample parsed item:', JSON.stringify(items[0]));
    }
    return items;
  } catch (e) {
    console.warn('[PA Pricing] Error fetching pricing:', e);
    return [];
  }
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function handleTest(supabase: any, body: any): Promise<Response> {
  const { locationId, testCredentials } = body;
  
  // Use testCredentials if provided (for testing before saving), otherwise fetch from DB
  let credentials: PACredentials | null = null;
  if (testCredentials?.username && testCredentials?.password) {
    credentials = { username: testCredentials.username, password: testCredentials.password, pa_location_id: testCredentials.pa_location_id };
  } else {
    credentials = await getCredentials(supabase, locationId);
  }
  
  if (!credentials) return jsonResponse({ authenticated: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ authenticated: false, error: 'Login failed — check credentials' });

  return jsonResponse({ authenticated: true, success: true, message: 'Produce Alliance connection successful!' });
}

async function handleItems(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const items = await fetchPAItems(session);

  // Also fetch current pricing and merge
  const pricing = await fetchPAPricing(session);
  if (pricing.length > 0) {
    const priceMapById = new Map(pricing.map((p: any) => [String(p.id), p]));
    const priceMapByName = new Map(pricing.map((p: any) => [p.name?.toUpperCase()?.trim(), p]));
    for (const item of items) {
      const priceInfo = priceMapById.get(String(item.id)) || priceMapByName.get(item.name?.toUpperCase()?.trim());
      if (priceInfo) {
        item.price = priceInfo.price;
        item.unit = priceInfo.unit?.toLowerCase() || item.unit;
      }
    }
  }

  return jsonResponse({ success: true, data: { items, count: items.length } });
}

// Helper: persist PA orders to pa_orders table
async function persistPAOrders(supabase: any, locationId: string, rawOrders: any[], parseMSDate: (d: string | null) => string | null) {
  let persisted = 0;
  for (const order of rawOrders) {
    const orderId = order.OrderID;
    if (!orderId) continue;

    const orderDate = parseMSDate(order.DateCreated);
    if (!orderDate) continue;

    const deliveryDate = parseMSDate(order.DeliveryDate);
    const lineItems = (order.OrderDetails || []).map((item: any) => ({
      name: item.ProductName || item.Name || item.Description,
      quantity: item.Quantity || item.Qty || 0,
      unit: item.UOM || item.Unit || 'CS',
      price: item.Price || item.UnitPrice || 0,
      total: item.ExtendedPrice || item.Total || item.Amount || 0,
    }));

    const { error } = await supabase
      .from('pa_orders')
      .upsert({
        location_id: locationId,
        pa_order_id: String(orderId),
        order_number: order.OrderNumber || String(orderId),
        order_date: orderDate.split('T')[0],
        delivery_date: deliveryDate ? deliveryDate.split('T')[0] : null,
        status: order.Status || 'delivered',
        total_amount: order.OrderTotal || null,
        items: lineItems,
        raw_data: order,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'location_id,pa_order_id' });

    if (!error) persisted++;
  }
  console.log(`[PA Orders] Persisted ${persisted} of ${rawOrders.length} orders for location ${locationId}`);
  return persisted;
}

async function handleOrders(supabase: any, body: any): Promise<Response> {
  const { locationId, fetchDetails } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const rawOrders = await fetchPAOrders(session);
  
  // Parse MS date format /Date(timestamp)/
  const parseMSDate = (d: string | null) => {
    if (!d) return null;
    const match = d.match(/\/Date\((\d+)\)\//);
    return match ? new Date(parseInt(match[1])).toISOString() : null;
  };

  // Persist orders to pa_orders table
  const persistedCount = await persistPAOrders(supabase, locationId, rawOrders, parseMSDate);

  const orders = rawOrders.map((o: any) => ({
    orderId: o.OrderID,
    orderTotal: o.OrderTotal,
    dateCreated: parseMSDate(o.DateCreated),
    deliveryDate: parseMSDate(o.DeliveryDate),
    hasNote: o.isNote === 'Yes',
    lineItems: o.OrderDetails || [],
  }));

  // Optionally fetch line-item details for recent orders
  if (fetchDetails && orders.length > 0) {
    // Need fresh cookies from the ordering page
    const pageResp = await fetch(`${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`, {
      method: 'GET',
      headers: { 'Cookie': session.cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    await pageResp.text();
    const detailCookies = mergeCookies(session.cookies, extractCookies(pageResp.headers));

    const detailCount = Math.min(orders.length, 5);
    for (let i = 0; i < detailCount; i++) {
      const oid = orders[i].orderId;
      console.log(`[PA API] Fetching detail for order ${oid}`);
      
      // Try multiple URL patterns — the "View" button opens a page like the price list
      const urls = [
        `${PA_BASE_URL}/Ordering/OrderDetail?orderid=${oid}&locationid=${session.locationId}&download=false`,
        `${PA_BASE_URL}/Ordering/OrderDetail?orderid=${oid}&download=false`,
        `${PA_BASE_URL}/Ordering/OrderDetailPage?orderid=${oid}&locationid=${session.locationId}&download=false`,
        `${PA_BASE_URL}/Ordering/InvoiceDetailPage?orderid=${oid}&locationid=${session.locationId}&download=false`,
      ];

      for (const url of urls) {
        try {
          const detailResp = await fetch(url, {
            method: 'GET',
            headers: {
              'Cookie': detailCookies,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': `${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`,
            },
            redirect: 'follow',
          });
          
          console.log(`[PA API] Order detail ${url.split('/Ordering/')[1]?.split('?')[0]} → ${detailResp.status}, len: ${detailResp.headers.get('content-length') || '?'}`);
          
          if (detailResp.ok) {
            const contentType = detailResp.headers.get('content-type') || '';
            const rawBytes = new Uint8Array(await detailResp.arrayBuffer());
            const text = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);
            const isPdf = text.startsWith('%PDF');
            
            console.log(`[PA API] Order ${oid} type: ${contentType}, isPdf: ${isPdf}, len: ${text.length}`);
            
            if (isPdf) {
              // Extract text from PDF streams
              const parsed = await parsePdfOrderDetail(rawBytes);
              if (parsed.length > 0) {
                orders[i].lineItems = parsed;
                console.log(`[PA API] Order ${oid}: ${parsed.length} line items from PDF`);
                break;
              }
            } else {
              console.log(`[PA API] Order ${oid} first 500:`, text.slice(0, 500).replace(/\s+/g, ' '));
              const parsed = parseOrderDetailHtml(text);
              if (parsed.length > 0) {
                orders[i].lineItems = parsed;
                console.log(`[PA API] Order ${oid}: ${parsed.length} line items from HTML`);
                break;
              }
            }
          } else {
            await detailResp.text().catch(() => '');
          }
        } catch (e) {
          console.warn(`[PA API] Detail fetch error for ${oid}:`, e);
        }
      }
    }
  }

  return jsonResponse({ success: true, data: { orders, count: orders.length, persisted: persistedCount } });
}

function parseOrderDetailHtml(html: string): any[] {
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
    // Look for rows with item data (typically: item#, description, qty, unit, price, total)
    if (cells.length >= 4) {
      const qtyVal = parseFloat(cells.find(c => /^\d+\.?\d*$/.test(c)) || '0');
      const priceVal = parseFloat((cells.find(c => /\$/.test(c)) || '').replace(/[$,]/g, ''));
      if (qtyVal > 0 || priceVal > 0) {
        items.push({
          name: cells[1] || cells[0],
          quantity: qtyVal,
          price: priceVal || 0,
          raw: cells,
        });
      }
    }
  }
  return items;
}

// Parse order line items from PDF binary (wkhtmltopdf with FlateDecode streams)
async function parsePdfOrderDetail(bytes: Uint8Array): Promise<any[]> {
  try {
    const rawText = new TextDecoder('latin1').decode(bytes);
    const allTextParts: string[] = [];
    
    // Find and decompress FlateDecode streams
    let searchFrom = 0;
    let streamCount = 0;
    let decompressedCount = 0;
    
    while (true) {
      // Handle both \n and \r\n after "stream"
      let streamIdx = rawText.indexOf('stream\r\n', searchFrom);
      let dataStart = streamIdx === -1 ? -1 : streamIdx + 'stream\r\n'.length;
      if (streamIdx === -1) {
        streamIdx = rawText.indexOf('stream\n', searchFrom);
        dataStart = streamIdx === -1 ? -1 : streamIdx + 'stream\n'.length;
      }
      if (streamIdx === -1) break;
      
      // Find endstream (could be \nendstream or \r\nendstream)
      let endIdx = rawText.indexOf('\r\nendstream', dataStart);
      if (endIdx === -1) endIdx = rawText.indexOf('\nendstream', dataStart);
      if (endIdx === -1) { searchFrom = dataStart; continue; }
      
      streamCount++;
      
      // Check header for FlateDecode
      const headerStart = Math.max(0, streamIdx - 500);
      const header = rawText.slice(headerStart, streamIdx);
      
      if (header.includes('FlateDecode')) {
        const compressedBytes = bytes.slice(dataStart, endIdx);
        console.log(`[PA PDF] Stream ${streamCount}: compressed ${compressedBytes.length} bytes, first 4: ${compressedBytes[0]?.toString(16)} ${compressedBytes[1]?.toString(16)}`);
        try {
          const decompressed = await decompressDeflate(compressedBytes);
          const streamText = new TextDecoder('latin1').decode(decompressed);
          
          // Log first decompressed stream content for debugging
          if (decompressedCount === 0) {
            console.log(`[PA PDF] Stream ${streamCount} decompressed ${decompressed.length} bytes, first 500:`, streamText.slice(0, 500));
          }
          
          // Extract text from BT...ET blocks  
          const btRegex = /BT\s*([\s\S]*?)ET/g;
          let btMatch;
          while ((btMatch = btRegex.exec(streamText)) !== null) {
            const block = btMatch[1];
            // Tj operator
            const tjRegex = /\(([^)]*)\)\s*Tj/g;
            let tj;
            while ((tj = tjRegex.exec(block)) !== null) {
              const decoded = tj[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
              if (decoded.trim()) allTextParts.push(decoded.trim());
            }
            // TJ array operator
            const tjArrRegex = /\[([^\]]*)\]\s*TJ/g;
            let tja;
            while ((tja = tjArrRegex.exec(block)) !== null) {
              const innerRegex = /\(([^)]*)\)/g;
              let inner;
              let combined = '';
              while ((inner = innerRegex.exec(tja[1])) !== null) {
                combined += inner[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')');
              }
              if (combined.trim()) allTextParts.push(combined.trim());
            }
          }
          decompressedCount++;
        } catch (e) {
          console.log(`[PA PDF] Stream ${streamCount} decompress failed:`, e?.message || e);
        }
      }
      
      searchFrom = endIdx + 10;
    }
    
    console.log(`[PA PDF] Found ${streamCount} streams, decompressed ${decompressedCount}, extracted ${allTextParts.length} text parts`);
    if (allTextParts.length > 0) {
      console.log('[PA PDF] Sample:', JSON.stringify(allTextParts.slice(0, 40)));
    }
    
    // Parse line items from text parts
    // Typical order: Item#, Description, Qty, Unit, Price, Extended
    const items: any[] = [];
    
    for (let i = 0; i < allTextParts.length; i++) {
      const part = allTextParts[i];
      // Look for dollar amounts
      if (/^\$[\d,]+\.\d{2}$/.test(part)) {
        const price = parseFloat(part.replace(/[$,]/g, ''));
        let name = '';
        let qty = 0;
        let unit = '';
        
        for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
          const prev = allTextParts[j];
          if (/^\d+\.?\d*$/.test(prev) && !qty) {
            qty = parseFloat(prev);
          } else if (/^(cs|ea|lb|bg|ct|cn|bx|pk|dz|hd|bn|bh|fl|jg)$/i.test(prev) && !unit) {
            unit = prev;
          } else if (prev.length > 3 && !/^\$/.test(prev) && !/^\d+\.?\d*$/.test(prev) && !name) {
            name = prev;
          }
        }
        
        if (name && (qty > 0 || price > 0)) {
          if (!items.some(it => it.name === name && it.price === price)) {
            items.push({ name, quantity: qty, unit: unit || 'cs', price });
          }
        }
      }
    }
    
    return items;
  } catch (e) {
    console.warn('[PA PDF] Parse error:', e);
    return [];
  }
}

async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  // Try raw deflate first, then with zlib header
  for (const format of ['raw' as const, 'deflate' as const]) {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      
      writer.write(data).catch(() => {});
      writer.close().catch(() => {});
      
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const result = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } catch {
      continue;
    }
  }
  throw new Error('Decompression failed');
}

async function handleSyncItems(supabase: any, body: any): Promise<Response> {
  const { locationId, triggeredBy } = body;

  // Create sync log
  const { data: syncLog } = await supabase
    .from('inventory_sync_logs')
    .insert({
      location_id: locationId,
      sync_source: 'produce_alliance',
      sync_type: 'manual',
      status: 'in_progress',
      triggered_by: triggeredBy || null,
      metadata: { method: 'ajax' },
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

  const items = await fetchPAItems(session);
  console.log('[PA Sync] Got', items.length, 'items to sync');

  // Merge pricing data (contains actual UOM)
  const pricing = await fetchPAPricing(session);
  console.log('[PA Sync] Got', pricing.length, 'pricing entries to merge UOM');
  if (pricing.length > 0) {
    // Log sample pricing entry for debugging
    console.log('[PA Sync] Sample pricing entry:', JSON.stringify(pricing[0]));
    
    // Build maps by both ID and normalized name for matching
    const priceMapById = new Map(pricing.map((p: any) => [String(p.id), p]));
    const priceMapByName = new Map(pricing.map((p: any) => [p.name?.toUpperCase()?.trim(), p]));
    
    let matched = 0;
    for (const item of items) {
      // Try matching by ID first, then by name
      const priceInfo = priceMapById.get(String(item.id)) || priceMapByName.get(item.name?.toUpperCase()?.trim());
      if (priceInfo) {
        item.price = priceInfo.price ?? item.price;
        const pricingUnit = priceInfo.unit?.toLowerCase()?.trim();
        if (pricingUnit && pricingUnit !== 'case' && pricingUnit !== 'cs') {
          item.unit = pricingUnit;
        } else if (pricingUnit) {
          item.unit = pricingUnit;
        }
        matched++;
      }
    }
    console.log('[PA Sync] Matched', matched, 'of', items.length, 'items with pricing UOM');
  } else {
    console.log('[PA Sync] WARNING: No pricing data returned — units will default to "case"');
  }

  if (items.length === 0) {
    await updateSyncLog(supabase, syncLogId, 'completed', 0, 0, [], { message: 'No items found' });
    return jsonResponse({ success: true, message: 'No items found on PA portal', synced: 0 });
  }

  // Upsert items WITHOUT storage location — user assigns manually
  let synced = 0;

  for (const item of items) {
    let existingItem = null;
    if (item.id) {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, user_hidden')
        .eq('location_id', locationId)
        .eq('pa_item_id', String(item.id))
        .maybeSingle();
      existingItem = data;
    }
    if (!existingItem && item.name) {
      const { data } = await supabase
        .from('inventory_items')
        .select('id, user_hidden')
        .eq('location_id', locationId)
        .ilike('name', item.name)
        .maybeSingle();
      existingItem = data;
    }

    // Parse pack info from item name
    const parsedPack = parsePackFromName(item.name || '');
    
    const itemData = {
      name: (item.name || '').trim(),
      unit: item.unit?.toLowerCase() || 'case',
      cost_per_unit: item.price,
      pack_size: item.packSize || parsedPack.packSize || null,
      pack_quantity: item.packQuantity || parsedPack.packQuantity || null,
      brand: item.brand || null,
      item_number: item.itemNumber || null,
      vendor_source: 'produce_alliance',
      is_active: true,
    };

    if (existingItem) {
      // Don't overwrite storage_location_id if user already assigned one
      // Don't re-activate items the user has manually hidden
      const updateData = { ...itemData };
      if (existingItem.user_hidden) {
        delete (updateData as any).is_active; // preserve hidden state
      }
      await supabase.from('inventory_items').update(updateData).eq('id', existingItem.id);
    } else {
      await supabase.from('inventory_items').insert({
        location_id: locationId,
        pa_item_id: item.id ? String(item.id) : null,
        storage_location_id: null, // User assigns manually
        ...itemData,
      });
    }
    synced++;
  }

  // Deactivate PA items that are NOT on the order guide
  const syncedPaIds = items.map(i => String(i.id)).filter(Boolean);
  if (syncedPaIds.length > 0) {
    const { data: allPaItems } = await supabase
      .from('inventory_items')
      .select('id, pa_item_id, user_hidden')
      .eq('location_id', locationId)
      .eq('vendor_source', 'produce_alliance')
      .eq('is_active', true);
    
    const toDeactivate = (allPaItems || []).filter(
      (item: any) => item.pa_item_id && !syncedPaIds.includes(String(item.pa_item_id))
    );
    
    if (toDeactivate.length > 0) {
      const deactivateIds = toDeactivate.map((i: any) => i.id);
      await supabase.from('inventory_items')
        .update({ is_active: false })
        .in('id', deactivateIds);
      console.log(`[PA Sync] Deactivated ${toDeactivate.length} items not on order guide`);
    }
  }

  // ---- Blended price calculation for linked items ----
  // Find hidden items that have a linked_item_id pointing to an active item
  const { data: linkedItems } = await supabase
    .from('inventory_items')
    .select('id, linked_item_id, cost_per_unit')
    .eq('location_id', locationId)
    .eq('user_hidden', true)
    .not('linked_item_id', 'is', null);

  if (linkedItems && linkedItems.length > 0) {
    // Group by linked_item_id (primary item)
    const linkMap = new Map<string, number[]>();
    for (const li of linkedItems) {
      if (!li.linked_item_id || li.cost_per_unit == null) continue;
      const existing = linkMap.get(li.linked_item_id) || [];
      existing.push(Number(li.cost_per_unit));
      linkMap.set(li.linked_item_id, existing);
    }

    for (const [primaryId, hiddenPrices] of linkMap.entries()) {
      // Get the primary item's cost
      const { data: primary } = await supabase
        .from('inventory_items')
        .select('cost_per_unit')
        .eq('id', primaryId)
        .single();

      if (!primary?.cost_per_unit) continue;

      const allPrices = [Number(primary.cost_per_unit), ...hiddenPrices];
      const avg = allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length;
      const blended = Math.round(avg * 100) / 100;

      await supabase
        .from('inventory_items')
        .update({ blended_price: blended })
        .eq('id', primaryId);

      console.log(`[PA Sync] Blended price for ${primaryId}: $${blended} (from ${allPrices.length} prices: ${allPrices.map(p => '$' + p.toFixed(2)).join(', ')})`);
    }
  }

  await updateSyncLog(supabase, syncLogId, 'completed', synced, 0, []);
  return jsonResponse({ success: true, synced });
}

async function handleSaveCredentials(supabase: any, body: any): Promise<Response> {
  const { locationId, username, password, paLocationId } = body;

  if (!locationId || !username || !password) {
    return jsonResponse({ success: false, error: 'Missing locationId, username, or password' }, 400);
  }

  // Test credentials
  const testSession = await loginToPA({ username, password, pa_location_id: paLocationId || '18046' });
  if (!testSession) {
    return jsonResponse({ success: false, error: 'Login failed — invalid credentials' });
  }

  const credentials: PACredentials = { username, password, pa_location_id: paLocationId || '18046' };

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
// EXPLORE — discover links on the ordering page
// ============================================================================

async function handleExplore(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const pageResp = await fetch(`${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`, {
    method: 'GET',
    headers: {
      'Cookie': session.cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });

  const pageHtml = await pageResp.text();

  // Extract all links
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links: { href: string; text: string }[] = [];
  let match;
  while ((match = linkRegex.exec(pageHtml)) !== null) {
    links.push({ href: match[1], text: match[2].replace(/<[^>]+>/g, '').trim() });
  }

  // Extract navigation/sidebar items
  const navRegex = /class="[^"]*(?:nav|menu|sidebar|tab)[^"]*"[^>]*>([\s\S]*?)<\//gi;
  const navItems: string[] = [];
  while ((match = navRegex.exec(pageHtml)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text) navItems.push(text);
  }

  // Look for pricing-related links
  const pricingLinks = links.filter(l => 
    /pric|cost|rate|pdf|report|export|download/i.test(l.href + ' ' + l.text)
  );

  // Search for pricing AJAX endpoint
  const pricingAjaxMatches = pageHtml.match(/url[:\s]*["'][^"']*[Pp]rice[^"']*["']/gi);
  console.log('[PA Explore] Pricing AJAX URLs:', JSON.stringify(pricingAjaxMatches));

  // Search for GetPrices or similar endpoints
  const getPricesMatches = pageHtml.match(/(?:Get|Load|Fetch)[A-Za-z]*[Pp]rice[^"'\s)}\]]*["')}\]]/gi);
  console.log('[PA Explore] GetPrices matches:', JSON.stringify(getPricesMatches));

  // Find the tblpricestablesummary AJAX setup - search around it
  const tblPricesIdx = pageHtml.indexOf('tblpricestablesummary');
  if (tblPricesIdx > -1) {
    // Go back further to find the AJAX url
    const context = pageHtml.slice(Math.max(0, tblPricesIdx - 2000), tblPricesIdx + 1000).replace(/\s+/g, ' ');
    console.log('[PA Explore] tblpricestablesummary context:', context);
  }

  // Search for Order Guide related JS/AJAX
  const ogJsRegex = /(?:function\s+getItems|OrderGuide|orderguide|GetOrderGuide|tblOrderGuide)[^;]{0,800}/gi;
  const ogMatches: string[] = [];
  let ogm;
  while ((ogm = ogJsRegex.exec(pageHtml)) !== null) {
    ogMatches.push(ogm[0].replace(/\s+/g, ' ').trim().slice(0, 400));
  }
  console.log('[PA Explore] OrderGuide JS matches:', JSON.stringify(ogMatches));

  // Also search for the specific getItems function
  const getItemsIdx = pageHtml.indexOf('function getItems');
  if (getItemsIdx > -1) {
    const context = pageHtml.slice(getItemsIdx, getItemsIdx + 1500).replace(/\s+/g, ' ');
    console.log('[PA Explore] getItems function:', context);
  }

  // Log full HTML for debugging (first 5000 chars)
  console.log('[PA Explore] Page HTML (5000 chars):', pageHtml.replace(/\s+/g, ' ').slice(0, 5000));
  console.log('[PA Explore] All links:', JSON.stringify(links));
  console.log('[PA Explore] Pricing links:', JSON.stringify(pricingLinks));

  return jsonResponse({
    success: true,
    data: {
      allLinks: links,
      pricingLinks,
      navItems,
      pageLength: pageHtml.length,
    }
  });
}

// ============================================================================
// PRICING — fetch pricing list PDF
// ============================================================================

async function handlePricing(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  // Step 1: Load ordering page to establish session state
  const pageResp = await fetch(`${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`, {
    method: 'GET',
    headers: {
      'Cookie': session.cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });
  await pageResp.text();
  const updatedCookies = mergeCookies(session.cookies, extractCookies(pageResp.headers));

  // Step 2: Get price list dates from AJAX endpoint
  console.log('[PA Pricing] Fetching price list dates...');
  const priceListResp = await fetch(`${PA_BASE_URL}/Ordering/GetPriceListPartialData`, {
    method: 'POST',
    headers: {
      'Cookie': updatedCookies,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': `${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`,
    },
    body: `locationid=${session.locationId}`,
    redirect: 'follow',
  });

  if (!priceListResp.ok) {
    console.log('[PA Pricing] GetPriceListPartialData →', priceListResp.status);
    return jsonResponse({ success: false, error: 'Failed to fetch price list dates' });
  }

  const priceListData = await priceListResp.json();
  console.log('[PA Pricing] Price list data:', JSON.stringify(priceListData).slice(0, 1000));

  const priceDates = priceListData.Data || priceListData.data || [];
  if (!Array.isArray(priceDates) || priceDates.length === 0) {
    return jsonResponse({ success: true, data: { priceLists: [], message: 'No price lists available' } });
  }

  // Step 3: Fetch the most recent pricing page (HTML version for parsing)
  const latestDate = priceDates[0];
  const dateBegin = latestDate.DateBegin || latestDate.dateBegin;
  console.log('[PA Pricing] Fetching latest price list for date:', dateBegin);

  const pricingPageResp = await fetch(
    `${PA_BASE_URL}/Ordering/PricesDetailPage?date=${encodeURIComponent(dateBegin)}&locationid=${session.locationId}&download=false`,
    {
      method: 'GET',
      headers: {
        'Cookie': updatedCookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
    }
  );

  console.log('[PA Pricing] PricesDetailPage status:', pricingPageResp.status, 'content-type:', pricingPageResp.headers.get('content-type'));

  if (!pricingPageResp.ok) {
    // Try PDF version instead
    console.log('[PA Pricing] HTML failed, trying PDF...');
    const pdfResp = await fetch(
      `${PA_BASE_URL}/Ordering/PricesDetail?date=${encodeURIComponent(dateBegin)}&locationid=${session.locationId}&download=false`,
      {
        method: 'GET',
        headers: {
          'Cookie': updatedCookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        redirect: 'follow',
      }
    );

    const pdfContentType = pdfResp.headers.get('content-type') || '';
    console.log('[PA Pricing] PDF status:', pdfResp.status, 'content-type:', pdfContentType);

    if (pdfResp.ok && pdfContentType.includes('pdf')) {
      const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());
      console.log('[PA Pricing] Got PDF, size:', pdfBytes.byteLength, 'bytes');
      return jsonResponse({
        success: true,
        data: {
          type: 'pdf',
          dateBegin,
          dateEnd: latestDate.DateEnd || latestDate.dateEnd,
          lineCount: latestDate.LineCount || latestDate.lineCount,
          pdfSize: pdfBytes.byteLength,
          allDates: priceDates,
        }
      });
    }

    const text = await pdfResp.text();
    console.log('[PA Pricing] Response (500 chars):', text.slice(0, 500));
    return jsonResponse({ success: false, error: 'Could not fetch pricing data' });
  }

  // Parse the HTML pricing page for item prices
  const pricingHtml = await pricingPageResp.text();
  console.log('[PA Pricing] Got pricing page HTML, length:', pricingHtml.length);
  console.log('[PA Pricing] HTML sample (2000 chars):', pricingHtml.replace(/\s+/g, ' ').slice(0, 2000));

  // Try to extract pricing data from the HTML table
  const items = parsePricingHtml(pricingHtml);

  return jsonResponse({
    success: true,
    data: {
      type: 'html',
      dateBegin,
      dateEnd: latestDate.DateEnd || latestDate.dateEnd,
      lineCount: latestDate.LineCount || latestDate.lineCount,
      items,
      itemCount: items.length,
      allDates: priceDates,
    }
  });
}

function parsePricingHtml(html: string): any[] {
  const items: any[] = [];
  
  // Table format: [itemId, name, unit, quantity, price($XX.XX)]
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    // Expected: [id, name, unit, qty, price]
    if (cells.length >= 5) {
      const priceStr = cells[4];
      if (priceStr && /\$/.test(priceStr)) {
        items.push({
          id: cells[0],
          name: cells[1],
          unit: cells[2],
          quantity: parseFloat(cells[3]) || 1,
          price: parseFloat(priceStr.replace(/[$,]/g, '')) || 0,
        });
      }
    }
  }
  
  return items;
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
  return data.credentials as unknown as PACredentials;
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
// TEST VISION — fetch one order PDF, send to Gemini Vision for line items
// ============================================================================

async function fetchOrderPdf(session: PASession, orderId: string): Promise<string | null> {
  // Establish cookies
  const pageResp = await fetch(`${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`, {
    method: 'GET',
    headers: { 'Cookie': session.cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    redirect: 'follow',
  });
  await pageResp.text();
  const detailCookies = mergeCookies(session.cookies, extractCookies(pageResp.headers));

  const urls = [
    `${PA_BASE_URL}/Ordering/OrderDetail?orderid=${orderId}&locationid=${session.locationId}&download=false`,
    `${PA_BASE_URL}/Ordering/OrderDetailPage?orderid=${orderId}&locationid=${session.locationId}&download=false`,
    `${PA_BASE_URL}/Ordering/InvoiceDetailPage?orderid=${orderId}&locationid=${session.locationId}&download=false`,
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Cookie': detailCookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        redirect: 'follow',
      });
      if (resp.ok) {
        const rawBytes = new Uint8Array(await resp.arrayBuffer());
        const isPdf = rawBytes[0] === 0x25 && rawBytes[1] === 0x50;
        if (isPdf && rawBytes.length > 100) {
          let binary = '';
          for (let i = 0; i < rawBytes.length; i++) binary += String.fromCharCode(rawBytes[i]);
          return btoa(binary);
        }
      }
      await resp.text().catch(() => '');
    } catch (e) {
      console.warn(`[PA Vision] Error fetching ${url}:`, e);
    }
  }
  return null;
}

async function extractLineItemsFromPdf(pdfBase64: string, apiKey: string): Promise<any[]> {
  const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Extract ALL line items from this produce order PDF. For each item return: product name, quantity ordered, unit of measure EXACTLY as shown (e.g. cs, ea, lb, bg, ct, cn, bx, pk, dz, hd, bn, bh, fl, jg, bunch, flat, each, case, pound — use the abbreviation from the document), and unit price. Return as JSON array: [{"name":"...","quantity":1,"unit":"cs","price":12.50}]. Only return the JSON array, nothing else.` },
          { type: 'image_url', image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
        ],
      }],
    }),
  });

  if (!aiResp.ok) {
    console.error('[PA Vision] AI error:', aiResp.status);
    return [];
  }

  const aiResult = await aiResp.json();
  const content = aiResult.choices?.[0]?.message?.content || '';
  try {
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    console.warn('[PA Vision] Could not parse AI response');
    return [];
  }
}

async function handleTestVision(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const rawOrders = await fetchPAOrders(session);
  if (rawOrders.length === 0) return jsonResponse({ success: false, error: 'No orders found' });

  const firstOrder = rawOrders[0];
  const orderId = firstOrder.OrderID;
  console.log(`[PA Vision] Testing with order ${orderId}`);

  const pdfBase64 = await fetchOrderPdf(session, orderId);
  if (!pdfBase64) return jsonResponse({ success: false, error: 'Could not fetch order PDF' });

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return jsonResponse({ success: false, error: 'LOVABLE_API_KEY not configured' });

  const lineItems = await extractLineItemsFromPdf(pdfBase64, LOVABLE_API_KEY);

  return jsonResponse({
    success: true,
    data: { orderId, orderTotal: firstOrder.OrderTotal, lineItems, lineItemCount: lineItems.length },
  });
}

// ============================================================================
// SYNC INVENTORY — process recent orders via Vision and upsert to inventory
// ============================================================================

async function handleSyncInventory(supabase: any, body: any): Promise<Response> {
  const { locationId, maxOrders = 3, triggeredBy } = body;
  const errors: string[] = [];

  // Create sync log entry
  const { data: syncLog } = await supabase
    .from('inventory_sync_logs')
    .insert({
      location_id: locationId,
      sync_source: 'produce_alliance',
      sync_type: 'manual',
      status: 'in_progress',
      triggered_by: triggeredBy || null,
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

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    await updateSyncLog(supabase, syncLogId, 'failed', 0, 0, ['LOVABLE_API_KEY not configured']);
    return jsonResponse({ success: false, error: 'LOVABLE_API_KEY not configured' });
  }

  // Step 1: Get orders and persist to pa_orders
  const rawOrders = await fetchPAOrders(session);
  if (rawOrders.length === 0) {
    await updateSyncLog(supabase, syncLogId, 'completed', 0, 0, [], { message: 'No orders found' });
    return jsonResponse({ success: true, synced: 0, message: 'No orders found' });
  }

  // Persist all fetched orders
  const parseMSDate = (d: string | null) => {
    if (!d) return null;
    const match = d.match(/\/Date\((\d+)\)\//);
    return match ? new Date(parseInt(match[1])).toISOString() : null;
  };
  await persistPAOrders(supabase, locationId, rawOrders, parseMSDate);

  const ordersToProcess = rawOrders.slice(0, maxOrders);
  console.log(`[PA Sync] Processing ${ordersToProcess.length} of ${rawOrders.length} orders`);

  // Step 2: Process each order via Vision with retry
  const allItems = new Map<string, any>(); // name -> latest data
  let ordersProcessed = 0;

  for (const order of ordersToProcess) {
    const orderId = order.OrderID;
    console.log(`[PA Sync] Processing order ${orderId}`);
    
    const pdfBase64 = await fetchOrderPdf(session, orderId);
    if (!pdfBase64) {
      const errMsg = `Could not fetch PDF for order ${orderId}`;
      console.warn(`[PA Sync] ${errMsg}`);
      errors.push(errMsg);
      continue;
    }

    // Retry Vision extraction up to 2 times
    let lineItems: any[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      lineItems = await extractLineItemsFromPdf(pdfBase64, LOVABLE_API_KEY);
      if (lineItems.length > 0) break;
      if (attempt < 2) {
        console.warn(`[PA Sync] Vision attempt ${attempt} failed for order ${orderId}, retrying...`);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        const errMsg = `Vision extraction failed for order ${orderId} after ${attempt} attempts`;
        console.warn(`[PA Sync] ${errMsg}`);
        errors.push(errMsg);
      }
    }

    console.log(`[PA Sync] Order ${orderId}: ${lineItems.length} items extracted`);
    
    for (const item of lineItems) {
      if (item.name) {
        allItems.set(item.name.toLowerCase(), item);
      }
    }
    ordersProcessed++;
  }

  // Step 4: Update EXISTING items only — never create new items from order PDFs
  // Order PDFs use abbreviated names that don't match catalog entries, so creating
  // new items from them causes duplicates and phantom entries.
  let synced = 0;
  let skippedNew = 0;
  for (const [, item] of allItems) {
    // Try matching by exact name first
    let existing = null;
    const { data: exactMatch } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('location_id', locationId)
      .ilike('name', item.name)
      .maybeSingle();
    existing = exactMatch;

    // Also try matching by pa_item_id if name has a stable ID pattern
    if (!existing) {
      const stablePaItemId = `pa_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60)}`;
      const { data: paMatch } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('location_id', locationId)
        .eq('pa_item_id', stablePaItemId)
        .maybeSingle();
      existing = paMatch;
    }

    if (existing) {
      // Only update price — don't overwrite name, unit, or storage location
      const updateData: any = {};
      if (item.price) updateData.cost_per_unit = item.price;
      if (Object.keys(updateData).length > 0) {
        await supabase.from('inventory_items').update(updateData).eq('id', existing.id);
      }
      synced++;
    } else {
      // Do NOT create new items from order PDFs — they use abbreviated names
      // that don't match catalog entries and cause duplicates
      skippedNew++;
      console.log(`[PA Sync] Skipped new item from order PDF (not in inventory): "${item.name}"`);
    }
  }
  console.log(`[PA Sync] Updated ${synced} existing items, skipped ${skippedNew} unmatched items`);

  // Update sync log
  await updateSyncLog(supabase, syncLogId, errors.length > 0 && synced === 0 ? 'failed' : 'completed', synced, ordersProcessed, errors, {
    totalOrdersAvailable: rawOrders.length,
  });

  return jsonResponse({
    success: true,
    synced,
    ordersProcessed,
    totalOrdersAvailable: rawOrders.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ============================================================================
// DISCOVER LOCATIONS — find available PA location IDs for an account
// ============================================================================

async function handleDiscoverLocations(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  // Fetch the ordering home page WITHOUT specifying DDLLocationID to see the default
  const pageResp = await fetch(`${PA_BASE_URL}/Ordering/Home`, {
    method: 'GET',
    headers: {
      'Cookie': session.cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });
  const pageHtml = await pageResp.text();

  // Look for DDLLocationID dropdown or select elements
  const selectRegex = /<select[^>]*id=["']?DDLLocationID["']?[^>]*>([\s\S]*?)<\/select>/i;
  const selectMatch = pageHtml.match(selectRegex);
  
  // Also look for any location-related dropdowns
  const allSelectRegex = /<select[^>]*(?:location|DDL)[^>]*>([\s\S]*?)<\/select>/gi;
  const allSelects: string[] = [];
  let sm;
  while ((sm = allSelectRegex.exec(pageHtml)) !== null) {
    allSelects.push(sm[0].slice(0, 500));
  }

  // Extract option values from any location select
  const optionRegex = /<option[^>]*value=["']?(\d+)["']?[^>]*>(.*?)<\/option>/gi;
  const locations: { id: string; name: string; selected: boolean }[] = [];
  const selectHtml = selectMatch ? selectMatch[0] : allSelects.join('');
  let om;
  while ((om = optionRegex.exec(selectHtml)) !== null) {
    locations.push({
      id: om[1],
      name: om[2].replace(/<[^>]+>/g, '').trim(),
      selected: om[0].includes('selected'),
    });
  }

  // Also search for locationID assignments in JS
  const jsLocationRegex = /locationID\s*[:=]\s*["']?(\d+)["']?/gi;
  const jsLocations: string[] = [];
  let jm;
  while ((jm = jsLocationRegex.exec(pageHtml)) !== null) {
    jsLocations.push(jm[1]);
  }

  // Look for the current URL's DDLLocationID
  const urlLocationMatch = pageResp.url.match(/DDLLocationID=(\d+)/i);

  console.log('[PA Discover] URL:', pageResp.url);
  console.log('[PA Discover] Found locations:', JSON.stringify(locations));
  console.log('[PA Discover] JS locationIDs:', JSON.stringify([...new Set(jsLocations)]));
  console.log('[PA Discover] URL location:', urlLocationMatch?.[1]);
  console.log('[PA Discover] Select elements found:', allSelects.length);

  return jsonResponse({
    success: true,
    data: {
      currentUrl: pageResp.url,
      urlLocationId: urlLocationMatch?.[1] || null,
      dropdownLocations: locations,
      jsLocationIds: [...new Set(jsLocations)],
      selectCount: allSelects.length,
      defaultLocationId: session.locationId,
    }
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

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }

    const action = body.action || 'test';
    console.log('[PA Service] Action:', action);

    switch (action) {
      case 'test': return await handleTest(supabase, body);
      case 'items': return await handleItems(supabase, body);
      case 'orders': return await handleOrders(supabase, body);
      case 'sync_items': return await handleSyncItems(supabase, body);
      case 'save_credentials': return await handleSaveCredentials(supabase, body);
      case 'explore': return await handleExplore(supabase, body);
      case 'pricing': return await handlePricing(supabase, body);
      case 'test_vision': return await handleTestVision(supabase, body);
      case 'sync_inventory': return await handleSyncInventory(supabase, body);
      case 'discover_locations': return await handleDiscoverLocations(supabase, body);
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
