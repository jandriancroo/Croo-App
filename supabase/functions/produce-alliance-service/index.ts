import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  console.log('[PA API] Fetching items, location:', session.locationId);

  // Load ordering page first (establishes state)
  const pageResp = await fetch(`${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`, {
    method: 'GET',
    headers: {
      'Cookie': session.cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'follow',
  });

  const pageHtml = await pageResp.text();
  if (pageHtml.includes('Login to get started')) {
    throw new Error('PA session expired');
  }

  const updatedCookies = mergeCookies(session.cookies, extractCookies(pageResp.headers));

  // Extract verification token
  let verificationToken = '';
  const tokenMatch = pageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  if (tokenMatch) verificationToken = tokenMatch[1];

  const baseHeaders: Record<string, string> = {
    'Cookie': updatedCookies,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': `${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`,
  };
  if (verificationToken) baseHeaders['__RequestVerificationToken'] = verificationToken;

  // Try GetInvoiceProducts with different content types
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
        console.log('[PA API] GetInvoiceProducts', ct, '→', resp.status);
        await resp.text().catch(() => '');
      }
    } catch (e) {
      console.warn('[PA API] Error:', e);
    }
  }

  // Try VerifyOrderGuideByLocation
  try {
    const resp = await fetch(`${PA_BASE_URL}/Ordering/VerifyOrderGuideByLocation`, {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `DDLLocationID=${session.locationId}`,
      redirect: 'follow',
    });

    if (resp.ok) {
      const text = await resp.text();
      console.log('[PA API] VerifyOrderGuide response (500 chars):', text.slice(0, 500));
      const result = tryParseItems(text, 'VerifyOrderGuide');
      if (result.length > 0) return result;
    } else {
      await resp.text().catch(() => '');
    }
  } catch (e) {
    console.warn('[PA API] VerifyOrderGuide error:', e);
  }

  // Log page structure for debugging
  console.log('[PA API] Page HTML sample:', pageHtml.replace(/\s+/g, ' ').slice(0, 3000));

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

function normalizeItem(raw: any): any {
  return {
    id: raw.PAProductID || raw.Id || raw.ItemId || raw.ProductId || raw.ProductID || raw.id || raw.InvoiceProductID || '',
    name: raw.PADescription || raw.Description || raw.Name || raw.ProductName || raw.ProductDescription || raw.name || raw.ItemName || '',
    itemNumber: raw.ItemNumber || raw.ProductNumber || raw.ItemNo || raw.Code || raw.itemNumber || raw.ProductCode || raw.SpecificationID || null,
    brand: raw.Brand || raw.BrandName || raw.brand || null,
    price: raw.Price || raw.UnitPrice || raw.CurrentPrice || raw.price || raw.Cost || raw.ExtPrice || raw.LastPrice || null,
    unit: raw.Unit || raw.UOM || raw.UnitOfMeasure || raw.unit || raw.Pack || 'case',
    packSize: raw.PackSize || raw.Size || raw.PackDescription || raw.packSize || raw.Sizing || raw.SizeDiameter || null,
    category: raw.Category || raw.CategoryName || raw.GroupName || raw.category || raw.ProductCategory || raw.StorageZone || null,
    imageUrl: raw.ImageURL || raw.imageUrl || null,
    variety: raw.Variety || null,
  };
}

// ============================================================================
// ORDER HISTORY — /Ordering/GetInvoices
// ============================================================================

async function fetchPAOrders(session: PASession): Promise<any[]> {
  console.log('[PA API] Fetching invoices');

  const bodies = [
    `DDLLocationID=${session.locationId}&page=1&pageSize=100`,
    `sort=&group=&filter=&DDLLocationID=${session.locationId}`,
  ];

  for (const body of bodies) {
    try {
      const resp = await fetch(`${PA_BASE_URL}/Ordering/GetInvoices`, {
        method: 'POST',
        headers: {
          'Cookie': session.cookies,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': `${PA_BASE_URL}/Ordering/Home?DDLLocationID=${session.locationId}`,
        },
        body,
        redirect: 'follow',
      });

      if (resp.ok) {
        const text = await resp.text();
        try {
          const data = JSON.parse(text);
          console.log('[PA API] GetInvoices keys:', Object.keys(data).join(', '));
          
          const invoices = data.Data || data.data || data.Invoices || data;
          if (Array.isArray(invoices) && invoices.length > 0) {
            console.log('[PA API] Found', invoices.length, 'invoices');
            if (invoices[0]) console.log('[PA API] Sample invoice keys:', Object.keys(invoices[0]).join(', '));
            return invoices;
          }
          
          for (const key of Object.keys(data)) {
            if (Array.isArray(data[key]) && data[key].length > 0) {
              return data[key];
            }
          }
          
          console.log('[PA API] GetInvoices response:', JSON.stringify(data).slice(0, 500));
        } catch {
          console.log('[PA API] GetInvoices non-JSON');
        }
      } else {
        console.log('[PA API] GetInvoices →', resp.status);
        await resp.text().catch(() => '');
      }
    } catch (e) {
      console.warn('[PA API] GetInvoices error:', e);
    }
  }

  return [];
}

