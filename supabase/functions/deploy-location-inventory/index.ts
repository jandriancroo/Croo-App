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
    const { locationId, brandId, templateId, sourceLocationId } = await req.json();
    // Default shelf template: Hemet
    const HEMET_LOCATION_ID = "12c977c7-1786-4131-90f5-1eef3f96e2c6";
    const shelfSourceId = sourceLocationId || HEMET_LOCATION_ID;
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

    // STRUCTURE-ONLY DEPLOY:
    // We intentionally do NOT stamp PFG/PA vendor SKU codes onto deployed items.
    // Vendor SKUs are location-specific (Hemet's PFG SKU != Palm Desert's PFG SKU
    // for the same product). The post-deploy PFG and PA syncs at the target location
    // are responsible for stamping the correct local SKUs and unmatched vendor items
    // surface as gaps in the GAPS UI for manual linking.
    const { data: existingItems } = await supabase
      .from("inventory_items")
      .select("id, name, item_number, pa_item_id, brand_item_id, is_active, storage_location_id")
      .eq("location_id", locationId);

    const existingByBrandItemId = new Set(
      (existingItems || []).filter((i: any) => i.brand_item_id && i.is_active).map((i: any) => i.brand_item_id)
    );

    // 3. Mirror storage locations from source location (default: Hemet)
    // Fetch source location's shelf layout
    const { data: sourceStorageLocs } = await supabase
      .from("inventory_locations")
      .select("id, name, display_order")
      .eq("location_id", shelfSourceId)
      .order("display_order");

    // Also collect any storage names from templates not in source (safety net)
    const allStorageNames = new Set<string>();
    allStorageNames.add("Unassigned");
    for (const sl of sourceStorageLocs || []) {
      allStorageNames.add(sl.name);
    }
    for (const t of templates) {
      if (t.storage_location_name) allStorageNames.add(t.storage_location_name);
    }

    // Check what already exists at target
    const { data: existingStorageLocs } = await supabase
      .from("inventory_locations")
      .select("id, name")
      .eq("location_id", locationId);

    const storageMap = new Map<string, string>();
    for (const loc of existingStorageLocs || []) {
      storageMap.set(loc.name.toLowerCase(), loc.id);
    }

    // Create missing storage locations, preserving source display_order
    const sourceOrderMap = new Map<string, number>();
    for (const sl of sourceStorageLocs || []) {
      sourceOrderMap.set(sl.name.toLowerCase(), sl.display_order);
    }

    const locsToCreate = [...allStorageNames]
      .filter((n) => !storageMap.has(n.toLowerCase()))
      .map((name, i) => ({
        location_id: locationId,
        name,
        display_order: sourceOrderMap.get(name.toLowerCase()) ?? (existingStorageLocs?.length || 0) + 100 + i,
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

    // Build a brand_item_id → storage_location_name map from source location's items
    const { data: sourceItems } = await supabase
      .from("inventory_items")
      .select("brand_item_id, storage_location_id, display_order")
      .eq("location_id", shelfSourceId)
      .eq("is_active", true)
      .not("brand_item_id", "is", null);

    // Map source storage_location_id → name for reverse lookup
    const sourceStorageIdToName = new Map<string, string>();
    for (const sl of sourceStorageLocs || []) {
      sourceStorageIdToName.set(sl.id, sl.name);
    }

    // brand_item_id → target storage location id (via source shelf assignment)
    const brandItemToShelf = new Map<string, string>();
    const brandItemToOrder = new Map<string, number>();
    for (const si of sourceItems || []) {
      if (si.brand_item_id && si.storage_location_id) {
        const sourceName = sourceStorageIdToName.get(si.storage_location_id);
        if (sourceName) {
          const targetLocId = storageMap.get(sourceName.toLowerCase());
          if (targetLocId) {
            brandItemToShelf.set(si.brand_item_id, targetLocId);
          }
        }
      }
      if (si.brand_item_id && si.display_order != null) {
        brandItemToOrder.set(si.brand_item_id, si.display_order);
      }
    }

    console.log(`[deploy] Shelf mirroring from ${shelfSourceId === HEMET_LOCATION_ID ? 'Hemet (default)' : shelfSourceId}: ${brandItemToShelf.size} item-to-shelf mappings`);

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
        // GHOST FILTER: Prefer active items over inactive ghosts
        const candidates = (existingItems || []).filter((i: any) => i.brand_item_id === tmpl.id);
        const existing = candidates.find((i: any) => i.is_active) || null;
        if (existing) {
          templateToItemId.set(tmpl.id, existing.id);
          // Re-activate and sync name/category/pack to brand standard.
          // NOTE: vendor SKUs (item_number, pa_item_id) are NOT touched here —
          // local syncs own those fields.
          const reactivatePackOverride = tmpl.pack_override_outer_qty
            ? tmpl.pack_override_outer_qty * (tmpl.pack_override_inner_qty || 1)
            : null;

          // SHELF RESTORATION: If item has no shelf, restore from source location
          const shelfRestore = (!existing.storage_location_id && brandItemToShelf.has(tmpl.id))
            ? { storage_location_id: brandItemToShelf.get(tmpl.id) }
            : {};

          await supabase
            .from("inventory_items")
            .update({
              is_active: true,
              name: tmpl.product_name,
              category: tmpl.category,
              ...shelfRestore,
              ...(reactivatePackOverride != null ? { pack_quantity_override: reactivatePackOverride } : {}),
              ...(tmpl.count_unit ? { count_unit: tmpl.count_unit } : {}),
              ...(tmpl.count_units_per_case != null ? { count_units_per_case: tmpl.count_units_per_case } : {}),
            })
            .eq("id", existing.id);

          // CRITICAL: Always record a deployment row for the existing-item skip path.
          // PA sync's Tier 1 matching chain (brand_template_id → deployment → item)
          // requires this row, otherwise costs silently stay at $0.
          deploymentRecords.push({
            template_id: tmpl.id,
            inventory_item_id: existing.id,
            location_id: locationId,
            needs_review: false,
            review_reason: null,
          });
        }
        skipped++;
        continue;
      }

      // Create new inventory_item — prioritize source shelf mapping, fall back to template name
      const storageLocId = brandItemToShelf.get(tmpl.id)
        || (tmpl.storage_location_name ? storageMap.get(tmpl.storage_location_name.toLowerCase()) : null)
        || storageMap.get("unassigned")
        || null;

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

      const sourceOrder = brandItemToOrder.get(tmpl.id);
      // Calculate pack_quantity_override from brand template overrides
      const packOverride = tmpl.pack_override_outer_qty
        ? tmpl.pack_override_outer_qty * (tmpl.pack_override_inner_qty || 1)
        : null;

      // STRUCTURE-ONLY: do NOT stamp item_number / pa_item_id.
      // Local PFG / PA syncs will fill these in with the correct location-specific SKUs.
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
          brand_item_id: tmpl.id,
          pan_sizes: panSizes,
          ...(packOverride != null ? { pack_quantity_override: packOverride } : {}),
          ...(tmpl.count_unit ? { count_unit: tmpl.count_unit } : {}),
          ...(tmpl.count_units_per_case != null ? { count_units_per_case: tmpl.count_units_per_case } : {}),
          ...(sourceOrder != null ? { display_order: sourceOrder } : {}),
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

    // ── Pre-flight checklist: flag missing integrations ──
    const warnings: string[] = [];

    // Check PFG integration
    const { data: pfgInt } = await supabase
      .from("location_integrations")
      .select("id")
      .eq("location_id", locationId)
      .eq("integration_type", "pfg")
      .eq("is_active", true)
      .maybeSingle();

    if (!pfgInt) {
      warnings.push("PFG integration: NOT CONFIGURED — costs will not sync for PFG items");
    }

    // Check PA integration
    const { data: paInt } = await supabase
      .from("location_integrations")
      .select("id")
      .eq("location_id", locationId)
      .eq("integration_type", "produce_alliance")
      .eq("is_active", true)
      .maybeSingle();

    if (!paInt) {
      const produceCount = templates.filter(
        (t: any) => t.vendor_source === "produce_alliance"
      ).length;
      warnings.push(
        `PA integration: NOT CONFIGURED — ${produceCount} produce items deployed with no pack/cost data`
      );
    }

    // Check for items deployed without pack data
    const itemsWithoutPack = templates.filter((t: any) => {
      const hasPackOverride = t.pack_override_outer_qty && t.pack_override_inner_qty;
      const hasCountUnit = t.count_unit;
      return !hasPackOverride && !hasCountUnit && templateToItemId.has(t.id);
    }).length;

    if (itemsWithoutPack > 0) {
      warnings.push(
        `${itemsWithoutPack} items deployed without brand-level pack/count configuration`
      );
    }

    // Tell the user the syncs are about to fire — gives context for the
    // "PFG SKU is empty right now, that's expected" state immediately after deploy.
    const itemsNeedingSync = templates.filter((t: any) =>
      t.vendor_source && templateToItemId.has(t.id)
    ).length;
    if (itemsNeedingSync > 0) {
      warnings.push(
        `${itemsNeedingSync} items need vendor sync for costs — syncs will run automatically`
      );
    }

    // Stamp last_deployed_at on the location
    await supabase
      .from("locations")
      .update({ last_deployed_at: new Date().toISOString() })
      .eq("id", locationId);

    // ── Auto-trigger vendor syncs (do not pure fire-and-forget) ──
    // Edge runtime may terminate this function before invoke()'s HTTP request leaves
    // the environment. Promise.race with a 2s timeout guarantees the request is sent
    // without forcing the deploy response to wait for the (potentially long) sync.
    const triggerSyncs: Promise<unknown>[] = [];

    if (pfgInt) {
      triggerSyncs.push(
        Promise.race([
          supabase.functions.invoke("pfg-service", {
            body: { locationId, action: "sync_orders" },
          }).then(() => console.log(`[deploy] PFG sync_orders triggered for ${locationId}`))
            .catch((e) => console.warn(`[deploy] PFG sync invoke error:`, e?.message || e)),
          new Promise((r) => setTimeout(r, 2000)),
        ])
      );
    }

    if (paInt) {
      triggerSyncs.push(
        Promise.race([
          supabase.functions.invoke("produce-alliance-service", {
            body: { action: "sync_items", locationId, triggeredBy: "deploy" },
          }).then(() => console.log(`[deploy] PA sync triggered for ${locationId}`))
            .catch((e) => console.warn(`[deploy] PA sync invoke error:`, e?.message || e)),
          new Promise((r) => setTimeout(r, 2000)),
        ])
      );
    }

    // Wait up to ~2s total for both invokes to leave; do not block on full sync run.
    if (triggerSyncs.length > 0) {
      await Promise.allSettled(triggerSyncs);
    }

    return new Response(
      JSON.stringify({
        deployed,
        skipped,
        total: templates.length,
        message: `Deployed ${deployed} items, skipped ${skipped} existing`,
        warnings,
        syncsTriggered: {
          pfg: !!pfgInt,
          produce_alliance: !!paInt,
        },
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
