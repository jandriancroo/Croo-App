/**
 * PFG Headless Login Script (Multi-Location)
 * 
 * Fetches all active PFG integrations from the database,
 * then uses Playwright to automate the OAuth login for each one.
 * 
 * Required environment variables (set as GitHub Secrets):
 *   SUPABASE_URL      - Supabase project URL
 *   SUPABASE_ANON_KEY - Supabase anon key
 */

import { chromium } from 'playwright';
import crypto from 'crypto';

// ── PFG Azure AD B2C Configuration ──────────────────────────────
const PFG_B2C_TENANT = 'pfgcustomerfirst';
const PFG_B2C_POLICY = 'b2c_1a_signup_signin';
const PFG_CLIENT_ID = 'c68e7fae-80a1-42db-bd89-3fb37d1224a2';
const PFG_REDIRECT_URI = 'https://www.customerfirstsolutions.com';

// ── Environment ─────────────────────────────────────────────────
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

// ── PKCE Helpers ────────────────────────────────────────────────
function base64UrlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generatePKCE() {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash('sha256').update(verifier).digest()
  );
  return { verifier, challenge };
}

// ── Login a single location ─────────────────────────────────────
async function loginLocation(browser, { locationId, username, password }) {
  const pkce = generatePKCE();
  const state = crypto.randomUUID();

  const authorizeUrl =
    `https://${PFG_B2C_TENANT}.b2clogin.com/${PFG_B2C_TENANT}.onmicrosoft.com/${PFG_B2C_POLICY}/oauth2/v2.0/authorize?` +
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

  console.log(`\n🔑 [${locationId}] Starting login for ${username}...`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let authCode = null;

  try {
    // Listen for the redirect that contains the auth code
    page.on('framenavigated', (frame) => {
      const url = frame.url();
      if (url.startsWith(PFG_REDIRECT_URI) && url.includes('code=')) {
        const fragment = new URL(url.replace('#', '?')).searchParams;
        authCode = fragment.get('code');
      }
    });

    await page.goto(authorizeUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Find email field
    const emailSelector = await Promise.race([
      page.waitForSelector('#signInName', { timeout: 15000 }).then(() => '#signInName'),
      page.waitForSelector('#email', { timeout: 15000 }).then(() => '#email'),
      page.waitForSelector('input[type="email"]', { timeout: 15000 }).then(() => 'input[type="email"]'),
      page.waitForSelector('input[name="loginfmt"]', { timeout: 15000 }).then(() => 'input[name="loginfmt"]'),
    ]).catch(() => null);

    if (!emailSelector) {
      throw new Error('Could not find email input on login page');
    }

    await page.fill(emailSelector, username);

    // Find password field
    const passwordSelector = await Promise.race([
      page.waitForSelector('#password', { timeout: 5000 }).then(() => '#password'),
      page.waitForSelector('input[type="password"]', { timeout: 5000 }).then(() => 'input[type="password"]'),
    ]).catch(() => null);

    if (!passwordSelector) {
      throw new Error('Could not find password input');
    }

    await page.fill(passwordSelector, password);

    // Click sign in
    const submitSelector = await Promise.race([
      page.waitForSelector('#next', { timeout: 5000 }).then(() => '#next'),
      page.waitForSelector('button[type="submit"]', { timeout: 5000 }).then(() => 'button[type="submit"]'),
      page.waitForSelector('#idSIButton9', { timeout: 5000 }).then(() => '#idSIButton9'),
    ]).catch(() => null);

    if (!submitSelector) {
      throw new Error('Could not find submit button');
    }

    await page.click(submitSelector);

    // Wait for redirect
    await page.waitForURL(`${PFG_REDIRECT_URI}**`, { timeout: 30000 }).catch(() => {});

    if (!authCode) {
      const finalUrl = page.url();
      if (finalUrl.includes('code=')) {
        const fragment = new URL(finalUrl.replace('#', '?')).searchParams;
        authCode = fragment.get('code');
      }
    }

    if (!authCode) {
      const errorText = await page.textContent('.error, .errorMessage, #errorMessage').catch(() => null);
      throw new Error(errorText ? `Login error: ${errorText.trim()}` : 'No authorization code received');
    }

    console.log(`   ✅ [${locationId}] Got auth code, exchanging...`);

    // Exchange code via edge function
    const exchangeResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/pfg-service?action=oauth_exchange`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          locationId,
          code: authCode,
          codeVerifier: pkce.verifier,
        }),
      }
    );

    const result = await exchangeResponse.json();

    if (!exchangeResponse.ok || result.error) {
      throw new Error(`Token exchange failed: ${JSON.stringify(result)}`);
    }

    console.log(`   🎉 [${locationId}] Token refresh successful!`);
    return { locationId, success: true };

  } catch (error) {
    console.error(`   ❌ [${locationId}] Failed: ${error.message}`);
    return { locationId, success: false, error: error.message };
  } finally {
    await context.close();
  }
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  // 1. Fetch all active PFG integrations from the database
  console.log('📡 Fetching active PFG integrations...');

  const listResponse = await fetch(
    `${SUPABASE_URL}/functions/v1/pfg-service?action=list_active_integrations`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({}),
    }
  );

  const { locations } = await listResponse.json();

  if (!locations || locations.length === 0) {
    console.log('ℹ️ No active PFG integrations with stored credentials found.');
    return;
  }

  console.log(`📋 Found ${locations.length} PFG integration(s) to refresh\n`);

  // 2. Launch browser once, reuse for all locations
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const loc of locations) {
    const result = await loginLocation(browser, loc);
    results.push(result);
    // Small delay between locations to avoid rate limiting
    if (locations.indexOf(loc) < locations.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  await browser.close();

  // 3. Report results
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Succeeded: ${succeeded.length}/${results.length}`);

  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length}`);
    for (const f of failed) {
      console.log(`   • ${f.locationId}: ${f.error}`);
    }

    // Report failures to edge function
    for (const f of failed) {
      await fetch(
        `${SUPABASE_URL}/functions/v1/pfg-service?action=headless_login_failed`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            locationId: f.locationId,
            error: f.error,
          }),
        }
      ).catch(() => {});
    }

    // Exit with error if any failed
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
