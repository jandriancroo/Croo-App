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

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
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
        if (!itemCode || !/^\d{3,}$/.test(itemCode)) continue;
        
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
    
    return { lineItems, deliveryDate, totalCases, totalAmount };
  });
  
  console.log(`   ${orderData.lineItems.length > 0 ? '✅' : '⚠️'} Order ${webOrderId}: ${orderData.lineItems.length} line items`);
  return orderData;
}

// ── Login to PA portal ──────────────────────────────────────────
async function loginToPA(page, { username, password }) {
  console.log(`   🔑 Logging in as ${username}...`);
  
  // Navigate to the Angular app login
  await page.goto(`${PA_BASE_URL}/ng/`, { waitUntil: 'networkidle', timeout: 30000 });
  
  // The Angular app uses OAuth2 — we need to find the login form
  // First check if we're already on a login page or need to find one
  const content = await page.content();
  
  if (content.includes('Sign in') || content.includes('j_security_check') || content.includes('login')) {
    // Try to find and fill login form
    const usernameSelector = await Promise.race([
      page.waitForSelector('#username', { timeout: 5000 }).then(() => '#username'),
      page.waitForSelector('#signInName', { timeout: 5000 }).then(() => '#signInName'),
      page.waitForSelector('input[name="username"]', { timeout: 5000 }).then(() => 'input[name="username"]'),
      page.waitForSelector('input[name="j_username"]', { timeout: 5000 }).then(() => 'input[name="j_username"]'),
      page.waitForSelector('input[type="text"]', { timeout: 5000 }).then(() => 'input[type="text"]'),
    ]).catch(() => null);
    
    if (usernameSelector) {
      await page.fill(usernameSelector, username);
      
      const passwordSelector = await Promise.race([
        page.waitForSelector('#password', { timeout: 3000 }).then(() => '#password'),
        page.waitForSelector('input[type="password"]', { timeout: 3000 }).then(() => 'input[type="password"]'),
        page.waitForSelector('input[name="j_password"]', { timeout: 3000 }).then(() => 'input[name="j_password"]'),
      ]).catch(() => null);
      
      if (passwordSelector) {
        await page.fill(passwordSelector, password);
        
        const submitSelector = await Promise.race([
          page.waitForSelector('button[type="submit"]', { timeout: 3000 }).then(() => 'button[type="submit"]'),
          page.waitForSelector('input[type="submit"]', { timeout: 3000 }).then(() => 'input[type="submit"]'),
          page.waitForSelector('#loginButton', { timeout: 3000 }).then(() => '#loginButton'),
        ]).catch(() => null);
        
        if (submitSelector) {
          await page.click(submitSelector);
          await page.waitForLoadState('networkidle', { timeout: 15000 });
        }
      }
    }
  }
  
  // Also try OAuth2 login via API (set tokenStore in localStorage like the Angular app does)
  const tokenResult = await page.evaluate(async ({ username, password, baseUrl }) => {
    try {
      const clientId = 'fc-client-2.0';
      const clientSecret = 'fc-client-secret';
      const basicAuth = btoa(`${clientId}:${clientSecret}`);
      const deviceId = crypto.randomUUID();
      
      const resp = await fetch(`${baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Authorization': `Basic ${basicAuth}`,
          'Accept': 'application/json',
        },
        body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&grant_type=password&device_id=${deviceId}&client_id=${clientId}`,
      });
      
      if (resp.ok) {
        const data = await resp.json();
        if (data.access_token) {
          // Store in localStorage like the Angular app does
          localStorage.setItem('tokenStore', JSON.stringify({
            access_token: data.access_token,
            refresh_token: data.refresh_token || '',
            expires_by: String(Date.now() + (data.expires_in || 1800) * 1000),
          }));
          return { success: true, token: data.access_token };
        }
      }
      return { success: false };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, { username, password, baseUrl: PA_BASE_URL });
  
  if (tokenResult.success) {
    console.log(`   ✅ OAuth2 login successful, token stored in localStorage`);
    return true;
  }
  
  // Check if we're logged in by looking for logged-in indicators
  const isLoggedIn = await page.evaluate(() => {
    const token = localStorage.getItem('tokenStore');
    if (token) {
      try {
        const parsed = JSON.parse(token);
        return !!parsed.access_token;
      } catch { return false; }
    }
    return false;
  });
  
  if (!isLoggedIn) {
    console.log(`   ❌ Login failed for ${username}`);
    return false;
  }
  
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
  // Primary: Weekly Prices Report has ALL items with Master Product Name, PA Product ID, prices
  const url = `${PA_BASE_URL}/reports/restaurantWeeklyProducePricesReport.jsp?restaurantId=${restaurantId}`;
  console.log(`   📦 Loading weekly prices report...`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

  // Wait for the table to render
  try {
    await page.waitForSelector('table td', { timeout: 10000 });
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

  const items = await page.evaluate(() => {
    const results = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const headerRow = table.querySelector('tr');
      if (!headerRow) continue;
      
      const headers = Array.from(headerRow.querySelectorAll('th, td'))
        .map(cell => cell.textContent.trim().toLowerCase());
      
      // Look for the table with "master product name" or "pa product id" headers
      const hasProductName = headers.some(h => h.includes('master product name') || h.includes('product name'));
      const hasPaId = headers.some(h => h.includes('pa product id') || h.includes('product id'));
      
      if (!hasProductName && !hasPaId) continue;
      
      // Find column indices
      const nameIdx = headers.findIndex(h => h.includes('master product name') || h.includes('product name'));
      const paIdIdx = headers.findIndex(h => h.includes('pa product id') || h.includes('product id'));
      const codeIdx = headers.findIndex(h => h.includes('master product code') || h.includes('product code'));
      // Look for price columns
      const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('cost'));
      
      const rows = table.querySelectorAll('tr');
      for (let i = 1; i < rows.length; i++) { // Skip header
        const cells = Array.from(rows[i].querySelectorAll('td')).map(td => td.textContent.trim());
        if (cells.length < 2) continue;
        
        // Skip filter/input rows
        const hasInput = rows[i].querySelector('input');
        if (hasInput) continue;
        
        const description = nameIdx >= 0 ? (cells[nameIdx] || '') : '';
        const paItemId = paIdIdx >= 0 ? (cells[paIdIdx] || '') : '';
        const productCode = codeIdx >= 0 ? (cells[codeIdx] || '') : '';
        
        if (!description && !paItemId) continue;
        if (!paItemId || !/^\d+$/.test(paItemId)) continue;
        
        // Extract pack size from the description (e.g., "Strawberries, lb." or "Tomatoes, Grape, 10 lb.")
        let packSize = '';
        const descParts = description.split(',');
        if (descParts.length > 1) {
          packSize = descParts[descParts.length - 1].trim();
        }
        
        let unitPrice = null;
        if (priceIdx >= 0 && cells[priceIdx]) {
          const parsed = parseFloat(cells[priceIdx].replace(/[$,]/g, ''));
          if (!isNaN(parsed) && parsed > 0) unitPrice = parsed;
        }

        results.push({
          pa_item_id: paItemId,
          description,
          pack_size: packSize,
          category: 'Produce',
          unit_price: unitPrice,
          product_code: productCode || null,
        });
      }

      if (results.length > 0) break; // Found the right table
    }

    return results;
  });

  console.log(`   ${items.length > 0 ? '✅' : '⚠️'} Weekly Prices Report: ${items.length} items found`);
  
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

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  try {
    await page.waitForSelector('table td', { timeout: 15000 });
  } catch {
    return [];
  }

  await page.waitForTimeout(3000);

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
    await page.goto(`${PA_BASE_URL}/ProduceAlliance.jsp`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

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
    const catalogLocations = await fetchAllPALocations();
    if (catalogLocations.length > 0) {
      console.log(`Found ${catalogLocations.length} PA location(s) for catalog scrape`);
      for (const loc of catalogLocations) {
        const result = await processCatalogLocation(browser, loc);
        console.log(`   ${result.success ? '✅' : '❌'} ${loc.locationId}: ${result.items} items`);
        await new Promise(r => setTimeout(r, 3000));
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
    const locations = await fetchPendingOrders();
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
