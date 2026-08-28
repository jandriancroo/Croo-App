// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuthorizedCaller } from '../_shared/callerAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const OVATION_API = 'https://api.ovationup.com/app-services/v2'
const OVATION_APP_API = 'https://apis.ovationup.com/app/v1'
const COGNITO_REGION = 'us-east-1'
const COGNITO_USER_POOL = 'us-east-1_ddNUtzgDs'
const COGNITO_CLIENT_ID = '45rj7fb9l3bmjv2fkvp3s4qnr9'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Resolve the action first so read-only dashboard calls can use a lower role bar.
  const preUrl = new URL(req.url)
  let preAction = preUrl.searchParams.get('action') || ''
  let cachedBody: any = null
  if (!preAction && req.method === 'POST') {
    try {
      cachedBody = await req.clone().json()
      if (cachedBody?.action) preAction = cachedBody.action
    } catch {}
  }

  const READ_ONLY_ACTIONS = new Set(['fetch_reviews', 'fetch_scores', 'get_config'])
  const minRole = READ_ONLY_ACTIONS.has(preAction) ? 'manager' : 'admin'

  const denied = await requireAuthorizedCaller(req, corsHeaders, { minRole });
  if (denied) return denied;


  const url = new URL(req.url)
  let action = url.searchParams.get('action') || ''

  // Fallback: read action from body if not in query params (supabase.functions.invoke encodes ? in name)
  if (!action && req.method === 'POST') {
    try {
      const cloned = req.clone()
      const body = await cloned.json()
      if (body?.action) action = body.action
    } catch {}
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    switch (action) {
      case 'save_config':
        return await handleSaveConfig(req, supabase)
      case 'test_survey_skip':
        return await handleTestSurveySkip(req, supabase)
      case 'save_location_mapping':
        return await handleSaveLocationMapping(req, supabase)
      case 'test_connection':
        return await handleTestConnection(req, supabase)
      case 'test_auth':
        return await handleTestAuth(req, supabase)
      case 'fetch_reviews':
        return await handleFetchReviews(req, supabase)
      case 'fetch_scores':
        return await handleFetchScores(req, supabase)
      case 'refresh_token':
        return await handleRefreshToken(req, supabase)
      case 'list_ovation_locations':
        return await handleListOvationLocations(req, supabase)
      case 'get_config':
        return await handleGetConfig(req, supabase)
      case 'auto_map_locations':
        return await handleAutoMapLocations(req, supabase)
      case 'cognito_login':
        return await handleCognitoLogin(req, supabase)
      case 'probe_api':
        return await handleProbeApi(req, supabase)
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (error: any) {
    console.error(`[ovation-service] Error (action=${action}):`, error)
    return jsonResponse({ error: error.message }, 500)
  }
})

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ==================== COGNITO SRP AUTH ====================
// Full SRP implementation for AWS Cognito USER_SRP_AUTH flow

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Modular exponentiation for BigInt
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base = base % mod
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod
    }
    exp = exp / 2n
    base = (base * base) % mod
  }
  return result
}

// AWS Cognito SRP constants
const N_HEX = 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF'
const N = BigInt('0x' + N_HEX)
const g = 2n
const k_hex = 'b4429e3959c149cfa4578226d0cb3542b2a8e42f5a8688bceb16fd1bb979a4b5' // SHA256(pad(N) + pad(g))

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hash)
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data)
  return new Uint8Array(sig)
}

function padHex(hex: string): string {
  if (hex.length % 2 === 1) hex = '0' + hex
  if ('89ABCDEFabcdef'.includes(hex[0])) hex = '00' + hex
  return hex
}

async function cognitoSrpAuth(username: string, password: string): Promise<{ AccessToken: string; IdToken: string; RefreshToken: string }> {
  // Try USER_PASSWORD_AUTH first (simpler, no SRP math needed)
  const passwordAuthResp = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    }),
  })

  const passwordAuthData = await passwordAuthResp.json()
  
  if (passwordAuthData.AuthenticationResult) {
    console.log('[ovation-service] USER_PASSWORD_AUTH succeeded')
    return {
      AccessToken: passwordAuthData.AuthenticationResult.AccessToken,
      IdToken: passwordAuthData.AuthenticationResult.IdToken,
      RefreshToken: passwordAuthData.AuthenticationResult.RefreshToken,
    }
  }

  // If USER_PASSWORD_AUTH not allowed, fall back to SRP
  if (passwordAuthData.__type === 'InvalidParameterException' || 
      passwordAuthData.__type === 'NotAuthorizedException' && passwordAuthData.message?.includes('USER_PASSWORD_AUTH')) {
    console.log('[ovation-service] USER_PASSWORD_AUTH not supported, trying SRP...')
    return cognitoSrpAuthFull(username, password)
  }

  // If it's a real auth error, throw
  if (passwordAuthData.__type || passwordAuthData.message) {
    throw new Error(passwordAuthData.message || passwordAuthData.__type)
  }

  throw new Error('Unexpected auth response')
}