// ============================================================================
// PRICING — fetch current prices via PricesDetailPage
// ============================================================================

async function fetchPAPricing(session: PASession): Promise<any[]> {
  try {
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

    if (!priceListResp.ok) return [];
    const priceListData = await priceListResp.json();
    const priceDates = priceListData.Data || priceListData.data || [];
    if (!Array.isArray(priceDates) || priceDates.length === 0) return [];

    const dateBegin = priceDates[0].DateBegin || priceDates[0].dateBegin;

    // Fetch pricing HTML page
    const pricingResp = await fetch(
      `${PA_BASE_URL}/Ordering/PricesDetailPage?date=${encodeURIComponent(dateBegin)}&locationid=${session.locationId}&download=false`,
      {
        method: 'GET',
        headers: { 'Cookie': updatedCookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        redirect: 'follow',
      }
    );

    if (!pricingResp.ok) return [];
    const html = await pricingResp.text();
    return parsePricingHtml(html);
  } catch (e) {
    console.warn('[PA Pricing] Error fetching pricing:', e);
    return [];
  }
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function handleTest(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'Login failed — check credentials' });

  return jsonResponse({ success: true, message: 'Produce Alliance connection successful!' });
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
    const priceMap = new Map(pricing.map((p: any) => [String(p.id), p]));
    for (const item of items) {
      const priceInfo = priceMap.get(String(item.id));
      if (priceInfo) {
        item.price = priceInfo.price;
        item.unit = priceInfo.unit?.toLowerCase() || item.unit;
      }
    }
  }

  return jsonResponse({ success: true, data: { items, count: items.length } });
}

async function handleOrders(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const orders = await fetchPAOrders(session);
  return jsonResponse({ success: true, data: { orders, count: orders.length } });
}

async function handleSyncItems(supabase: any, body: any): Promise<Response> {
  const { locationId } = body;
  const credentials = await getCredentials(supabase, locationId);
  if (!credentials) return jsonResponse({ success: false, error: 'PA integration not configured' });

  const session = await loginToPA(credentials);
  if (!session) return jsonResponse({ success: false, error: 'PA login failed' });

  const items = await fetchPAItems(session);
  console.log('[PA Sync] Got', items.length, 'items to sync');

  if (items.length === 0) {
    return jsonResponse({ success: true, message: 'No items found on PA portal', synced: 0 });
  }

  // Group by category
  const categoryMap = new Map<string, any[]>();
  for (const item of items) {
    const cat = item.category || 'Produce Alliance';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(item);
  }

  let synced = 0;

  for (const [categoryName, categoryItems] of categoryMap) {
    const { data: existing } = await supabase
      .from('inventory_locations')
      .select('id')
      .eq('location_id', locationId)
      .ilike('name', categoryName)
      .maybeSingle();

    let storageLocationId: string;
    if (existing) {
      storageLocationId = existing.id;
    } else {
      const { data: inserted } = await supabase
        .from('inventory_locations')
        .insert({ location_id: locationId, name: categoryName })
        .select('id')
        .single();
      storageLocationId = inserted?.id;
    }
    if (!storageLocationId) continue;

    for (const item of categoryItems) {
      let existingItem = null;
      if (item.id) {
        const { data } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('location_id', locationId)
          .eq('pa_item_id', String(item.id))
          .maybeSingle();
        existingItem = data;
      }
      if (!existingItem && item.name) {
        const { data } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('location_id', locationId)
          .ilike('name', item.name)
          .maybeSingle();
        existingItem = data;
      }

      const itemData = {
        name: item.name,
        unit: item.unit?.toLowerCase() || 'case',
        storage_location_id: storageLocationId,
        cost_per_unit: item.price,
        pack_size: item.packSize || null,
        brand: item.brand || null,
        item_number: item.itemNumber || null,
        vendor_source: 'produce_alliance',
        is_active: true,
      };

      if (existingItem) {
        await supabase.from('inventory_items').update(itemData).eq('id', existingItem.id);
      } else {
        await supabase.from('inventory_items').insert({
          location_id: locationId,
          pa_item_id: item.id ? String(item.id) : null,
          ...itemData,
        });
      }
      synced++;
    }
  }

  return jsonResponse({ success: true, synced, categories: categoryMap.size });
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
