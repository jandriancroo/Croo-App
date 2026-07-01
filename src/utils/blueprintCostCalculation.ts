import { supabase } from "@/integrations/supabase/client";

import { TO_OZ, normalizeUnit as normalizeIngUnit, expandEmbeddedUnit } from "./unitConversion";
import { parsePackSizeToOz } from "./legacy/conversionLegacy";

export { parsePackSizeToOz };

interface BlueprintInfo {
  id: string;
  yield_qty: number | null;
  yield_unit: string | null;
  produces_item_id: string | null;
}

interface BlueprintIngredientRow {
  blueprint_id: string;
  ingredient_type: string;
  vendor_item_id: string | null;
  sub_blueprint_id: string | null;
  quantity: number;
  unit: string | null;
}

interface VendorItemInfo {
  id: string;
  cost_per_unit: number | null;
  blended_price: number | null;
  pack_size: string | null;
  count_unit: string | null;
  count_units_per_case: number | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
}

interface ActiveConversionRow {
  brand_template_id: string;
  canonical_unit: string;
  outer_qty: number;
  canonical_qty_per_inner: number | null;
}

export interface BlueprintCostResult {
  batchCost: number;
  missingItems: string[];
  /** A0: ingredients whose brand template exists but is archived (deliberate brand decision). */
  archivedItems: string[];
  /** A0: ingredients that exist & are active but have no resolvable price (data gap). */
  unpricedItems: string[];
  isPartial: boolean;
}

/**
 * Fetches all recipe blueprints and their ingredients for a location,
 * then calculates the batch cost for each blueprint by walking the tree
 * down to vendor items and using live pricing.
 *
 * Returns Map<blueprint_id, BlueprintCostResult>
 */
