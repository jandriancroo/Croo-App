import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OVATION_API = 'https://api.ovationup.com/app-services/v2'
const COGNITO_REGION = 'us-east-1'
const COGNITO_USER_POOL = 'us-east-1_ddNUtzgDs'
const COGNITO_CLIENT_ID = '45rj7fb9l3bmjv2fkvp3s4qnr9'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || ''

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    switch (action) {
      case 'save_config':
        return await handleSaveConfig(req, supabase)
      case 'save_location_mapping':
        return await handleSaveLocationMapping(req, supabase)
      case 'test_connection':
        return await handleTestConnection(req, supabase)
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

  // Store refresh token as a secret-like field (we'll add column if needed)
  // For now, store in auth_token alongside the ID token
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

  // Calculate token age
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
    } : null,
    locationMapping: locationMapping ? {
      ovationLocationId: locationMapping.ovation_location_id,
    } : null,
  })
}

// ==================== TEST CONNECTION ====================
async function handleTestConnection(req: Request, supabase: any) {
  const { brandId } = await req.json()

  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .maybeSingle()

  if (!integration?.auth_token) {
    return jsonResponse({ success: false, error: 'No auth token configured' })
  }

  try {
    const response = await fetch(`${OVATION_API}/survey/list`, {
      method: 'POST',
      headers: {
        'Authorization': integration.auth_token,
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

  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .maybeSingle()

  if (!integration?.auth_token) {
    return jsonResponse({ error: 'No auth token configured', locations: [] })
  }

  try {
    const response = await fetch(`${OVATION_API}/location`, {
      method: 'POST',
      headers: {
        'Authorization': integration.auth_token,
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

// ==================== FETCH REVIEWS ====================
async function handleFetchReviews(req: Request, supabase: any) {
  const { locationId, brandId, days = 7, page = 1, pageSize = 20 } = await req.json()

  // Get brand integration
  let integration: any = null
  if (brandId) {
    const { data } = await supabase
      .from('ovation_integrations')
      .select('*')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .maybeSingle()
    integration = data
  } else if (locationId) {
    // Get brand via location -> org -> brand
    const { data: loc } = await supabase
      .from('locations')
      .select('organization_id')
      .eq('id', locationId)
      .single()
    if (loc) {
      const { data: org } = await supabase
        .from('organizations')
        .select('brand_id')
        .eq('id', loc.organization_id)
        .single()
      if (org) {
        const { data } = await supabase
          .from('ovation_integrations')
          .select('*')
          .eq('brand_id', org.brand_id)
          .eq('is_active', true)
          .maybeSingle()
        integration = data
      }
    }
  }

  if (!integration?.auth_token) {
    return jsonResponse({ error: 'No OvationUp integration', reviews: [] })
  }

  // Get ovation location ID mapping
  let ovationLocationIds: string[] = []
  if (locationId) {
    const { data: mapping } = await supabase
      .from('ovation_location_mappings')
      .select('ovation_location_id')
      .eq('location_id', locationId)
      .maybeSingle()
    if (mapping) {
      ovationLocationIds = [mapping.ovation_location_id]
    }
  }

  const now = new Date()
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const filters: any = {
    companyIds: [integration.company_id],
    createdAtRange: [startDate.toISOString(), now.toISOString()],
  }
  if (ovationLocationIds.length > 0) {
    filters.locationIds = ovationLocationIds
  }

  try {
    const response = await fetch(`${OVATION_API}/survey/list`, {
      method: 'POST',
      headers: {
        'Authorization': integration.auth_token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ filters, page, pageSize }),
    })

    if (response.status === 401) {
      return jsonResponse({ error: 'Token expired', reviews: [], expired: true })
    }

    if (!response.ok) {
      const text = await response.text()
      return jsonResponse({ error: `API error: ${response.status}`, reviews: [] })
    }

    const data = await response.json()
    const surveys = data?.data?.surveys || []

    const reviews = surveys.map((s: any) => ({
      id: s._id,
      customerName: s.customer?.name || 'Anonymous',
      rating: s.rating,
      feedback: s.feedback || null,
      source: s.source,
      createdAt: s.created,
      hasResponse: !!s.response,
    }))

    // Calculate WTD average
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()) // Sunday
    weekStart.setHours(0, 0, 0, 0)

    const wtdSurveys = surveys.filter((s: any) => new Date(s.created) >= weekStart)
    const wtdAvg = wtdSurveys.length > 0
      ? wtdSurveys.reduce((sum: number, s: any) => sum + (s.rating || 0), 0) / wtdSurveys.length
      : null

    const totalCount = data?.data?.count || reviews.length

    return jsonResponse({
      reviews,
      totalCount,
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

  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .maybeSingle()

  if (!integration?.auth_token) {
    return jsonResponse({ error: 'Not configured', scores: [] })
  }

  // Get ovation location mappings
  let ovationLocationIds: string[] = []
  const locationMappings: Record<string, string> = {}

  if (locationIds?.length > 0) {
    const { data: mappings } = await supabase
      .from('ovation_location_mappings')
      .select('location_id, ovation_location_id')
      .in('location_id', locationIds)
    if (mappings) {
      ovationLocationIds = mappings.map((m: any) => m.ovation_location_id)
      mappings.forEach((m: any) => {
        locationMappings[m.ovation_location_id] = m.location_id
      })
    }
  }

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  try {
    const response = await fetch(`${OVATION_API}/survey/survey-scores`, {
      method: 'POST',
      headers: {
        'Authorization': integration.auth_token,
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

  const { data: integration } = await supabase
    .from('ovation_integrations')
    .select('*')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (!integration) {
    return jsonResponse({ error: 'No OvationUp integration found' }, 400)
  }

  // Try to decode current token to check expiry
  const currentToken = integration.auth_token
  if (currentToken) {
    try {
      const parts = currentToken.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
        const expiresAt = payload.exp * 1000
        const hoursUntilExpiry = (expiresAt - Date.now()) / 3600000

        if (hoursUntilExpiry > 2) {
          return jsonResponse({
            success: true,
            message: `Token still valid for ${Math.round(hoursUntilExpiry)}h`,
            refreshed: false,
          })
        }
      }
    } catch {}
  }

  // Token expired or expiring soon - need refresh
  // AWS Cognito refresh token flow
  const refreshToken = Deno.env.get('OVATION_REFRESH_TOKEN')
  if (!refreshToken) {
    return jsonResponse({
      success: false,
      error: 'No refresh token configured. Please update OVATION_REFRESH_TOKEN secret.',
    })
  }

  try {
    const cognitoResponse = await fetch(
      `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: COGNITO_CLIENT_ID,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
          },
        }),
      }
    )

    const cognitoData = await cognitoResponse.json()

    if (cognitoData.AuthenticationResult?.IdToken) {
      const newToken = cognitoData.AuthenticationResult.IdToken

      // Save new token
      await supabase
        .from('ovation_integrations')
        .update({
          auth_token: newToken,
          token_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', integration.id)

      console.log(`[ovation-service] Token refreshed for brand ${brandId}`)
      return jsonResponse({ success: true, refreshed: true })
    } else {
      console.error('[ovation-service] Cognito refresh failed:', cognitoData)
      return jsonResponse({
        success: false,
        error: cognitoData.message || 'Cognito refresh failed',
        details: cognitoData.__type,
      })
    }
  } catch (error: any) {
    console.error('[ovation-service] Token refresh error:', error)
    return jsonResponse({ success: false, error: error.message })
  }
}
