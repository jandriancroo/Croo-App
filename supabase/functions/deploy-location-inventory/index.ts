import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "https://deno.land/x/edge_cors@0.2.1/src/cors.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { locationId, brandId, templateId } = await req.json();
    if (!locationId || !brandId) {
      return new Response(
        JSON.stringify({ error: "locationId and brandId required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Use service role for full DB access
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Fetch live brand templates (optionally scoped to a single template)
    let tmplQuery = supabase
      .from("brand_inventory_templates")
      .select("*")
      .eq("brand_id", brandId)
      .eq("status", "live");
    
    if (templateId) {
      tmplQuery = tmplQuery.eq("id", templateId);
    }

    const { data: templates, error: tmplErr } = await tmplQuery;

    if (tmplErr) throw tmplErr;
    if (!templates || templates.length === 0) {
      return new Response(
        JSON.stringify({ deployed: 0, message: "No live templates found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // 2. Check existing items at this location to prevent dupes
    const { data: existingItems } = await supabase
      .from("inventory_items")
      .select("id, name, item_number, pa_item_id, brand_item_id")
      .eq("location_id", locationId);

    const existingByBrandItemId = new Set(
      (existingItems || []).filter((i: any) => i.brand_item_id).map((i: any) => i.brand_item_id)
    );
    // For SKU matching, prefer active items to avoid re-pointing inactive dupes
    const existingBySku = new Map<string, string>();
    const activeItemIds = new Set((existingItems || []).filter((i: any) => i.is_active).map((i: any) => i.id));
    for (const item of existingItems || []) {
      const addMapping = (key: string) => {
        // Only overwrite if current entry is inactive and this one is active
        if (!existingBySku.has(key) || (activeItemIds.has(item.id) && !activeItemIds.has(existingBySku.get(key)!))) {
          existingBySku.set(key, item.id);
        }
      };
      if (item.item_number) addMapping(item.item_number.trim().toLowerCase());
      if (item.pa_item_id) addMapping(`pa:${item.pa_item_id.trim().toLowerCase()}`);
    }

    // 3. Collect unique storage locations and create them
    const storageNames = new Set<string>();
    storageNames.add("Unassigned");
    for (const t of templates) {
      if (t.storage_location_name) storageNames.add(t.storage_location_name);
    }

    const { data: existingStorageLocs } = await supabase
      .from("inventory_locations")
      .select("id, name")
      .eq("location_id", locationId);

    const storageMap = new Map<string, string>();
    for (const loc of existingStorageLocs || []) {
      storageMap.set(loc.name.toLowerCase(), loc.id);
    }

    const locsToCreate = [...storageNames]
      .filter((n) => !storageMap.has(n.toLowerCase()))
      .map((name, i) => ({
        location_id: locationId,
        name,
        display_order: (existingStorageLocs?.length || 0) + i,
      }));

    if (locsToCreate.length > 0) {
      const { data: created } = await supabase
        .from("inventory_locations")
        .insert(locsToCreate)
        .select("id, name");
      for (const loc of created || []) {
        storageMap.set(loc.name.toLowerCase(), loc.id);
      }
    }

    // 4. Collect unique product groups and create them
    const groupsToCreate: { name: string; pos_categories: string[] | null; pos_items: string[] | null }[] = [];
    const groupNames = new Set<string>();
    const targetGroupMap = new Map<string, string>();

    // Fetch existing groups
    const { data: existingGroups } = await supabase
      .from("inventory_product_groups")
      .select("id, name")
      .eq("location_id", locationId);
    for (const g of existingGroups || []) {
      targetGroupMap.set(g.name.toLowerCase(), g.id);
    }

    for (const t of templates) {
      const mappings = (t.usage_rate_mappings as any[]) || [];
      const allGroups =
        mappings.length > 0
          ? mappings.filter((m: any) => m.group_name).map((m: any) => ({
              name: m.group_name,
              pos_categories: m.pos_categories,
              pos_items: m.pos_items,
            }))
          : t.product_group_name
          ? [{ name: t.product_group_name, pos_categories: t.product_group_pos_categories, pos_items: t.product_group_pos_items }]
          : [];

      for (const g of allGroups) {
        const key = g.name.toLowerCase();
        if (!targetGroupMap.has(key) && !groupNames.has(key)) {
          groupsToCreate.push(g);
          groupNames.add(key);
        }
      }
    }

    if (groupsToCreate.length > 0) {
      const { data: created } = await supabase
        .from("inventory_product_groups")
        .insert(
          groupsToCreate.map((g) => ({
            location_id: locationId,
            name: g.name,
            pos_categories: g.pos_categories,
            pos_items: g.pos_items,
          }))
        )
        .select("id, name");
      for (const g of created || []) {
        targetGroupMap.set(g.name.toLowerCase(), g.id);
      }
    }

    // 5. Create inventory_items for each template (skip dupes)
    const templateToItemId = new Map<string, string>();
    const deploymentRecords: any[] = [];
    let deployed = 0;
    let skipped = 0;

    // Separate recipes from non-recipes (create non-recipes first so ingredients exist)
    const nonRecipeTemplates = templates.filter((t: any) => !t.is_recipe);
    const recipeTemplates = templates.filter((t: any) => t.is_recipe);

    for (const tmpl of [...nonRecipeTemplates, ...recipeTemplates]) {
      // Check for existing item linked to this template
      if (existingByBrandItemId.has(tmpl.id)) {
        // Already deployed — find existing item id and re-activate if needed
        const existing = (existingItems || []).find((i: any) => i.brand_item_id === tmpl.id);
        if (existing) {
          templateToItemId.set(tmpl.id, existing.id);
          // Re-activate and sync name/category to brand standard
          await supabase
            .from("inventory_items")
            .update({
              is_active: true,
              name: tmpl.product_name,
              category: tmpl.category,
            })
            .eq("id", existing.id);
        }
        skipped++;
        continue;
      }

      // Check for SKU collision — re-point existing item instead of creating new
      let existingItemId: string | null = null;
      if (tmpl.item_number) {
        existingItemId = existingBySku.get(tmpl.item_number.trim().toLowerCase()) || null;
      }
      if (!existingItemId && tmpl.pa_item_id) {
        existingItemId = existingBySku.get(`pa:${tmpl.pa_item_id.trim().toLowerCase()}`) || null;
      }

      if (existingItemId) {
        // Re-point existing item to brand template
        await supabase
          .from("inventory_items")
          .update({ brand_item_id: tmpl.id })
          .eq("id", existingItemId);
        templateToItemId.set(tmpl.id, existingItemId);
        skipped++;
        continue;
      }

      // Create new inventory_item
      const storageLocId = tmpl.storage_location_name
        ? storageMap.get(tmpl.storage_location_name.toLowerCase()) || storageMap.get("unassigned") || null
        : storageMap.get("unassigned") || null;

      // Build pan_sizes if template has pan config
      let panSizes: any = null;
      if (tmpl.pan_units_per_lb != null || tmpl.pan_units_per_unit != null) {
        panSizes = {
          enabled: true,
          baseline_key: tmpl.pan_baseline_key || "full",
          baseline_units: tmpl.pan_units_per_unit || tmpl.pan_units_per_lb || 1,
          enabled_keys: tmpl.pan_enabled_keys || ["full", "three_quarter", "half", "quarter"],
          ...(tmpl.pan_overrides ? { overrides: tmpl.pan_overrides } : {}),
        };
      }

      const { data: newItem, error: createErr } = await supabase
        .from("inventory_items")
        .insert({
          location_id: locationId,
          name: tmpl.product_name,
          category: tmpl.category,
          storage_location_id: storageLocId,
          is_active: true,
          is_recipe: tmpl.is_recipe || false,
          recipe_yield_qty: tmpl.recipe_yield_qty,
          recipe_yield_unit: tmpl.recipe_yield_unit,
          vendor_source: tmpl.vendor_source,
          item_number: tmpl.item_number,
          pa_item_id: tmpl.pa_item_id,
          brand_item_id: tmpl.id,
          pan_sizes: panSizes,
        })
        .select("id")
        .single();

      if (createErr) {
        console.error(`Failed to create item for template ${tmpl.product_name}:`, createErr);
        continue;
      }

      templateToItemId.set(tmpl.id, newItem.id);
      deployed++;

      deploymentRecords.push({
        template_id: tmpl.id,
        inventory_item_id: newItem.id,
        location_id: locationId,
        needs_review: false,
        review_reason: null,
      });
    }

    // 6. Deploy recipe ingredients
    for (const tmpl of recipeTemplates) {
      const recipeItemId = templateToItemId.get(tmpl.id);
      if (!recipeItemId) continue;

      const ingredients = (tmpl.recipe_ingredients as any[]) || [];
      if (ingredients.length === 0) continue;

      // Fetch all items at location for ingredient matching
      const { data: allItems } = await supabase
        .from("inventory_items")
        .select("id, name, item_number, pa_item_id")
        .eq("location_id", locationId)
        .eq("is_active", true);

      const ingredientInserts: any[] = [];
      for (const ing of ingredients) {
        let ingredientItemId: string | null = null;

        // Tier 1: vendor code match
        if (ing.ingredient_item_number) {
          const match = (allItems || []).find(
            (i: any) => i.item_number?.trim().toLowerCase() === ing.ingredient_item_number.trim().toLowerCase()
          );
          if (match) ingredientItemId = match.id;
        }
        if (!ingredientItemId && ing.ingredient_pa_item_id) {
          const match = (allItems || []).find(
            (i: any) => i.pa_item_id?.trim().toLowerCase() === ing.ingredient_pa_item_id.trim().toLowerCase()
          );
          if (match) ingredientItemId = match.id;
        }

        // Tier 2: name match
        if (!ingredientItemId && ing.ingredient_name) {
          const match = (allItems || []).find(
            (i: any) => i.name.toLowerCase() === ing.ingredient_name.toLowerCase()
          );
          if (match) ingredientItemId = match.id;
        }

        if (ingredientItemId) {
          ingredientInserts.push({
            recipe_item_id: recipeItemId,
            ingredient_item_id: ingredientItemId,
            quantity: ing.quantity,
            unit: ing.unit,
          });
        }
      }

      if (ingredientInserts.length > 0) {
        await supabase.from("inventory_recipe_ingredients").insert(ingredientInserts);
      }
    }

    // 7. Record deployments (upsert to prevent dupes)
    if (deploymentRecords.length > 0) {
      await supabase
        .from("brand_inventory_deployments")
        .upsert(deploymentRecords, { onConflict: "template_id,location_id" });
    }

    // 8. Deploy shortcuts — put all in "Shortcuts (Review)" location
    const templatesWithShortcuts = templates.filter(
      (t: any) => t.shortcut_location_names?.length > 0
    );
    if (templatesWithShortcuts.length > 0) {
      // Ensure "Shortcuts (Review)" storage location exists
      if (!storageMap.has("shortcuts (review)")) {
        const { data: newLoc } = await supabase
          .from("inventory_locations")
          .insert({ location_id: locationId, name: "Shortcuts (Review)", display_order: 999 })
          .select("id")
          .single();
        if (newLoc) storageMap.set("shortcuts (review)", newLoc.id);
      }
      const reviewLocId = storageMap.get("shortcuts (review)");

      if (reviewLocId) {
        for (const tmpl of templatesWithShortcuts) {
          const itemId = templateToItemId.get(tmpl.id);
          if (!itemId) continue;
          await supabase
            .from("inventory_item_locations" as any)
            .upsert(
              { item_id: itemId, storage_location_id: reviewLocId } as any,
              { onConflict: "item_id,storage_location_id" }
            );
        }
      }
    }

    return new Response(
      JSON.stringify({
        deployed,
        skipped,
        total: templates.length,
        message: `Deployed ${deployed} items, skipped ${skipped} existing`,
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("deploy-location-inventory error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
