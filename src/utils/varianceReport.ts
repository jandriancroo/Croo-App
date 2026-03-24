import { supabase } from "@/integrations/supabase/client";
import { reconcileSaladGroup, getReconciliationGroups } from "./saladReconciliation";

// ─── Unit conversion (shared with blueprintCostCalculation) ───
const TO_OZ: Record<string, number> = {
  oz: 1, qt: 32, lb: 16, gal: 128, tbsp: 0.5, tsp: 0.1667, ml: 0.033814, cups: 8, ea: 1, kg: 35.274, g: 0.03527,
};
const UNIT_ALIASES: Record<string, string> = {
  "oz-wt": "oz", "oz-fl": "oz", "fl-oz": "oz", "gram": "g", "grams": "g",
  "each": "ea", "count": "ea", "case": "cs", "cases": "cs", "can": "cn", "cans": "cn",
  "quart": "qt", "gallon": "gal", "gallons": "gal", "lbs": "lb", "pound": "lb", "pounds": "lb",
};
function norm(u: string | null | undefined): string {
  if (!u) return "";
  const c = u.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
  if (UNIT_ALIASES[c]) return UNIT_ALIASES[c];
  if (c.startsWith("case")) return "cs";
  if (c.startsWith("pack")) return "cs";
  if (c.includes("oz")) return "oz";
  if (c.includes("gram")) return "g";
  if (c.includes("gallon")) return "gal";
  if (c.includes("lb") || c.includes("pound")) return "lb";
  return c;
}
function parseCansPerCase(ps: string | null): number | null {
  if (!ps) return null;
  const m = ps.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
  return m ? parseInt(m[1]) : null;
}

// ─── Types ───
export interface VarianceItemRow {
  itemId: string;
  itemName: string;
  beginningQty: number;
  endingQty: number;
  beginningValue: number;
  purchaseValue: number;
  endingValue: number;
  actualUsage: number;
  theoreticalValue: number;
  varianceValue: number;
}

export interface VarianceCategoryRow {
  category: string;
  beginningValue: number;
  purchaseValue: number;
  endingValue: number;
  actualUsage: number;
  actualPct: number;
  theoreticalValue: number;
  theoreticalPct: number;
  varianceValue: number;
  variancePct: number;
  items: VarianceItemRow[];
}

export interface UnmappedPosItem {
  itemName: string;
  category: string;
  unitsSold: number;
}

export interface VarianceReportData {
  rows: VarianceCategoryRow[];
  totals: {
    beginningValue: number;
    purchaseValue: number;
    endingValue: number;
    actualUsage: number;
    actualPct: number;
    theoreticalValue: number;
    theoreticalPct: number;
    varianceValue: number;
    variancePct: number;
  };
  netSales: number;
  mappingCoverage: { mapped: number; total: number };
  unmappedPosItems: UnmappedPosItem[];
}