async function cognitoSrpAuthFull(username: string, password: string): Promise<{ AccessToken: string; IdToken: string; RefreshToken: string }> {
  // Step 1: Generate random 'a' and compute A = g^a mod N
  const aBytes = new Uint8Array(128)
  crypto.getRandomValues(aBytes)
  const a = BigInt('0x' + bytesToHex(aBytes)) % N
  let A = modPow(g, a, N)
  while (A % N === 0n) {
    crypto.getRandomValues(aBytes)
    const newA = BigInt('0x' + bytesToHex(aBytes)) % N
    A = modPow(g, newA, N)
  }
  const A_hex = A.toString(16)

  // Step 2: Initiate SRP auth
  const initResponse = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_SRP_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: username, SRP_A: A_hex },
    }),
  })

  const initData = await initResponse.json()
  if (!initData.ChallengeParameters) {
    throw new Error(initData.message || initData.__type || 'InitiateAuth failed')
  }

  const { SRP_B, SALT, SECRET_BLOCK, USER_ID_FOR_SRP } = initData.ChallengeParameters
  const B = BigInt('0x' + SRP_B)
  if (B % N === 0n) throw new Error('SRP_B mod N is zero')

  // Step 3: u = SHA256(pad(A) | pad(B))
  const hexLen = N_HEX.length
  const A_padded = padHex(A_hex).padStart(hexLen, '0')
  const B_padded = padHex(SRP_B).padStart(hexLen, '0')
  const u_hash = await sha256(hexToBytes(A_padded + B_padded))
  const u = BigInt('0x' + bytesToHex(u_hash))
  if (u === 0n) throw new Error('u is zero')

  // Step 4: x = SHA256(salt | SHA256(poolName + userId + ":" + password))
  const poolName = COGNITO_USER_POOL.split('_')[1]
  const innerHash = await sha256(new TextEncoder().encode(poolName + USER_ID_FOR_SRP + ':' + password))
  const saltBytes = hexToBytes(padHex(SALT))
  const xInput = new Uint8Array(saltBytes.length + innerHash.length)
  xInput.set(saltBytes)
  xInput.set(innerHash, saltBytes.length)
  const x = BigInt('0x' + bytesToHex(await sha256(xInput)))

  // Step 5: S = (B - k * g^x mod N) ^ (a + u * x) mod N
  const k = BigInt('0x' + k_hex)
  const gx = modPow(g, x, N)
  const kgx = (k * gx) % N
  const diff = ((B - kgx) % N + N) % N
  const S = modPow(diff, (a + u * x) % (N - 1n), N)

  // Step 6: HKDF
  const S_bytes = hexToBytes(padHex(S.toString(16)))
  const prk = await hmacSha256(u_hash, S_bytes)
  const expandInput = new Uint8Array([...new TextEncoder().encode('Caldera Derived Key'), 1])
  const derivedKey = (await hmacSha256(prk, expandInput)).slice(0, 16)

  // Step 7: Timestamp and signature
  const now = new Date()
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const timestamp = `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${now.getUTCDate()} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')} UTC ${now.getUTCFullYear()}`

  const secretBlockBytes = Uint8Array.from(atob(SECRET_BLOCK), c => c.charCodeAt(0))
  const poolNameBytes = new TextEncoder().encode(poolName)
  const userIdBytes = new TextEncoder().encode(USER_ID_FOR_SRP)
  const timestampBytes = new TextEncoder().encode(timestamp)
  
  const hmacInput = new Uint8Array(poolNameBytes.length + userIdBytes.length + secretBlockBytes.length + timestampBytes.length)
  let offset = 0
  hmacInput.set(poolNameBytes, offset); offset += poolNameBytes.length
  hmacInput.set(userIdBytes, offset); offset += userIdBytes.length
  hmacInput.set(secretBlockBytes, offset); offset += secretBlockBytes.length
  hmacInput.set(timestampBytes, offset)

  const signature = await hmacSha256(derivedKey, hmacInput)
  const signatureB64 = btoa(String.fromCharCode(...signature))

  // Step 8: Challenge response
  const challengeResponse = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge',
    },
    body: JSON.stringify({
      ChallengeName: 'PASSWORD_VERIFIER',
      ClientId: COGNITO_CLIENT_ID,
      ChallengeResponses: {
        USERNAME: USER_ID_FOR_SRP,
        PASSWORD_CLAIM_SECRET_BLOCK: SECRET_BLOCK,
        PASSWORD_CLAIM_SIGNATURE: signatureB64,
        TIMESTAMP: timestamp,
      },
    }),
  })

  const challengeData = await challengeResponse.json()
  if (!challengeData.AuthenticationResult) {
    throw new Error(challengeData.message || challengeData.__type || 'Challenge response failed')
  }

  return {
    AccessToken: challengeData.AuthenticationResult.AccessToken,
    IdToken: challengeData.AuthenticationResult.IdToken,
    RefreshToken: challengeData.AuthenticationResult.RefreshToken,
  }
}

