import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isInventoryEnabled, filterEnabledLocations, inventoryDisabledResponse } from "../_shared/inventoryGate.ts";
import { requireAuthorizedCaller } from '../_shared/callerAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

// Result type so callers can surface real B2C error codes (AADB2C90080, etc.)
// instead of a generic null.
type RefreshResult =
  | { ok: true; token: TokenResponse }
  | { ok: false; outcome: 'b2c_error' | 'b2c_timeout' | 'network_error'; status?: number; errorCode?: string; errorDescription?: string; raw?: string };

// 10s hard cap — if B2C hangs past this, we release the DB lock and let the next
// caller try with a fresh attempt instead of pinning the row indefinitely.
const B2C_TIMEOUT_MS = 10_000;

// Refresh tokens are JWTs that share a long, identical header prefix
// (kid + alg + ver). Real-world inspection of pfg_refresh_audit confirmed
// every token starts with `eyJraWQiOiJB...` so logging the first 16 chars
// is useless for disambiguation. We capture chars 30..60 — that's the start
// of the payload section, where the token identity actually diverges — plus
// the last 8 chars of the signature for tie-breaking.
const TOKEN_PREFIX_LEN = 30;          // skip the shared JWT header
const TOKEN_PREFIX_WINDOW = 30;       // capture this many chars of payload

// Returns a fingerprint that's safe to log AND actually distinguishes JWTs.
function tokenFingerprint(t: string | null | undefined): string | null {
  if (!t) return null;
  const mid = t.slice(TOKEN_PREFIX_LEN, TOKEN_PREFIX_LEN + TOKEN_PREFIX_WINDOW);
  const tail = t.slice(-8);
  return `${mid}…${tail}`;
}

// Refresh an existing token. NEVER persists — caller is responsible for the locked write.
async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  console.log('[PFG Auth] Refreshing access token (token prefix:', refreshToken.slice(0, 12), ')');

  const params = new URLSearchParams({
    client_id: PFG_CLIENT_ID,
    scope: PFG_SCOPE,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_info: '1',
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), B2C_TIMEOUT_MS);

  try {
    const response = await fetch(PFG_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await response.text();

    if (!response.ok) {
      // Try to parse Azure B2C's structured error so the UI / logs see the real code.
      let errorCode: string | undefined;
      let errorDescription: string | undefined;
      try {
        const j = JSON.parse(text);
        errorCode = j.error;
        errorDescription = j.error_description;
      } catch { /* not JSON, fall through */ }

      console.error('[PFG Auth] Token refresh failed:', response.status, errorCode || '(no code)', errorDescription || text.slice(0, 300));
      return { ok: false, outcome: 'b2c_error', status: response.status, errorCode, errorDescription, raw: text.slice(0, 500) };
    }

    const tokenData = JSON.parse(text) as TokenResponse;
    console.log('[PFG Auth] Token refresh successful. expires_in:', tokenData.expires_in, 'refresh_token_expires_in:', tokenData.refresh_token_expires_in);
    return { ok: true, token: tokenData };
  } catch (error) {
    clearTimeout(timeoutId);
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    console.error('[PFG Auth] Refresh error:', isAbort ? `timeout after ${B2C_TIMEOUT_MS}ms` : error);
    return {
      ok: false,
      outcome: isAbort ? 'b2c_timeout' : 'network_error',
      errorDescription: isAbort ? `B2C timeout after ${B2C_TIMEOUT_MS}ms` : (error instanceof Error ? error.message : String(error)),
    };
  }
}

// Forensic audit insert — fire-and-forget, never blocks the refresh path.
async function logRefreshAudit(supabase: any, row: {
  integration_id: string;
  location_id?: string | null;
  handler: string;
  caller_action?: string | null;
  outcome:
    | 'swapped' | 'lost_race' | 'b2c_error' | 'b2c_timeout'
    | 'no_token' | 'network_error'
    | 'ropc_recovery' | 'ropc_failed' | 'no_ropc_credentials';
  b2c_error_code?: string | null;
  b2c_error_message?: string | null;
  duration_ms?: number;
  old_token_prefix?: string | null;
  new_token_prefix?: string | null;
}): Promise<void> {
  try {
    await supabase.from('pfg_refresh_audit').insert(row);
  } catch (e) {
    console.error('[PFG Audit] Failed to write audit row:', e);
  }
}

// Hard-coded super-admin to attribute system-generated tickets to.
// Required because support_tickets.user_id is NOT NULL with FK to profiles.
const SYSTEM_TICKET_OWNER_ID = 'a2e81a39-0e0b-47b1-a1aa-0e53f3869d37';

// Auto-create a deduped support ticket when a PFG refresh chain breaks.
// One open ticket per location at a time — close/resolve it to allow a new one.
// Gated by a failure-streak check so a single transient failure does not
// open a ticket. Requires N consecutive ropc_failed outcomes inside a window.
const CHAIN_BROKEN_MIN_FAILURES = 3;
const CHAIN_BROKEN_WINDOW_MIN = 30;

async function maybeCreateChainBrokenTicket(
  supabase: any,
  locationId: string,
  failReason: string,
): Promise<void> {
  try {
    // Streak gate — only open a ticket after repeated failures within window.
    const sinceIso = new Date(Date.now() - CHAIN_BROKEN_WINDOW_MIN * 60_000).toISOString();
    const { data: recent } = await supabase
      .from('pfg_refresh_audit')
      .select('outcome, created_at')
      .eq('location_id', locationId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(20);

    const failCount = (recent || []).filter((r: any) =>
      r.outcome === 'ropc_failed' || r.outcome === 'refresh_failed'
    ).length;

    if (failCount < CHAIN_BROKEN_MIN_FAILURES) {
      console.log(`[PFG Ticket] Streak gate: ${failCount}/${CHAIN_BROKEN_MIN_FAILURES} failures in last ${CHAIN_BROKEN_WINDOW_MIN}m for ${locationId} — not opening ticket yet`);
      return;
    }

    const { data: loc } = await supabase
      .from('locations')
      .select('name')
      .eq('id', locationId)
      .maybeSingle();
    const locName = loc?.name || locationId;

    const dedupMarker = `[pfg-chain-broken:${locationId}]`;

    const { data: existing } = await supabase
      .from('support_tickets')
      .select('id')
      .eq('status', 'open')
      .ilike('description', `%${dedupMarker}%`)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      console.log(`[PFG Ticket] Dedup hit for ${locName} — open ticket ${existing.id} exists`);
      return;
    }

    const description = [
      `${dedupMarker}`,
      ``,
      `🚨 PFG token refresh chain BROKEN for ${locName}.`,
      ``,
      `Both the standard refresh AND the ROPC password fallback failed`,
      `${CHAIN_BROKEN_MIN_FAILURES}+ times in the last ${CHAIN_BROKEN_WINDOW_MIN} minutes.`,
      `A manager needs to manually reconnect PFG in Settings → Integrations.`,
      ``,
      `Failure detail: ${failReason}`,
      ``,
      `Generated automatically by pfg-service keep-alive at ${new Date().toISOString()}.`,
    ].join('\n');

    const { error: insertErr } = await supabase
      .from('support_tickets')
      .insert({
        user_id: SYSTEM_TICKET_OWNER_ID,
        category: 'broken_feature',
        description,
        occurrence_time: new Date().toISOString(),
        is_system: true,
      });

    if (insertErr) {
      console.error('[PFG Ticket] Insert failed:', insertErr);
    } else {
      console.log(`[PFG Ticket] Created chain-broken ticket for ${locName}`);
    }
  } catch (e) {
    console.error('[PFG Ticket] Unexpected error creating ticket:', e);
  }
}

