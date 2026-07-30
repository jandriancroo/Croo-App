// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "https://deno.land/x/edge_cors@0.2.1/src/cors.ts";
import { isInventoryEnabled, inventoryDisabledResponse } from "../_shared/inventoryGate.ts";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // Bulk template deployment — admins (or service/cron) only.
  const denied = await requireAuthorizedCaller(req, CORS, { minRole: "admin" });
  if (denied) return denied;

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

    // Gate: skip if target location has inventory disabled
    const gate = await isInventoryEnabled(supabase, locationId);
    if (!gate.enabled) {
      console.log(`[deploy-location-inventory] SKIPPED — inventory_enabled=false for ${locationId}`);
      return inventoryDisabledResponse(gate, CORS);
    }

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

    // 4b. Prefetch vendor mappings for ALL templates being deployed.
    // Vendor labels in brand_vendor_mappings: 'pfg', 'produce_alliance' (verified).
    // We stamp item_number (PFG) and pa_item_id (PA) at INSERT time so deployed items
    // are immediately ready for syncs/recipe matching — no separate stamping pass needed.
    const allTemplateIds = templates.map((t: any) => t.id);
    const pfgByTemplate = new Map<string, string>();
    const paByTemplate = new Map<string, string>();
    if (allTemplateIds.length > 0) {
      const { data: vendorMaps, error: vmErr } = await supabase
        .from("brand_vendor_mappings")
        .select("brand_template_id, vendor, vendor_item_id")
        .in("brand_template_id", allTemplateIds)
        .in("vendor", ["pfg", "produce_alliance", "pa"]);
      if (vmErr) {
        console.warn("[deploy] vendor mapping prefetch failed:", vmErr);
      } else {
        for (const m of vendorMaps || []) {
          if (!m.vendor_item_id) continue;
          if (m.vendor === "pfg" && !pfgByTemplate.has(m.brand_template_id)) {
            pfgByTemplate.set(m.brand_template_id, m.vendor_item_id);
          } else if ((m.vendor === "produce_alliance" || m.vendor === "pa") && !paByTemplate.has(m.brand_template_id)) {
            paByTemplate.set(m.brand_template_id, m.vendor_item_id);
          }
        }
        console.log(`[deploy] Prefetched vendor maps: ${pfgByTemplate.size} PFG, ${paByTemplate.size} PA`);
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
          // SKU INHERITANCE: only fill NULLs from the brand vendor mapping —
          // never overwrite a non-null local SKU. This closes the leak where a
          // location row had item_number/pa_item_id NULL and got skipped by syncs.
          const reactivatePackOverride = tmpl.pack_override_outer_qty
            ? tmpl.pack_override_outer_qty * (tmpl.pack_override_inner_qty || 1)
            : null;

          // SHELF RESTORATION: If item has no shelf, restore from source location
          const shelfRestore = (!existing.storage_location_id && brandItemToShelf.has(tmpl.id))
            ? { storage_location_id: brandItemToShelf.get(tmpl.id) }
            : {};

          const inheritedPfg = pfgByTemplate.get(tmpl.id);
          const inheritedPa = paByTemplate.get(tmpl.id);
          const skuFill: Record<string, any> = {};
          if (!existing.item_number && inheritedPfg) skuFill.item_number = inheritedPfg;
          if (!existing.pa_item_id && inheritedPa) skuFill.pa_item_id = inheritedPa;

          await supabase
            .from("inventory_items")
            .update({
              is_active: true,
              name: tmpl.product_name,
              category: tmpl.category,
              ...shelfRestore,
              ...skuFill,
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
      // TODO (backlog): also auto-populate pack_quantity_override from
      // brand_inventory_templates.count_units_per_case when packOverride is null.
      // Currently a manual Path A SQL step after deploying a new location.
      const packOverride = tmpl.pack_override_outer_qty
        ? tmpl.pack_override_outer_qty * (tmpl.pack_override_inner_qty || 1)
        : null;

      // Stamp vendor IDs from prefetched brand_vendor_mappings at INSERT time.
      // Mappings are brand-wide identity (not territory-scoped pricing), so it's safe
      // to stamp at deploy. Syncs remain price-only and don't touch these IDs.
      const pfgSku = pfgByTemplate.get(tmpl.id);
      const paSku = paByTemplate.get(tmpl.id);
      // Derive vendor_source from mappings if template's is blank.
      // Many older brand templates have NULL vendor_source even though they have
      // a PFG/PA mapping — without this, the cost-backfill loop below skips them
      // (it filters on vendor_source = 'pfg') and items deploy with $0 cost.
      const resolvedVendorSource = tmpl.vendor_source
        || (pfgSku ? "pfg" : (paSku ? "produce_alliance" : null));
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
          vendor_source: resolvedVendorSource,
          brand_item_id: tmpl.id,
          pan_sizes: panSizes,
          ...(pfgSku ? { item_number: pfgSku } : {}),
          ...(paSku ? { pa_item_id: paSku } : {}),
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

    // 5b. (Removed) Separate PFG stamping pass — vendor IDs are now stamped at INSERT time above.

    // 5c. Backfill PFG cost_per_unit. Two-tier strategy:
    //   Tier 1 — PFG Bid Guide (preferred): contract pricing for every SKU on the
    //     location's bid, regardless of whether it's been ordered. Pulled live via
    //     pfg-service `categories` action against the stored product_list_header_id.
    //   Tier 2 — Local PFG order history: fallback for SKUs not on the bid guide
    //     (off-bid items still ordered ad-hoc). Reads pfg_orders.items JSON.
    // PFG pricing is contract-specific per customer/location, so we never copy
    // from sibling locations. Subsequent order/invoice cycles refresh prices.
    try {
      const itemIds = Array.from(templateToItemId.values());
      if (itemIds.length > 0) {
        const { data: stampedItems } = await supabase
          .from("inventory_items")
          .select("id, item_number, cost_per_unit")
          .in("id", itemIds)
          .eq("vendor_source", "pfg")
          .not("item_number", "is", null);

        const needPrice = (stampedItems || []).filter(
          (i: any) => !i.cost_per_unit || i.cost_per_unit <= 0,
        );

        if (needPrice.length > 0) {
          const priceBySku = new Map<string, number>();

          // ─── Tier 1: PFG Bid Guide ────────────────────────────────────────────
          // Look up the location's stored bid guide ID + customer ID, then call
          // pfg-service to fetch every SKU on the bid with contract pricing.
          try {
            const { data: pfgIntegration } = await supabase
              .from("location_integrations")
              .select("credentials")
              .eq("location_id", locationId)
              .eq("integration_type", "pfg")
              .eq("is_active", true)
              .maybeSingle();

            const creds: any = pfgIntegration?.credentials || {};
            const bidGuideId = creds.product_list_header_id;
            const customerId = creds.customer_id;

            if (bidGuideId && customerId) {
              const { data: catData, error: catErr } = await supabase.functions.invoke(
                "pfg-service",
                {
                  body: {
                    action: "categories",
                    locationId,
                    productListHeaderId: bidGuideId,
                    customerId,
                  },
                },
              );
              if (catErr) {
                console.warn("[Deploy] PFG bid guide fetch failed:", catErr.message);
              } else {
                const categories = catData?.data?.categories || [];
                let bidProducts = 0;
                for (const cat of categories) {
                  for (const p of cat.products || []) {
                    const sku = p?.itemNumber ? String(p.itemNumber) : null;
                    const price = Number(p?.price) || 0;
                    if (sku && price > 0 && !priceBySku.has(sku)) {
                      priceBySku.set(sku, price);
                      bidProducts++;
                    }
                  }
                }
                console.log(`[Deploy] PFG Bid Guide loaded: ${bidProducts} SKUs with prices.`);
              }
            } else {
              console.log("[Deploy] No PFG bid guide configured for this location — skipping Tier 1.");
            }
          } catch (bidErr) {
            console.warn("[Deploy] PFG bid guide pass threw:", bidErr);
          }

          // ─── Tier 2: Local PFG order history (fallback for off-bid SKUs) ──────
          const stillNeed = needPrice.filter((i: any) => !priceBySku.has(i.item_number));
          if (stillNeed.length > 0) {
            const { data: orders, error: ordErr } = await supabase
              .from("pfg_orders")
              .select("items, order_date")
              .eq("location_id", locationId)
              .not("items", "is", null)
              .order("order_date", { ascending: false })
              .limit(50);

            if (ordErr) {
              console.warn("[Deploy] PFG orders fetch failed:", ordErr);
            } else {
              for (const ord of orders || []) {
                const lines = Array.isArray(ord.items) ? ord.items : [];
                for (const line of lines) {
                  const sku = line?.itemNumber ? String(line.itemNumber) : null;
                  const price = Number(line?.price) || 0;
                  if (sku && price > 0 && !priceBySku.has(sku)) {
                    priceBySku.set(sku, price);
                  }
                }
              }
            }
          }

          // ─── Apply prices ─────────────────────────────────────────────────────
          let priced = 0;
          for (const item of needPrice) {
            const price = priceBySku.get(item.item_number);
            if (price == null) continue;
            const { error: priceErr } = await supabase
              .from("inventory_items")
              .update({ cost_per_unit: price })
              .eq("id", item.id);
            if (!priceErr) priced++;
          }
          console.log(`[Deploy] Backfilled PFG cost on ${priced}/${needPrice.length} items (bid guide + order history).`);
        }
      }
    } catch (e) {
      console.warn("[Deploy] PFG price backfill pass threw:", e);
    }


    // 6. Deploy recipe ingredients
    // IDEMPOTENT: We delete existing ingredients first so this step can safely re-run
    // after vendor syncs populate item_number / pa_item_id (the second-pass deploy that
    // the LocationActivationList orchestrates). Without this, repeated deploys would
    // multiply ingredient rows.
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

      // Only rewrite ingredients if we resolved at least one — protects against wiping
      // a previously-good link list when an unrelated sync issue blanks vendor IDs.
      if (ingredientInserts.length > 0) {
        await supabase
          .from("inventory_recipe_ingredients")
          .delete()
          .eq("recipe_item_id", recipeItemId);
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
          }).then(() => console.log(`[deploy] PA sync_items triggered for ${locationId}`))
            .catch((e) => console.warn(`[deploy] PA sync_items invoke error:`, e?.message || e)),
          new Promise((r) => setTimeout(r, 2000)),
        ])
      );
      // Also pull recent order history so cost reconciliation has data to work with
      triggerSyncs.push(
        Promise.race([
          supabase.functions.invoke("produce-alliance-service", {
            body: { action: "orders", locationId, triggeredBy: "deploy" },
          }).then(() => console.log(`[deploy] PA orders triggered for ${locationId}`))
            .catch((e) => console.warn(`[deploy] PA orders invoke error:`, e?.message || e)),
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