// Helper: Get or refresh auth token for a brand (legacy, still used by fetch_scores etc.)
async function getAuthToken(supabase: any, brandId: string): Promise<string | null> {
  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .maybeSingle()

  if (!integration) return null

  if (integration.auth_token && integration.token_updated_at) {
    const ageHours = (Date.now() - new Date(integration.token_updated_at).getTime()) / 3600000
    if (ageHours < 20) return integration.auth_token
  }

  const username = integration.cognito_username
  const password = integration.cognito_password
  if (!username || !password) {
    return integration.auth_token || null
  }

  try {
    const tokens = await cognitoSrpAuth(username, password)
    await supabase
      .from('ovation_integrations')
      .update({
        auth_token: tokens.IdToken,
        token_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id)
    return tokens.IdToken
  } catch (error: any) {
    console.error(`[ovation-service] SRP auth failed:`, error.message)
    return integration.auth_token || null
  }
}

// Helper: Get or refresh auth token for a specific location (per-location credentials)
async function getAuthTokenForLocation(supabase: any, locationId: string): Promise<{ token: string; companyId: string; ovationLocationId: string } | null> {
  const { data: mapping } = await supabase
    .from('ovation_location_mappings')
    .select('*')
    .eq('location_id', locationId)
    .maybeSingle()

  if (!mapping || !mapping.cognito_username || !mapping.cognito_password) {
    // Fall back to brand-level credentials
    return null
  }

  // Check if existing token is still valid (less than 20 hours old)
  if (mapping.auth_token && mapping.token_updated_at) {
    const ageHours = (Date.now() - new Date(mapping.token_updated_at).getTime()) / 3600000
    if (ageHours < 20) {
      return { token: mapping.auth_token, companyId: mapping.company_id, ovationLocationId: mapping.ovation_location_id }
    }
  }

  try {
    console.log(`[ovation-service] Authenticating with Cognito for location ${locationId}...`)
    const tokens = await cognitoSrpAuth(mapping.cognito_username, mapping.cognito_password)
    await supabase
      .from('ovation_location_mappings')
      .update({
        auth_token: tokens.IdToken,
        token_updated_at: new Date().toISOString(),
      })
      .eq('id', mapping.id)
    return { token: tokens.IdToken, companyId: mapping.company_id, ovationLocationId: mapping.ovation_location_id }
  } catch (error: any) {
    console.error(`[ovation-service] Location SRP auth failed:`, error.message)
    if (mapping.auth_token) {
      return { token: mapping.auth_token, companyId: mapping.company_id, ovationLocationId: mapping.ovation_location_id }
    }
    return null
  }
}

// ==================== COGNITO LOGIN (explicit) ====================
async function handleCognitoLogin(req: Request, supabase: any) {
  const { brandId } = await req.json()
  if (!brandId) return jsonResponse({ error: 'Missing brandId' }, 400)

  const token = await getAuthToken(supabase, brandId)
  if (!token) return jsonResponse({ success: false, error: 'No credentials or auth failed' })
  return jsonResponse({ success: true })
}

// ==================== TEST AUTH ====================
async function handleTestAuth(req: Request, supabase: any) {
  const { username, password } = await req.json()
  if (!username || !password) return jsonResponse({ error: 'Missing username or password' }, 400)

  try {
    const tokens = await cognitoSrpAuth(username, password)
    
    // Try to discover user info and company ID using the access token
    let ovationUserId: string | null = null
    let companyId: string | null = null
    let companyName: string | null = null

    // Step 1: Get OvationUp user ID from Cognito GetUser
    try {
      const getUserResp = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'AWSCognitoIdentityProviderService.GetUser',
        },
        body: JSON.stringify({ AccessToken: tokens.AccessToken }),
      })
      const userData = await getUserResp.json()
      ovationUserId = userData.Username || null
      console.log('[ovation-service] Cognito user:', ovationUserId, JSON.stringify(userData.UserAttributes))
    } catch (e: any) {
      console.error('[ovation-service] GetUser failed:', e.message)
    }

    // Step 2: Try to fetch user's companies via OvationUp API
    if (ovationUserId) {
      // Try /users/me or /users/{id} patterns
      const tryEndpoints = [
        `${OVATION_API}/users/me`,
        `${OVATION_API}/users/${ovationUserId}`,
        `${OVATION_API}/companies`,
        `${OVATION_API}/company/list`,
        `${OVATION_API}/users/me/companies`,
      ]
      
      for (const endpoint of tryEndpoints) {
        try {
          const resp = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'Authorization': tokens.IdToken,
              'Accept': 'application/json',
            },
          })
          const respText = await resp.text()
          console.log(`[ovation-service] ${endpoint} -> ${resp.status}: ${respText.substring(0, 500)}`)
          
          if (resp.ok) {
            try {
              const data = JSON.parse(respText)
              // Look for company info in response
              if (data?.data?.company?._id) {
                companyId = data.data.company._id
                companyName = data.data.company.name
                break
              }
              if (data?.data?.companies?.[0]?._id) {
                companyId = data.data.companies[0]._id
                companyName = data.data.companies[0].name
                break
              }
              if (data?.data?.companyId) {
                companyId = data.data.companyId
                break
              }
              if (data?.data?._id && data?.data?.name) {
                companyId = data.data._id
                companyName = data.data.name
                break
              }
            } catch {}
          }
        } catch (e: any) {
          console.log(`[ovation-service] ${endpoint} error: ${e.message}`)
        }
      }
    }

    return jsonResponse({ 
      success: true, 
      hasTokens: !!tokens.AccessToken,
      ovationUserId,
      companyId,
      companyName,
    })
  } catch (error: any) {
    console.error('[ovation-service] Test auth failed:', error.message)
    return jsonResponse({ success: false, error: error.message })
  }
}

