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

// ==================== DIFF BOM (Universal Import Pipeline) ====================

async function handleDiffBOM(req: Request, supabase: any): Promise<Response> {
  try {
    const { csvContent, locationId, sourceSystem = 'r365', fileName } = await req.json()

    if (!csvContent || !locationId) {
      return new Response(
        JSON.stringify({ error: 'Missing csvContent or locationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the uploading user from the auth header
    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '')
    const { data: { user } } = await supabase.auth.getUser(authHeader)
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[diff-bom] Starting diff for location: ${locationId}, source: ${sourceSystem}`)

    // Parse the CSV using existing parser
    const rows = parseCSV(csvContent)
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid rows found in CSV' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[diff-bom] Parsed ${rows.length} rows`)

    // Build sets from CSV
    const csvIngredients = new Map<string, ParsedIngredient>()
    const csvMenuItems = new Map<string, ParsedMenuItem>()
    const csvRecipes = new Map<string, { qty: number; uofm: string; yieldPercent: number; recipe: string; item: string }>()

    for (const row of rows) {
      if (!csvIngredients.has(row.item)) {
        const category = extractIngredientCategory(row.item)
        csvIngredients.set(row.item, {
          r365_name: row.item,
          category,
          clean_name: cleanIngredientName(row.item),
          unit_standard: normalizeUnit(row.uofm),
          is_prep_item: category === 'PREP',
        })
      }
      if (!csvMenuItems.has(row.recipe)) {
        const category = extractMenuCategory(row.recipe)
        csvMenuItems.set(row.recipe, {
          r365_name: row.recipe,
          category,
          clean_name: cleanMenuName(row.recipe),
          is_sellable: category === 'MI',
        })
      }

      const recipeKey = `${row.recipe}::${row.item}`
      if (csvRecipes.has(recipeKey)) {
        csvRecipes.get(recipeKey)!.qty += row.qty
      } else {
        csvRecipes.set(recipeKey, {
          qty: row.qty,
          uofm: row.uofm,
          yieldPercent: row.yieldPercent,
          recipe: row.recipe,
          item: row.item,
        })
      }
    }

    // Fetch existing data from BOM tables
    const [existingIngredientsRes, existingMenuItemsRes, existingRecipesRes] = await Promise.all([
      supabase.from('bom_ingredients').select('id, r365_name, category, clean_name, unit_standard, is_prep_item').eq('location_id', locationId),
      supabase.from('bom_menu_items').select('id, r365_name, category, clean_name, is_sellable').eq('location_id', locationId),
      supabase.from('bom_recipe_ingredients').select('id, menu_item_id, ingredient_id, quantity, unit_of_measure, yield_percent').eq('location_id', locationId),
    ])

    const existingIngredients = new Map<string, any>()
    for (const ing of existingIngredientsRes.data || []) {
      existingIngredients.set(ing.r365_name, ing)
    }

    const existingMenuItems = new Map<string, any>()
    for (const mi of existingMenuItemsRes.data || []) {
      existingMenuItems.set(mi.r365_name, mi)
    }

    // Build recipe lookup by r365_names
    const existingIngById = new Map<string, string>()
    for (const ing of existingIngredientsRes.data || []) {
      existingIngById.set(ing.id, ing.r365_name)
    }
    const existingMiById = new Map<string, string>()
    for (const mi of existingMenuItemsRes.data || []) {
      existingMiById.set(mi.id, mi.r365_name)
    }
    const existingRecipes = new Map<string, any>()
    for (const ri of existingRecipesRes.data || []) {
      const miName = existingMiById.get(ri.menu_item_id)
      const ingName = existingIngById.get(ri.ingredient_id)
      if (miName && ingName) {
        existingRecipes.set(`${miName}::${ingName}`, ri)
      }
    }

    // Create batch
    const { data: batch, error: batchError } = await supabase
      .from('bom_import_batches')
      .insert({
        location_id: locationId,
        source_system: sourceSystem,
        status: 'reviewing',
        uploaded_by: user.id,
        file_name: fileName || 'bom_export.csv',
      })
      .select('id')
      .single()

    if (batchError) throw batchError

    const batchId = batch.id
    const diffItems: any[] = []
    let newCount = 0, updatedCount = 0, removedCount = 0, unchangedCount = 0

    // Diff ingredients
    for (const [name, csvIng] of csvIngredients) {
      const existing = existingIngredients.get(name)
      if (!existing) {
        diffItems.push({
          batch_id: batchId, entity_type: 'ingredient', change_type: 'new',
          r365_name: name, category: csvIng.category, clean_name: csvIng.clean_name,
          unit_standard: csvIng.unit_standard, is_prep_item: csvIng.is_prep_item,
          new_values: csvIng,
        })
        newCount++
      } else {
        const changed = existing.unit_standard !== csvIng.unit_standard || existing.category !== csvIng.category
        diffItems.push({
          batch_id: batchId, entity_type: 'ingredient',
          change_type: changed ? 'updated' : 'unchanged',
          r365_name: name, category: csvIng.category, clean_name: csvIng.clean_name,
          unit_standard: csvIng.unit_standard, is_prep_item: csvIng.is_prep_item,
          previous_values: changed ? { unit_standard: existing.unit_standard, category: existing.category } : null,
          new_values: changed ? csvIng : null,
          resolution: changed ? 'pending' : 'skipped',
        })
        if (changed) updatedCount++
        else unchangedCount++
      }
    }

    // Removed ingredients (in DB but not in CSV)
    for (const [name, existing] of existingIngredients) {
      if (!csvIngredients.has(name)) {
        diffItems.push({
          batch_id: batchId, entity_type: 'ingredient', change_type: 'removed',
          r365_name: name, category: existing.category, clean_name: existing.clean_name,
          previous_values: existing,
        })
        removedCount++
      }
    }

    // Diff menu items
    for (const [name, csvMi] of csvMenuItems) {
      const existing = existingMenuItems.get(name)
      if (!existing) {
        diffItems.push({
          batch_id: batchId, entity_type: 'menu_item', change_type: 'new',
          r365_name: name, category: csvMi.category, clean_name: csvMi.clean_name,
          is_sellable: csvMi.is_sellable,
          new_values: csvMi,
        })
        newCount++
      } else {
        const changed = existing.category !== csvMi.category
        diffItems.push({
          batch_id: batchId, entity_type: 'menu_item',
          change_type: changed ? 'updated' : 'unchanged',
          r365_name: name, category: csvMi.category, clean_name: csvMi.clean_name,
          is_sellable: csvMi.is_sellable,
          previous_values: changed ? { category: existing.category } : null,
          new_values: changed ? csvMi : null,
          resolution: changed ? 'pending' : 'skipped',
        })
        if (changed) updatedCount++
        else unchangedCount++
      }
    }

    // Removed menu items
    for (const [name, existing] of existingMenuItems) {
      if (!csvMenuItems.has(name)) {
        diffItems.push({
          batch_id: batchId, entity_type: 'menu_item', change_type: 'removed',
          r365_name: name, category: existing.category, clean_name: existing.clean_name,
          previous_values: existing,
        })
        removedCount++
      }
    }

    // Diff recipe links
    for (const [key, csvRecipe] of csvRecipes) {
      const existing = existingRecipes.get(key)
      if (!existing) {
        diffItems.push({
          batch_id: batchId, entity_type: 'recipe_link', change_type: 'new',
          r365_name: key, parent_r365_name: csvRecipe.recipe,
          quantity: csvRecipe.qty, unit_of_measure: csvRecipe.uofm,
          yield_percent: csvRecipe.yieldPercent,
          new_values: csvRecipe,
        })
        newCount++
      } else {
        const qtyChanged = Math.abs(existing.quantity - csvRecipe.qty) > 0.001
        const yieldChanged = Math.abs((existing.yield_percent || 100) - csvRecipe.yieldPercent) > 0.001
        const changed = qtyChanged || yieldChanged
        diffItems.push({
          batch_id: batchId, entity_type: 'recipe_link',
          change_type: changed ? 'updated' : 'unchanged',
          r365_name: key, parent_r365_name: csvRecipe.recipe,
          quantity: csvRecipe.qty, unit_of_measure: csvRecipe.uofm,
          yield_percent: csvRecipe.yieldPercent,
          previous_values: changed ? { quantity: existing.quantity, yield_percent: existing.yield_percent } : null,
          new_values: changed ? csvRecipe : null,
          resolution: changed ? 'pending' : 'skipped',
        })
        if (changed) updatedCount++
        else unchangedCount++
      }
    }

    // Removed recipe links
    for (const [key, existing] of existingRecipes) {
      if (!csvRecipes.has(key)) {
        const [recipeName, itemName] = key.split('::')
        diffItems.push({
          batch_id: batchId, entity_type: 'recipe_link', change_type: 'removed',
          r365_name: key, parent_r365_name: recipeName,
          previous_values: { quantity: existing.quantity, yield_percent: existing.yield_percent },
        })
        removedCount++
      }
    }

    // Batch insert diff items
    const batchSize = 500
    for (let i = 0; i < diffItems.length; i += batchSize) {
      const batch_slice = diffItems.slice(i, i + batchSize)
      const { error: itemError } = await supabase.from('bom_import_items').insert(batch_slice)
      if (itemError) {
        console.error(`[diff-bom] Error inserting diff items batch:`, itemError)
        throw itemError
      }
    }

    // Update batch summary
    const summary = { new: newCount, updated: updatedCount, removed: removedCount, unchanged: unchangedCount, total: diffItems.length }
    await supabase.from('bom_import_batches').update({ summary }).eq('id', batchId)

    console.log(`[diff-bom] Diff complete: ${JSON.stringify(summary)}`)

    return new Response(
      JSON.stringify({ success: true, batchId, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    console.error('[diff-bom] Error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// ==================== APPLY BOM DIFF ====================

async function handleApplyBOMDiff(req: Request, supabase: any): Promise<Response> {
  try {
    const { batchId, locationId } = await req.json()

    if (!batchId || !locationId) {
      return new Response(
        JSON.stringify({ error: 'Missing batchId or locationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '')
    const { data: { user } } = await supabase.auth.getUser(authHeader)
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch approved items (or all non-rejected for bulk approve)
    const { data: items, error: itemsError } = await supabase
      .from('bom_import_items')
      .select('*')
      .eq('batch_id', batchId)
      .in('resolution', ['pending', 'approved'])
      .neq('change_type', 'unchanged')

    if (itemsError) throw itemsError

    console.log(`[apply-bom-diff] Applying ${items?.length || 0} changes for batch ${batchId}`)

    let applied = 0

    // Process ingredients
    const newIngredients = items.filter((i: any) => i.entity_type === 'ingredient' && i.change_type === 'new')
    const updatedIngredients = items.filter((i: any) => i.entity_type === 'ingredient' && i.change_type === 'updated')
    const removedIngredients = items.filter((i: any) => i.entity_type === 'ingredient' && i.change_type === 'removed' && i.resolution === 'approved')

    if (newIngredients.length > 0) {
      const ingData = newIngredients.map((i: any) => ({
        location_id: locationId,
        r365_name: i.r365_name,
        category: i.category,
        clean_name: i.clean_name,
        unit_standard: i.unit_standard,
        is_prep_item: i.is_prep_item,
      }))
      const { error } = await supabase.from('bom_ingredients').upsert(ingData, { onConflict: 'location_id,r365_name', ignoreDuplicates: false })
      if (error) throw error
      applied += newIngredients.length
    }

    if (updatedIngredients.length > 0) {
      for (const ing of updatedIngredients) {
        const { error } = await supabase.from('bom_ingredients')
          .update({ category: ing.category, unit_standard: ing.unit_standard })
          .eq('location_id', locationId).eq('r365_name', ing.r365_name)
        if (error) console.error(`[apply-bom-diff] Error updating ingredient ${ing.r365_name}:`, error)
        else applied++
      }
    }

    // Process menu items
    const newMenuItems = items.filter((i: any) => i.entity_type === 'menu_item' && i.change_type === 'new')
    const updatedMenuItems = items.filter((i: any) => i.entity_type === 'menu_item' && i.change_type === 'updated')

    if (newMenuItems.length > 0) {
      const miData = newMenuItems.map((i: any) => ({
        location_id: locationId,
        r365_name: i.r365_name,
        category: i.category,
        clean_name: i.clean_name,
        is_sellable: i.is_sellable,
      }))
      const { error } = await supabase.from('bom_menu_items').upsert(miData, { onConflict: 'location_id,r365_name', ignoreDuplicates: false })
      if (error) throw error
      applied += newMenuItems.length
    }

    if (updatedMenuItems.length > 0) {
      for (const mi of updatedMenuItems) {
        const { error } = await supabase.from('bom_menu_items')
          .update({ category: mi.category })
          .eq('location_id', locationId).eq('r365_name', mi.r365_name)
        if (error) console.error(`[apply-bom-diff] Error updating menu item ${mi.r365_name}:`, error)
        else applied++
      }
    }

    // Process recipe links
    const newRecipes = items.filter((i: any) => i.entity_type === 'recipe_link' && i.change_type === 'new')
    const updatedRecipes = items.filter((i: any) => i.entity_type === 'recipe_link' && i.change_type === 'updated')
    const removedRecipes = items.filter((i: any) => i.entity_type === 'recipe_link' && i.change_type === 'removed' && i.resolution === 'approved')

    // For recipe links, we need to resolve r365_names to IDs
    const { data: allIngredients } = await supabase.from('bom_ingredients').select('id, r365_name').eq('location_id', locationId)
    const { data: allMenuItems } = await supabase.from('bom_menu_items').select('id, r365_name').eq('location_id', locationId)

    const ingIdMap = new Map<string, string>()
    for (const ing of allIngredients || []) ingIdMap.set(ing.r365_name, ing.id)
    const miIdMap = new Map<string, string>()
    for (const mi of allMenuItems || []) miIdMap.set(mi.r365_name, mi.id)

    if (newRecipes.length > 0) {
      const riData = newRecipes.map((i: any) => {
        const [recipeName, itemName] = i.r365_name.split('::')
        return {
          location_id: locationId,
          menu_item_id: miIdMap.get(recipeName),
          ingredient_id: ingIdMap.get(itemName),
          quantity: i.quantity,
          quantity_normalized: i.quantity,
          unit_of_measure: i.unit_of_measure,
          yield_percent: i.yield_percent,
        }
      }).filter((r: any) => r.menu_item_id && r.ingredient_id)

      if (riData.length > 0) {
        const { error } = await supabase.from('bom_recipe_ingredients').insert(riData)
        if (error) console.error('[apply-bom-diff] Error inserting recipes:', error)
        else applied += riData.length
      }
    }

    if (updatedRecipes.length > 0) {
      for (const ri of updatedRecipes) {
        const [recipeName, itemName] = ri.r365_name.split('::')
        const menuItemId = miIdMap.get(recipeName)
        const ingredientId = ingIdMap.get(itemName)
        if (!menuItemId || !ingredientId) continue

        const { error } = await supabase.from('bom_recipe_ingredients')
          .update({ quantity: ri.quantity, quantity_normalized: ri.quantity, yield_percent: ri.yield_percent })
          .eq('location_id', locationId).eq('menu_item_id', menuItemId).eq('ingredient_id', ingredientId)
        if (error) console.error(`[apply-bom-diff] Error updating recipe ${ri.r365_name}:`, error)
        else applied++
      }
    }

    if (removedRecipes.length > 0) {
      for (const ri of removedRecipes) {
        const [recipeName, itemName] = ri.r365_name.split('::')
        const menuItemId = miIdMap.get(recipeName)
        const ingredientId = ingIdMap.get(itemName)
        if (!menuItemId || !ingredientId) continue

        await supabase.from('bom_recipe_ingredients')
          .delete()
          .eq('location_id', locationId).eq('menu_item_id', menuItemId).eq('ingredient_id', ingredientId)
        applied++
      }
    }

    // Mark batch as approved
    await supabase.from('bom_import_batches').update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    }).eq('id', batchId)

    // Mark all pending items as approved
    await supabase.from('bom_import_items')
      .update({ resolution: 'approved', resolved_by: user.id, resolved_at: new Date().toISOString() })
      .eq('batch_id', batchId).eq('resolution', 'pending')

    // ==================== BRIDGE BOM → INVENTORY_ITEMS ====================
    // Create/update editable inventory_items for each menu item (recipe) in BOM
    console.log(`[apply-bom-diff] Bridging BOM recipes to inventory_items...`)

    let bridged = 0

    // Fetch all BOM menu items for this location (these become recipes)
    const { data: bomMenuItems } = await supabase
      .from('bom_menu_items')
      .select('id, r365_name, clean_name, category')
      .eq('location_id', locationId)

    // Fetch all BOM recipe ingredients for this location
    const { data: bomRecipeIngs } = await supabase
      .from('bom_recipe_ingredients')
      .select('menu_item_id, ingredient_id, quantity, unit_of_measure, yield_percent')
      .eq('location_id', locationId)

    // Fetch all BOM ingredients for name lookups
    const { data: bomIngredients } = await supabase
      .from('bom_ingredients')
      .select('id, r365_name, clean_name, category, unit_standard')
      .eq('location_id', locationId)

    const bomIngMap = new Map<string, any>()
    for (const bi of bomIngredients || []) bomIngMap.set(bi.id, bi)

    // Fetch existing inventory_items to find or create
    const { data: existingItems } = await supabase
      .from('inventory_items')
      .select('id, name, source')
      .eq('location_id', locationId)

    const existingNameMap = new Map<string, any>()
    for (const ei of existingItems || []) existingNameMap.set(ei.name.toLowerCase(), ei)

    // Group BOM recipe ingredients by menu_item_id
    const recipeIngsByMenu = new Map<string, any[]>()
    for (const ri of bomRecipeIngs || []) {
      if (!recipeIngsByMenu.has(ri.menu_item_id)) recipeIngsByMenu.set(ri.menu_item_id, [])
      recipeIngsByMenu.get(ri.menu_item_id)!.push(ri)
    }

    for (const mi of bomMenuItems || []) {
      const displayName = mi.clean_name || mi.r365_name
      const existingItem = existingNameMap.get(displayName.toLowerCase())
      const recipeIngs = recipeIngsByMenu.get(mi.id) || []

      let recipeItemId: string

      if (existingItem) {
        // Update existing item to mark as r365_import source
        await supabase.from('inventory_items')
          .update({ is_recipe: true, source: 'r365_import', category: mi.category })
          .eq('id', existingItem.id)
        recipeItemId = existingItem.id
      } else {
        // Create new inventory_item as recipe
        const { data: newItem, error: createError } = await supabase
          .from('inventory_items')
          .insert({
            location_id: locationId,
            name: displayName,
            unit: 'ea',
            is_recipe: true,
            is_active: true,
            countable: true,
            source: 'r365_import',
            category: mi.category,
          })
          .select('id')
          .single()

        if (createError) {
          console.error(`[apply-bom-diff] Error creating recipe item for ${displayName}:`, createError)
          continue
        }
        recipeItemId = newItem.id
        existingNameMap.set(displayName.toLowerCase(), { id: recipeItemId, name: displayName })
      }

      // Now bridge ingredient links → inventory_recipe_ingredients
      // First, clear existing recipe ingredients for this item (full replace from BOM)
      await supabase.from('inventory_recipe_ingredients').delete().eq('recipe_item_id', recipeItemId)

      if (recipeIngs.length > 0) {
        const ingredientLinks: any[] = []

        for (const ri of recipeIngs) {
          const bomIng = bomIngMap.get(ri.ingredient_id)
          if (!bomIng) continue

          const ingDisplayName = bomIng.clean_name || bomIng.r365_name
          let ingredientItemId: string

          // Find or create the ingredient as an inventory_item
          const existingIng = existingNameMap.get(ingDisplayName.toLowerCase())
          if (existingIng) {
            ingredientItemId = existingIng.id
            // Tag source if not already
            if (existingIng.source !== 'r365_import' && existingIng.source !== 'manual') {
              await supabase.from('inventory_items')
                .update({ source: 'r365_import' })
                .eq('id', existingIng.id)
            }
          } else {
            const { data: newIng, error: ingError } = await supabase
              .from('inventory_items')
              .insert({
                location_id: locationId,
                name: ingDisplayName,
                unit: bomIng.unit_standard || 'oz',
                is_recipe: false,
                is_active: true,
                countable: true,
                source: 'r365_import',
                category: bomIng.category,
              })
              .select('id')
              .single()

            if (ingError) {
              console.error(`[apply-bom-diff] Error creating ingredient item for ${ingDisplayName}:`, ingError)
              continue
            }
            ingredientItemId = newIng.id
            existingNameMap.set(ingDisplayName.toLowerCase(), { id: ingredientItemId, name: ingDisplayName })
          }

          ingredientLinks.push({
            recipe_item_id: recipeItemId,
            ingredient_item_id: ingredientItemId,
            quantity: ri.quantity,
            unit: ri.unit_of_measure || 'oz',
          })
        }

        if (ingredientLinks.length > 0) {
          const { error: linkError } = await supabase.from('inventory_recipe_ingredients').insert(ingredientLinks)
          if (linkError) console.error(`[apply-bom-diff] Error linking recipe ingredients for ${displayName}:`, linkError)
          else bridged += ingredientLinks.length
        }
      }
    }

    console.log(`[apply-bom-diff] Bridged ${bridged} recipe ingredient links to inventory_items`)
    console.log(`[apply-bom-diff] Applied ${applied} changes`)

    return new Response(
      JSON.stringify({ success: true, applied, bridged }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    console.error('[apply-bom-diff] Error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}
