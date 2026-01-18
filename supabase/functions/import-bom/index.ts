import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BOMRow {
  item: string;
  recipe: string;
  qty: number;
  uofm: string;
  yieldPercent: number;
}

interface ParsedIngredient {
  r365_name: string;
  category: string;
  clean_name: string;
  unit_standard: string;
  is_prep_item: boolean;
}

interface ParsedMenuItem {
  r365_name: string;
  category: string;
  clean_name: string;
  is_sellable: boolean;
}

// Extract category from R365 naming convention
function extractIngredientCategory(name: string): string {
  const prefixes = [
    'DRY', 'MEAT', 'DAIRY', 'PROD', 'PREP', 'PAPER', 
    'NA BEV', 'BEER', 'WINE', 'MI'
  ];
  
  for (const prefix of prefixes) {
    if (name.toUpperCase().startsWith(prefix)) {
      return prefix.replace(' ', '_').toUpperCase();
    }
  }
  return 'OTHER';
}

// Extract category from menu item naming
function extractMenuCategory(name: string): string {
  if (name.startsWith('MI -')) return 'MI';
  if (name.startsWith('Core -') || name.startsWith('Core ')) return 'CORE';
  if (name.startsWith('Base -')) return 'BASE';
  if (name.startsWith('PREP') || name.startsWith('Prep')) return 'PREP';
  if (name.startsWith('Catering') || name.startsWith('Cat -')) return 'CATERING';
  if (name.startsWith('Culinary')) return 'CULINARY';
  if (name.startsWith('Costing')) return 'COSTING';
  if (name.startsWith('Offer')) return 'OFFER';
  return 'OTHER';
}

// Clean ingredient name for matching
function cleanIngredientName(name: string): string {
  // Remove category prefix and clean up
  const prefixes = ['DRY ', 'MEAT ', 'DAIRY ', 'PROD ', 'PREP ', 'PAPER ', 'NA BEV ', 'BEER ', 'WINE ', 'MI '];
  let clean = name;
  for (const prefix of prefixes) {
    if (clean.toUpperCase().startsWith(prefix)) {
      clean = clean.substring(prefix.length);
      break;
    }
  }
  return clean.trim().toLowerCase();
}

// Clean menu item name for QU matching
function cleanMenuName(name: string): string {
  // Remove prefix like "MI - ", "Core - ", etc.
  return name.replace(/^(MI|Core|Base|PREP|Prep|Catering|Cat|Culinary|Costing|Offer)\s*-?\s*/i, '').trim().toLowerCase();
}

// Normalize unit of measure
function normalizeUnit(uofm: string): string {
  const normalized = uofm.toLowerCase().replace('-', '');
  if (normalized.includes('oz') && normalized.includes('wt')) return 'oz';
  if (normalized.includes('oz') && normalized.includes('fl')) return 'fl_oz';
  if (normalized.includes('oz')) return 'oz';
  if (normalized.includes('each')) return 'each';
  if (normalized.includes('gram')) return 'gram';
  if (normalized.includes('lb')) return 'lb';
  if (normalized.includes('gallon')) return 'gallon';
  if (normalized.includes('quart')) return 'quart';
  if (normalized.includes('can')) return 'each';
  if (normalized.includes('bottle')) return 'each';
  if (normalized.includes('pack')) return 'each';
  if (normalized.includes('ct')) return 'each';
  return 'each';
}