// ==================== AUTO MAP LOCATIONS ====================
async function handleAutoMapLocations(req: Request, supabase: any) {
  const { brandId } = await req.json()
  if (!brandId) return jsonResponse({ error: 'Missing brandId' }, 400)

  const authToken = await getAuthToken(supabase, brandId)
  if (!authToken) return jsonResponse({ error: 'No auth token available', mapped: 0 }, 400)

  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('company_id')
    .eq('brand_id', brandId)
    .single()

  if (!integration?.company_id) {
    return jsonResponse({ error: 'No company configured', mapped: 0 }, 400)
  }

  // Fetch all OvationUp locations for this company
  let ovationLocations: any[] = []
  try {
    const response = await fetch(`${OVATION_API}/location`, {
      method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ filters: { companyIds: [integration.company_id] } }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[ovation-service] Location list fetch error:', response.status, text)
      return jsonResponse({ error: `API error: ${response.status}`, mapped: 0 })
    }

    const data = await response.json()
    ovationLocations = data?.data?.locations || []
    console.log(`[ovation-service] Found ${ovationLocations.length} OvationUp locations`)
  } catch (error: any) {
    return jsonResponse({ error: error.message, mapped: 0 })
  }

  if (ovationLocations.length === 0) return jsonResponse({ mapped: 0, message: 'No OvationUp locations found' })

  // Get CrooHQ locations for this brand
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id')
    .eq('brand_id', brandId)

  if (!orgs?.length) return jsonResponse({ mapped: 0, message: 'No organizations for brand' })

  const orgIds = orgs.map((o: any) => o.id)
  const { data: crooLocations } = await supabase
    .from('locations')
    .select('id, name, address')
    .in('organization_id', orgIds)

  if (!crooLocations?.length) return jsonResponse({ mapped: 0, message: 'No CrooHQ locations found' })

  const normalize = (value: string | null | undefined) => (value || '').toLowerCase().trim()

  const { data: existingMappings } = await supabase
    .from('ovation_location_mappings')
    .select('location_id, ovation_location_id')
    .in('location_id', crooLocations.map((l: any) => l.id))

  const usedOvationIds = new Set(
    (existingMappings || [])
      .map((m: any) => m.ovation_location_id)
      .filter((id: string | null) => !!id && id !== 'pending')
  )

  const rowsToUpsert: Array<{ location_id: string; ovation_location_id: string }> = []
  const results: { crooName: string; ovationName: string; ovationId: string }[] = []

  for (const crooLoc of crooLocations) {
    const crooName = normalize(crooLoc.name)
    const crooAddress = normalize(crooLoc.address)
    if (!crooName && !crooAddress) continue

    const match = ovationLocations.find((ol: any) => {
      const ovationId = String(ol._id || ol.id || '')
      const olCity = normalize(ol.city || ol.addressDetails?.city)
      const olName = normalize(ol.name || ol.locationName)

      if (!ovationId || (usedOvationIds.has(ovationId) && !(existingMappings || []).some((m: any) => m.location_id === crooLoc.id && m.ovation_location_id === ovationId))) {
        return false
      }

      return (
        (olCity && (olCity === crooName || crooName.includes(olCity) || crooAddress.includes(olCity))) ||
        (olName && (olName.includes(crooName) || crooName.includes(olName)))
      )
    })

    if (!match) continue

    const ovationId = String(match._id || match.id || '')
    if (!ovationId) continue

    usedOvationIds.add(ovationId)
    rowsToUpsert.push({
      location_id: crooLoc.id,
      ovation_location_id: ovationId,
    })
    results.push({
      crooName: crooLoc.name,
      ovationName: match.name || match.locationName || crooLoc.name,
      ovationId,
    })
  }

  if (rowsToUpsert.length === 0) {
    return jsonResponse({ mapped: 0, results: [], totalOvation: ovationLocations.length, totalCroo: crooLocations.length })
  }

  const { error: upsertError } = await supabase
    .from('ovation_location_mappings')
    .upsert(rowsToUpsert, { onConflict: 'location_id' })

  if (upsertError) {
    console.error('[ovation-service] Auto-map upsert error:', upsertError)
    return jsonResponse({ error: upsertError.message, mapped: 0 }, 500)
  }

  console.log(`[ovation-service] Auto-mapped ${rowsToUpsert.length} locations`)
  return jsonResponse({
    mapped: rowsToUpsert.length,
    results,
    totalOvation: ovationLocations.length,
    totalCroo: crooLocations.length,
  })
}

