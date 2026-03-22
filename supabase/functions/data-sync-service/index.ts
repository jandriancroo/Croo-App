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

// ==================== HELPERS ====================

async function fetchAllRows(supabase: any, table: string, query: (from: number, to: number) => any): Promise<any[]> {
  const allRows: any[] = []
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await query(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return allRows
}

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

// ==================== IMPORT BOM (legacy direct import) ====================

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

interface RecipeMetadata {
  recipeName: string
  yieldQty: number
  yieldUofM: string
  avgCost: number
  active: boolean
}

function parseRecipeCSV(content: string): Map<string, RecipeMetadata> {
  const lines = content.split('\n').filter(line => line.trim())
  if (lines.length < 2) return new Map()
  
  const metadata = new Map<string, RecipeMetadata>()
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
  
  const nameIdx = headers.indexOf('RecipeName')
  const yieldQtyIdx = headers.indexOf('YieldQty')
  const yieldUofMIdx = headers.indexOf('YieldUofM')
  const avgCostIdx = headers.indexOf('AvgCost')
  const activeIdx = headers.indexOf('Active')
  
  for (let i = 1; i < lines.length; i++) {
    const parts: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of lines[i]) {
      if (char === '"') { inQuotes = !inQuotes }
      else if (char === ',' && !inQuotes) { parts.push(current.trim()); current = '' }
      else { current += char }
    }
    parts.push(current.trim())
    
    const name = nameIdx >= 0 ? parts[nameIdx] : ''
    if (!name) continue
    
    metadata.set(name, {
      recipeName: name,
      yieldQty: yieldQtyIdx >= 0 ? (parseFloat(parts[yieldQtyIdx]) || 1) : 1,
      yieldUofM: yieldUofMIdx >= 0 ? (parts[yieldUofMIdx] || 'Each') : 'Each',
      avgCost: avgCostIdx >= 0 ? (parseFloat(parts[avgCostIdx]) || 0) : 0,
      active: activeIdx >= 0 ? parts[activeIdx] === 'Yes' : true,
    })
  }
  
  return metadata
}

