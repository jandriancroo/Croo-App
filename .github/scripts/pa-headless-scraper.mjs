/**
 * Produce Alliance Headless Scraper (Multi-Location)
 * 
 * Uses Playwright to login to the PA portal (producealliance.info),
 * navigate to viewOrder.jsp for orders missing line items,
 * and scrape the Angular-rendered table.
 * 
 * Required environment variables (set as GitHub Secrets):
 *   SUPABASE_URL      - Supabase project URL
 *   SUPABASE_ANON_KEY - Supabase anon key
 */

import { chromium } from 'playwright';

const PA_BASE_URL = 'https://producealliance.info';

const { SUPABASE_URL, SUPABASE_ANON_KEY, LOCATION_FILTER, CRON_SECRET } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const locationFilter = (LOCATION_FILTER || '').trim();
if (locationFilter) {
  console.log(`🎯 LOCATION_FILTER active → only processing location_id=${locationFilter}`);
}

// ── Fetch active PA integrations + orders missing line items ─────
async function fetchPendingOrders() {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/produce-alliance-service`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({ action: 'list_pending_scrapes' }),
    }
  );

  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(`Failed to fetch pending orders: ${JSON.stringify(result)}`);
  }

  return result.locations || [];
}

// ── Scrape a single order's line items ──────────────────────────
async function scrapeOrder(page, { webOrderId, restaurantId, startDate, endDate }) {
  // Navigate to viewOrder.jsp — this loads the Angular SPA
  const toNonPadded = (d) => {
    const [y, m, dd] = d.split('-');
    return `${y}-${parseInt(m)}-${parseInt(dd)}`;
  };
  
  const url = `${PA_BASE_URL}/viewOrder.jsp?&webOrderId=${webOrderId}&startDate=${toNonPadded(startDate)}&endDate=${toNonPadded(endDate)}&restaurantId=${restaurantId}&includeOnlySubmit=false`;
  
  console.log(`   📄 Loading order ${webOrderId}...`);
  
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  
  // Wait for the Angular app to render the order table
  // The table contains item codes (numeric patterns like 01212)
  try {
    await page.waitForSelector('table td', { timeout: 15000 });
  } catch {
    console.log(`   ⚠️ No table rendered for order ${webOrderId}, checking page content...`);
    const content = await page.content();
    if (content.includes('Sign in') || content.includes('j_security_check')) {
      throw new Error('Session expired — got login page');
    }
    return null;
  }
  
  // Wait a bit more for data to populate
  await page.waitForTimeout(2000);
  
  // Extract line items from the rendered table
  const orderData = await page.evaluate(() => {
    const lineItems = [];
    const debugRows = [];
    let deliveryDate = null;
    let totalCases = null;
    let totalAmount = null;
    
    // Extract delivery date
    const body = document.body.innerText;
    const deliveryMatch = body.match(/Delivery\s*Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (deliveryMatch) {
      const parts = deliveryMatch[1].split('/');
      deliveryDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    }
    
    // Extract total cases
    const casesMatch = body.match(/Total\s*Cases[:\s]*([\d.]+)/i);
    if (casesMatch) totalCases = parseFloat(casesMatch[1]);
    
    // Extract total amount
    const totalMatch = body.match(/Total[:\s]*\$([\d,.]+)/i);
    if (totalMatch) totalAmount = parseFloat(totalMatch[1].replace(/,/g, ''));
    
    // Item code accepts pure-digit codes (03132) AND alphanumeric distributor SKUs
    // like 8021-CASE, 2077-EACH, 8002B-CASE (Blaze-1284 format). Must start with a
    // digit and be ≥3 chars; optional trailing -WORD suffix.
    const itemCodeRe = /^\d[\w]{2,}(-[A-Z]+)?$/i;
    
    // Find all tables and look for the one with item data
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      let foundItems = false;
      
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
        
        if (cells.length < 5) continue;
        
        // Detect spacer column
        const hasSpacerCol = cells.length >= 7 && (
          cells[0] === '' || cells[0] === '\u00a0' || !/\d/.test(cells[0])
        );
        const offset = hasSpacerCol ? 1 : 0;
        
        const itemCode = cells[offset];
        
        // Capture first few candidate rows for debug regardless of match
        if (debugRows.length < 3 && cells.length >= 5 && itemCode) {
          debugRows.push({ cells: cells.slice(0, 8), offset, matched: itemCodeRe.test(itemCode) });
        }
        
        if (!itemCode || !itemCodeRe.test(itemCode)) continue;
        
        const description = cells[offset + 1] || '';
        const paProductId = cells[offset + 2] || '';
        const unitPrice = parseFloat((cells[offset + 3] || '0').replace(/[$,]/g, ''));
        const quantity = parseFloat(cells[offset + 4] || '0');
        const cost = parseFloat((cells[offset + 5] || '0').replace(/[$,]/g, ''));
        
        if (quantity > 0 || cost > 0) {
          lineItems.push({
            item_code: itemCode,
            description,
            pa_product_id: paProductId,
            unit_price: unitPrice,
            quantity,
            cost,
          });
          foundItems = true;
        }
      }
      
      if (foundItems) break; // Found the right table
    }
    
    return { lineItems, deliveryDate, totalCases, totalAmount, debugRows };
  });
  
  if (orderData.lineItems.length === 0 && orderData.debugRows?.length) {
    console.log(`   🔎 ORDER_DBG ${webOrderId} sample rows: ${JSON.stringify(orderData.debugRows)}`);
  }
  console.log(`   ${orderData.lineItems.length > 0 ? '✅' : '⚠️'} Order ${webOrderId}: ${orderData.lineItems.length} line items`);
  return orderData;
}

// ── Login to PA portal ──────────────────────────────────────────
async function loginToPA(page, { username, password }) {
  console.log(`   🔑 Logging in as ${username}...`);

  // The PA portal uses a classic J2EE form login (POST /Login). As of Sep 2026
  // `/login.jsp` 302s to `/logout.jsp`, which only bounces the browser via
  // localStorage — the real login form now lives on the site root (index.jsp).
  // So: land on the root, make sure urlDesignation is PA, then submit the form.
  // If the root ever stops carrying the form, fall back to the legacy path.
  const openLoginForm = async () => {
    for (const target of [`${PA_BASE_URL}/`, `${PA_BASE_URL}/index.jsp`, `${PA_BASE_URL}/login.jsp`]) {
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.evaluate(() => {
          try {
            localStorage.setItem('urlDesignation', 'PA');
            localStorage.removeItem('lastRequestUrl');
          } catch {}
        });
        await page.waitForSelector('input[name="username"], #username', { timeout: 8000 });
        console.log(`   📝 Login form found at ${page.url()}`);
        return true;
      } catch {
        console.log(`   ↪️ No login form at ${target}, trying next...`);
      }
    }
    return false;
  };

  if (!(await openLoginForm())) {
    console.log('   ❌ Could not find the PA login form on any known URL');
    return false;
  }

  try {
    await page.fill('input[name="username"], #username', username);
    await page.fill('input[name="password"], #password', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
      page.click('#login, input[name="login"], button[name="login"], button[type="submit"]'),
    ]);
    // Give the post-login redirect / Angular handoff a moment to settle
    await page.waitForTimeout(2500);
  } catch (e) {
    console.log(`   ❌ Form login error: ${e.message}`);
    return false;
  }

  // Verify login: the login form must be gone.
  const stillHasForm = await page
    .evaluate(() => !!document.querySelector('input[name="password"], #password'))
    .catch(() => false);
  if (stillHasForm) {
    console.log(`   ❌ Login failed — still on the login form at ${page.url()}`);
    return false;
  }



  // Also mint an OAuth token + store it in localStorage so any subsequent
  // /api/* calls the Angular code paths might make also work.
  await page.evaluate(async ({ username, password, baseUrl }) => {
    try {
      const basicAuth = btoa('fc-client-2.0:fc-client-secret');
      const deviceId = crypto.randomUUID();
      const resp = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&grant_type=password&device_id=${deviceId}&client_id=fc-client-2.0`,
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.access_token) {
          localStorage.setItem('tokenStore', JSON.stringify({
            access_token: data.access_token,
            refresh_token: data.refresh_token || '',
            expires_by: String(Date.now() + (data.expires_in || 1800) * 1000),
          }));
        }
      }
      localStorage.setItem('urlDesignation', 'PA');
    } catch {}
  }, { username, password, baseUrl: PA_BASE_URL });

  console.log(`   ✅ Form login successful (J2EE /Login)`);
  return true;
}