// ==================== SAVE CONFIG ====================
async function handleSaveConfig(req: Request, supabase: any) {
  const { brandId, companyId, authToken, refreshToken } = await req.json()

  if (!brandId || !companyId) {
    return jsonResponse({ error: 'Missing brandId or companyId' }, 400)
  }

  const { data: existing } = await supabase
    .from('ovation_integrations')
    .select('id')
    .eq('brand_id', brandId)
    .maybeSingle()

  const updateData: any = {
    company_id: companyId,
    is_active: true,
    updated_at: new Date().toISOString(),
  }

  if (authToken) {
    updateData.auth_token = authToken
    updateData.token_updated_at = new Date().toISOString()
  }

  if (existing) {
    const { error } = await supabase
      .from('ovation_integrations')
      .update(updateData)
      .eq('id', existing.id)

    if (error) throw error
  } else {
    const { error } = await supabase
      .from('ovation_integrations')
      .insert({ brand_id: brandId, ...updateData })

    if (error) throw error
  }

  console.log(`[ovation-service] Config saved for brand ${brandId}`)
  return jsonResponse({ success: true })
}

// ==================== SAVE LOCATION MAPPING ====================
async function handleSaveLocationMapping(req: Request, supabase: any) {
  const { locationId, ovationLocationId } = await req.json()

  if (!locationId || !ovationLocationId) {
    return jsonResponse({ error: 'Missing locationId or ovationLocationId' }, 400)
  }

  const { data: existing } = await supabase
    .from('ovation_location_mappings')
    .select('id')
    .eq('location_id', locationId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('ovation_location_mappings')
      .update({ ovation_location_id: ovationLocationId })
      .eq('id', existing.id)

    if (error) throw error
  } else {
    const { error } = await supabase
      .from('ovation_location_mappings')
      .insert({ location_id: locationId, ovation_location_id: ovationLocationId })

    if (error) throw error
  }

  return jsonResponse({ success: true })
}

// ==================== GET CONFIG ====================
async function handleGetConfig(req: Request, supabase: any) {
  const { brandId, locationId } = await req.json()

  let integration = null
  if (brandId) {
    const { data } = await supabase
      .from('ovation_integrations')
      .select('*')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle()
    integration = data
  }

  let locationMapping = null
  if (locationId) {
    const { data } = await supabase
      .from('ovation_location_mappings')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle()
    locationMapping = data
  }

  let tokenAgeHours = null
  if (integration?.token_updated_at) {
    tokenAgeHours = Math.round(
      (Date.now() - new Date(integration.token_updated_at).getTime()) / 3600000
    )
  }

  return jsonResponse({
    integration: integration ? {
      id: integration.id,
      companyId: integration.company_id,
      isActive: integration.is_active,
      tokenUpdatedAt: integration.token_updated_at,
      tokenAgeHours,
      hasToken: !!integration.auth_token,
      hasCredentials: !!integration.cognito_username,
    } : null,
    locationMapping: locationMapping ? {
      ovationLocationId: locationMapping.ovation_location_id,
    } : null,
  })
}

// ==================== TEST CONNECTION ====================
async function handleTestConnection(req: Request, supabase: any) {
  const { brandId } = await req.json()

  const authToken = await getAuthToken(supabase, brandId)
  if (!authToken) {
    return jsonResponse({ success: false, error: 'No auth token available' })
  }

  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('company_id')
    .eq('brand_id', brandId)
    .single()

  try {
    const response = await fetch(`${OVATION_API}/survey/list`, {
      method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        filters: {
          companyIds: [integration.company_id],
          createdAtRange: [
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            new Date().toISOString(),
          ],
        },
        page: 1,
        pageSize: 1,
      }),
    })

    if (response.status === 401) {
      return jsonResponse({ success: false, error: 'Token expired', expired: true })
    }

    if (!response.ok) {
      return jsonResponse({ success: false, error: `API returned ${response.status}` })
    }

    const data = await response.json()
    return jsonResponse({
      success: true,
      totalSurveys: data?.data?.count || 0,
    })
  } catch (error: any) {
    return jsonResponse({ success: false, error: error.message })
  }
}