// Legacy direct import — kept for backwards compat
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

    let insertedCount = 0
    const batchSize = 500
    for (let i = 0; i < recipeIngredients.length; i += batchSize) {
      const batch = recipeIngredients.slice(i, i + batchSize)
      const { error: riError, count } = await supabase
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
    for (const [, mi] of menuItemMap) {
      categoryBreakdown[mi.category] = (categoryBreakdown[mi.category] || 0) + 1
    }

    return new Response(
      JSON.stringify({
        success: true,
        ingredients: ingredientMap.size,
        menuItems: menuItemMap.size,
        recipeLinks: insertedCount,
        categories: categoryBreakdown,
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
        ovationLocationIds = mappings.map((m: any) => m.ovation_location_id)
        mappings.forEach((m: any) => {
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
        const locIds = brandLocations.map((l: any) => l.id)
        const { data: mappings } = await supabase
          .from('ovation_location_mappings')
          .select('location_id, ovation_location_id')
          .in('location_id', locIds)

        if (mappings) {
          ovationLocationIds = mappings.map((m: any) => m.ovation_location_id)
          mappings.forEach((m: any) => {
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

// ==================== DIFF BOM → BLUEPRINT PIPELINE ====================
// Compares CSV against existing recipe_blueprints (Three-Layer Architecture)

async function handleDiffBOM(req: Request, supabase: any): Promise<Response> {
  try {
    const body = await req.json()
    const { locationId, sourceSystem = 'r365', fileName } = body
    
    // Support multi-file upload
    let ingredientCsv = ''
    let recipeCsv = ''
    
    if (body.csvFiles && Array.isArray(body.csvFiles)) {
      for (const f of body.csvFiles) {
        const firstLine = f.csvContent.split('\n')[0] || ''
        if (firstLine.includes('RecipeName') || firstLine.includes('YieldUofM')) {
          recipeCsv = f.csvContent
          console.log(`[diff-bom] Detected recipes file: ${f.fileName}`)
        } else if (firstLine.includes('Item') && firstLine.includes('Recipe')) {
          ingredientCsv = f.csvContent
          console.log(`[diff-bom] Detected ingredients file: ${f.fileName}`)
        } else {
          ingredientCsv = f.csvContent
          console.log(`[diff-bom] Unknown format, treating as ingredients: ${f.fileName}`)
        }
      }
    } else {
      ingredientCsv = body.csvContent || ''
    }

    if (!ingredientCsv || !locationId) {
      return new Response(
        JSON.stringify({ error: 'Missing ingredient CSV or locationId.' }),
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

    console.log(`[diff-bom] Starting blueprint diff for location: ${locationId}`)

    const rows = parseCSV(ingredientCsv)
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid rows found in ingredient CSV' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const recipeMetadata = recipeCsv ? parseRecipeCSV(recipeCsv) : new Map()
    if (recipeMetadata.size > 0) {
      console.log(`[diff-bom] Parsed ${recipeMetadata.size} recipe metadata entries`)
    }

    console.log(`[diff-bom] Parsed ${rows.length} ingredient rows`)

    // Build sets from CSV
    const csvIngredients = new Map<string, ParsedIngredient>()
    const csvMenuItems = new Map<string, ParsedMenuItem & { yieldQty?: number; yieldUnit?: string }>()
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
        const meta = recipeMetadata.get(row.recipe)
        csvMenuItems.set(row.recipe, {
          r365_name: row.recipe,
          category,
          clean_name: cleanMenuName(row.recipe),
          is_sellable: category === 'MI',
          yieldQty: meta?.yieldQty,
          yieldUnit: meta?.yieldUofM,
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

    // Compare against existing recipe_blueprints
    const existingBlueprints = await fetchAllRows(supabase, 'recipe_blueprints', (from, to) =>
      supabase
        .from('recipe_blueprints')
        .select('id, name, category, yield_qty, yield_unit, r365_name')
        .eq('location_id', locationId)
        .eq('source', 'r365_import')
        .eq('is_active', true)
        .range(from, to)
    )

    const existingBpByR365 = new Map<string, any>()
    const existingBpById = new Map<string, any>()
    for (const bp of existingBlueprints || []) {
      const key = bp.r365_name || bp.name
      existingBpByR365.set(key, bp)
      existingBpById.set(bp.id, bp)
    }

    // Fetch existing blueprint ingredients
    const existingBpIds = existingBlueprints.map((b: any) => b.id)
    let existingIngredients: any[] = []
    if (existingBpIds.length > 0) {
      existingIngredients = await fetchAllRows(supabase, 'recipe_blueprint_ingredients', (from, to) =>
        supabase
          .from('recipe_blueprint_ingredients')
          .select('id, blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id, quantity, unit')
          .in('blueprint_id', existingBpIds)
          .range(from, to)
      )
    }

    // Build recipe key → ingredient map for existing data
    const existingRecipeKeys = new Map<string, any>()
    // We need vendor item name lookups for comparison
    const vendorItemIds = existingIngredients.filter((i: any) => i.vendor_item_id).map((i: any) => i.vendor_item_id)
    let vendorNameMap = new Map<string, string>()
    if (vendorItemIds.length > 0) {
      const { data: vendorItems } = await supabase
        .from('inventory_items')
        .select('id, name')
        .in('id', vendorItemIds.slice(0, 1000))
      for (const vi of vendorItems || []) {
        vendorNameMap.set(vi.id, vi.name)
      }
    }

    // Build existing recipe links by r365_name keys
    for (const ing of existingIngredients) {
      const bp = existingBpById.get(ing.blueprint_id)
      if (!bp) continue
      const bpKey = bp.r365_name || bp.name
      // For vendor items, use the vendor item name
      let ingKey = ''
      if (ing.vendor_item_id) {
        ingKey = vendorNameMap.get(ing.vendor_item_id) || ing.vendor_item_id
      } else if (ing.sub_blueprint_id) {
        const subBp = existingBpById.get(ing.sub_blueprint_id)
        ingKey = subBp ? (subBp.r365_name || subBp.name) : ing.sub_blueprint_id
      }
      const compositeKey = `${bpKey}::${ingKey}`
      existingRecipeKeys.set(compositeKey, { ...ing, bpKey, ingKey })
    }

    // Create staging batch
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

    // Diff ingredients (raw items from CSV)
    for (const [name, csvIng] of csvIngredients) {
      diffItems.push({
        batch_id: batchId, entity_type: 'ingredient', change_type: 'new',
        r365_name: name, category: csvIng.category, clean_name: csvIng.clean_name,
        unit_standard: csvIng.unit_standard, is_prep_item: csvIng.is_prep_item,
        new_values: csvIng,
      })
      // Don't count base ingredients as "new" since they're reference data
    }

    // Diff menu items (recipes/blueprints)
    for (const [name, csvMi] of csvMenuItems) {
      const existing = existingBpByR365.get(name)
      if (!existing) {
        diffItems.push({
          batch_id: batchId, entity_type: 'menu_item', change_type: 'new',
          r365_name: name, category: csvMi.category, clean_name: csvMi.clean_name,
          is_sellable: csvMi.is_sellable,
          new_values: { ...csvMi, yieldQty: csvMi.yieldQty, yieldUnit: csvMi.yieldUnit },
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
          new_values: changed ? { ...csvMi, yieldQty: csvMi.yieldQty, yieldUnit: csvMi.yieldUnit } : null,
          resolution: changed ? 'pending' : 'skipped',
        })
        if (changed) updatedCount++
        else unchangedCount++
      }
    }

    // Removed blueprints (in DB but not in CSV)
    for (const [name] of existingBpByR365) {
      if (!csvMenuItems.has(name)) {
        diffItems.push({
          batch_id: batchId, entity_type: 'menu_item', change_type: 'removed',
          r365_name: name,
        })
        removedCount++
      }
    }

    // Diff recipe links
    for (const [key, csvRecipe] of csvRecipes) {
      diffItems.push({
        batch_id: batchId, entity_type: 'recipe_link', change_type: 'new',
        r365_name: key, parent_r365_name: csvRecipe.recipe,
        quantity: csvRecipe.qty, unit_of_measure: csvRecipe.uofm,
        yield_percent: csvRecipe.yieldPercent,
        new_values: csvRecipe,
      })
      newCount++
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

// ==================== APPLY BOM DIFF → RECIPE BLUEPRINTS ====================
// Three-Layer Blueprint Architecture: writes to recipe_blueprints + recipe_blueprint_ingredients
// Uses topological dependency resolution (Vendor → Prep → Complex → Menu)

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

    // Fetch all staging items for this batch (paginated)
    const items = await fetchAllRows(supabase, 'bom_import_items', (from, to) =>
      supabase
        .from('bom_import_items')
        .select('*')
        .eq('batch_id', batchId)
        .in('resolution', ['pending', 'approved'])
        .neq('change_type', 'unchanged')
        .range(from, to)
    )

    console.log(`[apply-blueprint] Processing ${items?.length || 0} staging items for batch ${batchId}`)

    // Separate by entity type
    const ingredientItems = items.filter((i: any) => i.entity_type === 'ingredient')
    const menuItems = items.filter((i: any) => i.entity_type === 'menu_item')
    const recipeLinks = items.filter((i: any) => i.entity_type === 'recipe_link')

    // ==================== STEP 1: BUILD DEPENDENCY GRAPH ====================
    // Parse all recipe links to understand which recipes reference which ingredients
    // Ingredients can be: vendor items (physical) or sub-recipes (other menu items from R365)

    // Build set of all menu item r365_names (these are blueprints)
    const allMenuItemNames = new Set<string>()
    for (const mi of menuItems) allMenuItemNames.add(mi.r365_name)
    // Also check existing blueprints
    const existingBlueprints = await fetchAllRows(supabase, 'recipe_blueprints', (from, to) =>
      supabase
        .from('recipe_blueprints')
        .select('id, name, r365_name, category, yield_qty, yield_unit, produces_item_id')
        .eq('location_id', locationId)
        .eq('source', 'r365_import')
        .eq('is_active', true)
        .range(from, to)
    )
    const existingBpByR365 = new Map<string, any>()
    for (const bp of existingBlueprints) {
      existingBpByR365.set(bp.r365_name || bp.name, bp)
      allMenuItemNames.add(bp.r365_name || bp.name)
    }

    // Build set of all raw ingredient r365_names
    const allIngredientNames = new Set<string>()
    for (const ing of ingredientItems) allIngredientNames.add(ing.r365_name)

    // Build adjacency list: recipe → [dependency recipe names]
    const recipesByParent = new Map<string, { item: string; qty: number; uofm: string }[]>()
    for (const rl of recipeLinks) {
      const [recipeName, itemName] = rl.r365_name.split('::')
      if (!recipesByParent.has(recipeName)) recipesByParent.set(recipeName, [])
      recipesByParent.get(recipeName)!.push({
        item: itemName,
        qty: rl.quantity || 0,
        uofm: rl.unit_of_measure || 'each',
      })
    }

    // Identify which ingredients are actually sub-recipes (they appear as both ingredient AND menu item)
    const subRecipeNames = new Set<string>()
    for (const ingName of allIngredientNames) {
      if (allMenuItemNames.has(ingName)) {
        subRecipeNames.add(ingName)
      }
    }

    // ==================== STEP 2: TOPOLOGICAL SORT ====================
    // Process in order: items with no sub-recipe dependencies first, then up
    const processed = new Set<string>()
    const sortedRecipes: string[] = []

    function visit(name: string, visiting: Set<string>) {
      if (processed.has(name)) return
      if (visiting.has(name)) return // cycle
      visiting.add(name)

      const deps = recipesByParent.get(name) || []
      for (const dep of deps) {
        if (subRecipeNames.has(dep.item)) {
          visit(dep.item, visiting)
        }
      }
      visiting.delete(name)
      processed.add(name)
      sortedRecipes.push(name)
    }

    for (const name of allMenuItemNames) {
      visit(name, new Set())
    }

    console.log(`[apply-blueprint] Topological order: ${sortedRecipes.length} recipes`)

    // ==================== STEP 3: AUTO-MATCH VENDOR ITEMS ====================
    // Fetch existing inventory_items (vendor/physical items only)
    const vendorItems = await fetchAllRows(supabase, 'inventory_items', (from, to) =>
      supabase
        .from('inventory_items')
        .select('id, name, common_name, pack_size, count_unit, count_units_per_case, cost_per_unit, is_recipe')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .range(from, to)
    )

    // Build name → vendor item map for auto-matching
    const vendorByName = new Map<string, any>()
    const vendorByCommonName = new Map<string, any>()
    for (const vi of vendorItems) {
      vendorByName.set(vi.name.toLowerCase(), vi)
      if (vi.common_name) vendorByCommonName.set(vi.common_name.toLowerCase(), vi)
    }

    function scoreSimilarity(a: string, b: string): number {
      const aLow = a.toLowerCase().replace(/[^a-z0-9 ]/g, '')
      const bLow = b.toLowerCase().replace(/[^a-z0-9 ]/g, '')
      if (aLow === bLow) return 100
      if (bLow.includes(aLow) || aLow.includes(bLow)) return 80
      const aWords = aLow.split(/\s+/)
      const bWords = bLow.split(/\s+/)
      const matches = aWords.filter(w => bWords.some((bw: string) => bw.includes(w) || w.includes(bw)))
      if (matches.length === 0) return 0
      return Math.round((matches.length / Math.max(aWords.length, 1)) * 60)
    }

    function findVendorItem(ingredientR365Name: string): { id: string; score: number; name: string } | null {
      const cleanName = cleanIngredientName(ingredientR365Name)
      
      // Exact match on name
      const exactName = vendorByName.get(cleanName)
      if (exactName) return { id: exactName.id, score: 100, name: exactName.name }
      
      // Exact match on common_name
      const exactCommon = vendorByCommonName.get(cleanName)
      if (exactCommon) return { id: exactCommon.id, score: 100, name: exactCommon.name }

      // Fuzzy match
      let bestMatch: any = null
      let bestScore = 0
      for (const vi of vendorItems) {
        if (vi.is_recipe) continue // skip recipe items
        const names = [vi.common_name, vi.name].filter(Boolean) as string[]
        for (const n of names) {
          const score = scoreSimilarity(cleanName, n)
          if (score > bestScore) {
            bestScore = score
            bestMatch = vi
          }
        }
      }
      if (bestMatch && bestScore >= 60) {
        return { id: bestMatch.id, score: bestScore, name: bestMatch.common_name || bestMatch.name }
      }
      return null
    }

    // ==================== STEP 4: CREATE/UPDATE BLUEPRINTS IN TOPO ORDER ====================
    const blueprintIdMap = new Map<string, string>() // r365_name → blueprint UUID
    let created = 0
    let updated = 0
    let ingredientLinksCreated = 0
    let autoMatched = 0
    const matchResults: Array<{ ingredientName: string; matchedTo: string; score: number }> = []
    const unmappedIngredients: string[] = []

    // Pre-populate blueprint ID map from existing
    for (const bp of existingBlueprints) {
      blueprintIdMap.set(bp.r365_name || bp.name, bp.id)
    }

    // Get recipe metadata map for yield info
    const recipeMetadataFromCSV = new Map<string, any>()
    for (const mi of menuItems) {
      if (mi.new_values) {
        recipeMetadataFromCSV.set(mi.r365_name, mi.new_values)
      }
    }

    for (const recipeName of sortedRecipes) {
      const existingBp = existingBpByR365.get(recipeName)
      const csvMi = recipeMetadataFromCSV.get(recipeName)
      const category = csvMi?.category || extractMenuCategory(recipeName)
      const cleanName = csvMi?.clean_name || cleanMenuName(recipeName)
      const yieldQty = csvMi?.yieldQty || null
      const yieldUnit = csvMi?.yieldUnit ? normalizeUnit(csvMi.yieldUnit) : null

      let blueprintId: string

      if (existingBp) {
        // Update existing blueprint
        blueprintId = existingBp.id
        await supabase
          .from('recipe_blueprints')
          .update({
            name: cleanName || recipeName,
            category,
            yield_qty: yieldQty || existingBp.yield_qty,
            yield_unit: yieldUnit || existingBp.yield_unit,
          })
          .eq('id', blueprintId)
        updated++
      } else {
        // Create new blueprint
        const isPrepCategory = ['PREP', 'BASE', 'CORE'].includes(category)
        const { data: newBp, error: bpErr } = await supabase
          .from('recipe_blueprints')
          .insert({
            location_id: locationId,
            name: cleanName || recipeName,
            r365_name: recipeName,
            category,
            yield_qty: yieldQty,
            yield_unit: yieldUnit,
            source: 'r365_import',
            is_active: true,
          })
          .select('id')
          .single()

        if (bpErr) {
          console.error(`[apply-blueprint] Error creating blueprint ${recipeName}:`, bpErr)
          continue
        }
        blueprintId = newBp.id
        created++
      }

      blueprintIdMap.set(recipeName, blueprintId)

      // Delete existing ingredients for this blueprint (full replace from CSV)
      await supabase
        .from('recipe_blueprint_ingredients')
        .delete()
        .eq('blueprint_id', blueprintId)

      // Insert ingredients from CSV
      const recipeIngs = recipesByParent.get(recipeName) || []
      const ingredientInserts: any[] = []

      for (const ing of recipeIngs) {
        if (subRecipeNames.has(ing.item)) {
          // This ingredient is a sub-recipe — link to its blueprint
          const subBpId = blueprintIdMap.get(ing.item)
          if (subBpId) {
            ingredientInserts.push({
              blueprint_id: blueprintId,
              ingredient_type: 'blueprint',
              vendor_item_id: null,
              sub_blueprint_id: subBpId,
              quantity: ing.qty,
              unit: ing.uofm,
            })
          } else {
            console.warn(`[apply-blueprint] Sub-recipe ${ing.item} not found for ${recipeName}`)
            unmappedIngredients.push(`${recipeName} → ${ing.item} (sub-recipe)`)
          }
        } else {
          // Raw ingredient — try to match to vendor item
          const match = findVendorItem(ing.item)
          if (match) {
            ingredientInserts.push({
              blueprint_id: blueprintId,
              ingredient_type: 'vendor_item',
              vendor_item_id: match.id,
              sub_blueprint_id: null,
              quantity: ing.qty,
              unit: ing.uofm,
            })
            if (match.score < 100) {
              autoMatched++
              matchResults.push({
                ingredientName: cleanIngredientName(ing.item),
                matchedTo: match.name,
                score: match.score,
              })
            }
          } else {
            // No match — still create the ingredient link with null vendor_item_id
            // This will show as "needs mapping" in the UI
            ingredientInserts.push({
              blueprint_id: blueprintId,
              ingredient_type: 'vendor_item',
              vendor_item_id: null,
              sub_blueprint_id: null,
              quantity: ing.qty,
              unit: ing.uofm,
            })
            unmappedIngredients.push(cleanIngredientName(ing.item))
          }
        }
      }

      if (ingredientInserts.length > 0) {
        const { error: ingErr } = await supabase
          .from('recipe_blueprint_ingredients')
          .insert(ingredientInserts)
        if (ingErr) {
          console.error(`[apply-blueprint] Error inserting ingredients for ${recipeName}:`, ingErr)
        } else {
          ingredientLinksCreated += ingredientInserts.length
        }
      }
    }

    // Handle removed blueprints (deactivate)
    const removedMIs = menuItems.filter((i: any) => i.change_type === 'removed' && (i.resolution === 'pending' || i.resolution === 'approved'))
    for (const removed of removedMIs) {
      const bp = existingBpByR365.get(removed.r365_name)
      if (bp) {
        await supabase
          .from('recipe_blueprints')
          .update({ is_active: false })
          .eq('id', bp.id)
        // If it had a produces_item_id, deactivate that too
        if (bp.produces_item_id) {
          await supabase
            .from('inventory_items')
            .update({ is_active: false })
            .eq('id', bp.produces_item_id)
        }
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

    // Also write to legacy bom_* tables for backward compatibility with catalog UI
    // This ensures RecipeCatalog still works until fully migrated
    await writeLegacyBomTables(supabase, locationId, ingredientItems, menuItems, recipeLinks)

    console.log(`[apply-blueprint] Complete: ${created} created, ${updated} updated, ${ingredientLinksCreated} ingredient links, ${autoMatched} auto-matched, ${unmappedIngredients.length} unmapped`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        applied: created + updated,
        created,
        updated,
        ingredientLinks: ingredientLinksCreated,
        autoMatched, 
        autoMatchTotal: unmappedIngredients.length + autoMatched,
        unmappedCount: unmappedIngredients.length,
        unmappedIngredients: unmappedIngredients.slice(0, 30),
        matchResults: matchResults.slice(0, 20),
        bridged: 0, // Legacy compat
        usageRatesCreated: 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    console.error('[apply-blueprint] Error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Write to legacy bom_* tables so RecipeCatalog continues working
async function writeLegacyBomTables(
  supabase: any, 
  locationId: string, 
  ingredientItems: any[], 
  menuItems: any[], 
  recipeLinks: any[]
) {
  try {
    // Upsert ingredients
    const newIngs = ingredientItems.filter((i: any) => i.change_type === 'new')
    if (newIngs.length > 0) {
      const ingData = newIngs.map((i: any) => ({
        location_id: locationId,
        r365_name: i.r365_name,
        category: i.category,
        clean_name: i.clean_name,
        unit_standard: i.unit_standard,
        is_prep_item: i.is_prep_item,
      }))
      await supabase.from('bom_ingredients').upsert(ingData, { onConflict: 'location_id,r365_name', ignoreDuplicates: false })
    }

    // Upsert menu items
    const newMIs = menuItems.filter((i: any) => i.change_type === 'new')
    if (newMIs.length > 0) {
      const miData = newMIs.map((i: any) => ({
        location_id: locationId,
        r365_name: i.r365_name,
        category: i.category,
        clean_name: i.clean_name,
        is_sellable: i.is_sellable,
        recipe_yield_qty: i.new_values?.yieldQty || null,
        recipe_yield_unit: i.new_values?.yieldUnit || null,
      }))
      await supabase.from('bom_menu_items').upsert(miData, { onConflict: 'location_id,r365_name', ignoreDuplicates: false })
    }

    // Recipe links — need ID lookups
    if (recipeLinks.length > 0) {
      const { data: allIngs } = await supabase.from('bom_ingredients').select('id, r365_name').eq('location_id', locationId)
      const { data: allMIs } = await supabase.from('bom_menu_items').select('id, r365_name').eq('location_id', locationId)
      
      const ingIdMap = new Map<string, string>()
      for (const ing of allIngs || []) ingIdMap.set(ing.r365_name, ing.id)
      const miIdMap = new Map<string, string>()
      for (const mi of allMIs || []) miIdMap.set(mi.r365_name, mi.id)

      const newRLs = recipeLinks.filter((i: any) => i.change_type === 'new')
      if (newRLs.length > 0) {
        const riData = newRLs.map((i: any) => {
          const [recipeName, itemName] = i.r365_name.split('::')
          return {
            location_id: locationId,
            menu_item_id: miIdMap.get(recipeName),
            ingredient_id: ingIdMap.get(itemName),
            quantity: i.quantity || 0,
            unit_of_measure: i.unit_of_measure || 'each',
            yield_percent: i.yield_percent || 100,
          }
        }).filter((r: any) => r.menu_item_id && r.ingredient_id)

        if (riData.length > 0) {
          await supabase.from('bom_recipe_ingredients').insert(riData)
        }
      }
    }
  } catch (err) {
    console.error('[apply-blueprint] Legacy bom write error (non-fatal):', err)
  }
}