// Auto-resolve any open chain-broken ticket for this location on a
// successful refresh. Keeps the inbox clean when the chain self-heals.
async function autoResolveChainBrokenTicket(
  supabase: any,
  locationId: string,
): Promise<void> {
  try {
    const dedupMarker = `[pfg-chain-broken:${locationId}]`;
    const { data: open } = await supabase
      .from('support_tickets')
      .select('id')
      .eq('status', 'open')
      .ilike('description', `%${dedupMarker}%`);
    if (!open || open.length === 0) return;
    const ids = open.map((r: any) => r.id);
    const { error } = await supabase
      .from('support_tickets')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .in('id', ids);
    if (error) {
      console.error('[PFG Ticket] Auto-resolve failed:', error);
    } else {
      console.log(`[PFG Ticket] Auto-resolved ${ids.length} chain-broken ticket(s) for ${locationId}`);
    }
  } catch (e) {
    console.error('[PFG Ticket] Auto-resolve unexpected error:', e);
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

// Some PFG divisions return BOTH a national and a division SKU in one field,
// e.g. "104752, EL681". Split into individual codes so matching can try each.
const splitItemNumbers = (raw: unknown): string[] => {
  if (raw == null) return [];
  return String(raw)
    .split(/[,;/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

// Parse the inner-pack quantity (sleeves / bundles / inner boxes) from a free-form
// product description or name. PFG packSize gives us only outer/inner case structure
// ("6 / 1 LB"), but the inner-pack tier (e.g. 50 cups per sleeve, 25 boxes per bundle)
// shows up in the description text. Patterns recognized:
//   "50/slv", "50/sleeve", "50 per sleeve"
//   "25/bundle", "25/bdl", "25/bx"
//   "100/pk", "100/pack", "100/inner", "300/cs 50 inner"
// Conservative: returns null if no clear "<N>/<word>" or "<N> per <word>" hit.
const parseInnerPackQuantity = (text: string | undefined | null): number | null => {
  if (!text) return null;
  const m = text.match(
    /(\d+)\s*(?:\/|\s+per\s+)\s*(slv|sleeve|sleeves|bdl|bundle|bundles|inner(?:\s+pack)?|pk|pack|packs|bx|box|boxes)\b/i,
  );
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 1 && n <= 10000) return n;
  }
  // "300/cs 50 inner" style — number directly before "inner"
  const m2 = text.match(/(\d+)\s+inner\b/i);
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (Number.isFinite(n) && n > 1 && n <= 10000) return n;
  }
  return null;
};

// Parse a full PFG packSize string ("6 / 1 LB", "16 / 3.5 OZ", "1 / 1000CT")
// into a normalized conversion record. Returns null for malformed strings
// (e.g. "6 / #10 CN") so callers can skip them safely.
type ParsedPack = {
  outer_qty: number;
  inner_qty: number;
  inner_unit: string;       // 'lb' | 'oz' | 'kg' | 'gal' | 'ea'
  canonical_unit: string;   // 'oz' | 'ea'
  canonical_qty_per_inner: number;
};
const parsePackString = (packSize: string | undefined | null): ParsedPack | null => {
  if (!packSize) return null;
  const m = packSize.match(/^\s*(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$/);
  if (!m) return null;
  const outer_qty = parseInt(m[1], 10);
  const inner_qty = parseFloat(m[2]);
  const rawUnit = m[3].toLowerCase();
  if (!Number.isFinite(outer_qty) || !Number.isFinite(inner_qty) || outer_qty <= 0 || inner_qty <= 0) return null;
  let inner_unit = 'ea';
  let canonical_unit = 'ea';
  let canonical_qty_per_inner = inner_qty;
  switch (rawUnit) {
    case 'lb': case 'lbs':
      inner_unit = 'lb'; canonical_unit = 'oz'; canonical_qty_per_inner = inner_qty * 16; break;
    case 'oz':
      inner_unit = 'oz'; canonical_unit = 'oz'; canonical_qty_per_inner = inner_qty; break;
    case 'kg':
      inner_unit = 'kg'; canonical_unit = 'oz'; canonical_qty_per_inner = inner_qty * 35.274; break;
    case 'g':
      inner_unit = 'g'; canonical_unit = 'oz'; canonical_qty_per_inner = inner_qty * 0.03527; break;
    case 'ga': case 'gal':
      inner_unit = 'gal'; canonical_unit = 'oz'; canonical_qty_per_inner = inner_qty * 128; break;
    case 'ct': case 'ea': case 'each': case 'cn':
    default:
      inner_unit = 'ea'; canonical_unit = 'ea'; canonical_qty_per_inner = inner_qty; break;
  }
  return { outer_qty, inner_qty, inner_unit, canonical_unit, canonical_qty_per_inner };
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
      
      const rawItemNumber = product.DisplayProductNumber || product.ProductNumber || product.ProductKey;
      const skuTokens = splitItemNumbers(rawItemNumber);

      return {
        id: product.ProductKey || product.Id,
        itemNumber: skuTokens[0] || rawItemNumber,
        altItemNumbers: skuTokens,
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

// Upsert PFG bid/product-list items into pfg_bid_items cache for a location.
// Piggybacks on any categories fetch — no extra round-trips. Items not seen
// this run keep their old last_seen_at and naturally age out of Phase 2's
// 30-day freshness window.
//
// TODO(price-backfill): unit_price is intentionally NOT backfilled here. The
// list endpoint returns null prices for most items; resolving them requires a
// per-product fetchProductDetail call (~170 round-trips per location). The
// `categories` action does this on demand for the user-visible browse flow,
// which incrementally fills prices into pfg_bid_items via the piggyback.
// If we ever need fully-priced cache for analytics/reporting, add a
// dedicated `scrape_bid_prices` action as a separate scheduled job (e.g.
// weekly) — do not bolt it onto scrape_bid_all_locations.

async function upsertPfgBidItems(
  supabase: any,
  locationId: string,
  categories: any[],
): Promise<{ upserted: number; skipped: number }> {
  if (!locationId || !Array.isArray(categories) || categories.length === 0) {
    return { upserted: 0, skipped: 0 };
  }

  const seen = new Map<string, any>(); // dedupe by item_number within run
  for (const cat of categories) {
    const categoryName = cat?.name || null;
    for (const p of (cat?.products || [])) {
      const itemNumber = p?.itemNumber;
      if (!itemNumber) continue;
      const key = String(itemNumber);
      if (seen.has(key)) continue;
      seen.set(key, {
        location_id: locationId,
        item_number: key,
        description: p?.fullDescription || p?.name || '',
        pack_size: p?.packSize || null,
        category: categoryName,
        brand_name: p?.brand || null,
        unit_price: typeof p?.price === 'number' && p.price > 0 ? p.price : null,
        last_seen_at: new Date().toISOString(),
      });
    }
  }

  if (seen.size === 0) return { upserted: 0, skipped: 0 };

  const rows = Array.from(seen.values());
  // Chunk to keep payloads sane
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('pfg_bid_items')
      .upsert(chunk, { onConflict: 'location_id,item_number' });
    if (error) {
      console.warn('[PFG bid cache] Upsert chunk failed:', error.message);
    } else {
      upserted += chunk.length;
    }
  }
  console.log(`[PFG bid cache] Upserted ${upserted}/${rows.length} items for location ${locationId}`);
  return { upserted, skipped: rows.length - upserted };
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
  
  // NOTE: the bulk list endpoints (GetCustomers / GetAllCustomers /
  // GetCustomerList) can return tens of megabytes on broadline logins, which
  // exceeds the function's memory limit before we can slim the rows. Store IDs
  // are configured per location instead, so we only ask for this login's own
  // customer record.
  const endpoints = [
    '/Customer/V1/GetCustomer',
    '/Account/V1/GetCustomerInfo',
  ];

  
  // Probe endpoints and merge. The single-customer endpoint often answers
  // first with a placeholder record (CustomerNumber "00000") on TRACS Direct
  // logins, while the *list* endpoints hold the real multi-store accounts.
  // Records are slimmed immediately — the raw list endpoints can return tens of
  // thousands of rows and blow the function's memory budget.
  const MAX_CUSTOMERS = 300;
  const slim = (c: any) => ({
    CustomerId: c?.CustomerId ?? c?.Id ?? null,
    CustomerNumber: c?.CustomerNumber ?? null,
    DeliverToCustomerNumber: c?.DeliverToCustomerNumber ?? null,
    CustomerName: c?.CustomerName ?? c?.Name ?? c?.DeliverToCustomerName ?? null,
    OperationCompanyNumber: c?.OperationCompanyNumber ?? null,
    BusinessUnitERPKey: c?.BusinessUnitERPKey ?? null,
  });

  const merged: any[] = [];
  let firstSingle: any = null;
  for (const path of endpoints) {
    if (merged.length >= MAX_CUSTOMERS) break;
    try {
      const data = await fetchPfgJson(path, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });
      const result = data?.ResultObject ?? data;
      const list = Array.isArray(result)
        ? result
        : Array.isArray(result?.Customers)
          ? result.Customers
          : null;
      if (list) {
        console.log('[PFG API] Found', list.length, 'customers at', path);
        for (const r of list.slice(0, MAX_CUSTOMERS - merged.length)) if (r) merged.push(slim(r));
      } else if (result && !firstSingle) {
        firstSingle = slim(result);
        console.log('[PFG API] Single customer at', path, '→', firstSingle.CustomerNumber, firstSingle.CustomerName);
      }
    } catch (err) {
      console.warn('[PFG API] Customer endpoint failed:', path, (err as Error).message?.slice(0, 100));
    }
  }

  if (merged.length > 0) {
    // Dedupe by customer number / id
    const seen = new Set<string>();
    const unique = merged.filter((c) => {
      const key = String(c?.CustomerNumber || c?.DeliverToCustomerNumber || c?.CustomerId || Math.random());
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (firstSingle) unique.push(firstSingle);
    return unique;
  }
  return firstSingle;
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
async function fetchOrderHistory(accessToken: string, customerId?: string, daysBack: number = 14): Promise<any> {
  console.log(`[PFG API] Fetching order history (merged strategy, ${daysBack} days back)`);

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - daysBack);
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
  auditCtx?: {
    supabase: any;
    integrationId: string;
    locationId: string | null;
    callerAction: string;
  },
): Promise<any[]> {
  // PFG returns a native DeliveryKey on the header — use it verbatim.
  // OpCo-specific formats vary (Hickory/770 returns a 3-part YYYYMMDD key;
  // others return a 4-part YYYY-MM-DD key). Reconstruction broke Hickory
  // entirely, so trust the source of truth first and only rebuild as a
  // last resort.
  const opCo = order.OrderOperationCompanyNumber || '428';
  const custNum = order.DeliverToCustomerNumber || '';
  const orderKey = order.OrderKey || order.OrderNumber;

  let deliveryKey: string | null = order.DeliveryKey || null;
  let keySource: 'native' | 'reconstructed' = 'native';

  if (!deliveryKey) {
    const deliveryDateRaw = order.DeliveryDate;
    if (!custNum || !deliveryDateRaw || !orderKey) {
      console.warn('[PFG API] No native DeliveryKey and cannot reconstruct — missing fields', {
        opCo, hasCustNum: !!custNum, hasDeliveryDate: !!deliveryDateRaw, hasOrderKey: !!orderKey,
      });
      return [];
    }
    const deliveryDateFormatted = parsePfgDate(deliveryDateRaw);
    if (!deliveryDateFormatted) {
      console.warn('[PFG API] No native DeliveryKey and cannot parse delivery date:', deliveryDateRaw);
      return [];
    }
    deliveryKey = `${opCo}_${custNum}_${deliveryDateFormatted}_${orderKey}`;
    keySource = 'reconstructed';
    console.warn('[PFG API] Falling back to reconstructed DeliveryKey (header had none):', deliveryKey);
  }

  console.log(`[PFG API] Fetching delivery detail (${keySource}), key:`, deliveryKey);

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
      if (auditCtx) {
        auditCtx.supabase.from('pfg_refresh_audit').insert({
          integration_id: auditCtx.integrationId,
          location_id: auditCtx.locationId,
          handler: 'fetchDeliveryDetail',
          caller_action: auditCtx.callerAction,
          outcome: 'detail_fetch_failed',
          b2c_error_code: 'non_array_result',
          b2c_error_message: `key=${deliveryKey} src=${keySource} orderKey=${orderKey}`,
        }).then(() => {}, (e: any) => console.error('[PFG Audit] insert failed:', e));
      }
      return [];
    }

    console.log(`[PFG API] Got ${items.length} line items for order ${orderKey} (key source: ${keySource})`);
    return items;
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500);
    console.warn(`[PFG API] DeliveryDetail failed for key (${keySource})`, deliveryKey, ':', msg);
    if (auditCtx) {
      auditCtx.supabase.from('pfg_refresh_audit').insert({
        integration_id: auditCtx.integrationId,
        location_id: auditCtx.locationId,
        handler: 'fetchDeliveryDetail',
        caller_action: auditCtx.callerAction,
        outcome: 'detail_fetch_failed',
        b2c_error_code: 'request_error',
        b2c_error_message: `key=${deliveryKey} src=${keySource} orderKey=${orderKey} :: ${msg}`,
      }).then(() => {}, (e: any) => console.error('[PFG Audit] insert failed:', e));
    }
    return [];
  }
}

// ============================================================================
// INVOICE DETAIL FETCH — POST /Invoice/V1/GetInvoiceDetails
// Reads existing pfg_orders rows; only new API calls are per-invoice details.
// ============================================================================
async function fetchInvoiceDetail(
  accessToken: string,
  args: {
    invoiceNumber: string;
    invoiceHeaderKey?: string | null;
    invoiceHeaderBusinessUnitERPKey?: number | null;
    invoiceHeaderOperationCompanyNumber?: string | null;
    operationCompanyNumber: string;
    customerNumber: string;
    customerId: string;
  },
  auditCtx?: { supabase: any; integrationId: string; locationId: string | null; callerAction: string },
): Promise<any | null> {
  // Verified body shape (captured from PFG portal network trace on Invoice 4514533):
  //   { Invoices: [{ BusinessUnitERPKey, InvoiceHeaderKey, OperationCompanyNumber, CustomerId }] }
  // The endpoint accepts a batch; we send one invoice per call so the per-invoice
  // error handling / audit logging downstream stays meaningful.
  const body = {
    Invoices: [
      {
        BusinessUnitERPKey: args.invoiceHeaderBusinessUnitERPKey ?? 0,
        InvoiceHeaderKey: args.invoiceHeaderKey ?? args.invoiceNumber,
        OperationCompanyNumber: args.invoiceHeaderOperationCompanyNumber ?? args.operationCompanyNumber,
        CustomerId: args.customerId,
      },
    ],
  };
  try {
    const data = await fetchPfgJson(
      '/Invoice/V1/GetInvoiceDetails',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const result = data?.ResultObject ?? data ?? null;
    const len = Array.isArray(result) ? result.length : (result ? 'object' : 'null');
    console.log(`[PFG Invoice] ${args.invoiceNumber} → result length: ${len}`);
    return result;
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500);
    console.warn(`[PFG Invoice] GetInvoiceDetails failed for ${args.invoiceNumber}:`, msg);
    if (auditCtx) {
      auditCtx.supabase.from('pfg_refresh_audit').insert({
        integration_id: auditCtx.integrationId,
        location_id: auditCtx.locationId,
        handler: 'fetchInvoiceDetail',
        caller_action: auditCtx.callerAction,
        outcome: 'detail_fetch_failed',
        b2c_error_code: 'request_error',
        b2c_error_message: `invoice=${args.invoiceNumber} :: ${msg}`,
      }).then(() => {}, (e: any) => console.error('[PFG Audit] insert failed:', e));
    }
    return null;
  }
}

// Mirror of the line-item normalizer used by syncOrders (see ~L2121), plus
// invoice-only fields (weight, isCredit/creditAmount). Defensive on field
// names because the GetInvoiceDetails envelope is still being locked down
// against a live payload (smoke test on Hemet 4514533).
function normalizeInvoiceLineItem(item: any) {
  // Live GetInvoiceDetails payload puts UoM rows under `UnitOfMeasures` (verified
  // against Invoice 4514533 capture). Older drafts used `InvoiceDetailUnitOfMeasures`
  // / `DeliveryDetailUnitOfMeasures` — kept as fallbacks for safety.
  const uom = item.UnitOfMeasures?.[0]
    ?? item.InvoiceDetailUnitOfMeasures?.[0]
    ?? item.DeliveryDetailUnitOfMeasures?.[0]
    ?? {};
  const total = uom.ExtendedPrice ?? item.ExtendedPrice ?? item.LineTotal ?? 0;
  return {
    productId: item.ProductKey || item.InvoiceDetailProductKey || item.DeliveryDetailProductKey,
    itemNumber: uom.ProductNumber || item.ProductKey,
    name: item.ProductDescription || 'Unknown',
    brand: item.ProductBrand || null,
    category: item.ProductCategory || null,
    manufacturer: item.ManufacturerName || null,
    manufacturerProductNumber: item.ManufacturerProductNumber || null,
    gtin: item.GTIN || null,
    vendorNumber: item.VendorNumber || null,
    lineNumber: item.InvoiceDetailLineNumber ?? null,
    quantity: uom.QuantityOrdered ?? 0,
    quantityShipped: uom.QuantityShipped ?? 0,
    unit: 'CS',
    packSize: uom.ProductPackSize || null,
    price: uom.UnitPrice ?? 0,
    netPrice: uom.NetPrice ?? null,
    total,
    weight: uom.CatchWeightDisplay || item.CatchWeight || item.ActualWeight || item.ShippedWeight || null,
    isCatchWeight: uom.IsCatchWeight || false,
    isShorted: item.IsProductShorted || false,
    isCredit: total < 0,
    creditAmount: total < 0 ? Math.abs(total) : null,
  };
}

// syncRecentInvoices — reads existing pfg_orders rows (no GetDeliveries call),
// dedupes Invoices[] across last `days` days, fires GetInvoiceDetails per
// invoice, normalizes line items, computes novelty diff against last 90d of
// pfg_orders.items SKUs at this location, and upserts into pfg_invoices.
async function cascadeInvoicePricesToInventory(
  supabase: any,
  locationId: string,
  invoiceRows: Array<{ invoice_date: string | null; items: any }>,
): Promise<number> {
  const skuMeta = new Map<string, { price: number; invoiceDate: string }>();
  for (const inv of invoiceRows) {
    const dt = String(inv.invoice_date || '');
    if (!dt) continue;
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const li of items as any[]) {
      const sku = String(li?.itemNumber || li?.item_number || '').trim();
      const price = Number(li?.unit_price ?? li?.unitPrice ?? li?.price);
      if (!sku || !Number.isFinite(price) || price <= 0) continue;
      const ex = skuMeta.get(sku);
      if (!ex || dt > ex.invoiceDate) skuMeta.set(sku, { price, invoiceDate: dt });
    }
  }
  if (skuMeta.size === 0) return 0;

  const { data: locRow } = await supabase
    .from('locations')
    .select('organization_id, organizations:organization_id(brand_id)')
    .eq('id', locationId)
    .maybeSingle();
  const brandId = (locRow as any)?.organizations?.brand_id;
  if (!brandId) return 0;

  const skus = Array.from(skuMeta.keys());
  const skuToTemplate = new Map<string, string>();

  const { data: maps } = await supabase
    .from('brand_vendor_mappings')
    .select('brand_template_id, vendor_item_id, brand_inventory_templates!inner(brand_id)')
    .eq('vendor', 'pfg')
    .eq('brand_inventory_templates.brand_id', brandId)
    .in('vendor_item_id', skus);
  for (const m of (maps || [])) {
    skuToTemplate.set(String((m as any).vendor_item_id), (m as any).brand_template_id);
  }

  const { data: legacy } = await supabase
    .from('brand_inventory_templates')
    .select('id, item_number')
    .eq('brand_id', brandId)
    .in('item_number', skus);
  for (const t of (legacy || [])) {
    const num = String((t as any).item_number);
    if (!skuToTemplate.has(num)) skuToTemplate.set(num, (t as any).id);
  }
  if (skuToTemplate.size === 0) return 0;

  let stamped = 0;
  for (const [sku, meta] of skuMeta) {
    const tplId = skuToTemplate.get(sku);
    if (!tplId) continue;
    const invoiceIso = `${meta.invoiceDate}T00:00:00Z`;
    const nowIso = new Date().toISOString();
    const { count, error } = await supabase
      .from('inventory_items')
      .update(
        { cost_per_unit: meta.price, last_synced_at: nowIso, updated_at: nowIso },
        { count: 'exact' },
      )
      .eq('brand_item_id', tplId)
      .eq('location_id', locationId)
      .or(`cost_per_unit.is.null,last_synced_at.is.null,last_synced_at.lt.${invoiceIso}`);
    if (!error && count) stamped += count;
  }
  return stamped;
}

async function syncRecentInvoices(
  supabase: any,
  integration: { id: string; location_id: string; credentials: PFGCredentials },
  days = 3,
  opts: { backfillFromStored?: boolean } = {},
): Promise<{ invoicesProcessed: number; invoicesUpserted: number; failed: number; novelInvoices: number; pricesStamped: number; backfillStamped: number }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: orders, error } = await supabase
    .from('pfg_orders')
    .select('id, raw_data, delivery_date')
    .eq('location_id', integration.location_id)
    .gte('delivery_date', since);

  if (error) {
    console.warn('[PFG Invoice Sync] pfg_orders read failed:', error.message);
    return { invoicesProcessed: 0, invoicesUpserted: 0, failed: 0, novelInvoices: 0, pricesStamped: 0, backfillStamped: 0 };
  }

  type InvRef = {
    pfgDeliveryId: string;
    parentDeliveryDate: string | null;
    invoiceNumber: string;
    invoiceHeaderKey?: string;
    invoiceHeaderBusinessUnitERPKey?: number;
    invoiceHeaderOperationCompanyNumber?: string;
    opCo: string;
    custNum: string;
    customerIdHint?: string;
  };
  const refs = new Map<string, InvRef>();
  for (const o of orders ?? []) {
    const raw = (o as any).raw_data ?? {};
    const invoices: any[] = Array.isArray(raw.Invoices) ? raw.Invoices : [];
    const opCo = String(raw.OrderOperationCompanyNumber ?? raw.DeliveryOperationCompanyNumber ?? '428');
    const custNum = String(raw.DeliverToCustomerNumber ?? raw.CustomerNumber ?? '');
    const customerIdHint = raw.CustomerId ? String(raw.CustomerId) : undefined;
    for (const inv of invoices) {
      const invNum = String(inv.InvoiceNumber ?? '').trim();
      if (!invNum) continue;
      if (!refs.has(invNum)) {
        refs.set(invNum, {
          pfgDeliveryId: (o as any).id,
          parentDeliveryDate: (o as any).delivery_date ?? null,
          invoiceNumber: invNum,
          invoiceHeaderKey: inv.InvoiceHeaderKey ? String(inv.InvoiceHeaderKey) : undefined,
          invoiceHeaderBusinessUnitERPKey: typeof inv.InvoiceHeaderBusinessUnitERPKey === 'number'
            ? inv.InvoiceHeaderBusinessUnitERPKey
            : (inv.InvoiceHeaderBusinessUnitERPKey != null ? Number(inv.InvoiceHeaderBusinessUnitERPKey) : 0),
          invoiceHeaderOperationCompanyNumber: inv.InvoiceHeaderOperationCompanyNumber
            ? String(inv.InvoiceHeaderOperationCompanyNumber)
            : undefined,
          opCo,
          custNum,
          customerIdHint,
        });
      }
    }
  }

  console.log(`[PFG Invoice Sync] location=${integration.location_id} orders=${(orders ?? []).length} unique_invoices=${refs.size}`);

  if (refs.size === 0) {
    return { invoicesProcessed: 0, invoicesUpserted: 0, failed: 0, novelInvoices: 0, pricesStamped: 0, backfillStamped: 0 };
  }

  const tokenResult = await getValidAccessToken(
    supabase,
    integration.credentials,
    integration.id,
    integration.location_id,
    'sync_invoices',
  );
  if (!tokenResult) {
    console.warn('[PFG Invoice Sync] no token — skipping');
    return { invoicesProcessed: 0, invoicesUpserted: 0, failed: refs.size, novelInvoices: 0, pricesStamped: 0, backfillStamped: 0 };
  }
  const accessToken = tokenResult.accessToken;
  const customerId = integration.credentials.customer_id || '';

  // 90-day novelty baseline at this location.
  const ninety = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: baselineRows } = await supabase
    .from('pfg_orders')
    .select('items')
    .eq('location_id', integration.location_id)
    .gte('delivery_date', ninety);
  const knownSkus = new Set<string>();
  for (const r of baselineRows ?? []) {
    for (const it of ((r as any).items as any[] | null) ?? []) {
      const sku = String(it?.itemNumber ?? '').trim();
      if (sku) knownSkus.add(sku);
    }
  }

  const list = [...refs.values()];
  let upserted = 0;
  let failed = 0;
  let novelInvoices = 0;
  let pricesStamped = 0;
  let backfillStamped = 0;
  const auditCtx = {
    supabase,
    integrationId: integration.id,
    locationId: integration.location_id,
    callerAction: 'sync_invoices',
  };

  for (let i = 0; i < list.length; i += 5) {
    const batch = list.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((b) =>
        fetchInvoiceDetail(
          accessToken,
          {
            invoiceNumber: b.invoiceNumber,
            invoiceHeaderKey: b.invoiceHeaderKey,
            invoiceHeaderBusinessUnitERPKey: b.invoiceHeaderBusinessUnitERPKey,
            invoiceHeaderOperationCompanyNumber: b.invoiceHeaderOperationCompanyNumber,
            operationCompanyNumber: b.opCo,
            customerNumber: b.custNum,
            customerId: b.customerIdHint || customerId,
          },
          auditCtx,
        ),
      ),
    );

    const rows: any[] = [];
    for (let j = 0; j < results.length; j++) {
      const ref = batch[j];
      const r = results[j];
      if (r.status !== 'fulfilled' || !r.value) {
        failed++;
        continue;
      }
      const detail = r.value;
      // GetInvoiceDetails returns a FLAT array of line items under ResultObject —
      // no Header block, no invoice-level dates/totals (verified against live 4514533
      // capture). We derive subtotal from sum(ExtendedPrice) and default invoice_date
      // to the parent pfg_order's delivery_date until/unless we wire a header endpoint.
      const rawItems: any[] = Array.isArray(detail)
        ? detail
        : (detail.ResultObject ?? detail.Items ?? detail.InvoiceDetails ?? detail.InvoiceLines ?? []);
      const items = rawItems.map(normalizeInvoiceLineItem);

      const novelItems = items.filter((it) => it.itemNumber && !knownSkus.has(String(it.itemNumber)));
      const hasNovel = novelItems.length > 0;
      if (hasNovel) novelInvoices++;

      const subtotal = items.reduce((s, it) => s + (Number(it.total) || 0), 0);

      rows.push({
        location_id: integration.location_id,
        invoice_number: ref.invoiceNumber,
        invoice_header_key: ref.invoiceHeaderKey ?? null,
        operation_company_number: ref.opCo,
        customer_number: ref.custNum,
        pfg_delivery_id: ref.pfgDeliveryId,
        invoice_date: ref.parentDeliveryDate,
        delivery_date: ref.parentDeliveryDate,
        due_date: null,
        subtotal,
        tax: null,
        freight: null,
        total_amount: subtotal,
        status: '',
        items,
        raw_data: detail,
        has_novel_skus: hasNovel,
        novel_sku_count: novelItems.length,
        updated_at: new Date().toISOString(),
      });
    }

    if (rows.length) {
      const { error: upErr } = await supabase
        .from('pfg_invoices')
        .upsert(rows, { onConflict: 'location_id,invoice_number' });
      if (upErr) {
        console.warn('[PFG Invoice Sync] upsert error:', upErr.message);
        failed += rows.length;
      } else {
        upserted += rows.length;
        pricesStamped += await cascadeInvoicePricesToInventory(
          supabase, integration.location_id, rows,
        );
      }
    }
  }

  if (opts.backfillFromStored) {
    const since180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: stored } = await supabase
      .from('pfg_invoices')
      .select('invoice_date, items')
      .eq('location_id', integration.location_id)
      .gte('invoice_date', since180);
    if (stored?.length) {
      backfillStamped = await cascadeInvoicePricesToInventory(
        supabase, integration.location_id, stored,
      );
    }
  }

  console.log(`[PFG Invoice Sync] location=${integration.location_id} upserted=${upserted} failed=${failed} novel=${novelInvoices} pricesStamped=${pricesStamped} backfillStamped=${backfillStamped}`);
  return { invoicesProcessed: list.length, invoicesUpserted: upserted, failed, novelInvoices, pricesStamped, backfillStamped };
}