// ── Process a single location ───────────────────────────────────
async function processLocation(browser, location) {
  const { locationId, username, password, restaurantId, pendingOrders } = location;
  
  console.log(`\n🏪 [${locationId}] Processing ${pendingOrders.length} pending order(s)...`);
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  const results = [];
  
  try {
    // Login once per location
    const loggedIn = await loginToPA(page, { username, password });
    if (!loggedIn) {
      // Report failure
      await fetch(
        `${SUPABASE_URL}/functions/v1/produce-alliance-service`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-cron-secret': CRON_SECRET,
          },
          body: JSON.stringify({
            action: 'headless_login_failed',
            locationId,
            error: 'Headless login failed',
          }),
        }
      ).catch(() => {});
      
      return { locationId, success: false, error: 'Login failed', scraped: 0 };
    }
    
    // Set the urlDesignation in localStorage (PA Angular app uses this for routing)
    await page.evaluate((rid) => {
      localStorage.setItem('urlDesignation', `restaurantBackOffice/viewOrders?restaurantId=${rid}`);
    }, restaurantId);
    
    // Scrape each pending order
    for (const order of pendingOrders) {
      try {
        const orderData = await scrapeOrder(page, {
          webOrderId: order.pa_order_id,
          restaurantId,
          startDate: order.startDate || order.order_date || '2026-01-01',
          endDate: order.endDate || order.order_date || '2026-12-31',
        });
        
        if (orderData && orderData.lineItems.length > 0) {
          // Post scraped data back to edge function
          const saveResp = await fetch(
            `${SUPABASE_URL}/functions/v1/produce-alliance-service`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-cron-secret': CRON_SECRET,
              },
              body: JSON.stringify({
                action: 'save_scraped_order',
                locationId,
                webOrderId: order.pa_order_id,
                ...orderData,
              }),
            }
          );
          
          const saveResult = await saveResp.json();
          results.push({
            orderId: order.pa_order_id,
            success: saveResult.success,
            lineItems: orderData.lineItems.length,
          });
        } else {
          results.push({
            orderId: order.pa_order_id,
            success: false,
            lineItems: 0,
            note: 'No line items found in rendered page',
          });
        }
        
        // Brief pause between orders
        await new Promise(r => setTimeout(r, 2000));
        
      } catch (err) {
        console.error(`   ❌ Error scraping order ${order.pa_order_id}:`, err.message);
        results.push({
          orderId: order.pa_order_id,
          success: false,
          error: err.message,
        });
      }
    }
    
  } catch (error) {
    console.error(`   ❌ [${locationId}] Fatal error:`, error.message);
    return { locationId, success: false, error: error.message, scraped: 0 };
  } finally {
    await context.close();
  }
  
  const scraped = results.filter(r => r.success).length;
  return { locationId, success: true, scraped, total: pendingOrders.length, results };
}