// ─── Main calculation ───
export async function calculateVarianceReport(
  endingCountId: string,
  beginningCountId: string,
  locationId: string,
  periodStartDate: string,
  periodEndDate: string
): Promise<VarianceReportData> {
  // Parallel data fetches
  const [
    endingItems,
    beginningItems,
    salesData,
    pfgOrders,
    paOrders,
    inventoryItems,
    posMappings,
    blueprints,
    allIngredients,
  ] = await Promise.all([
    fetchCountItems(endingCountId),
    fetchCountItems(beginningCountId),
    fetchSalesData(locationId, periodStartDate, periodEndDate),
    fetchPfgOrders(locationId, periodStartDate, periodEndDate),
    fetchPaOrders(locationId, periodStartDate, periodEndDate),
    fetchAllInventoryItems(locationId),
    fetchPosMappings(locationId),
    fetchBlueprints(locationId),
    fetchAllIngredients(locationId),
  ]);

  const netSales = salesData.totalNetSales;

  // Build item lookup maps
  const itemMap = new Map(inventoryItems.map(i => [i.id, i]));
  const itemByNumber = new Map(inventoryItems.filter(i => i.item_number).map(i => [i.item_number!, i.id]));
  const itemByPaId = new Map(inventoryItems.filter(i => i.pa_item_id).map(i => [i.pa_item_id!, i.id]));

  // ─── Per-item tracking ───
  const itemActual = new Map<string, { beginning: number; purchases: number; ending: number; beginningQty: number; endingQty: number }>();
  const getOrCreateItem = (itemId: string) => {
    if (!itemActual.has(itemId)) itemActual.set(itemId, { beginning: 0, purchases: 0, ending: 0, beginningQty: 0, endingQty: 0 });
    return itemActual.get(itemId)!;
  };

  const getItemUnitValue = (itemId: string) => {
    const item = itemMap.get(itemId);
    if (!item) return 0;
    const packQty = item.pack_quantity_override ?? item.pack_quantity ?? 1;
    return (item.cost_per_unit || 0) / Math.max(packQty, 1);
  };

  const getItemCategory = (itemId: string) => {
    const cat = itemMap.get(itemId)?.category || "Other";
    // Roll "MI" into "Other" — MI is a recipe/menu-item designation, not a real inventory category
    if (cat === "MI") return "Other";
    return cat;
  };

  const isRecipeItem = (itemId: string) => {
    return itemMap.get(itemId)?.is_recipe === true;
  };

  // Beginning count values — aggregate duplicate item_id rows (multiple storage locations)
  for (const ci of beginningItems) {
    if (isRecipeItem(ci.item_id)) continue;
    const entry = getOrCreateItem(ci.item_id);
    entry.beginningQty += ci.quantity;
    entry.beginning += ci.quantity * getItemUnitValue(ci.item_id);
  }

  // Ending count values
  for (const ci of endingItems) {
    if (isRecipeItem(ci.item_id)) continue;
    const entry = getOrCreateItem(ci.item_id);
    entry.endingQty += ci.quantity;
    entry.ending += ci.quantity * getItemUnitValue(ci.item_id);
  }

  // Purchases - match PFG items by item_number
  for (const order of pfgOrders) {
    if (!order.items) continue;
    const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
    for (const li of items) {
      const invItemId = itemByNumber.get(String(li.itemNumber || li.productId));
      if (invItemId) {
        getOrCreateItem(invItemId).purchases += Number(li.total) || 0;
      } else {
        // Unmatched PFG item — add to a generic "Other" bucket
        const key = `__pfg_unmatched_${li.itemNumber || li.productId}`;
        if (!itemActual.has(key)) {
          itemActual.set(key, { beginning: 0, purchases: 0, ending: 0, beginningQty: 0, endingQty: 0 });
        }
        itemActual.get(key)!.purchases += Number(li.total) || 0;
      }
    }
  }

  // Purchases - match PA items by pa_product_id
  for (const order of paOrders) {
    if (!order.items) continue;
    const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
    for (const li of items) {
      const invItemId = itemByPaId.get(String(li.pa_product_id || li.item_code));
      if (invItemId) {
        getOrCreateItem(invItemId).purchases += Number(li.total) || 0;
      }
    }
  }

  // ─── 2. THEORETICAL USAGE by item (blueprint tree-walk) ───
  const bpMap = new Map(blueprints.map(b => [b.id, b]));
  const ingByBp = new Map<string, typeof allIngredients>();
  for (const ing of allIngredients) {
    const list = ingByBp.get(ing.blueprint_id) || [];
    list.push(ing);
    ingByBp.set(ing.blueprint_id, list);
  }

  // Get units sold per POS mapping from product_mix & track ALL POS items
  const unitsSoldByMapping = new Map<string, number>();
  const allPosItemsSold = new Map<string, { category: string; quantity: number }>();
  const matchedPosItemNames = new Set<string>();

  // First pass: aggregate all POS items sold
  for (const day of salesData.dailyMix) {
    for (const mixItem of day) {
      const key = mixItem.itemName;
      if (!key) continue;
      const existing = allPosItemsSold.get(key);
      if (existing) {
        existing.quantity += mixItem.quantity;
      } else {
        allPosItemsSold.set(key, { category: mixItem.category, quantity: mixItem.quantity });
      }
    }
  }

  // ─── RECONCILIATION ENGINE ───
  // Run salad (and any future) reconciliation groups BEFORE the standard mapping loop.
  // This produces blueprint-level depletions and marks POS items as consumed so they
  // aren't double-counted by the standard 1:1 mapping logic below.
  const reconciliationGroups = getReconciliationGroups(posMappings);
  const reconciledPosItems = new Set<string>();
  const reconciliationDepletions = new Map<string, number>();

  for (const groupName of reconciliationGroups) {
    const result = reconcileSaladGroup(posMappings, salesData.dailyMix, groupName);

    // Merge consumed POS items
    result.consumedPosItems.forEach(posItem => {
      reconciledPosItems.add(posItem);
      matchedPosItemNames.add(posItem);
    });

    // Merge depletions (blueprint_id → units)
    result.depletions.forEach((qty, bpId) => {
      reconciliationDepletions.set(bpId, (reconciliationDepletions.get(bpId) || 0) + qty);
    });

    // Log reconciliation debug info
    if (result.debug.namedParentSales.length > 0 || result.debug.genericAllocations.length > 0) {
      console.log(`[variance] Reconciliation group "${groupName}":`, {
        namedParents: result.debug.namedParentSales,
        modSubtractions: result.debug.modSubtractions,
        pmix: result.debug.pmix,
        genericAllocations: result.debug.genericAllocations,
      });
    }
  }

  // Second pass: match against POS mappings (standard 1:1 direct mappings only)
  for (const mapping of posMappings) {
    if (!mapping.blueprint_id) continue;
    // Skip reconciliation-managed mappings — they were handled above
    if (mapping.mapping_type !== "direct") continue;

    let sold = 0;
    const posCats = mapping.pos_categories || [];
    const posItems = mapping.pos_items || [];

    for (const day of salesData.dailyMix) {
      for (const mixItem of day) {
        // Skip POS items already consumed by reconciliation
        if (reconciledPosItems.has(mixItem.itemName)) continue;

        const matchesCat = posCats.length > 0 && posCats.includes(mixItem.category);
        const matchesItem = posItems.length > 0 && posItems.includes(mixItem.itemName);
        if (matchesCat || matchesItem) {
          sold += mixItem.quantity;
          if (mixItem.itemName) matchedPosItemNames.add(mixItem.itemName);
        }
      }
    }
    if (sold > 0) unitsSoldByMapping.set(mapping.id, sold);
  }

  // Resolve each blueprint to vendor-item cost breakdown
  const costBreakdownCache = new Map<string, Map<string, number>>();

  function resolveBreakdown(bpId: string, visited = new Set<string>()): Map<string, number> {
    if (costBreakdownCache.has(bpId)) return costBreakdownCache.get(bpId)!;
    if (visited.has(bpId)) return new Map();
    visited.add(bpId);

    const breakdown = new Map<string, number>();
    const ingredients = ingByBp.get(bpId) || [];

    for (const ing of ingredients) {
      if (ing.ingredient_type === "blueprint" && ing.sub_blueprint_id) {
        const subBp = bpMap.get(ing.sub_blueprint_id);
        if (!subBp) continue;
        const subBreakdown = resolveBreakdown(ing.sub_blueprint_id, new Set(visited));
        const subYield = subBp.yield_qty || 1;
        const ingUnit = norm(ing.unit);
        const subYieldUnit = norm(subBp.yield_unit);

        let scale = ing.quantity / subYield;
        if (ingUnit && subYieldUnit && ingUnit !== subYieldUnit
            && ingUnit !== "ea" && subYieldUnit !== "ea"
            && TO_OZ[ingUnit] && TO_OZ[subYieldUnit]) {
          scale = (ing.quantity * TO_OZ[ingUnit]) / (subYield * TO_OZ[subYieldUnit]);
        }

        for (const [itemId, cost] of subBreakdown) {
          breakdown.set(itemId, (breakdown.get(itemId) || 0) + cost * scale);
        }
      } else if (ing.vendor_item_id) {
        const vendor = itemMap.get(ing.vendor_item_id);
        if (!vendor || !vendor.cost_per_unit) continue;

        const caseCost = vendor.blended_price ?? vendor.cost_per_unit ?? 0;
        if (caseCost === 0) continue;
        const ingUnit = norm(ing.unit);
        const nativeUnit = norm(vendor.count_unit);
        let cost = 0;

        if (ingUnit === "cs" || ingUnit === "case") {
          cost = caseCost * ing.quantity;
        } else if (ingUnit === "cn" || ingUnit === "can") {
          const cpc = parseCansPerCase(vendor.pack_size);
          if (cpc && cpc > 0) {
            cost = (ing.quantity / cpc) * caseCost;
          } else {
            const upc = vendor.count_units_per_case || vendor.pack_quantity || 1;
            cost = (caseCost / upc) * ing.quantity;
          }
        } else {
          const upc = vendor.count_units_per_case || vendor.pack_quantity || 1;
          const cpnu = caseCost / upc;
          if (ingUnit && nativeUnit && ingUnit !== nativeUnit && TO_OZ[ingUnit] && TO_OZ[nativeUnit]) {
            const inNative = (ing.quantity * TO_OZ[ingUnit]) / TO_OZ[nativeUnit];
            cost = cpnu * inNative;
          } else {
            cost = cpnu * ing.quantity;
          }
        }

        breakdown.set(ing.vendor_item_id, (breakdown.get(ing.vendor_item_id) || 0) + cost);
      }
    }

    costBreakdownCache.set(bpId, breakdown);
    return breakdown;
  }

  // Aggregate theoretical cost per item
  const itemTheoretical = new Map<string, number>();
  let mappedCount = 0;

  // Process standard 1:1 direct mappings
  for (const mapping of posMappings) {
    if (!mapping.blueprint_id) continue;
    if (mapping.mapping_type !== "direct") continue;
    const unitsSold = unitsSoldByMapping.get(mapping.id);
    if (!unitsSold) continue;

    mappedCount++;
    const bp = bpMap.get(mapping.blueprint_id);
    if (!bp) continue;
    const yieldQty = bp.yield_qty || 1;
    const breakdown = resolveBreakdown(mapping.blueprint_id);

    for (const [itemId, batchCost] of breakdown) {
      const theoreticalCost = (batchCost / yieldQty) * unitsSold;
      itemTheoretical.set(itemId, (itemTheoretical.get(itemId) || 0) + theoreticalCost);
    }
  }

  // Process reconciliation depletions (salad engine output)
  reconciliationDepletions.forEach((unitsSold, bpId) => {
    mappedCount++;
    const bp = bpMap.get(bpId);
    if (!bp) return;
    const yieldQty = bp.yield_qty || 1;
    const breakdown = resolveBreakdown(bpId);

    breakdown.forEach((batchCost, itemId) => {
      const theoreticalCost = (batchCost / yieldQty) * unitsSold;
      itemTheoretical.set(itemId, (itemTheoretical.get(itemId) || 0) + theoreticalCost);
    });
  });

  // ─── 3. Build rows by category with item detail ───
  const catMap = new Map<string, { items: Map<string, VarianceItemRow> }>();

  // Process all items that have any actual data
  for (const [itemId, actual] of itemActual) {
    // Skip unmatched purchase placeholders for now
    if (itemId.startsWith("__pfg_unmatched_")) continue;

    const cat = getItemCategory(itemId);
    const item = itemMap.get(itemId);
    const itemName = item?.common_name || item?.name || itemId;
    const theo = itemTheoretical.get(itemId) || 0;
    const actualUsage = actual.beginning + actual.purchases - actual.ending;

    if (!catMap.has(cat)) catMap.set(cat, { items: new Map() });
    const catEntry = catMap.get(cat)!;

    if (catEntry.items.has(itemId)) {
      const existing = catEntry.items.get(itemId)!;
      existing.beginningQty += actual.beginningQty;
      existing.endingQty += actual.endingQty;
      existing.beginningValue += actual.beginning;
      existing.purchaseValue += actual.purchases;
      existing.endingValue += actual.ending;
      existing.actualUsage += actualUsage;
      existing.theoreticalValue += theo;
      existing.varianceValue += actualUsage - theo;
    } else {
      catEntry.items.set(itemId, {
        itemId,
        itemName,
        beginningQty: actual.beginningQty,
        endingQty: actual.endingQty,
        beginningValue: round2(actual.beginning),
        purchaseValue: round2(actual.purchases),
        endingValue: round2(actual.ending),
        actualUsage: round2(actualUsage),
        theoreticalValue: round2(theo),
        varianceValue: round2(actualUsage - theo),
      });
    }
  }

  // Also add items that only have theoretical usage (mapped via POS but not in actual counts)
  for (const [itemId, theo] of itemTheoretical) {
    if (isRecipeItem(itemId)) continue;
    if (itemActual.has(itemId)) continue; // already handled above
    const cat = getItemCategory(itemId);
    const item = itemMap.get(itemId);
    const itemName = item?.common_name || item?.name || itemId;

    if (!catMap.has(cat)) catMap.set(cat, { items: new Map() });
    catMap.get(cat)!.items.set(itemId, {
      itemId,
      itemName,
      beginningQty: 0,
      endingQty: 0,
      beginningValue: 0,
      purchaseValue: 0,
      endingValue: 0,
      actualUsage: 0,
      theoreticalValue: round2(theo),
      varianceValue: round2(-theo),
    });
  }

  const rows: VarianceCategoryRow[] = [];
  let totalBeginning = 0, totalPurchases = 0, totalEnding = 0, totalActual = 0, totalTheoretical = 0;

  for (const [cat, catData] of catMap) {
    const itemRows = Array.from(catData.items.values());
    // Sort items by absolute variance descending
    itemRows.sort((a, b) => Math.abs(b.varianceValue) - Math.abs(a.varianceValue));

    let catBeginning = 0, catPurchases = 0, catEnding = 0, catActualUsage = 0, catTheo = 0;
    for (const item of itemRows) {
      catBeginning += item.beginningValue;
      catPurchases += item.purchaseValue;
      catEnding += item.endingValue;
      catActualUsage += item.actualUsage;
      catTheo += item.theoreticalValue;
    }

    totalBeginning += catBeginning;
    totalPurchases += catPurchases;
    totalEnding += catEnding;
    totalActual += catActualUsage;
    totalTheoretical += catTheo;

    const variance = catActualUsage - catTheo;

    rows.push({
      category: cat,
      beginningValue: round2(catBeginning),
      purchaseValue: round2(catPurchases),
      endingValue: round2(catEnding),
      actualUsage: round2(catActualUsage),
      actualPct: netSales > 0 ? round2((catActualUsage / netSales) * 100) : 0,
      theoreticalValue: round2(catTheo),
      theoreticalPct: netSales > 0 ? round2((catTheo / netSales) * 100) : 0,
      varianceValue: round2(variance),
      variancePct: netSales > 0 ? round2((variance / netSales) * 100) : 0,
      items: itemRows,
    });
  }

  // Sort by actual usage descending
  rows.sort((a, b) => Math.abs(b.actualUsage) - Math.abs(a.actualUsage));

  const totalVariance = totalActual - totalTheoretical;

  // Build unmapped POS items list
  const unmappedPosItems: UnmappedPosItem[] = [];
  for (const [itemName, info] of allPosItemsSold) {
    if (!matchedPosItemNames.has(itemName) && info.quantity > 0) {
      unmappedPosItems.push({
        itemName,
        category: info.category || "Uncategorized",
        unitsSold: info.quantity,
      });
    }
  }
  // Sort by units sold descending
  unmappedPosItems.sort((a, b) => b.unitsSold - a.unitsSold);

  return {
    rows,
    totals: {
      beginningValue: round2(totalBeginning),
      purchaseValue: round2(totalPurchases),
      endingValue: round2(totalEnding),
      actualUsage: round2(totalActual),
      actualPct: netSales > 0 ? round2((totalActual / netSales) * 100) : 0,
      theoreticalValue: round2(totalTheoretical),
      theoreticalPct: netSales > 0 ? round2((totalTheoretical / netSales) * 100) : 0,
      varianceValue: round2(totalVariance),
      variancePct: netSales > 0 ? round2((totalVariance / netSales) * 100) : 0,
    },
    netSales: round2(netSales),
    mappingCoverage: { mapped: mappedCount, total: posMappings.filter(m => m.blueprint_id).length },
    unmappedPosItems,
  };
}

