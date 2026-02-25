/**
 * PFG Headless Login Script
 * 
 * Uses Playwright to automate PFG's Azure AD B2C login flow,
 * captures the OAuth authorization code, and sends it to our
 * edge function to exchange for fresh tokens.
 * 
 * Required environment variables (set as GitHub Secrets):
 *   PFG_USERNAME      - PFG login email
 *   PFG_PASSWORD      - PFG login password
 *   SUPABASE_URL      - Supabase project URL
 *   SUPABASE_ANON_KEY - Supabase anon key
 *   PFG_LOCATION_ID   - CrooHQ location UUID for this PFG account
 */

import { chromium } from 'playwright';
import crypto from 'crypto';

// ── PFG Azure AD B2C Configuration ──────────────────────────────
const PFG_B2C_TENANT = 'pfgcustomerfirst';
const PFG_B2C_POLICY = 'b2c_1a_signup_signin';
const PFG_CLIENT_ID = 'c68e7fae-80a1-42db-bd89-3fb37d1224a2';
const PFG_REDIRECT_URI = 'https://www.customerfirstsolutions.com';

// ── Environment ─────────────────────────────────────────────────
const {
  PFG_USERNAME,
  PFG_PASSWORD,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  PFG_LOCATION_ID,
} = process.env;

if (!PFG_USERNAME || !PFG_PASSWORD || !SUPABASE_URL || !SUPABASE_ANON_KEY || !PFG_LOCATION_ID) {
  console.error('❌ Missing required environment variables');
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

// ── Main ────────────────────────────────────────────────────────
async function main() {
  const pkce = generatePKCE();
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

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
      nonce,
      state,
    }).toString();

  console.log('🔑 Starting PFG headless login...');

  const browser = await chromium.launch({ headless: true });
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
        // Extract code from fragment (#code=XXX&state=YYY)
        const fragment = new URL(url.replace('#', '?')).searchParams;
        authCode = fragment.get('code');
        console.log('✅ Captured authorization code');
      }
    });

    // Navigate to the authorize URL
    console.log('📡 Navigating to PFG login page...');
    await page.goto(authorizeUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the login form to appear
    // Azure B2C typically uses these selectors
    console.log('📝 Waiting for login form...');
    
    // Try common B2C selectors
    const emailSelector = await Promise.race([
      page.waitForSelector('#signInName', { timeout: 15000 }).then(() => '#signInName'),
      page.waitForSelector('#email', { timeout: 15000 }).then(() => '#email'),
      page.waitForSelector('input[type="email"]', { timeout: 15000 }).then(() => 'input[type="email"]'),
      page.waitForSelector('input[name="loginfmt"]', { timeout: 15000 }).then(() => 'input[name="loginfmt"]'),
    ]).catch(() => null);

    if (!emailSelector) {
      // Take a screenshot for debugging
      await page.screenshot({ path: '/tmp/pfg-login-page.png' });
      throw new Error('Could not find email input on login page');
    }

    console.log(`📧 Found email field: ${emailSelector}`);
    await page.fill(emailSelector, PFG_USERNAME);

    // Find and fill password
    const passwordSelector = await Promise.race([
      page.waitForSelector('#password', { timeout: 5000 }).then(() => '#password'),
      page.waitForSelector('input[type="password"]', { timeout: 5000 }).then(() => 'input[type="password"]'),
    ]).catch(() => null);

    if (!passwordSelector) {
      throw new Error('Could not find password input');
    }

    console.log('🔒 Filling password...');
    await page.fill(passwordSelector, PFG_PASSWORD);

    // Click the sign-in button
    const submitSelector = await Promise.race([
      page.waitForSelector('#next', { timeout: 5000 }).then(() => '#next'),
      page.waitForSelector('button[type="submit"]', { timeout: 5000 }).then(() => 'button[type="submit"]'),
      page.waitForSelector('#idSIButton9', { timeout: 5000 }).then(() => '#idSIButton9'),
    ]).catch(() => null);

    if (!submitSelector) {
      throw new Error('Could not find submit button');
    }

    console.log('🖱️ Clicking sign in...');
    await page.click(submitSelector);

    // Wait for redirect with the auth code
    console.log('⏳ Waiting for OAuth redirect...');
    await page.waitForURL(`${PFG_REDIRECT_URI}**`, { timeout: 30000 }).catch(() => {});

    // Also check the final URL manually
    if (!authCode) {
      const finalUrl = page.url();
      if (finalUrl.includes('code=')) {
        const fragment = new URL(finalUrl.replace('#', '?')).searchParams;
        authCode = fragment.get('code');
        console.log('✅ Captured authorization code from final URL');
      }
    }

    if (!authCode) {
      // Check if there's an error on the page
      const errorText = await page.textContent('.error, .errorMessage, #errorMessage').catch(() => null);
      if (errorText) {
        throw new Error(`Login error: ${errorText.trim()}`);
      }
      throw new Error('No authorization code received after login');
    }

  } finally {
    await browser.close();
  }

  // ── Exchange the code via our edge function ───────────────────
  console.log('🔄 Exchanging code for tokens via edge function...');
  
  const exchangeResponse = await fetch(
    `${SUPABASE_URL}/functions/v1/pfg-service?action=oauth_exchange`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        locationId: PFG_LOCATION_ID,
        code: authCode,
        codeVerifier: pkce.verifier,
      }),
    }
  );

  const result = await exchangeResponse.json();

  if (!exchangeResponse.ok || result.error) {
    console.error('❌ Token exchange failed:', result);
    process.exit(1);
  }

  console.log('🎉 PFG token refresh successful!');
  console.log(`   Location: ${PFG_LOCATION_ID}`);
  console.log(`   Authenticated: ${result.authenticated}`);
  console.log(`   Customer ID: ${result.customerId || 'N/A'}`);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
