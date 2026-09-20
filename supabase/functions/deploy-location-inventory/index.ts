// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
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
    const body = await req.json();
    const { locationId, brandId, templateId, sourceLocationId } = body;
    // Free-text label for the deploy log: which entry point fired this run.
    const deploySource: string = body?.source ?? (templateId ? "template_trigger" : "unknown");
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

    // Phase 1 deploys items INACTIVE (the activation sweep flips them on once a real
    // price is found), so "already deployed" must NOT be gated on is_active — otherwise
    // every re-deploy would create a duplicate row for every inactive item.
    const existingByBrandItemId = new Set(
      (existingItems || []).filter((i: any) => i.brand_item_id).map((i: any) => i.brand_item_id)
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

    // 4c. DIVISION GUARD — a PFG number is only valid at the warehouse that
    // carries it. Tuscaloosa/Rowlett inherited SoCal numbers their own warehouse
    // never recognised, so those items could never be priced and nothing flagged it.
    // Validate every inherited number against THIS location's order guide before
    // stamping it. A number the guide doesn't have is not planted on the local row;
    // the item is marked unpriced-pending and a gap alert is raised for this store.
    const localGuideNumbers = new Set<string>();
    {
      const { data: guideRows, error: guideErr } = await supabase
        .from("pfg_bid_items")
        .select("item_number")
        .eq("location_id", locationId);
      if (guideErr) {
        console.warn("[deploy] guide prefetch failed — skipping number validation:", guideErr);
      } else {
        for (const g of guideRows || []) {
          const n = String((g as any).item_number || "").trim();
          if (n) localGuideNumbers.add(n);
        }
      }
    }
    // Only enforce when we actually have a guide for this location. No guide =
    // unknown, not invalid — never strip numbers on a blind guess.
    const guideKnown = localGuideNumbers.size > 0;
    const foreignNumberAlerts: { itemNumber: string; productName: string }[] = [];
    const isNumberValidHere = (sku: string | undefined): boolean => {
      if (!sku) return false;
      if (!guideKnown) return true;
      return localGuideNumbers.has(String(sku).trim());
    };

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
        // Already deployed — refresh identity only. Activation is the sweep's job.
        // Prefer an active row when several exist, but fall back to an inactive one so
        // Phase 1 never duplicates an item it deployed inactive on an earlier run.
        const candidates = (existingItems || []).filter((i: any) => i.brand_item_id === tmpl.id);
        const existing = candidates.find((i: any) => i.is_active) || candidates[0] || null;

        if (existing) {
          templateToItemId.set(tmpl.id, existing.id);
          // Sync name/category/pack to brand standard. NOTE: is_active is deliberately
          // NOT touched here — a re-deploy must never resurrect a dead item. The
          // activation sweep (Phase 2) is the only thing that turns items on.
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

          const inheritedPfgRaw = pfgByTemplate.get(tmpl.id);
          const inheritedPa = paByTemplate.get(tmpl.id);
          // Division guard: don't inherit a number this warehouse doesn't carry.
          const inheritedPfg = isNumberValidHere(inheritedPfgRaw) ? inheritedPfgRaw : undefined;
          if (inheritedPfgRaw && !inheritedPfg && !existing.item_number) {
            foreignNumberAlerts.push({ itemNumber: inheritedPfgRaw, productName: tmpl.product_name });
          }
          const skuFill: Record<string, any> = {};
          if (!existing.item_number && inheritedPfg) skuFill.item_number = inheritedPfg;
          if (!existing.pa_item_id && inheritedPa) skuFill.pa_item_id = inheritedPa;
          // No usable PFG number here → mark unpriced-pending so the chase and
          // the gap screen both keep it visible instead of silently sitting at $0.
          if (inheritedPfgRaw && !inheritedPfg && !existing.item_number) {
            skuFill.unpriced_since = new Date().toISOString();
          }

          await supabase
            .from("inventory_items")
            .update({
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
      const pfgSkuRaw = pfgByTemplate.get(tmpl.id);
      const paSku = paByTemplate.get(tmpl.id);
      // Division guard (see 4c): only stamp a PFG number this location's own order
      // guide actually carries. Otherwise leave it blank, mark unpriced-pending and
      // raise a gap alert for this store.
      const pfgSku = isNumberValidHere(pfgSkuRaw) ? pfgSkuRaw : undefined;
      const foreignPfg = !!pfgSkuRaw && !pfgSku;
      if (foreignPfg) {
        foreignNumberAlerts.push({ itemNumber: pfgSkuRaw!, productName: tmpl.product_name });
      }
      // Derive vendor_source from mappings if template's is blank.
      // Many older brand templates have NULL vendor_source even though they have
      // a PFG/PA mapping — without this the activation sweep would treat them as
      // house-made ("no vendor price ever expected") and activate them unpriced.
      const resolvedVendorSource = tmpl.vendor_source
        || (pfgSku ? "pfg" : (paSku ? "produce_alliance" : null));
      const { data: newItem, error: createErr } = await supabase
        .from("inventory_items")
        .insert({
          location_id: locationId,
          name: tmpl.product_name,
          category: tmpl.category,
          storage_location_id: storageLocId,
          // PHASE 1 = STRUCTURE ONLY. Items land inactive; the Phase 2 activation
          // sweep turns on the ones it can actually price.
          is_active: false,

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

    // 5c. (Removed, Stage 3) PFG cost_per_unit backfill. Deploy no longer talks to any
    // vendor API and no longer stamps prices. Pricing lives in exactly one place now:
    // _shared/vendorPriceChase.ts (master list → orders → invoices, PFG *and* PA),
    // invoked as the Phase 2 activation sweep after this function returns.

    // 6. Deploy recipe ingredients
    // IDEMPOTENT: existing ingredients are deleted first, so this step is safe to re-run.
    // Matching uses item_number / pa_item_id, which are stamped at INSERT from
    // brand_vendor_mappings — no vendor call is needed for this to resolve.
    for (const tmpl of recipeTemplates) {
      const recipeItemId = templateToItemId.get(tmpl.id);
      if (!recipeItemId) continue;

      const ingredients = (tmpl.recipe_ingredients as any[]) || [];
      if (ingredients.length === 0) continue;

      // Fetch all items at location for ingredient matching.
      // NOT filtered on is_active: Phase 1 deploys items inactive, so an active-only
      // filter here would fail to resolve every ingredient on a fresh deploy.
      const { data: allItems } = await supabase
        .from("inventory_items")
        .select("id, name, item_number, pa_item_id")
        .eq("location_id", locationId);


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

    // Items land inactive by design — say so, so an empty-looking count screen
    // straight after deploy reads as expected rather than as a failure.
    const itemsNeedingSync = templates.filter((t: any) =>
      t.vendor_source && templateToItemId.has(t.id)
    ).length;
    if (itemsNeedingSync > 0) {
      warnings.push(
        `${itemsNeedingSync} items deployed INACTIVE — they turn on when the activation sweep finds a vendor price`
      );
    }

    // Stamp last_deployed_at on the location
    await supabase
      .from("locations")
      .update({ last_deployed_at: new Date().toISOString() })
      .eq("id", locationId);

    // ── Phase 1 ends here ──
    // No vendor API calls, no price stamping, no activation. The caller is responsible
    // for running the Phase 2 activation sweep (vendor-price-chase with activate:true)
    // after refreshing vendor lists. Deliberately NOT fired from here: a fire-and-forget
    // invoke can't be waited on or reported, which is what Stage 3 removes.
    const deployedItemIds = Array.from(templateToItemId.values());

    // ── Persistent deploy log (Phase 1) ──
    // One row per deploy run. Nothing is recomputed here — we persist exactly the
    // summary that was already assembled above and until now only reached a toast.
    // Phase 2 (vendor-price-chase, activate:true) completes this same row.
    let deployRunId: string | null = null;
    try {
      const { data: runRow, error: runErr } = await supabase
        .from("inventory_deploy_runs")
        .insert({
          location_id: locationId,
          brand_id: brandId,
          source: typeof deploySource === "string" && deploySource ? deploySource : "unknown",
          phase_1_result: {
            deployed,
            skipped,
            total: templates.length,
            template_id: templateId ?? null,
            warnings,
            integrations: { pfg: !!pfgInt, produce_alliance: !!paInt },
            deployed_item_count: deployedItemIds.length,
          },
        })
        .select("id")
        .single();
      if (runErr) throw runErr;
      deployRunId = runRow?.id ?? null;
    } catch (logErr: any) {
      // Logging must never break a deploy.
      console.warn("[deploy-location-inventory] deploy run log failed:", logErr?.message || logErr);
    }

    return new Response(
      JSON.stringify({
        deployed,
        skipped,
        total: templates.length,
        deployedItemIds,
        deployRunId,
        message: `Deployed ${deployed} items (inactive), skipped ${skipped} existing`,
        warnings,
        phase: "structure_only",
        nextStep: "vendor-price-chase { activate: true, includeInactive: true }",
        integrations: {
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