// Parse CSV content
function parseCSV(content: string): BOMRow[] {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];
  
  const rows: BOMRow[] = [];
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Handle CSV with potential commas in values
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    parts.push(current.trim());
    
    if (parts.length >= 5) {
      rows.push({
        item: parts[0],
        recipe: parts[1],
        qty: parseFloat(parts[2]) || 0,
        uofm: parts[3],
        yieldPercent: parseFloat(parts[4]) || 100,
      });
    }
  }
  
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { csvContent, locationId } = await req.json();

    if (!csvContent || !locationId) {
      return new Response(
        JSON.stringify({ error: 'Missing csvContent or locationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting BOM import for location: ${locationId}`);

    // Parse CSV
    const rows = parseCSV(csvContent);
    console.log(`Parsed ${rows.length} rows from CSV`);

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid rows found in CSV' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract unique ingredients
    const ingredientMap = new Map<string, ParsedIngredient>();
    for (const row of rows) {
      if (!ingredientMap.has(row.item)) {
        const category = extractIngredientCategory(row.item);
        ingredientMap.set(row.item, {
          r365_name: row.item,
          category,
          clean_name: cleanIngredientName(row.item),
          unit_standard: normalizeUnit(row.uofm),
          is_prep_item: category === 'PREP',
        });
      }
    }

    // Extract unique menu items
    const menuItemMap = new Map<string, ParsedMenuItem>();
    for (const row of rows) {
      if (!menuItemMap.has(row.recipe)) {
        const category = extractMenuCategory(row.recipe);
        menuItemMap.set(row.recipe, {
          r365_name: row.recipe,
          category,
          clean_name: cleanMenuName(row.recipe),
          is_sellable: category === 'MI',
        });
      }
    }

    console.log(`Found ${ingredientMap.size} unique ingredients`);
    console.log(`Found ${menuItemMap.size} unique menu items`);

    // Clear existing data for this location (optional - upsert handles duplicates)
    // We'll use upsert instead to preserve any manual matches

    // Insert ingredients
    const ingredientData = Array.from(ingredientMap.values()).map(ing => ({
      location_id: locationId,
      ...ing,
    }));

    const { data: insertedIngredients, error: ingError } = await supabase
      .from('bom_ingredients')
      .upsert(ingredientData, { 
        onConflict: 'location_id,r365_name',
        ignoreDuplicates: false 
      })
      .select('id, r365_name');

    if (ingError) {
      console.error('Error inserting ingredients:', ingError);
      throw ingError;
    }

    console.log(`Upserted ${insertedIngredients?.length || 0} ingredients`);

    // Insert menu items
    const menuItemData = Array.from(menuItemMap.values()).map(mi => ({
      location_id: locationId,
      ...mi,
    }));

    const { data: insertedMenuItems, error: miError } = await supabase
      .from('bom_menu_items')
      .upsert(menuItemData, { 
        onConflict: 'location_id,r365_name',
        ignoreDuplicates: false 
      })
      .select('id, r365_name');

    if (miError) {
      console.error('Error inserting menu items:', miError);
      throw miError;
    }

    console.log(`Upserted ${insertedMenuItems?.length || 0} menu items`);

    // Create lookup maps for IDs
    const ingredientIdMap = new Map<string, string>();
    const { data: allIngredients } = await supabase
      .from('bom_ingredients')
      .select('id, r365_name')
      .eq('location_id', locationId);
    
    for (const ing of allIngredients || []) {
      ingredientIdMap.set(ing.r365_name, ing.id);
    }

    const menuItemIdMap = new Map<string, string>();
    const { data: allMenuItems } = await supabase
      .from('bom_menu_items')
      .select('id, r365_name')
      .eq('location_id', locationId);
    
    for (const mi of allMenuItems || []) {
      menuItemIdMap.set(mi.r365_name, mi.id);
    }

    // Insert recipe ingredients (the mappings)
    // Deduplicate by combining quantities for same menu_item + ingredient
    const recipeMap = new Map<string, {
      location_id: string;
      menu_item_id: string;
      ingredient_id: string;
      quantity: number;
      unit_of_measure: string;
      quantity_normalized: number;
      yield_percent: number;
    }>();

    for (const row of rows) {
      const menuItemId = menuItemIdMap.get(row.recipe);
      const ingredientId = ingredientIdMap.get(row.item);
      
      if (!menuItemId || !ingredientId) continue;
      
      const key = `${menuItemId}::${ingredientId}`;
      
      if (recipeMap.has(key)) {
        // Add quantity to existing entry
        const existing = recipeMap.get(key)!;
        existing.quantity += row.qty;
        existing.quantity_normalized += row.qty;
      } else {
        recipeMap.set(key, {
          location_id: locationId,
          menu_item_id: menuItemId,
          ingredient_id: ingredientId,
          quantity: row.qty,
          unit_of_measure: row.uofm,
          quantity_normalized: row.qty,
          yield_percent: row.yieldPercent,
        });
      }
    }

    const recipeIngredients = Array.from(recipeMap.values());
    console.log(`Deduplicated to ${recipeIngredients.length} unique recipe mappings`);

    // Delete existing recipe ingredients for this location first (clean slate for mappings)
    await supabase
      .from('bom_recipe_ingredients')
      .delete()
      .eq('location_id', locationId);

    // Insert in batches to avoid payload size limits
    const batchSize = 500;
    let insertedCount = 0;
    
    for (let i = 0; i < recipeIngredients.length; i += batchSize) {
      const batch = recipeIngredients.slice(i, i + batchSize);
      const { error: riError } = await supabase
        .from('bom_recipe_ingredients')
        .insert(batch);

      if (riError) {
        console.error(`Error inserting recipe ingredients batch ${i / batchSize}:`, riError);
        throw riError;
      }
      insertedCount += batch.length;
    }

    console.log(`Inserted ${insertedCount} recipe ingredient mappings`);

    // Get category breakdown for response
    const categoryBreakdown: Record<string, number> = {};
    for (const ing of ingredientMap.values()) {
      categoryBreakdown[ing.category] = (categoryBreakdown[ing.category] || 0) + 1;
    }

    const menuCategoryBreakdown: Record<string, number> = {};
    for (const mi of menuItemMap.values()) {
      menuCategoryBreakdown[mi.category] = (menuCategoryBreakdown[mi.category] || 0) + 1;
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
    );

  } catch (error: unknown) {
    console.error('BOM import error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
