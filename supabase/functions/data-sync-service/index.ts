import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'sync-birthday-events'

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    switch (action) {
      case 'sync-birthday-events':
        return await handleBirthdaySync(supabase)
      case 'import-bom':
        return await handleImportBOM(req, supabase)
      case 'diff-bom':
        return await handleDiffBOM(req, supabase)
      case 'apply-bom-diff':
        return await handleApplyBOMDiff(req, supabase)
      case 'fetch-ovation-scores':
        return await handleFetchOvationScores(req, supabase)
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (error: any) {
    console.error(`[data-sync-service] Error (action=${action}):`, error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ==================== SYNC BIRTHDAY EVENTS ====================

async function handleBirthdaySync(supabase: any): Promise<Response> {
  try {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, birthday')
      .eq('is_active', true)
      .not('birthday', 'is', null)

    if (profilesError) throw profilesError

    const { data: userLocations, error: userLocationsError } = await supabase
      .from('user_locations')
      .select('user_id, location_id')

    if (userLocationsError) throw userLocationsError

    const userLocationMap = new Map<string, string[]>()
    for (const ul of userLocations || []) {
      if (!userLocationMap.has(ul.user_id)) {
        userLocationMap.set(ul.user_id, [])
      }
      userLocationMap.get(ul.user_id)!.push(ul.location_id)
    }

    const expectedCombos = new Set<string>()
    const birthdayHolidays = []
    const today = new Date()
    
    for (const profile of profiles || []) {
      if (!profile.birthday) continue

      const [year, month, day] = profile.birthday.split('-').map(Number)
      const thisYearBirthday = new Date(today.getFullYear(), month - 1, day)
      const holidayDate = thisYearBirthday.toISOString().split('T')[0]

      const locationIds = userLocationMap.get(profile.id) || []

      if (locationIds.length === 0) {
        continue
      }

      for (const locationId of locationIds) {
        const comboKey = `${profile.id}:${locationId}`
        expectedCombos.add(comboKey)
        
        birthdayHolidays.push({
          holiday_name: `🎂 ${profile.full_name}'s Birthday`,
          holiday_date: holidayDate,
          holiday_type: 'birthday',
          user_id: profile.id,
          location_id: locationId,
          is_recurring: true
        })
      }
    }

    const { data: existingHolidays, error: existingError } = await supabase
      .from('holidays')
      .select('id, user_id, location_id')
      .eq('holiday_type', 'birthday')

    if (existingError) throw existingError

    const seenCombos = new Map<string, string>()
    const toDelete: string[] = []
    
    for (const h of existingHolidays || []) {
      const comboKey = `${h.user_id}:${h.location_id}`
      
      if (!expectedCombos.has(comboKey)) {
        toDelete.push(h.id)
      } else if (seenCombos.has(comboKey)) {
        toDelete.push(h.id)
      } else {
        seenCombos.set(comboKey, h.id)
      }
    }

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('holidays')
        .delete()
        .in('id', toDelete)

      if (deleteError) throw deleteError
    }

    const toInsert = birthdayHolidays.filter(h => {
      const comboKey = `${h.user_id}:${h.location_id}`
      return !seenCombos.has(comboKey)
    })

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('holidays')
        .insert(toInsert)

      if (insertError) throw insertError
    }

    for (const h of birthdayHolidays) {
      const comboKey = `${h.user_id}:${h.location_id}`
      const existingId = seenCombos.get(comboKey)
      
      if (existingId) {
        await supabase
          .from('holidays')
          .update({
            holiday_name: h.holiday_name,
            holiday_date: h.holiday_date,
          })
          .eq('id', existingId)
      }
    }

    return new Response(
      JSON.stringify({ 
        message: `Synced birthday holidays: ${toInsert.length} added, ${toDelete.length} removed`,
        added: toInsert.length,
        removed: toDelete.length,
        total: birthdayHolidays.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('[data-sync-service] Error syncing birthday holidays:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}

// ==================== IMPORT BOM ====================

interface BOMRow {
  item: string
  recipe: string
  qty: number
  uofm: string
  yieldPercent: number
}

interface ParsedIngredient {
  r365_name: string
  category: string
  clean_name: string
  unit_standard: string
  is_prep_item: boolean
}

interface ParsedMenuItem {
  r365_name: string
  category: string
  clean_name: string
  is_sellable: boolean
}

function extractIngredientCategory(name: string): string {
  const prefixes = ['DRY', 'MEAT', 'DAIRY', 'PROD', 'PREP', 'PAPER', 'NA BEV', 'BEER', 'WINE', 'MI']
  
  for (const prefix of prefixes) {
    if (name.toUpperCase().startsWith(prefix)) {
      return prefix.replace(' ', '_').toUpperCase()
    }
  }
  return 'OTHER'
}

function extractMenuCategory(name: string): string {
  if (name.startsWith('MI -')) return 'MI'
  if (name.startsWith('Core -') || name.startsWith('Core ')) return 'CORE'
  if (name.startsWith('Base -')) return 'BASE'
  if (name.startsWith('PREP') || name.startsWith('Prep')) return 'PREP'
  if (name.startsWith('Catering') || name.startsWith('Cat -')) return 'CATERING'
  if (name.startsWith('Culinary')) return 'CULINARY'
  if (name.startsWith('Costing')) return 'COSTING'
  if (name.startsWith('Offer')) return 'OFFER'
  return 'OTHER'
}

function cleanIngredientName(name: string): string {
  const prefixes = ['DRY ', 'MEAT ', 'DAIRY ', 'PROD ', 'PREP ', 'PAPER ', 'NA BEV ', 'BEER ', 'WINE ', 'MI ']
  let clean = name
  for (const prefix of prefixes) {
    if (clean.toUpperCase().startsWith(prefix)) {
      clean = clean.substring(prefix.length)
      break
    }
  }
  return clean.trim().toLowerCase()
}

function cleanMenuName(name: string): string {
  return name.replace(/^(MI|Core|Base|PREP|Prep|Catering|Cat|Culinary|Costing|Offer)\s*-?\s*/i, '').trim().toLowerCase()
}

function normalizeUnit(uofm: string): string {
  const normalized = uofm.toLowerCase().replace('-', '')
  if (normalized.includes('oz') && normalized.includes('wt')) return 'oz'
  if (normalized.includes('oz') && normalized.includes('fl')) return 'fl_oz'
  if (normalized.includes('oz')) return 'oz'
  if (normalized.includes('each')) return 'each'
  if (normalized.includes('gram')) return 'gram'
  if (normalized.includes('lb')) return 'lb'
  if (normalized.includes('gallon')) return 'gallon'
  if (normalized.includes('quart')) return 'quart'
  if (normalized.includes('can')) return 'each'
  if (normalized.includes('bottle')) return 'each'
  if (normalized.includes('pack')) return 'each'
  if (normalized.includes('ct')) return 'each'
  return 'each'
}

function parseCSV(content: string): BOMRow[] {
  const lines = content.split('\n').filter(line => line.trim())
  if (lines.length < 2) return []
  
  const rows: BOMRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const parts: string[] = []
    let current = ''
    let inQuotes = false
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        parts.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    parts.push(current.trim())
    
    if (parts.length >= 5) {
      rows.push({
        item: parts[0],
        recipe: parts[1],
        qty: parseFloat(parts[2]) || 0,
        uofm: parts[3],
        yieldPercent: parseFloat(parts[4]) || 100,
      })
    }
  }
  
  return rows
}

async function handleImportBOM(req: Request, supabase: any): Promise<Response> {
  try {
    const { csvContent, locationId } = await req.json()

    if (!csvContent || !locationId) {
      return new Response(
        JSON.stringify({ error: 'Missing csvContent or locationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[data-sync-service] Starting BOM import for location: ${locationId}`)

    const rows = parseCSV(csvContent)
    console.log(`[data-sync-service] Parsed ${rows.length} rows from CSV`)

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid rows found in CSV' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const ingredientMap = new Map<string, ParsedIngredient>()
    for (const row of rows) {
      if (!ingredientMap.has(row.item)) {
        const category = extractIngredientCategory(row.item)
        ingredientMap.set(row.item, {
          r365_name: row.item,
          category,
          clean_name: cleanIngredientName(row.item),
          unit_standard: normalizeUnit(row.uofm),
          is_prep_item: category === 'PREP',
        })
      }
    }

    const menuItemMap = new Map<string, ParsedMenuItem>()
    for (const row of rows) {
      if (!menuItemMap.has(row.recipe)) {
        const category = extractMenuCategory(row.recipe)
        menuItemMap.set(row.recipe, {
          r365_name: row.recipe,
          category,
          clean_name: cleanMenuName(row.recipe),
          is_sellable: category === 'MI',
        })
      }
    }

    console.log(`[data-sync-service] Found ${ingredientMap.size} unique ingredients`)
    console.log(`[data-sync-service] Found ${menuItemMap.size} unique menu items`)

    const ingredientData = Array.from(ingredientMap.values()).map(ing => ({
      location_id: locationId,
      ...ing,
    }))

    const { data: insertedIngredients, error: ingError } = await supabase
      .from('bom_ingredients')
      .upsert(ingredientData, { 
        onConflict: 'location_id,r365_name',
        ignoreDuplicates: false 
      })
      .select('id, r365_name')

    if (ingError) {
      console.error('[data-sync-service] Error inserting ingredients:', ingError)
      throw ingError
    }

    console.log(`[data-sync-service] Upserted ${insertedIngredients?.length || 0} ingredients`)

    const menuItemData = Array.from(menuItemMap.values()).map(mi => ({
      location_id: locationId,
      ...mi,
    }))

    const { data: insertedMenuItems, error: miError } = await supabase
      .from('bom_menu_items')
      .upsert(menuItemData, { 
        onConflict: 'location_id,r365_name',
        ignoreDuplicates: false 
      })
      .select('id, r365_name')

    if (miError) {
      console.error('[data-sync-service] Error inserting menu items:', miError)
      throw miError
    }

    console.log(`[data-sync-service] Upserted ${insertedMenuItems?.length || 0} menu items`)

    const ingredientIdMap = new Map<string, string>()
    const { data: allIngredients } = await supabase
      .from('bom_ingredients')
      .select('id, r365_name')
      .eq('location_id', locationId)
    
    for (const ing of allIngredients || []) {
      ingredientIdMap.set(ing.r365_name, ing.id)
    }

    const menuItemIdMap = new Map<string, string>()
    const { data: allMenuItems } = await supabase
      .from('bom_menu_items')
      .select('id, r365_name')
      .eq('location_id', locationId)
    
    for (const mi of allMenuItems || []) {
      menuItemIdMap.set(mi.r365_name, mi.id)
    }

    const recipeMap = new Map<string, {
      location_id: string
      menu_item_id: string
      ingredient_id: string
      quantity: number
      unit_of_measure: string
      quantity_normalized: number
      yield_percent: number
    }>()

    for (const row of rows) {
      const menuItemId = menuItemIdMap.get(row.recipe)
      const ingredientId = ingredientIdMap.get(row.item)
      
      if (!menuItemId || !ingredientId) continue
      
      const key = `${menuItemId}::${ingredientId}`
      
      if (recipeMap.has(key)) {
        const existing = recipeMap.get(key)!
        existing.quantity += row.qty
        existing.quantity_normalized += row.qty
      } else {
        recipeMap.set(key, {
          location_id: locationId,
          menu_item_id: menuItemId,
          ingredient_id: ingredientId,
          quantity: row.qty,
          unit_of_measure: row.uofm,
          quantity_normalized: row.qty,
          yield_percent: row.yieldPercent,
        })
      }
    }

    const recipeIngredients = Array.from(recipeMap.values())
    console.log(`[data-sync-service] Deduplicated to ${recipeIngredients.length} unique recipe mappings`)

    await supabase
      .from('bom_recipe_ingredients')
      .delete()
      .eq('location_id', locationId)

    const batchSize = 500
    let insertedCount = 0
    
    for (let i = 0; i < recipeIngredients.length; i += batchSize) {
      const batch = recipeIngredients.slice(i, i + batchSize)
      const { error: riError } = await supabase
        .from('bom_recipe_ingredients')
        .insert(batch)

      if (riError) {
        console.error(`[data-sync-service] Error inserting recipe ingredients batch ${i / batchSize}:`, riError)
        throw riError
      }
      insertedCount += batch.length
    }

    console.log(`[data-sync-service] Inserted ${insertedCount} recipe ingredient mappings`)

    const categoryBreakdown: Record<string, number> = {}
    for (const ing of ingredientMap.values()) {
      categoryBreakdown[ing.category] = (categoryBreakdown[ing.category] || 0) + 1
    }

    const menuCategoryBreakdown: Record<string, number> = {}
    for (const mi of menuItemMap.values()) {
      menuCategoryBreakdown[mi.category] = (menuCategoryBreakdown[mi.category] || 0) + 1
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          totalRows: rows.length,
          uniqueIngredients: ingredientMap.size,
          uniqueMenuItems: menuItemMap.size,
          recipeMappings: insertedCount,
          ingredientCategories: categoryBreakdown,
          menuCategories: menuCategoryBreakdown,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    console.error('[data-sync-service] BOM import error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// ==================== FETCH OVATION SCORES ====================

interface OvationFilters {
  companyIds: string[]
  locationIds: string[]
  createdAtRange: string[]
}

interface SurveyScore {
  locationId: string
  locationName: string
  averageScore: number
  totalResponses: number
  nps?: number
}

async function handleFetchOvationScores(req: Request, supabase: any): Promise<Response> {
  try {
    const { brandId, locationIds, dateRange } = await req.json()
    console.log(`[data-sync-service] Fetching OvationUp scores for brand: ${brandId}`)

    const { data: integration, error: integrationError } = await supabase
      .from('ovation_integrations')
      .select('*')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .single()

    if (integrationError || !integration) {
      console.log('[data-sync-service] No OvationUp integration found for brand:', brandId)
      return new Response(
        JSON.stringify({ error: 'OvationUp integration not configured', scores: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    if (!integration.auth_token) {
      console.log('[data-sync-service] No auth token configured for OvationUp integration')
      return new Response(
        JSON.stringify({ error: 'OvationUp auth token not configured', scores: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    let ovationLocationIds: string[] = []
    let locationMappings: Record<string, string> = {}

    if (locationIds && locationIds.length > 0) {
      const { data: mappings } = await supabase
        .from('ovation_location_mappings')
        .select('location_id, ovation_location_id')
        .in('location_id', locationIds)

      if (mappings) {
        ovationLocationIds = mappings.map(m => m.ovation_location_id)
        mappings.forEach(m => {
          locationMappings[m.ovation_location_id] = m.location_id
        })
      }
    }

    if (ovationLocationIds.length === 0) {
      const { data: brandLocations } = await supabase
        .from('locations')
        .select(`id, organization:organizations!inner(brand_id)`)
        .eq('organizations.brand_id', brandId)

      if (brandLocations && brandLocations.length > 0) {
        const locIds = brandLocations.map(l => l.id)
        const { data: mappings } = await supabase
          .from('ovation_location_mappings')
          .select('location_id, ovation_location_id')
          .in('location_id', locIds)

        if (mappings) {
          ovationLocationIds = mappings.map(m => m.ovation_location_id)
          mappings.forEach(m => {
            locationMappings[m.ovation_location_id] = m.location_id
          })
        }
      }
    }

    console.log(`[data-sync-service] Found ${ovationLocationIds.length} OvationUp location mappings`)

    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const createdAtRange = dateRange || [
      thirtyDaysAgo.toISOString(),
      now.toISOString()
    ]

    const payload: { filters: OvationFilters } = {
      filters: {
        companyIds: [integration.company_id],
        locationIds: ovationLocationIds,
        createdAtRange
      }
    }

    console.log('[data-sync-service] OvationUp request payload:', JSON.stringify(payload))

    const response = await fetch('https://api.ovationup.com/app-services/v2/survey/survey-scores', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Authorization': integration.auth_token,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[data-sync-service] OvationUp API error:', response.status, errorText)
      
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'OvationUp token expired. Please update the auth token.', scores: [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
      
      return new Response(
        JSON.stringify({ error: `OvationUp API error: ${response.status}`, scores: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const data = await response.json()
    console.log('[data-sync-service] OvationUp response:', JSON.stringify(data).substring(0, 500))

    const scores: SurveyScore[] = []
    
    if (data && Array.isArray(data)) {
      for (const item of data) {
        scores.push({
          locationId: locationMappings[item.locationId] || item.locationId,
          locationName: item.locationName || 'Unknown',
          averageScore: parseFloat(item.averageScore || item.score || '0') || 0,
          totalResponses: parseInt(item.totalResponses || item.responses || '0') || 0,
          nps: item.nps !== undefined ? parseFloat(item.nps) : undefined,
        })
      }
    } else if (data && data.scores) {
      for (const item of data.scores) {
        scores.push({
          locationId: locationMappings[item.locationId] || item.locationId,
          locationName: item.locationName || 'Unknown',
          averageScore: parseFloat(item.averageScore || item.score || '0') || 0,
          totalResponses: parseInt(item.totalResponses || item.responses || '0') || 0,
          nps: item.nps !== undefined ? parseFloat(item.nps) : undefined,
        })
      }
    }

    scores.sort((a, b) => b.averageScore - a.averageScore)

    return new Response(
      JSON.stringify({ scores, raw: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[data-sync-service] Error fetching OvationUp scores:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errorMessage, scores: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}