// ==================== LIST OVATION LOCATIONS ====================
async function handleListOvationLocations(req: Request, supabase: any) {
  const { brandId } = await req.json()

  const authToken = await getAuthToken(supabase, brandId)
  if (!authToken) {
    return jsonResponse({ error: 'No auth token available', locations: [] })
  }

  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('company_id')
    .eq('brand_id', brandId)
    .single()

  try {
    const response = await fetch(`${OVATION_API}/location`, {
      method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        filters: { companyIds: [integration.company_id] },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[ovation-service] Location list error:', response.status, text)
      return jsonResponse({ error: `API error: ${response.status}`, locations: [] })
    }

    const data = await response.json()
    const locations = Array.isArray(data) ? data : data?.data || data?.locations || []

    return jsonResponse({
      locations: locations.map((l: any) => ({
        id: l._id || l.id,
        name: l.name || l.locationName,
        storeNumber: l.storeNumber || l.number,
      })),
    })
  } catch (error: any) {
    return jsonResponse({ error: error.message, locations: [] })
  }
}

function extractSurveyLocationIds(survey: any): string[] {
  const rawIds = [
    survey?.location,
    survey?.locationId,
    survey?.location_id,
    survey?.location?._id,
    survey?.location?.id,
    survey?.store?._id,
    survey?.store?.id,
  ].filter(Boolean)

  return Array.from(new Set(rawIds.map((value: any) => String(value))))
}

function surveyMatchesAllowedLocations(survey: any, allowedLocationIds: string[]): boolean {
  if (allowedLocationIds.length === 0) return true
  const surveyLocationIds = extractSurveyLocationIds(survey)
  return surveyLocationIds.some((id) => allowedLocationIds.includes(id))
}

// Helper: extract ovation_user_id from Cognito IdToken JWT
function extractOvationUserId(idToken: string): string | null {
  try {
    const parts = idToken.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload['custom:ovation_user_id'] || payload['cognito:username'] || payload['sub'] || null
  } catch {
    return null
  }
}

// ==================== FETCH REVIEWS ====================
async function handleFetchReviews(req: Request, supabase: any) {
  const { locationId, brandId, days = 14, page = 1, pageSize = 20 } = await req.json()

  let authToken: string | null = null
  let companyId: string | null = null
  let ovationLocationIds: string[] = []

  // Try per-location credentials first
  if (locationId) {
    const locAuth = await getAuthTokenForLocation(supabase, locationId)
    if (locAuth) {
      authToken = locAuth.token
      companyId = locAuth.companyId
      if (locAuth.ovationLocationId && locAuth.ovationLocationId !== 'pending') {
        ovationLocationIds = [locAuth.ovationLocationId]
      } else if (locAuth.ovationLocationId === 'pending') {
        return jsonResponse({ reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0, pending: true })
      }
    }
  }

  // Fall back to brand-level credentials
  if (!authToken) {
    let resolvedBrandId = brandId
    if (!resolvedBrandId && locationId) {
      const { data: loc } = await supabase.from('locations').select('organization_id').eq('id', locationId).single()
      if (loc) {
        const { data: org } = await supabase.from('organizations').select('brand_id').eq('id', loc.organization_id).single()
        if (org) resolvedBrandId = org.brand_id
      }
    }
    if (!resolvedBrandId) return jsonResponse({ error: 'Could not resolve brand', reviews: [] })

    authToken = await getAuthToken(supabase, resolvedBrandId)
    if (!authToken) return jsonResponse({ error: 'No OvationUp integration', reviews: [] })

    const { data: integration } = await supabase.from('ovation_integrations').select('company_id').eq('brand_id', resolvedBrandId).single()
    companyId = integration?.company_id

    if (locationId && ovationLocationIds.length === 0) {
      const { data: mapping } = await supabase.from('ovation_location_mappings').select('ovation_location_id').eq('location_id', locationId).maybeSingle()
      if (mapping && mapping.ovation_location_id !== 'pending') {
        ovationLocationIds = [mapping.ovation_location_id]
      } else if (mapping && mapping.ovation_location_id === 'pending') {
        return jsonResponse({ reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0, pending: true })
      } else {
        return jsonResponse({ reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 })
      }
    }
  }

  if (locationId && ovationLocationIds.length === 0) {
    return jsonResponse({ reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 })
  }
  if (!companyId) return jsonResponse({ error: 'No company ID configured', reviews: [] })

  const now = new Date()
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  // Use survey/list with skip/limit pagination (matching Ovation's dashboard pattern)
  const matchingSurveys: any[] = []
  const seenIds = new Set<string>()
  const BATCH_SIZE = 50
  const MAX_SKIP = 500

  try {
    const filters: any = {
      companyIds: [companyId],
      createdAtRange: [startDate.toISOString(), now.toISOString()],
      ...(ovationLocationIds.length > 0 ? { locationIds: ovationLocationIds } : {}),
    }

    let skip = 0
    let totalCount = 0
    let emptyBatches = 0

    while (skip < MAX_SKIP) {
      const response = await fetch(`${OVATION_API}/survey/list`, {
        method: 'POST',
        headers: {
          'Authorization': authToken!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ filters, skip, limit: BATCH_SIZE }),
      })

      if (response.status === 401) {
        return jsonResponse({ error: 'Token expired', reviews: [], expired: true })
      }

      if (!response.ok) {
        console.error('[ovation-service] survey/list error:', response.status)
        break
      }

      const data = await response.json()
      const surveys = data?.data?.surveys || []
      totalCount = data?.data?.count || totalCount

      if (surveys.length === 0) break

      const newSurveys = surveys.filter((s: any) => {
        const id = s._id || s.id
        if (!id || seenIds.has(id)) return false
        seenIds.add(id)
        return true
      })

      if (newSurveys.length === 0) {
        emptyBatches++
        if (emptyBatches >= 2) break
      } else {
        emptyBatches = 0
      }

      // Server-side location + date filtering (strict — API ignores createdAtRange)
      const pageMatches = newSurveys.filter((survey: any) => {
        // Date filter: the API does NOT respect createdAtRange, so enforce it here
        const surveyDate = new Date(survey.created)
        if (surveyDate < startDate || surveyDate > now) return false
        // Location filter
        return surveyMatchesAllowedLocations(survey, ovationLocationIds)
      })
      matchingSurveys.push(...pageMatches)

      // If we're getting surveys older than our window, stop paginating
      const oldestInBatch = surveys[surveys.length - 1]
      const oldestDate = oldestInBatch?.created ? new Date(oldestInBatch.created) : null
      if (oldestDate && oldestDate < startDate) {
        console.log(`[ovation-service] skip=${skip}: reached surveys before startDate, stopping pagination`)
        break
      }

      console.log(`[ovation-service] skip=${skip}: ${pageMatches.length}/${surveys.length} matched (total API count=${totalCount})`)

      if (skip + BATCH_SIZE >= totalCount) break
      skip += BATCH_SIZE
    }

    const offset = Math.max(0, (page - 1) * pageSize)
    const pagedSurveys = matchingSurveys.slice(offset, offset + pageSize)

    const reviews = pagedSurveys.map((s: any) => ({
      id: s._id,
      customerName: s.customer?.name || 'Anonymous',
      rating: s.rating,
      feedback: s.feedback || null,
      source: s.source,
      createdAt: s.created,
      hasResponse: !!s.response,
    }))

    // Use the same 14-day window as the query (matches the "14d" label in the UI)
    const wtdSurveys = matchingSurveys
    const wtdAvg = wtdSurveys.length > 0
      ? wtdSurveys.reduce((sum: number, s: any) => sum + (s.rating || 0), 0) / wtdSurveys.length
      : null

    return jsonResponse({
      reviews,
      totalCount: matchingSurveys.length,
      wtdAverage: wtdAvg ? Math.round(wtdAvg * 100) / 100 : null,
      wtdCount: wtdSurveys.length,
    })
  } catch (error: any) {
    console.error('[ovation-service] Fetch reviews error:', error)
    return jsonResponse({ error: error.message, reviews: [] })
  }
}