// ── Fetch all PA locations (for catalog scrape) ────────────────
async function fetchAllPALocations() {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/produce-alliance-service`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({ action: 'list_catalog_locations' }),
    }
  );

  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(`Failed to fetch PA locations: ${JSON.stringify(result)}`);
  }

  return result.locations || [];
}

// ── Scrape full product catalog from restaurantWeeklyProducePricesReport.jsp ───
async function scrapeCatalog(page, { restaurantId }) {
  // CRITICAL: the JSP stub script checks localStorage.urlDesignation —
  // if it's not 'PA', the page redirects to /index.jsp instead of rendering the table.
  // OAuth login only sets tokenStore; the Angular portal-selector normally sets this.
  await page.evaluate(() => { try { localStorage.setItem('urlDesignation', 'PA'); } catch {} });

  // Primary: Weekly Prices Report has ALL items with Master Product Name, PA Product ID, prices
  const url = `${PA_BASE_URL}/reports/restaurantWeeklyProducePricesReport.jsp?restaurantId=${restaurantId}`;
  console.log(`   📦 Loading weekly prices report...`);


  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);
  const debugInfo = await page.evaluate(() => ({
    url: location.href,
    len: document.documentElement.outerHTML.length,
    hasCostDetailTable: !!document.querySelector('#costDetailTable'),
    tableCount: document.querySelectorAll('table').length,
  }));
  console.log(`   🔍 page: ${debugInfo.url} | len=${debugInfo.len} | tables=${debugInfo.tableCount} | costDetailTable=${debugInfo.hasCostDetailTable}`);

  // Wait for the table to render
  try {
    await page.waitForSelector('#costDetailTable td, table td', { timeout: 10000 });
  } catch {
    console.log(`   ⚠️ No table rendered on weekly prices page, trying fallback...`);
    const content = await page.content();
    if (content.includes('Sign in') || content.includes('j_security_check')) {
      throw new Error('Session expired — got login page');
    }
    return await scrapeCatalogFallback(page, { restaurantId });
  }

  // Brief pause for any late-rendering cells
  await page.waitForTimeout(500);


  // Pipe browser-side console.log into the Node/Actions log
  page.removeAllListeners('console');
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('PA_DBG')) console.log(`   ${t}`);
  });

  const evalResult = await page.evaluate(() => {
    const out = { results: [], debug: { tablesSeen: 0, picked: null, sampleRows: [] } };
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      out.debug.tablesSeen++;
      const headerRow = table.querySelector('tr');
      if (!headerRow) continue;

      const headers = Array.from(headerRow.querySelectorAll('th, td'))
        .map(cell => cell.textContent.trim().toLowerCase());

      const hasProductName = headers.some(h => h.includes('master product name') || h.includes('product name'));
      const hasPaId = headers.some(h => h.includes('pa product id') || h.includes('product id'));
      if (!hasProductName && !hasPaId) continue;

      const nameIdx = headers.findIndex(h => h.includes('master product name') || h.includes('product name'));
      const paIdIdx = headers.findIndex(h => h.includes('pa product id') || h.includes('product id'));
      const codeIdx = headers.findIndex(h => h.includes('master product code') || h.includes('product code'));

      const rowsAll = table.querySelectorAll('tr');
      let sampleCells = [];
      for (let i = 1; i < rowsAll.length; i++) {
        const visibleInputs = rowsAll[i].querySelectorAll('input:not([type="hidden"]), select');
        if (visibleInputs.length > 0) continue;
        const c = Array.from(rowsAll[i].querySelectorAll('td')).map(td => td.textContent.trim());
        if (c.length >= 2) { sampleCells = c; break; }
      }

      const headerPriceCandidates = headers
        .map((h, i) => ({ h, i }))
        .filter(({ h }) => /price|cost|amount|rate|\$|per\s*case|per\s*unit|sell|each|extended/.test(h));
      const preferred = headerPriceCandidates.find(({ h }) => /unit|current|this\s*week|new|case\s*sell|sell/.test(h));
      let priceIdxList = preferred
        ? [preferred.i, ...headerPriceCandidates.filter(c => c.i !== preferred.i).map(c => c.i)]
        : headerPriceCandidates.map(c => c.i);

      // Money-shape: require $ prefix OR a decimal point (rejects padded numeric IDs like "03132")
      const moneyShaped = sampleCells
        .map((v, i) => ({ v, i }))
        .filter(({ v, i }) =>
          i !== paIdIdx && i !== codeIdx && i !== nameIdx &&
          /^\$\s*\d+(\.\d{1,2})?$|^\d+\.\d{1,2}$/.test(v.replace(/,/g, ''))
        );

      if (priceIdxList.length === 0) {
        priceIdxList = moneyShaped.map(c => c.i);
      }

      out.debug.picked = { headers, sampleCells, nameIdx, paIdIdx, codeIdx, priceIdxList, preferred: preferred ? preferred.h : null, moneyShaped };

      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td')).map(td => td.textContent.trim());
        if (cells.length < 2) continue;
        const visibleInputs = rows[i].querySelectorAll('input:not([type="hidden"]), select');
        if (visibleInputs.length > 0) continue;

        const description = nameIdx >= 0 ? (cells[nameIdx] || '') : '';
        const paItemId = paIdIdx >= 0 ? (cells[paIdIdx] || '') : '';
        const productCode = codeIdx >= 0 ? (cells[codeIdx] || '') : '';

        if (!description && !paItemId) continue;
        if (!paItemId || !/^\d+$/.test(paItemId)) continue;

        let packSize = '';
        const descParts = description.split(',');
        if (descParts.length > 1) packSize = descParts[descParts.length - 1].trim();

        // Table-level priceIdxList first
        let unitPrice = null;
        let priceSource = null;
        for (const idx of priceIdxList) {
          const raw = (cells[idx] || '').replace(/[^0-9.]/g, '');
          const parsed = parseFloat(raw);
          if (!isNaN(parsed) && parsed > 0) { unitPrice = parsed; priceSource = 'header:' + idx; break; }
        }
        // Per-row rescue: any money-shaped cell that isn't name/paId/code
        if (unitPrice === null) {
          for (let ci = 0; ci < cells.length; ci++) {
            if (ci === nameIdx || ci === paIdIdx || ci === codeIdx) continue;
            const v = (cells[ci] || '').replace(/,/g, '');
            if (/^\$\s*\d+(\.\d{1,2})?$|^\d+\.\d{1,2}$/.test(v)) {
              const parsed = parseFloat(v.replace(/[^0-9.]/g, ''));
              if (!isNaN(parsed) && parsed > 0) { unitPrice = parsed; priceSource = 'rowscan:' + ci; break; }
            }
          }
        }

        if (out.debug.sampleRows.length < 5) {
          out.debug.sampleRows.push({ desc: description, cells, unitPrice, priceSource });
        }

        out.results.push({
          pa_item_id: paItemId,
          pa_product_id: paItemId,
          master_product_code: productCode || null,
          description,
          pack_size: packSize,
          category: 'Produce',
          unit_price: unitPrice,
          product_code: productCode || null,
        });
      }

      if (out.results.length > 0) break;
    }

    return out;
  });

  const items = evalResult.results;
  console.log(`   🔎 PA_DBG picked=${JSON.stringify(evalResult.debug.picked)}`);
  console.log(`   🔎 PA_DBG sampleRows=${JSON.stringify(evalResult.debug.sampleRows)}`);
  const priced = items.filter(i => i.unit_price != null).length;
  console.log(`   ${items.length > 0 ? '✅' : '⚠️'} Weekly Prices Report: ${items.length} items found (${priced} with price)`);
  
  // If weekly prices page yielded nothing, try fallback
  if (items.length === 0) {
    return await scrapeCatalogFallback(page, { restaurantId });
  }
  
  return items;
}

// ── Fallback: restaurantOrderSort.jsp ──
async function scrapeCatalogFallback(page, { restaurantId }) {
  const url = `${PA_BASE_URL}/restaurantOrderSort.jsp?restaurantId=${restaurantId}`;
  console.log(`   📦 Fallback: Loading order sort page...`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

  try {
    await page.waitForSelector('table td', { timeout: 8000 });
  } catch {
    return [];
  }

  await page.waitForTimeout(500);

  const items = await page.evaluate(() => {
    const results = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      let currentCategory = '';

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());

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

        results.push({
          pa_item_id: itemCode,
          description,
          pack_size: packSize,
          category: currentCategory || null,
          unit_price: unitPrice > 0 ? unitPrice : null,
        });
      }

      if (results.length > 0) break;
    }

    return results;
  });

  console.log(`   ${items.length > 0 ? '✅' : '⚠️'} Fallback catalog: ${items.length} items found`);
  return items;
}

// ── Process catalog scrape for a single location ────────────────
async function processCatalogLocation(browser, location) {
  const { locationId, username, password, restaurantId } = location;
  console.log(`\n🗂️  [${locationId}] Scraping catalog...`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    const loggedIn = await loginToPA(page, { username, password });
    if (!loggedIn) {
      return { locationId, success: false, error: 'Login failed', items: 0 };
    }

    // Set PA designation so JSP pages route correctly
    await page.evaluate((rid) => {
      localStorage.setItem('urlDesignation', 'PA');
    }, restaurantId);

    // Navigate to ProduceAlliance.jsp first to establish JSP session
    await page.goto(`${PA_BASE_URL}/ProduceAlliance.jsp`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});

    const items = await scrapeCatalog(page, { restaurantId });

    if (items.length > 0) {
      // Post catalog items back to edge function
      const saveResp = await fetch(
        `${SUPABASE_URL}/functions/v1/produce-alliance-service`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-cron-secret': CRON_SECRET,
          },
          body: JSON.stringify({
            action: 'save_catalog',
            locationId,
            items,
          }),
        }
      );

      const saveResult = await saveResp.json();
      console.log(`   💾 Saved: ${saveResult.saved || 0} catalog items`);
      const pricedCount = items.filter(i => i.unit_price != null).length;
      const pick = (needle) => {
        const m = items.find(i => (i.description || '').toLowerCase().includes(needle));
        return m ? `${m.description}=${m.unit_price != null ? '$' + m.unit_price : 'null'}` : `${needle}=none`;
      };
      console.log(`   📊 LOC_SUMMARY location_id=${locationId} rows=${items.length} withPrice=${pricedCount} | ${pick('arugula')} | ${pick('basil')}`);
      return { locationId, success: true, items: items.length, saved: saveResult.saved || 0 };
    }

    return { locationId, success: true, items: 0, note: 'No items found on catalog page' };
  } catch (error) {
    console.error(`   ❌ [${locationId}] Catalog error:`, error.message);
    return { locationId, success: false, error: error.message, items: 0 };
  } finally {
    await context.close();
  }
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('🍅 Produce Alliance Headless Scraper');
  console.log('━'.repeat(40));

  const browser = await chromium.launch({ headless: true });

  // ── Phase 1: Catalog scrape (all PA locations) ──
  console.log('\n📦 Phase 1: Full catalog scrape');
  console.log('─'.repeat(30));
  try {
    let catalogLocations = await fetchAllPALocations();
    if (locationFilter) {
      catalogLocations = catalogLocations.filter(l => l.locationId === locationFilter);
    }
    if (catalogLocations.length > 0) {
      console.log(`Found ${catalogLocations.length} PA location(s) for catalog scrape`);
      for (const loc of catalogLocations) {
        const result = await processCatalogLocation(browser, loc);
        console.log(`   ${result.success ? '✅' : '❌'} ${loc.locationId}: ${result.items} items`);
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      console.log('ℹ️ No PA locations configured.');
    }
  } catch (err) {
    console.error('❌ Catalog scrape error:', err.message);
  }

  // ── Phase 2: Pending order scrape (orders missing line items) ──
  console.log('\n📄 Phase 2: Pending order scrape');
  console.log('─'.repeat(30));
  let totalOrders = 0;
  const allResults = [];

  try {
    let locations = await fetchPendingOrders();
    if (locationFilter && locations) {
      locations = locations.filter(l => l.locationId === locationFilter);
    }
    if (locations && locations.length > 0) {
      totalOrders = locations.reduce((sum, l) => sum + (l.pendingOrders?.length || 0), 0);
      console.log(`Found ${locations.length} location(s) with ${totalOrders} pending order(s)`);

      for (const location of locations) {
        const result = await processLocation(browser, location);
        allResults.push(result);
        if (locations.indexOf(location) < locations.length - 1) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    } else {
      console.log('ℹ️ No pending PA orders to scrape.');
    }
  } catch (err) {
    console.error('❌ Order scrape error:', err.message);
  }

  await browser.close();

  // ── Report ──
  const succeeded = allResults.filter(r => r.success);
  const totalScraped = allResults.reduce((sum, r) => sum + (r.scraped || 0), 0);

  console.log(`\n${'━'.repeat(40)}`);
  console.log(`📦 Orders scraped: ${totalScraped}/${totalOrders}`);

  const failed = allResults.filter(r => !r.success);
  if (failed.length > 0) {
    console.log(`❌ Failed locations: ${failed.length}`);
    for (const f of failed) {
      console.log(`   • ${f.locationId}: ${f.error}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