// ─── Data fetchers ───
async function fetchCountItems(countId: string) {
  const { data, error } = await supabase
    .from("inventory_count_items")
    .select("item_id, quantity")
    .eq("count_id", countId);
  if (error) throw error;
  return data || [];
}

async function fetchSalesData(locationId: string, start: string, end: string) {
  const { data, error } = await supabase
    .from("sales_cache")
    .select("net_sales, product_mix")
    .eq("location_id", locationId)
    .gte("sale_date", start)
    .lte("sale_date", end);
  if (error) throw error;

  let totalNetSales = 0;
  const dailyMix: Array<Array<{ category: string; itemName: string; quantity: number }>> = [];

  for (const row of data || []) {
    totalNetSales += Number(row.net_sales) || 0;
    if (row.product_mix) {
      const mix = typeof row.product_mix === "string" ? JSON.parse(row.product_mix) : row.product_mix;
      if (Array.isArray(mix)) {
        dailyMix.push(
          mix.map((m: any) => ({
            category: m.category || "",
            itemName: m.itemName || m.item_name || "",
            quantity: Number(m.quantity) || 0,
          }))
        );
      }
    }
  }
  return { totalNetSales, dailyMix };
}

async function fetchPfgOrders(locationId: string, start: string, end: string) {
  const { data, error } = await supabase
    .from("pfg_orders")
    .select("items, total_amount")
    .eq("location_id", locationId)
    .gte("delivery_date", start)
    .lte("delivery_date", end);
  if (error) throw error;
  return data || [];
}