// ==================== FETCH SCORES ====================
async function handleFetchScores(req: Request, supabase: any) {
  const { brandId, locationIds, dateRange } = await req.json()

  const authToken = await getAuthToken(supabase, brandId)
  if (!authToken) {
    return jsonResponse({ error: 'Not configured', scores: [] })
  }

  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('company_id')
    .eq('brand_id', brandId)
    .single()

  // Get ovation location mappings
  let ovationLocationIds: string[] = []
  const locationMappings: Record<string, string> = {}

  if (locationIds?.length > 0) {
    const { data: mappings } = await supabase
      .from('ovation_location_mappings')
      .select('location_id, ovation_location_id')
      .in('location_id', locationIds)
    if (mappings) {
      ovationLocationIds = mappings
        .filter((m: any) => m.ovation_location_id && m.ovation_location_id !== 'pending')
        .map((m: any) => m.ovation_location_id)
      mappings.forEach((m: any) => {
        if (m.ovation_location_id && m.ovation_location_id !== 'pending') {
          locationMappings[m.ovation_location_id] = m.location_id
        }
      })
    }
  }

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  try {
    const response = await fetch(`${OVATION_API}/survey/survey-scores`, {
      method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        filters: {
          companyIds: [integration.company_id],
          locationIds: ovationLocationIds,
          createdAtRange: dateRange || [thirtyDaysAgo.toISOString(), now.toISOString()],
        },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return jsonResponse({ error: `API error: ${response.status}`, scores: [] })
    }

    const data = await response.json()
    return jsonResponse({ scores: data, raw: data })
  } catch (error: any) {
    return jsonResponse({ error: error.message, scores: [] })
  }
}

// ==================== REFRESH TOKEN ====================
async function handleRefreshToken(req: Request, supabase: any) {
  const { brandId } = await req.json()

  // Just use getAuthToken which handles SRP refresh automatically
  const token = await getAuthToken(supabase, brandId)
  if (token) {
    return jsonResponse({ success: true, refreshed: true })
  }
  return jsonResponse({ success: false, error: 'Could not refresh token' })
}

// ==================== PROBE API ====================
async function handleProbeApi(req: Request, supabase: any) {
  const { brandId, locationId } = await req.json()

  let resolvedBrandId = brandId
  if (!resolvedBrandId && locationId) {
    const { data: loc } = await supabase.from('locations').select('organization_id').eq('id', locationId).single()
    if (loc) {
      const { data: org } = await supabase.from('organizations').select('brand_id').eq('id', loc.organization_id).single()
      if (org) resolvedBrandId = org.brand_id
    }
  }

  const authToken = await getAuthToken(supabase, resolvedBrandId)
  if (!authToken) return jsonResponse({ error: 'No auth token' })

  const { data: integration } = await supabase.from('ovation_integrations').select('company_id').eq('brand_id', resolvedBrandId).single()
  const companyId = integration?.company_id

  // Get PS ovation location id
  const { data: mapping } = await supabase.from('ovation_location_mappings').select('ovation_location_id').eq('location_id', locationId).maybeSingle()
  const ovLocId = mapping?.ovation_location_id

  const results: Record<string, any> = {}
  const baseUrl = 'https://api.ovationup.com/app-services/v2'
  const headers = { 'Authorization': authToken, 'Content-Type': 'application/json', 'Accept': 'application/json' }

  // Try different endpoints
  const endpoints = [
    { name: 'survey/list_page2', url: `${baseUrl}/survey/list`, body: { filters: { companyIds: [companyId], locationIds: ovLocId ? [ovLocId] : [] }, page: 2, pageSize: 50 } },
    { name: 'survey/list_page3', url: `${baseUrl}/survey/list`, body: { filters: { companyIds: [companyId], locationIds: ovLocId ? [ovLocId] : [] }, page: 3, pageSize: 50 } },
    { name: 'survey/list_small', url: `${baseUrl}/survey/list`, body: { filters: { companyIds: [companyId], locationIds: ovLocId ? [ovLocId] : [] }, page: 1, pageSize: 200 } },
    { name: 'survey/list_loc_only', url: `${baseUrl}/survey/list`, body: { filters: { companyIds: [companyId], locationIds: ovLocId ? [ovLocId] : [], createdAtRange: [new Date(Date.now() - 14*86400000).toISOString(), new Date().toISOString()] }, page: 1, pageSize: 200 } },
    { name: 'surveys_GET', url: `${baseUrl}/surveys?companyId=${companyId}&locationId=${ovLocId}&page=1&pageSize=100`, body: null },
    { name: 'survey_GET', url: `${baseUrl}/survey?companyId=${companyId}&locationId=${ovLocId}&page=1&pageSize=100`, body: null },
    { name: 'company_surveys', url: `${baseUrl}/company/${companyId}/surveys`, body: null },
    { name: 'location_surveys', url: `${baseUrl}/location/${ovLocId}/surveys`, body: null },
    { name: 'survey_search', url: `${baseUrl}/survey/search`, body: { companyId, locationId: ovLocId, page: 1, pageSize: 100 } },
    { name: 'survey_filter', url: `${baseUrl}/survey/filter`, body: { companyId, locationIds: [ovLocId], page: 1, pageSize: 100 } },
  ]

  for (const ep of endpoints) {
    try {
      const opts: any = { headers }
      if (ep.body) {
        opts.method = 'POST'
        opts.body = JSON.stringify(ep.body)
      } else {
        opts.method = 'GET'
      }
      const resp = await fetch(ep.url, opts)
      const text = await resp.text()
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch {}
      
      const surveyCount = parsed?.data?.surveys?.length || parsed?.data?.length || parsed?.surveys?.length || parsed?.length || null
      const totalRecords = parsed?.data?.count || parsed?.data?.totalCount || parsed?.totalRecords || parsed?.total || null
      
      results[ep.name] = {
        status: resp.status,
        surveyCount,
        totalRecords,
        keys: parsed ? Object.keys(parsed) : null,
        dataKeys: parsed?.data ? Object.keys(parsed.data) : null,
        sample: text.substring(0, 300),
      }
    } catch (e: any) {
      results[ep.name] = { error: e.message }
    }
  }

  return jsonResponse({ companyId, ovationLocationId: ovLocId, results })
}

// ==================== TEST SURVEY SKIP ====================
async function handleTestSurveySkip(req: Request, supabase: any) {
  const { locationId } = await req.json()
  
  let resolvedBrandId: string | null = null
  if (locationId) {
    const { data: loc } = await supabase.from('locations').select('organization_id').eq('id', locationId).single()
    if (loc) {
      const { data: org } = await supabase.from('organizations').select('brand_id').eq('id', loc.organization_id).single()
      if (org) resolvedBrandId = org.brand_id
    }
  }

  const authToken = await getAuthToken(supabase, resolvedBrandId!)
  if (!authToken) return jsonResponse({ error: 'No auth token' })

  const { data: integration } = await supabase.from('ovation_integrations').select('company_id').eq('brand_id', resolvedBrandId).single()
  const companyId = integration?.company_id
  
  const { data: mapping } = await supabase.from('ovation_location_mappings').select('ovation_location_id').eq('location_id', locationId).maybeSingle()
  const ovLocId = mapping?.ovation_location_id

  const results: Record<string, any> = {}

  // Test survey/list with skip/limit (like Ovation dashboard does)
  for (const skip of [0, 50, 100]) {
    const body = {
      filters: {
        companyIds: [companyId],
        locationIds: ovLocId ? [ovLocId] : [],
      },
      skip,
      limit: 50,
    }
    
    try {
      const resp = await fetch(`${OVATION_API}/survey/list`, {
        method: 'POST',
        headers: { 'Authorization': authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json()
      const surveys = data?.data?.surveys || []
      const firstId = surveys[0]?._id || 'none'
      const lastId = surveys[surveys.length - 1]?._id || 'none'
      results[`skip_${skip}`] = {
        count: surveys.length,
        total: data?.data?.count,
        firstId,
        lastId,
        firstDate: surveys[0]?.created,
        lastDate: surveys[surveys.length - 1]?.created,
      }
    } catch (e: any) {
      results[`skip_${skip}`] = { error: e.message }
    }
  }

  return jsonResponse({ results })
}