// ============================================================================
// HANDLER: action=sync_invoices
// Body: { locationId?: string }  — if omitted, runs all active PFG integrations.
// ============================================================================
async function handleSyncInvoices(supabase: any, body: any): Promise<Response> {
  const locationIds: string[] = body?.locationId ? [body.locationId] : [];
  let query = supabase
    .from('location_integrations')
    .select('id, location_id, credentials')
    .eq('integration_type', 'pfg')
    .eq('is_active', true);
  if (locationIds.length > 0) query = query.in('location_id', locationIds);

  const { data: integrationsRaw, error: intError } = await query;
  if (intError) throw new Error(`Failed to fetch integrations: ${intError.message}`);

  const enabledIds = await filterEnabledLocations(
    supabase,
    (integrationsRaw || []).map((i: any) => i.location_id),
  );
  const integrations = (integrationsRaw || []).filter((i: any) => enabledIds.has(i.location_id));

  if (integrations.length === 0) {
    return new Response(JSON.stringify({ success: true, message: 'No active PFG integrations', results: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const days = typeof body?.days === 'number' && body.days > 0 ? body.days : 3;
  const backfillFromStored = body?.backfill === true;
  const results: any[] = [];

  for (const integration of integrations) {
    const credentials = integration.credentials as unknown as PFGCredentials;
    if (!credentials?.refresh_token) {
      results.push({ locationId: integration.location_id, success: false, error: 'No credentials stored' });
      continue;
    }
    try {
      const summary = await syncRecentInvoices(
        supabase,
        { id: integration.id, location_id: integration.location_id, credentials },
        days,
        { backfillFromStored },
      );
      results.push({ locationId: integration.location_id, success: true, ...summary });
    } catch (err) {
      console.error('[PFG Invoice Sync] location failure:', integration.location_id, err);
      results.push({
        locationId: integration.location_id,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return new Response(JSON.stringify({ success: true, days, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// PROBE: try multiple endpoint/body shapes for invoice detail discovery.
// Body: { locationId, invoiceNumber }
// ============================================================================
async function handleProbeInvoiceDetail(supabase: any, body: any): Promise<Response> {
  const locationId = body?.locationId;
  const invoiceNumber = String(body?.invoiceNumber ?? '');
  if (!locationId || !invoiceNumber) {
    return new Response(JSON.stringify({ error: 'locationId and invoiceNumber required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: integration } = await supabase
    .from('location_integrations')
    .select('id, location_id, credentials')
    .eq('location_id', locationId)
    .eq('integration_type', 'pfg')
    .eq('is_active', true)
    .maybeSingle();
  if (!integration) {
    return new Response(JSON.stringify({ error: 'no pfg integration' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Pull the matching order row so we have every header field PFG returned.
  const { data: orderRow } = await supabase
    .from('pfg_orders')
    .select('raw_data')
    .eq('location_id', locationId)
    .filter('raw_data->Invoices->0->>InvoiceNumber', 'eq', invoiceNumber)
    .maybeSingle();
  const raw = (orderRow as any)?.raw_data ?? {};
  const inv = Array.isArray(raw.Invoices) ? raw.Invoices[0] : {};

  const credentials = integration.credentials as unknown as PFGCredentials;
  const tr = await getValidAccessToken(supabase, credentials, integration.id, locationId, 'probe_invoice_detail');
  if (!tr) {
    return new Response(JSON.stringify({ error: 'no token' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const token = tr.accessToken;
  const customerId = String(raw.CustomerId ?? credentials.customer_id ?? '');
  const opCo = String(inv.InvoiceHeaderOperationCompanyNumber ?? raw.OrderOperationCompanyNumber ?? raw.DeliveryOperationCompanyNumber ?? '428');
  const custNum = String(raw.DeliverToCustomerNumber ?? raw.CustomerNumber ?? '');
  const invHeaderKey = String(inv.InvoiceHeaderKey ?? invoiceNumber);
  const buERPKey = Number(inv.InvoiceHeaderBusinessUnitERPKey ?? 0);

  const probes: { label: string; method: string; path: string; body?: any }[] = [
    // Path variants
    { label: 'POST /Invoice/V1/GetInvoiceDetails (header-shaped)', method: 'POST', path: '/Invoice/V1/GetInvoiceDetails',
      body: { InvoiceHeaderBusinessUnitERPKey: buERPKey, InvoiceHeaderKey: invHeaderKey, InvoiceHeaderOperationCompanyNumber: opCo, CustomerId: customerId } },
    { label: 'POST /Invoice/V1/GetInvoiceDetail (singular)', method: 'POST', path: '/Invoice/V1/GetInvoiceDetail',
      body: { InvoiceHeaderBusinessUnitERPKey: buERPKey, InvoiceHeaderKey: invHeaderKey, InvoiceHeaderOperationCompanyNumber: opCo, CustomerId: customerId } },
    { label: 'POST /Invoice/V1/GetInvoice', method: 'POST', path: '/Invoice/V1/GetInvoice',
      body: { InvoiceHeaderBusinessUnitERPKey: buERPKey, InvoiceHeaderKey: invHeaderKey, InvoiceHeaderOperationCompanyNumber: opCo, CustomerId: customerId } },
    { label: 'POST /Invoice/V1/GetInvoiceDetails (number-shaped)', method: 'POST', path: '/Invoice/V1/GetInvoiceDetails',
      body: { InvoiceNumber: invoiceNumber, OperationCompanyNumber: opCo, CustomerNumber: custNum, CustomerId: customerId } },
    { label: 'POST /Invoice/V1/GetInvoiceDetails (url-triplet)', method: 'POST', path: '/Invoice/V1/GetInvoiceDetails',
      body: { InvoiceNumber: invoiceNumber, BusinessUnitERPKey: buERPKey, OperationCompanyNumber: opCo, CustomerId: customerId } },
    { label: 'GET /Invoice/V1/GetInvoiceDetails?…', method: 'GET',
      path: `/Invoice/V1/GetInvoiceDetails?InvoiceNumber=${invoiceNumber}&OperationCompanyNumber=${opCo}&BusinessUnitERPKey=${buERPKey}&CustomerId=${encodeURIComponent(customerId)}` },
    { label: 'POST /Delivery/V1/GetInvoiceDetails', method: 'POST', path: '/Delivery/V1/GetInvoiceDetails',
      body: { InvoiceHeaderBusinessUnitERPKey: buERPKey, InvoiceHeaderKey: invHeaderKey, InvoiceHeaderOperationCompanyNumber: opCo, CustomerId: customerId } },
  ];

  const results: any[] = [];
  for (const p of probes) {
    try {
      const data = await fetchPfgJson(
        p.path,
        {
          method: p.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          ...(p.body ? { body: JSON.stringify(p.body) } : {}),
        },
      );
      const ro = data?.ResultObject;
      const summary = {
        topKeys: data && typeof data === 'object' ? Object.keys(data) : null,
        resultObjectType: Array.isArray(ro) ? `array(${ro.length})` : typeof ro,
        resultObjectKeys: ro && !Array.isArray(ro) && typeof ro === 'object' ? Object.keys(ro) : null,
        firstElemKeys: Array.isArray(ro) && ro[0] && typeof ro[0] === 'object' ? Object.keys(ro[0]) : null,
        errorMessages: data?.ErrorMessages ?? null,
        isSuccess: data?.IsSuccess ?? null,
      };
      results.push({ ...p, ok: true, summary, sample: ro });
    } catch (err) {
      results.push({ ...p, ok: false, error: (err as Error).message?.slice(0, 300) });
    }
  }

  return new Response(JSON.stringify({
    invoiceNumber,
    inputs: { customerId, opCo, custNum, invHeaderKey, buERPKey },
    invoicePayloadFromOrder: inv,
    probes: results,
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
  locationId: string | null = null,
  callerAction: string = 'unknown',
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

  // 2. Try refresh_token — atomic via DB compare-and-swap to prevent race-condition stomping.
  if (!credentials.refresh_token) {
    if (integrationId) {
      await logRefreshAudit(supabase, {
        integration_id: integrationId,
        location_id: locationId,
        handler: 'get_valid_access_token',
        caller_action: callerAction,
        outcome: 'no_token',
      });
    }
    return null;
  }

  const oldRefresh = credentials.refresh_token;
  const startedAt = Date.now();
  const refreshResult = await refreshAccessToken(oldRefresh);

  if (!refreshResult.ok) {
    if (integrationId) {
      await logRefreshAudit(supabase, {
        integration_id: integrationId,
        location_id: locationId,
        handler: 'get_valid_access_token',
        caller_action: callerAction,
        outcome: refreshResult.outcome,
        b2c_error_code: refreshResult.errorCode ?? null,
        b2c_error_message: refreshResult.errorDescription ?? null,
        duration_ms: Date.now() - startedAt,
        old_token_prefix: tokenFingerprint(oldRefresh),
      });
    }
    console.error('[PFG Auth] Token refresh failed —', refreshResult.errorCode || refreshResult.outcome, refreshResult.errorDescription || '');
    return null;
  }

  const tokenData = refreshResult.token;
  const now = new Date();
  const expiresAtIso = new Date(now.getTime() + tokenData.expires_in * 1000).toISOString();
  const updatedCredentials: PFGCredentials = {
    ...credentials,
    refresh_token: tokenData.refresh_token,
    access_token: tokenData.access_token,
    token_expires_at: expiresAtIso,
    refresh_token_updated_at: now.toISOString(),
  };

  // 4. Persist via locked compare-and-swap. If another concurrent caller already
  // wrote a newer token between our read and our write, the swap returns false
  // and we DO NOT overwrite — their token is the live one, ours is already dead.
  if (integrationId) {
    const { data: swapped, error: swapErr } = await supabase.rpc('pfg_swap_credentials', {
      p_integration_id: integrationId,
      p_expected_old_refresh_token: oldRefresh,
      p_new_credentials: updatedCredentials,
    });

    if (swapErr) {
      console.error('[PFG Auth] CAS swap error:', swapErr);
    }

    await logRefreshAudit(supabase, {
      integration_id: integrationId,
      location_id: locationId,
      handler: 'get_valid_access_token',
      caller_action: callerAction,
      outcome: swapped === true ? 'swapped' : 'lost_race',
      duration_ms: Date.now() - startedAt,
      old_token_prefix: tokenFingerprint(oldRefresh),
      new_token_prefix: tokenFingerprint(tokenData.refresh_token),
    });

    if (swapped === true) {
      console.log('[PFG Auth] Tokens cached until', expiresAtIso, '(locked swap OK)');
    } else {
      console.warn('[PFG Auth] Lost race — another caller already rotated the token. Skipping write to avoid stomping live credentials.');
    }
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
    .select('id, location_id, credentials, pfg_auto_revert_on_failure, pfg_keep_alive_minutes')
    .eq('integration_type', 'pfg')
    .eq('is_active', true);
  
  if (locationId) {
    query = query.eq('location_id', locationId);
  }

  const { data: integrationsRaw, error } = await query;

  if (error) throw new Error(`Failed to fetch PFG integrations: ${error.message}`);

  // Gate: drop integrations whose location has inventory disabled
  const enabledIds = await filterEnabledLocations(
    supabase,
    (integrationsRaw || []).map((i: any) => i.location_id),
  );
  const integrations = (integrationsRaw || []).filter((i: any) => enabledIds.has(i.location_id));
  const keepAliveSkipped = (integrationsRaw?.length || 0) - integrations.length;
  if (keepAliveSkipped > 0) {
    console.log(`[PFG Keep-Alive] Skipped ${keepAliveSkipped} integration(s) — inventory_enabled=false`);
  }

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
      const oldRefresh = creds.refresh_token;
      const startedAt = Date.now();
      const refreshResult = await refreshAccessToken(oldRefresh);
      const CRON_CALLER = 'scheduled_cron_keepalive';

      if (!refreshResult.ok) {
        // Audit the B2C failure with the real error code (AADB2C90080, etc.)
        await logRefreshAudit(supabase, {
          integration_id: integration.id,
          location_id: integration.location_id,
          handler: 'keep_alive_cron',
          caller_action: CRON_CALLER,
          outcome: refreshResult.outcome,
          b2c_error_code: refreshResult.errorCode ?? null,
          b2c_error_message: refreshResult.errorDescription ?? null,
          duration_ms: Date.now() - startedAt,
          old_token_prefix: tokenFingerprint(oldRefresh),
        });

        const pfgUser = creds.pfg_username;
        const pfgPass = creds.pfg_password;
        const refreshSummary = `${refreshResult.outcome}${refreshResult.errorCode ? ` (${refreshResult.errorCode})` : ''}`;

        // No stored ROPC creds — log it instead of silently skipping.
        if (!pfgUser || !pfgPass) {
          await logRefreshAudit(supabase, {
            integration_id: integration.id,
            location_id: integration.location_id,
            handler: 'keep_alive_cron',
            caller_action: CRON_CALLER,
            outcome: 'no_ropc_credentials',
            b2c_error_code: refreshResult.errorCode ?? null,
            b2c_error_message: 'B2C refresh failed and no ROPC username/password on file',
            old_token_prefix: tokenFingerprint(oldRefresh),
          });
          results.push({ locationId: integration.location_id, success: false, error: `Refresh failed (${refreshSummary}); no ROPC credentials stored` });
          continue;
        }

        console.log(`[PFG Keep-Alive] Refresh failed for ${integration.location_id} (${refreshSummary}), attempting ROPC fallback...`);
        const ropcStart = Date.now();
        const ropcData = await ropcAuthenticate(pfgUser, pfgPass);

        if (ropcData) {
          const ropcNow = new Date();
          const updatedCreds: PFGCredentials = {
            ...creds,
            refresh_token: ropcData.refresh_token,
            access_token: ropcData.access_token,
            token_expires_at: new Date(ropcNow.getTime() + ropcData.expires_in * 1000).toISOString(),
            refresh_token_updated_at: ropcNow.toISOString(),
            ropc_last_success: ropcNow.toISOString(),
          };

          // LOCKED ROPC WRITE. ROPC generates a fresh grant chain unrelated to
          // the (now-dead) old refresh token, so the token-match CAS would always
          // fail. This RPC takes a FOR UPDATE lock without the match — two
          // concurrent ROPC writers serialize, last writer wins, both equally valid.
          const { data: ropcSwapped, error: ropcSwapErr } = await supabase.rpc(
            'pfg_swap_credentials_ropc',
            { p_integration_id: integration.id, p_new_credentials: updatedCreds },
          );
          if (ropcSwapErr) console.error('[PFG Keep-Alive] ROPC swap error:', ropcSwapErr);

          await logRefreshAudit(supabase, {
            integration_id: integration.id,
            location_id: integration.location_id,
            handler: 'keep_alive_cron',
            caller_action: CRON_CALLER,
            outcome: 'ropc_recovery',
            duration_ms: Date.now() - ropcStart,
            old_token_prefix: tokenFingerprint(oldRefresh),
            new_token_prefix: tokenFingerprint(ropcData.refresh_token),
          });

          results.push({ locationId: integration.location_id, success: true, error: 'Recovered via ROPC' });
          console.log(`[PFG Keep-Alive] ✓ ROPC recovery successful for ${integration.location_id} (swap=${ropcSwapped})`);
          await autoResolveChainBrokenTicket(supabase, integration.location_id);
          continue;
        }

        // ROPC also failed — record reason on the integration row + audit
        const failNow = new Date();
        const failReason = `ROPC failed: refresh returned ${refreshSummary}`;

        // Build update payload. If this integration had auto_revert_on_failure
        // set (i.e. it's running an experimental cadence), reset to safe 5-min.
        const failureUpdate: Record<string, unknown> = {
          credentials: { ...creds, ropc_last_failure: failNow.toISOString(), ropc_failure_reason: failReason },
        };
        if ((integration as any).pfg_auto_revert_on_failure === true) {
          failureUpdate.pfg_keep_alive_minutes = 5;
          failureUpdate.pfg_auto_revert_on_failure = false;
          console.warn(`[PFG Keep-Alive] Auto-reverting ${integration.location_id} to 5-min cadence after ropc_failed`);
        }

        await supabase
          .from('location_integrations')
          .update(failureUpdate)
          .eq('id', integration.id);

        await logRefreshAudit(supabase, {
          integration_id: integration.id,
          location_id: integration.location_id,
          handler: 'keep_alive_cron',
          caller_action: CRON_CALLER,
          outcome: 'ropc_failed',
          duration_ms: Date.now() - ropcStart,
          b2c_error_code: refreshResult.errorCode ?? null,
          b2c_error_message: failReason,
          old_token_prefix: tokenFingerprint(oldRefresh),
        });

        // Auto-create a deduped support ticket so the chain break is visible
        // in the support inbox without flooding (one ticket per 24h per location).
        await maybeCreateChainBrokenTicket(supabase, integration.location_id, failReason);

        results.push({ locationId: integration.location_id, success: false, error: `Both refresh and ROPC failed (${refreshSummary})` });
        console.error(`[PFG Keep-Alive] ✗ ROPC also failed for ${integration.location_id}`);
        continue;
      }

      const tokenData = refreshResult.token;
      const now = new Date();
      const updatedCreds: PFGCredentials = {
        ...creds,
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        token_expires_at: new Date(now.getTime() + tokenData.expires_in * 1000).toISOString(),
        refresh_token_updated_at: now.toISOString(),
      };

      // Locked compare-and-swap — never stomp a fresher token written by a concurrent caller.
      const { data: swapped, error: swapErr } = await supabase.rpc('pfg_swap_credentials', {
        p_integration_id: integration.id,
        p_expected_old_refresh_token: oldRefresh,
        p_new_credentials: updatedCreds,
      });

      if (swapErr) console.error('[PFG Keep-Alive] CAS swap error:', swapErr);

      await logRefreshAudit(supabase, {
        integration_id: integration.id,
        location_id: integration.location_id,
        handler: 'keep_alive_cron',
        caller_action: CRON_CALLER,
        outcome: swapped === true ? 'swapped' : 'lost_race',
        duration_ms: Date.now() - startedAt,
        old_token_prefix: tokenFingerprint(oldRefresh),
        new_token_prefix: tokenFingerprint(tokenData.refresh_token),
      });

      results.push({ locationId: integration.location_id, success: true });
      if (swapped === true) {
        console.log(`[PFG Keep-Alive] ✓ Refreshed token for location ${integration.location_id}`);
        await autoResolveChainBrokenTicket(supabase, integration.location_id);
      } else {
        console.warn(`[PFG Keep-Alive] ⚠ Lost race for ${integration.location_id} — concurrent caller wrote first; skipping our (now-dead) token write`);
      }

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

  const tokenResult = await getValidAccessToken(supabase, credentials, integrationId, locationId ?? null, `fetch_action:${action || 'unknown'}`);

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
    
    // Piggyback: cache bid items for Phase 2 (pack-selection-backfill).
    // Safe — failure here never breaks the categories response.
    if (locationId) {
      try {
        await upsertPfgBidItems(supabase, locationId, categories);
      } catch (e) {
        console.warn('[PFG bid cache] Piggyback upsert failed:', (e as Error).message);
      }
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

// Scrape the bid/order guide(s) for every active PFG-connected location and
// upsert results into pfg_bid_items. Run once to seed Phase 2; thereafter
// the piggyback in the categories action keeps the cache fresh.
async function handleScrapeBidAllLocations(supabase: any, body: any): Promise<Response> {
  const onlyLocationId: string | null = body?.locationId || null;

  let query = supabase
    .from('location_integrations')
    .select('id, location_id, credentials')
    .eq('integration_type', 'pfg')
    .eq('is_active', true);

  if (onlyLocationId) {
    query = query.eq('location_id', onlyLocationId);
  }

  const { data: integrations, error: intError } = await query;

  if (intError) {
    return new Response(JSON.stringify({ success: false, error: intError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!integrations || integrations.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      message: 'No active PFG integrations',
      results: [],
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  console.log(`[PFG scrape_bid_all] Found ${integrations.length} active integration(s)`);

  const results: Array<{
    locationId: string;
    success: boolean;
    guidesScraped: number;
    itemsUpserted: number;
    error?: string;
  }> = [];

  for (const integration of integrations) {
    const credentials = integration.credentials as unknown as PFGCredentials;
    const locId = integration.location_id;

    if (!credentials?.refresh_token) {
      results.push({ locationId: locId, success: false, guidesScraped: 0, itemsUpserted: 0, error: 'No refresh token' });
      continue;
    }

    try {
      const tokenResult = await getValidAccessToken(supabase, credentials, integration.id, locId, 'scrape_bid_all');
      if (!tokenResult) {
        results.push({ locationId: locId, success: false, guidesScraped: 0, itemsUpserted: 0, error: 'Token refresh failed' });
        continue;
      }
      const accessToken = tokenResult.accessToken;
      const customerId = credentials.customer_id;
      if (!customerId) {
        results.push({ locationId: locId, success: false, guidesScraped: 0, itemsUpserted: 0, error: 'No customer_id' });
        continue;
      }

      const { guides } = await fetchProductListHeaders(accessToken, customerId);
      if (!guides || guides.length === 0) {
        results.push({ locationId: locId, success: false, guidesScraped: 0, itemsUpserted: 0, error: 'No product list headers returned' });
        continue;
      }

      // Prefer guides whose name/description mentions "bid"; fall back to ALL guides.
      const nameOf = (g: any): string =>
        String(g?.Description || g?.ProductListHeaderDescription || g?.Name || g?.Title || '');
      const bidGuides = guides.filter((g: any) => /bid/i.test(nameOf(g)));
      const targetGuides = bidGuides.length > 0 ? bidGuides : guides;

      console.log(`[PFG scrape_bid_all] ${locId}: ${guides.length} total guides, scraping ${targetGuides.length} (bid-match=${bidGuides.length})`);

      let totalUpserted = 0;
      let guidesScraped = 0;

      for (const guide of targetGuides) {
        const headerId = guide?.ProductListHeaderId || guide?.Id || guide?.ProductListHeaderID;
        if (!headerId) continue;
        try {
          const { categories } = await fetchProductListItems(accessToken, String(headerId), customerId);
          const { upserted } = await upsertPfgBidItems(supabase, locId, categories || []);
          totalUpserted += upserted;
          guidesScraped++;
        } catch (e) {
          console.warn(`[PFG scrape_bid_all] guide ${headerId} failed for ${locId}: ${(e as Error).message}`);
        }
      }

      results.push({ locationId: locId, success: true, guidesScraped, itemsUpserted: totalUpserted });
    } catch (e) {
      results.push({
        locationId: locId,
        success: false,
        guidesScraped: 0,
        itemsUpserted: 0,
        error: (e as Error).message,
      });
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      locations: acc.locations + 1,
      ok: acc.ok + (r.success ? 1 : 0),
      guides: acc.guides + r.guidesScraped,
      items: acc.items + r.itemsUpserted,
    }),
    { locations: 0, ok: 0, guides: 0, items: 0 },
  );

  return new Response(JSON.stringify({ success: true, totals, results }), {
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

  const { data: integrationsRaw, error: intError } = await query;

  if (intError) {
    throw new Error(`Failed to fetch integrations: ${intError.message}`);
  }

  // Gate: drop integrations whose location has inventory disabled
  const enabledIds = await filterEnabledLocations(
    supabase,
    (integrationsRaw || []).map((i: any) => i.location_id),
  );
  const integrations = (integrationsRaw || []).filter((i: any) => enabledIds.has(i.location_id));
  const skippedCount = (integrationsRaw?.length || 0) - integrations.length;
  if (skippedCount > 0) {
    console.log(`[PFG sync_orders] Skipped ${skippedCount} integration(s) — inventory_enabled=false`);
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
      const tokenResult = await getValidAccessToken(supabase, credentials, integration.id, integration.location_id, 'sync_orders');

      if (!tokenResult) {
        results.push({ locationId: integration.location_id, success: false, ordersImported: 0, error: 'Auth failed — re-login needed' });
        continue;
      }

      const { accessToken } = tokenResult;

      const customerIdToUse = credentials.customer_id;
      const daysBack = typeof body?.daysBack === 'number' && body.daysBack > 0 ? body.daysBack : 14;
      const orderData = await fetchOrderHistory(accessToken, customerIdToUse, daysBack);

      
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
            return fetchDeliveryDetail(accessToken, p.orderForDetail, p.customerIdForDetail, {
              supabase,
              integrationId: integration.id,
              locationId: integration.location_id,
              callerAction: 'sync_orders',
            });
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

      // --- Vendor gap detection: surface line items NOT in the brand catalog ---
      // The Bid Guide scan (vendor-gap-scan) only sees items the BID exposes.
      // Off-BID items that ship on actual TRACS deliveries (e.g. prosciutto,
      // tiramisu, salad bowls) would never become gap alerts otherwise. We
      // diff this sync's line items against brand_vendor_mappings + the
      // legacy item_number column on brand_inventory_templates, then call the
      // same RPC the manual invoice path uses.
      try {
        // Collect unique SKUs from THIS sync (skip empty itemNumbers).
        // Track latest price per SKU so we can cascade case cost to inventory_items.
        const skuMeta = new Map<string, { name: string; pack: string; price: number | null; deliveryDate: string }>();
        for (const row of upsertBatch) {
          const dt = String(row.delivery_date || '');
          for (const li of (row.items || []) as any[]) {
            const sku = String(li?.itemNumber || '').trim();
            if (!sku) continue;
            const price = Number(li?.price);
            const validPrice = Number.isFinite(price) && price > 0 ? price : null;
            const existing = skuMeta.get(sku);
            if (!existing) {
              skuMeta.set(sku, {
                name: String(li?.name || ''),
                pack: String(li?.packSize || ''),
                price: validPrice,
                deliveryDate: dt,
              });
            } else if (validPrice !== null && (existing.price === null || dt > existing.deliveryDate)) {
              existing.price = validPrice;
              existing.deliveryDate = dt;
              if (!existing.pack && li?.packSize) existing.pack = String(li.packSize);
            }
          }
        }

        if (skuMeta.size > 0) {
          // Resolve brand + location name for the RPC
          const { data: locRow } = await supabase
            .from('locations')
            .select('name, organization_id, organizations:organization_id(brand_id)')
            .eq('id', integration.location_id)
            .maybeSingle();
          const brandId = (locRow as any)?.organizations?.brand_id || null;
          const locationName = (locRow as any)?.name || 'Unknown';

          if (brandId) {
            // Pull all mapped PFG SKUs for this brand (junction + legacy column)
            const { data: templates } = await supabase
              .from('brand_inventory_templates')
              .select('id, item_number, status')
              .eq('brand_id', brandId);
            const templateIds = (templates || []).map((t: any) => t.id);
            const mappedSkus = new Set<string>();
            for (const t of (templates || [])) {
              const itemNum = String(t.item_number || '').trim();
              if (itemNum && t.status !== 'archived') mappedSkus.add(itemNum);
            }
            // Junction: chunk to avoid PostgREST URL length limits
            const CHUNK = 50;
            for (let i = 0; i < templateIds.length; i += CHUNK) {
              const chunk = templateIds.slice(i, i + CHUNK);
              const { data: mappings } = await supabase
                .from('brand_vendor_mappings')
                .select('vendor_item_id')
                .eq('vendor', 'pfg')
                .in('brand_template_id', chunk);
              for (const m of (mappings || [])) {
                const vid = String(m.vendor_item_id || '').trim();
                if (vid) mappedSkus.add(vid);
              }
            }

            let gapWrites = 0;
            for (const [sku, meta] of skuMeta) {
              if (mappedSkus.has(sku)) continue;
              const { error: rpcErr } = await supabase.rpc('upsert_vendor_gap_with_location', {
                _brand_id: brandId,
                _vendor_source: 'pfg',
                _item_number: sku,
                _vendor_name: meta.name,
                _vendor_description: meta.name,
                _pack_size: meta.pack,
                _category_name: '',
                _location_id: integration.location_id,
                _location_name: locationName,
              });
              if (!rpcErr) gapWrites++;
              else console.warn(`[PFG Sync] Gap RPC failed for SKU ${sku}:`, rpcErr.message);
            }
            if (gapWrites > 0) {
              console.log(`[PFG Sync] ${locationName}: wrote/merged ${gapWrites} vendor gap alerts from delivery items`);
            }

            // --- Seed/refresh item_conversions from PFG packSize for this brand ---
            // Newly-created gap templates start with a placeholder "1 ea" conversion.
            // Now that we have authoritative packSize from the delivery, derive
            // proper outer/inner/canonical values so pack info shows correctly
            // (e.g. Prosciutto 6 cs × 1 LB instead of "each").
            try {
              const skuToTemplate = new Map<string, string>();
              for (const t of (templates || [])) {
                const itemNum = String(t.item_number || '').trim();
                if (itemNum) skuToTemplate.set(itemNum, t.id);
              }
              // Pull current active conversions for this brand to detect placeholders
              const { data: activeConvs } = await supabase
                .from('item_conversions')
                .select('id, brand_template_id, outer_qty, source, version')
                .eq('brand_id', brandId)
                .is('effective_to', null);
              const convByTemplate = new Map<string, any>();
              for (const c of (activeConvs || [])) convByTemplate.set(c.brand_template_id, c);

              let convWrites = 0;
              for (const [sku, meta] of skuMeta) {
                const templateId = skuToTemplate.get(sku);
                if (!templateId) continue;
                const parsed = parsePackString(meta.pack);
                if (!parsed) continue;
                const existing = convByTemplate.get(templateId);
                // Only overwrite placeholder/needs_review rows; preserve manual_override
                if (existing) {
                  const isPlaceholder =
                    Number(existing.outer_qty) <= 1 &&
                    (existing.source === 'needs_review' || existing.source === 'manual_override' || existing.source === 'vendor_auto');
                  if (!isPlaceholder) continue;
                  // Skip if already matches what we'd write
                  if (Number(existing.outer_qty) === parsed.outer_qty) continue;
                  await supabase
                    .from('item_conversions')
                    .update({ effective_to: new Date().toISOString() })
                    .eq('id', existing.id);
                }
                const { error: insErr } = await supabase.from('item_conversions').insert({
                  brand_template_id: templateId,
                  brand_id: brandId,
                  outer_qty: parsed.outer_qty,
                  outer_unit: 'cs',
                  has_inner: true,
                  inner_qty: parsed.inner_qty,
                  inner_unit: parsed.inner_unit,
                  canonical_unit: parsed.canonical_unit,
                  canonical_qty_per_inner: parsed.canonical_qty_per_inner,
                  source: 'vendor_auto',
                  version: (existing?.version || 0) + 1,
                });
                if (!insErr) convWrites++;
                else console.warn(`[PFG Sync] Conversion seed failed for SKU ${sku}:`, insErr.message);
              }
              if (convWrites > 0) {
                console.log(`[PFG Sync] ${locationName}: seeded/refreshed ${convWrites} item conversions from PFG packSize`);
              }

              // --- Cascade pack info to deployed local inventory_items at every location ---
              // The brand-level conversion is the source of truth, but the UI
              // reads pack_size / pack_quantity / count_units_per_case from
              // each location's inventory_items row. Push the values down
              // (skipping anywhere a manager set pack_quantity_override).
              try {
                const skuToParsed = new Map<string, ParsedPack & { packSizeRaw: string }>();
                for (const [sku, meta] of skuMeta) {
                  const parsed = parsePackString(meta.pack);
                  if (parsed) skuToParsed.set(sku, { ...parsed, packSizeRaw: meta.pack.replace(/\s+/g, '') });
                }
                let cascadeWrites = 0;
                let priceWrites = 0;
                for (const t of (templates || [])) {
                  const sku = String(t.item_number || '').trim();
                  if (!sku) continue;
                  const parsed = skuToParsed.get(sku);
                  const meta = skuMeta.get(sku);

                  // Brand-wide pack cascade (only if we parsed a real pack)
                  if (parsed) {
                    const { error: cascadeErr, count } = await supabase
                      .from('inventory_items')
                      .update({
                        pack_size: parsed.packSizeRaw,
                        unit: 'cs',
                        pack_quantity: parsed.outer_qty,
                        count_units_per_case: parsed.outer_qty * parsed.canonical_qty_per_inner,
                        count_unit: parsed.canonical_unit,
                        updated_at: new Date().toISOString(),
                      }, { count: 'exact' })
                      .eq('brand_item_id', t.id)
                      .is('pack_quantity_override', null);
                    if (!cascadeErr && count) cascadeWrites += count;
                  }

                  // Inner-pack cascade (Phase 5): parse sleeves/bundles/inner-packs
                  // from the description text. Only set when currently null so we
                  // never overwrite a manual edit. Additive — zero risk.
                  const innerPackQty = parseInnerPackQuantity(meta?.name);
                  if (innerPackQty) {
                    const { error: innerErr, count } = await supabase
                      .from('inventory_items')
                      .update({
                        inner_pack_quantity: innerPackQty,
                        updated_at: new Date().toISOString(),
                      }, { count: 'exact' })
                      .eq('brand_item_id', t.id)
                      .is('inner_pack_quantity', null);
                    if (!innerErr && count) {
                      console.log(`[PFG Sync] Set inner_pack_quantity=${innerPackQty} on ${count} rows for SKU ${sku} ("${meta?.name}")`);
                    }
                  }

                  // Location-scoped price write — case price comes straight from
                  // PFG line item.price; we only write to THIS location since
                  // pricing varies by territory/contract.
                  if (meta?.price && meta.price > 0) {
                    const nowIso = new Date().toISOString();
                    const { error: priceErr, count } = await supabase
                      .from('inventory_items')
                      .update({ cost_per_unit: meta.price, last_synced_at: nowIso, updated_at: nowIso }, { count: 'exact' })
                      .eq('brand_item_id', t.id)
                      .eq('location_id', integration.location_id);
                    if (!priceErr && count) priceWrites += count;
                  } else if (meta) {
                    // SKU returned by PFG for this location but no price line — still stamp sync evidence
                    const nowIso = new Date().toISOString();
                    await supabase
                      .from('inventory_items')
                      .update({ last_synced_at: nowIso, updated_at: nowIso })
                      .eq('brand_item_id', t.id)
                      .eq('location_id', integration.location_id);
                  }
                }
                if (cascadeWrites > 0) {
                  console.log(`[PFG Sync] ${locationName}: cascaded pack info to ${cascadeWrites} inventory_items rows brand-wide`);
                }
                if (priceWrites > 0) {
                  console.log(`[PFG Sync] ${locationName}: updated case price on ${priceWrites} inventory_items rows`);
                }
              } catch (cascadeErr) {
                console.warn(`[PFG Sync] Pack/price cascade error (non-fatal):`, cascadeErr instanceof Error ? cascadeErr.message : cascadeErr);
              }
            } catch (convErr) {
              console.warn(`[PFG Sync] Conversion seeding error (non-fatal):`, convErr instanceof Error ? convErr.message : convErr);
            }
          }
        }
      } catch (gapErr) {
        // Never let gap detection break the sync itself
        console.warn(`[PFG Sync] Gap detection error (non-fatal):`, gapErr instanceof Error ? gapErr.message : gapErr);
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
  const tokenResult = await getValidAccessToken(supabase, credentials, integration.id, locationId, 'list_delivery_locations');
  if (!tokenResult) {
    return new Response(JSON.stringify({ error: 'Auth failed — re-login needed' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { accessToken } = tokenResult;

  // Resolve the customer account for this login if we don't have it yet, and
  // gather every store this login can reach — works even with zero order history.
  const PLACEHOLDER_NUMBERS = new Set(['00000', '0', '']);
  const PLACEHOLDER_GUID = '00000000-0000-0000-0000-000000000000';
  let resolvedCustomerId = credentials.customer_id;
  const customerAccounts: { number: string; name: string; orderCount: number }[] = [];
  try {
    const customerInfo = await fetchCustomerInfo(accessToken);
    const list = Array.isArray(customerInfo) ? customerInfo : customerInfo ? [customerInfo] : [];
    for (const c of list) {
      const num = c?.CustomerNumber || c?.DeliverToCustomerNumber || c?.Number;
      const name = c?.CustomerName || c?.Name || c?.DeliverToCustomerName || 'Unknown';
      if (num && !PLACEHOLDER_NUMBERS.has(String(num))) {
        customerAccounts.push({ number: String(num), name: String(name).trim(), orderCount: 0 });
      }
    }
    if (!resolvedCustomerId) {
      const candidate = list[0]?.CustomerId || list[0]?.Id;
      if (candidate && candidate !== PLACEHOLDER_GUID) {
        resolvedCustomerId = candidate;
        await supabase
          .from('location_integrations')
          .update({ credentials: { ...credentials, customer_id: resolvedCustomerId } })
          .eq('id', integration.id);
      }
    }
  } catch (err) {
    console.warn('[PFG Stores] Customer lookup failed:', (err as Error).message?.slice(0, 120));
  }

  // TRACS Direct logins return a placeholder customer — their real store list
  // shows up on the order guides (product list headers) instead.
  try {
    const headerResult = await fetchProductListHeaders(accessToken, resolvedCustomerId);
    for (const g of headerResult.guides || []) {
      const num = g?.CustomerNumber || g?.DeliverToCustomerNumber;
      const name = g?.CustomerName || g?.ProductListName || g?.Name || 'Unknown';
      if (num && !PLACEHOLDER_NUMBERS.has(String(num)) && !customerAccounts.some((a) => a.number === String(num))) {
        customerAccounts.push({ number: String(num), name: String(name).trim(), orderCount: 0 });
      }
    }
  } catch (err) {
    console.warn('[PFG Stores] Guide lookup failed:', (err as Error).message?.slice(0, 120));
  }


  // Order history is only used to count/label stores. It can be huge, which
  // blows the function's memory budget — keep the window small, skip it when we
  // already discovered stores, and never fail the request over it.
  let orderData: any = null;
  if (customerAccounts.length === 0) {
    try {
      orderData = await fetchOrderHistory(accessToken, resolvedCustomerId, 30);
    } catch (err) {
      console.warn('[PFG Stores] Order history lookup failed:', (err as Error).message?.slice(0, 120));
    }
  }

  let rawOrders: any[];
  const resultObj = orderData?.ResultObject;
  if (Array.isArray(resultObj)) {
    rawOrders = resultObj.slice(0, 500);
  } else if (resultObj && typeof resultObj === 'object') {
    rawOrders = (resultObj.SubmittedOrderHeaders || resultObj.Orders || resultObj.Items || []).slice(0, 500);
    if (rawOrders.length === 0 && (resultObj.OrderNumber || resultObj.DeliveryDate)) {
      rawOrders = [resultObj];
    }
  } else {
    rawOrders = [];
  }
  orderData = null;

  // Extract unique delivery locations (handle both GetSubmittedOrderHeaders and GetDeliveries field names)
  const deliveryLocations = new Map<string, { number: string; name: string; orderCount: number }>();
  // Seed with the customer accounts this login can reach (works with zero order history)
  for (const acct of customerAccounts) {
    deliveryLocations.set(acct.number, { ...acct });
  }
  for (const order of rawOrders) {
    const num = order.DeliverToCustomerNumber || order.CustomerNumber;
    const name = order.DeliverToCustomerName || order.CustomerName || 'Unknown';
    if (num) {
      const existing = deliveryLocations.get(String(num));
      if (existing) {
        existing.orderCount++;
        if (existing.name === 'Unknown' && name) existing.name = String(name).trim();
      } else {
        deliveryLocations.set(String(num), { number: String(num), name: name.trim(), orderCount: 1 });
      }
    }
  }


  const currentDeliverTo = (credentials as any).deliver_to_customer_number || null;

  // Always keep the store that's already saved on this location in the list, so
  // the picker still works even when PFG's lookup endpoints are unhappy.
  if (currentDeliverTo && !deliveryLocations.has(String(currentDeliverTo))) {
    deliveryLocations.set(String(currentDeliverTo), {
      number: String(currentDeliverTo),
      name: (credentials as any).deliver_to_customer_name || 'Saved store',
      orderCount: 0,
    });
  }


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
  const tokenResult = await getValidAccessToken(supabase, credentials, integration.id, locationId, 'customer_info');
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
// BACKFILL ITEMS — repair pfg_orders rows where items is NULL / [] by
// re-calling GetDeliveryDetail using the native DeliveryKey persisted in
// raw_data.DeliveryKey. Dry-run by default; pass { apply: true } to write.
// ============================================================================

async function handleBackfillItems(supabase: any, body: any): Promise<Response> {
  const apply: boolean = body?.apply === true;
  const locationId: string | null = body?.locationId || null;
  const daysBack: number = Math.min(Math.max(Number(body?.daysBack) || 90, 1), 365);
  const maxRows: number = Math.min(Math.max(Number(body?.maxRows) || 500, 1), 2000);

  // Gate: single-location call — short-circuit if disabled
  if (locationId) {
    const gate = await isInventoryEnabled(supabase, locationId);
    if (!gate.enabled) {
      console.log(`[PFG Backfill] SKIPPED — inventory_enabled=false for ${locationId}`);
      return inventoryDisabledResponse(gate, corsHeaders);
    }
  }

  console.log(`[PFG Backfill] start apply=${apply} location=${locationId || 'ALL'} daysBack=${daysBack}`);

  // 1. Pull candidate empty orders
  let q = supabase
    .from('pfg_orders')
    .select('id, location_id, pfg_order_id, order_number, order_date, delivery_date, items, raw_data, source_delivery_key')
    .gte('order_date', new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10))
    .or('items.is.null,items.eq.[]')
    .limit(maxRows);
  if (locationId) q = q.eq('location_id', locationId);

  const { data: candidates, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. Bucket by location and classify
  type Row = any;
  const byLoc = new Map<string, Row[]>();
  for (const r of candidates || []) {
    if (!byLoc.has(r.location_id)) byLoc.set(r.location_id, []);
    byLoc.get(r.location_id)!.push(r);
  }

  // Resolve location names
  const locIds = [...byLoc.keys()];
  const { data: locs } = await supabase.from('locations').select('id, name').in('id', locIds);
  const locName = new Map<string, string>((locs || []).map((l: any) => [l.id, l.name]));

  // Gate: drop disabled locations from multi-loc backfill
  const enabledIds = await filterEnabledLocations(supabase, locIds);
  for (const lid of locIds) {
    if (!enabledIds.has(lid)) {
      console.log(`[PFG Backfill] Skipping ${lid} — inventory_enabled=false`);
      byLoc.delete(lid);
    }
  }

  // 3. For each location, fetch a valid access token once and process rows
  type RowReport = {
    pfg_order_id: string;
    order_date: string;
    native_key: string | null;
    classification: 'has_native_key' | 'no_native_key_skip';
    result?: 'would_repair' | 'repaired' | 'still_empty' | 'fetch_failed';
    line_count?: number;
    error?: string;
  };

  const perLocation: Array<{
    location_id: string;
    location_name: string;
    candidates: number;
    has_native_key: number;
    no_native_key_skip: number;
    repaired: number;
    would_repair: number;
    still_empty: number;
    fetch_failed: number;
    rows: RowReport[];
  }> = [];

  for (const [locId, rows] of byLoc) {
    // Get integration + token (only if we'll actually call PFG, i.e. apply mode
    // OR we still want to verify in dry-run? For a true dry-run, we skip the
    // network call and just classify by raw_data shape.)
    const { data: integration } = await supabase
      .from('location_integrations')
      .select('id, credentials')
      .eq('location_id', locId)
      .eq('integration_type', 'pfg')
      .eq('is_active', true)
      .maybeSingle();

    let accessToken: string | null = null;
    if (apply) {
      if (!integration) {
        console.warn(`[PFG Backfill] no active integration for ${locId} — skipping repairs`);
      } else {
        try {
          const tr = await getValidAccessToken(
            supabase, integration.credentials, integration.id, locId, 'backfill_items',
          );
          accessToken = tr?.accessToken || null;
        } catch (err) {
          console.warn(`[PFG Backfill] token resolve failed for ${locId}:`, (err as Error).message);
        }
      }
    }

    const rep = {
      location_id: locId,
      location_name: locName.get(locId) || locId,
      candidates: rows.length,
      has_native_key: 0,
      no_native_key_skip: 0,
      repaired: 0,
      would_repair: 0,
      still_empty: 0,
      fetch_failed: 0,
      rows: [] as RowReport[],
    };

    for (const r of rows) {
      const raw = r.raw_data || {};
      const nativeKey: string | null = raw.DeliveryKey || r.source_delivery_key || null;
      const rowReport: RowReport = {
        pfg_order_id: r.pfg_order_id,
        order_date: r.order_date,
        native_key: nativeKey,
        classification: nativeKey ? 'has_native_key' : 'no_native_key_skip',
      };

      if (!nativeKey) {
        rep.no_native_key_skip++;
        rep.rows.push(rowReport);
        continue;
      }

      rep.has_native_key++;

      if (!apply) {
        rowReport.result = 'would_repair';
        rep.would_repair++;
        rep.rows.push(rowReport);
        continue;
      }

      if (!accessToken) {
        rowReport.result = 'fetch_failed';
        rowReport.error = 'no_access_token';
        rep.fetch_failed++;
        rep.rows.push(rowReport);
        continue;
      }

      // raw_data is the Delivery object from GetDeliveries (Delivery* fields),
      // not the Order from GetSubmittedOrderHeaders. Pass through verbatim
      // so fetchDeliveryDetail uses the native DeliveryKey. CustomerId is
      // per-order on the raw payload, fall back to credentials.
      const customerId = (raw.CustomerId as string)
        || (integration?.credentials?.customer_id as string)
        || '';
      const syntheticOrder = {
        DeliveryKey: nativeKey,
        OrderOperationCompanyNumber: raw.DeliveryOperationCompanyNumber || raw.OrderOperationCompanyNumber,
        OrderBusinessUnitERPKey: raw.DeliveryBusinessUnitERPKey || raw.OrderBusinessUnitERPKey || 0,
      };

      try {
        const items = await fetchDeliveryDetail(accessToken, syntheticOrder, customerId, {
          supabase,
          integrationId: integration.id,
          locationId: integration.location_id,
          callerAction: 'backfill_items',
        });
        if (items.length === 0) {
          rowReport.result = 'still_empty';
          rep.still_empty++;
        } else {
          const { error: upErr } = await supabase
            .from('pfg_orders')
            .update({ items, source_delivery_key: nativeKey, updated_at: new Date().toISOString() })
            .eq('id', r.id);
          if (upErr) {
            rowReport.result = 'fetch_failed';
            rowReport.error = upErr.message;
            rep.fetch_failed++;
          } else {
            rowReport.result = 'repaired';
            rowReport.line_count = items.length;
            rep.repaired++;
          }
        }
      } catch (err) {
        rowReport.result = 'fetch_failed';
        rowReport.error = (err as Error).message?.slice(0, 200);
        rep.fetch_failed++;
      }

      rep.rows.push(rowReport);
    }

    perLocation.push(rep);
  }

  const totals = perLocation.reduce((acc, l) => ({
    candidates: acc.candidates + l.candidates,
    has_native_key: acc.has_native_key + l.has_native_key,
    no_native_key_skip: acc.no_native_key_skip + l.no_native_key_skip,
    repaired: acc.repaired + l.repaired,
    would_repair: acc.would_repair + l.would_repair,
    still_empty: acc.still_empty + l.still_empty,
    fetch_failed: acc.fetch_failed + l.fetch_failed,
  }), { candidates: 0, has_native_key: 0, no_native_key_skip: 0, repaired: 0, would_repair: 0, still_empty: 0, fetch_failed: 0 });

  return new Response(JSON.stringify({
    success: true,
    mode: apply ? 'apply' : 'dry_run',
    params: { locationId, daysBack, maxRows },
    totals,
    by_location: perLocation,
  }, null, 2), {
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

  const denied = await requireAuthorizedCaller(req, corsHeaders, {});
  if (denied) return denied;

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

    // Credential-bearing actions require admin (service-role / cron callers
    // already passed the guard above and are exempt).
    const PRIVILEGED_PFG_ACTIONS = ['test_ropc', 'save_pfg_credentials', 'list_active_integrations', 'save_token', 'oauth_exchange'];
    if (action && PRIVILEGED_PFG_ACTIONS.includes(action)) {
      const adminDenied = await requireAuthorizedCaller(req, corsHeaders, { minRole: 'admin' });
      if (adminDenied) return adminDenied;
    }

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
        // GitHub Actions headless login failed — create deduped support ticket
        const failLocationId = body?.locationId;
        const failError = body?.error || 'Unknown headless login failure';
        console.error('[PFG Headless] Login failed for location:', failLocationId, failError);
        
        if (failLocationId) {
          await maybeCreateChainBrokenTicket(
            supabase,
            failLocationId,
            `Headless login failure: ${failError}`,
          );
        }
        
        return new Response(JSON.stringify({ success: true, message: 'Failure logged' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      case 'scrape_bid_all_locations':
        return await handleScrapeBidAllLocations(supabase, body);

      case 'sync_orders':
        return await handleSyncOrders(supabase, body);

      case 'sync_invoices':
        return await handleSyncInvoices(supabase, body);

      case 'probe_invoice_detail':
        return await handleProbeInvoiceDetail(supabase, body);

      case 'backfill_items':
        return await handleBackfillItems(supabase, body);

      
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