async function fetchPaOrders(locationId: string, start: string, end: string) {
  const { data, error } = await supabase
    .from("pa_orders")
    .select("items, total_amount")
    .eq("location_id", locationId)
    .gte("delivery_date", start)
    .lte("delivery_date", end);
  if (error) throw error;
  return data || [];
}

async function fetchAllInventoryItems(locationId: string) {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, name, common_name, category, cost_per_unit, blended_price, pack_quantity, pack_quantity_override, pack_size, item_number, pa_item_id, count_unit, count_units_per_case, is_recipe")
    .eq("location_id", locationId);
  if (error) throw error;
  return data || [];
}

async function fetchPosMappings(locationId: string) {
  const { data, error } = await supabase
    .from("inventory_product_groups")
    .select("id, name, blueprint_id, pos_categories, pos_items, mapping_type, reconciliation_group")
    .eq("location_id", locationId)
    .eq("is_active", true);
  if (error) throw error;
  return (data || []).map(d => ({
    ...d,
    mapping_type: (d as any).mapping_type || "direct",
    reconciliation_group: (d as any).reconciliation_group || null,
  }));
}

async function fetchBlueprints(locationId: string) {
  const { data, error } = await supabase
    .from("recipe_blueprints" as any)
    .select("id, yield_qty, yield_unit, produces_item_id")
    .eq("location_id", locationId)
    .eq("is_active", true);
  if (error) throw error;
  return (data || []) as unknown as Array<{ id: string; yield_qty: number | null; yield_unit: string | null; produces_item_id: string | null }>;
}

async function fetchAllIngredients(_locationId: string) {
  // Paginate to handle >1000 ingredients
  const all: Array<{ blueprint_id: string; ingredient_type: string; vendor_item_id: string | null; sub_blueprint_id: string | null; quantity: number; unit: string | null }> = [];
  let offset = 0;
  const PAGE = 500;

  while (true) {
    const { data, error } = await supabase
      .from("recipe_blueprint_ingredients" as any)
      .select("blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id, quantity, unit")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as any[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}