export async function fetchBlueprintCosts(
  locationId: string
): Promise<Map<string, BlueprintCostResult>> {
  // 1. Fetch all active blueprints using inheritance merge:
  // brand-level blueprints are the base catalog, and local blueprints layer on top.
  const { resolveBrandId } = await import("@/utils/resolveBrandId");
  const brandId = await resolveBrandId(locationId);

  // Pipeline 1 — fetch active brand conversions keyed by brand_template_id.
  // ing.vendor_item_id in recipe_blueprint_ingredients is always a brand_inventory_templates.id,
  // so we can look it up directly without resolving via the local vendor row.
  const conversionMap = new Map<string, ActiveConversionRow>();
  if (brandId) {
    const { data: conversions, error: convErr } = await supabase
      .from("item_conversions")
      .select("brand_template_id, canonical_unit, outer_qty, canonical_qty_per_inner")
      .eq("brand_id", brandId)
      .is("effective_to", null);
    if (!convErr && conversions) {
      for (const c of conversions as ActiveConversionRow[]) {
        conversionMap.set(c.brand_template_id, c);
      }
    }
  }

  const [localBpRes, brandBpRes] = await Promise.all([
    supabase
      .from("recipe_blueprints" as any)
      .select("id, yield_qty, yield_unit, produces_item_id")
      .eq("location_id", locationId)
      .eq("is_active", true),
    brandId
      ? supabase
          .from("recipe_blueprints" as any)
          .select("id, yield_qty, yield_unit, produces_item_id")
          .eq("brand_id", brandId)
          .is("location_id", null)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (localBpRes.error) throw localBpRes.error;
  if (brandBpRes.error) throw brandBpRes.error;

  const mergedBlueprints = new Map<string, BlueprintInfo>();
  const brandBlueprints = ((brandBpRes.data || []) as unknown) as BlueprintInfo[];
  const localBlueprints = ((localBpRes.data || []) as unknown) as BlueprintInfo[];

  for (const bp of brandBlueprints) {
    mergedBlueprints.set(bp.id, bp);
  }
  for (const bp of localBlueprints) {
    mergedBlueprints.set(bp.id, bp);
  }

  const bpList = Array.from(mergedBlueprints.values()) as unknown as BlueprintInfo[];
  if (!bpList.length) return new Map();

  const bpMap = new Map<string, BlueprintInfo>(bpList.map(b => [b.id, b]));
  const blueprintIds = bpList.map(b => b.id);

  // 2. Fetch all ingredients for these blueprints with true pagination.
  // Supabase API row caps (often 1000) still apply even when .limit() is higher,
  // so we page by range to guarantee we collect all rows.
  const ingList: BlueprintIngredientRow[] = [];
  const ID_BATCH_SIZE = 200;
  const PAGE_SIZE = 500;

  for (let i = 0; i < blueprintIds.length; i += ID_BATCH_SIZE) {
    const idBatch = blueprintIds.slice(i, i + ID_BATCH_SIZE);
    let offset = 0;

    while (true) {
      const { data: pageData, error: ingErr } = await supabase
        .from("recipe_blueprint_ingredients" as any)
        .select("id, blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id, quantity, unit")
        .in("blueprint_id", idBatch)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (ingErr) throw ingErr;

      const rows = (pageData || []) as unknown as BlueprintIngredientRow[];
      ingList.push(...rows);

      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  // 3. Fetch vendor items for pricing
  // vendor_item_id in recipe_blueprint_ingredients references brand_inventory_templates,
  // so we need to resolve those to local inventory_items via brand_inventory_deployments.
  const brandTemplateIds = [
    ...new Set(ingList.filter(i => i.vendor_item_id).map(i => i.vendor_item_id!)),
  ];

  let vendorMap = new Map<string, VendorItemInfo>();
  // Map from brand_template_id → local inventory_item for cost lookup
  const templateToLocalId = new Map<string, string>();
  // A0: track which brand templates are archived so the engine can flag them
  // separately from "missing" (no deployment) and "unpriced" (data gap).
  const archivedTemplateIds = new Set<string>();
  // Templates flagged as intentionally free (Water, Ice, etc.) — $0 cost is valid,
  // do NOT flag the recipe as unpriced/partial when these are ingredients.
  const freeTemplateIds = new Set<string>();

  if (brandTemplateIds.length > 0) {
    // A0: pull template status alongside the deployment lookup so we can
    // distinguish archived ingredients from data-gap and missing ingredients.
    const { data: templateStatuses, error: tplErr } = await supabase
      .from("brand_inventory_templates")
      .select("id, status, is_free")
      .in("id", brandTemplateIds);
    if (tplErr) throw tplErr;
    for (const t of templateStatuses || []) {
      // Brand templates use status 'live' | 'draft' | 'archived'.
      // Only 'archived' should be flagged — 'live' and 'draft' are usable.
      if ((t as any).status === "archived") {
        archivedTemplateIds.add((t as any).id);
      }
      if ((t as any).is_free === true) {
        freeTemplateIds.add((t as any).id);
      }
    }


    // Resolve brand templates → local inventory items via deployments
    const { data: deployments, error: depErr } = await supabase
      .from("brand_inventory_deployments")
      .select("template_id, inventory_item_id")
      .eq("location_id", locationId)
      .in("template_id", brandTemplateIds);
    if (depErr) throw depErr;

    const localItemIds: string[] = [];
    for (const dep of (deployments || [])) {
      templateToLocalId.set(dep.template_id, dep.inventory_item_id);
      localItemIds.push(dep.inventory_item_id);
    }

    if (localItemIds.length > 0) {
      const { data: vendorItems, error: vErr } = await supabase
        .from("inventory_items")
        .select("id, cost_per_unit, blended_price, pack_size, count_unit, count_units_per_case, pack_quantity, pack_quantity_override")
        .in("id", localItemIds);
      if (vErr) throw vErr;
      vendorMap = new Map((vendorItems || []).map(v => [v.id, v as VendorItemInfo]));
    }
  }

  // 4. Group ingredients by blueprint
  const ingredientsByBp = new Map<string, BlueprintIngredientRow[]>();
  for (const ing of ingList) {
    const list = ingredientsByBp.get(ing.blueprint_id) || [];
    list.push(ing);
    ingredientsByBp.set(ing.blueprint_id, list);
  }

  // 5. Recursive cost calculation with cycle detection
  const costCache = new Map<string, BlueprintCostResult>();

  function calculateBatchCost(
    blueprintId: string,
    visited: Set<string> = new Set()
  ): BlueprintCostResult {
    if (costCache.has(blueprintId)) return costCache.get(blueprintId)!;
    if (visited.has(blueprintId))
      return { batchCost: 0, missingItems: [], archivedItems: [], unpricedItems: [], isPartial: false };
    visited.add(blueprintId);

    const ingredients = ingredientsByBp.get(blueprintId) || [];
    if (ingredients.length === 0) {
      const result: BlueprintCostResult = { batchCost: 0, missingItems: [], archivedItems: [], unpricedItems: [], isPartial: false };
      costCache.set(blueprintId, result);
      return result;
    }

    let totalBatchCost = 0;
    const missingItems: string[] = [];
    const archivedItems: string[] = [];
    const unpricedItems: string[] = [];

    for (const ing of ingredients) {
      if (ing.ingredient_type === "blueprint" && ing.sub_blueprint_id) {
        // Sub-recipe: get batch cost, divide by yield, multiply by quantity
        const subBp = bpMap.get(ing.sub_blueprint_id);
        if (!subBp) {
          missingItems.push(ing.sub_blueprint_id);
          continue;
        }
        const subResult = calculateBatchCost(ing.sub_blueprint_id, new Set(visited));
        if (subResult.missingItems.length > 0) missingItems.push(...subResult.missingItems);
        if (subResult.archivedItems.length > 0) archivedItems.push(...subResult.archivedItems);
        if (subResult.unpricedItems.length > 0) unpricedItems.push(...subResult.unpricedItems);
        const subYield = subBp.yield_qty || 1;
        const subYieldUnit = normalizeIngUnit(subBp.yield_unit);
        const subExpanded = expandEmbeddedUnit(Number(ing.quantity) || 0, ing.unit);
        const ingUnit = subExpanded.unit;
        const ingQty = subExpanded.qty;
        const costPerYieldUnit = subResult.batchCost / subYield;

        // Convert ingredient quantity to yield units if they differ
        if (ingUnit && subYieldUnit && ingUnit !== subYieldUnit
            && ingUnit !== "ea" && subYieldUnit !== "ea"
            && TO_OZ[ingUnit] && TO_OZ[subYieldUnit]) {
          const ingInYieldUnits = (ingQty * TO_OZ[ingUnit]) / TO_OZ[subYieldUnit];
          totalBatchCost += costPerYieldUnit * ingInYieldUnits;
        } else {
          totalBatchCost += costPerYieldUnit * ingQty;
        }
      } else if (ing.vendor_item_id) {
        // A0: archived brand template — flag separately, don't silently zero out.
        const isArchived = archivedTemplateIds.has(ing.vendor_item_id);
        if (isArchived) {
          archivedItems.push(ing.vendor_item_id);
          continue;
        }

        // Vendor item: resolve brand template ID → local inventory item for cost
        const localId = templateToLocalId.get(ing.vendor_item_id);
        const vendor = localId ? vendorMap.get(localId) : undefined;
        if (!vendor) {
          missingItems.push(ing.vendor_item_id);
          continue;
        }

        const caseCost = vendor.blended_price ?? vendor.cost_per_unit ?? 0;
        if (caseCost === 0) {
          // Intentionally free ingredient (Water, Ice, etc.) — $0 is valid, contributes
          // nothing to batch cost and does NOT flag the recipe as unpriced.
          if (freeTemplateIds.has(ing.vendor_item_id)) {
            continue;
          }
          // A0: item exists & is active but has no resolvable price — flag as data gap.
          unpricedItems.push(ing.vendor_item_id);
          continue;
        }


        // Expand embedded-size units like "bottle(20oz-fl)", "#10can", "pack(9.6lb)"
        // into a base qty + canonical unit before any branch logic. Plain units pass through.
        const expanded = expandEmbeddedUnit(Number(ing.quantity) || 0, ing.unit);
        const ingQty = expanded.qty;
        const ingUnit = expanded.unit;
        const nativeUnit = normalizeIngUnit(vendor.count_unit);

        if (ingUnit === "cs" || ingUnit === "case") {
          totalBatchCost += caseCost * ingQty;
        } else if (ingUnit === "cn" || ingUnit === "can") {
          // Can-based: parse cans per case from pack_size
          const cansPerCase = parseCansPerCase(vendor.pack_size);
          if (cansPerCase && cansPerCase > 0) {
            totalBatchCost += (ingQty / cansPerCase) * caseCost;
          } else {
            const unitsPerCase = vendor.pack_quantity_override || vendor.count_units_per_case || vendor.pack_quantity || 1;
            totalBatchCost += (caseCost / unitsPerCase) * ingQty;
          }
        } else {
          // Pipeline 1 — ing.vendor_item_id is brand_template_id, direct key into conversionMap.
          const brandConversion = conversionMap.get(ing.vendor_item_id);

          const effNativeUnit = normalizeIngUnit(
            brandConversion?.canonical_unit || vendor.count_unit || ""
          );
          const unitsPerCase = brandConversion
            ? (brandConversion.outer_qty * (brandConversion.canonical_qty_per_inner ?? 1))
            : (vendor.pack_quantity || 1);
          const costPerNativeUnit = caseCost / unitsPerCase;

          if (ingUnit === "ea" && effNativeUnit === "ea") {
            totalBatchCost += costPerNativeUnit * ingQty;
          } else if (ingUnit && effNativeUnit && ingUnit === effNativeUnit) {
            totalBatchCost += costPerNativeUnit * ingQty;
          } else if (ingUnit && effNativeUnit && ingUnit !== effNativeUnit && TO_OZ[ingUnit] && TO_OZ[effNativeUnit]) {
            const ingInNative = (ingQty * TO_OZ[ingUnit]) / TO_OZ[effNativeUnit];
            totalBatchCost += costPerNativeUnit * ingInNative;
          } else if (!effNativeUnit && TO_OZ[ingUnit] && !brandConversion) {
            // Legacy fallback: derive cost per oz from pack_size when no brand conversion exists.
            const totalOz = parsePackSizeToOz(vendor.pack_size);
            if (totalOz && totalOz > 0) {
              totalBatchCost += (caseCost / totalOz) * ingQty * TO_OZ[ingUnit];
            } else {
              missingItems.push(ing.vendor_item_id || "unknown");
            }
          } else if (!effNativeUnit && ingUnit === "ea") {
            totalBatchCost += costPerNativeUnit * ingQty;
          } else {
            missingItems.push(ing.vendor_item_id || "unknown");
          }
        }
      }
    }

    const result: BlueprintCostResult = {
      batchCost: totalBatchCost,
      missingItems,
      archivedItems,
      unpricedItems,
      isPartial:
        missingItems.length > 0 || archivedItems.length > 0 || unpricedItems.length > 0,
    };
    costCache.set(blueprintId, result);
    return result;
  }

  // 6. Calculate costs for all blueprints
  const results = new Map<string, BlueprintCostResult>();
  for (const bp of bpList) {
    results.set(bp.id, calculateBatchCost(bp.id));
  }

  return results;
}

/**
 * Given a blueprint's batch cost and yield quantity, returns the cost per single output unit.
 */
export function getBlueprintUnitCost(batchCost: number, yieldQty: number | null): number {
  if (!yieldQty || yieldQty === 0) return batchCost;
  return batchCost / yieldQty;
}

// Helper: parse cans per case from pack_size like "6/#10 CN"
function parseCansPerCase(packSize: string | null): number | null {
  if (!packSize) return null;
  const match = packSize.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]*)$/);
  if (match) return parseInt(match[1]);
  return null;
}
