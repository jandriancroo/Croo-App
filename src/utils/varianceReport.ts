import { supabase } from "@/integrations/supabase/client";

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

  // ─── 1. ACTUAL USAGE by category ───
  const catActual = new Map<string, { beginning: number; purchases: number; ending: number }>();
  const getOrCreate = (cat: string) => {
    if (!catActual.has(cat)) catActual.set(cat, { beginning: 0, purchases: 0, ending: 0 });
    return catActual.get(cat)!;
  };

  const getItemValue = (itemId: string, qty: number) => {
    const item = itemMap.get(itemId);
    if (!item) return 0;
    const packQty = item.pack_quantity_override ?? item.pack_quantity ?? 1;
    return qty * ((item.cost_per_unit || 0) / Math.max(packQty, 1));
  };

  const getItemCategory = (itemId: string) => {
    return itemMap.get(itemId)?.category || "Other";
  };

  // Beginning count values
  for (const ci of beginningItems) {
    const cat = getItemCategory(ci.item_id);
    getOrCreate(cat).beginning += getItemValue(ci.item_id, ci.quantity);
  }

  // Ending count values
  for (const ci of endingItems) {
    const cat = getItemCategory(ci.item_id);
    getOrCreate(cat).ending += getItemValue(ci.item_id, ci.quantity);
  }

  // Purchases - match PFG items by item_number
  for (const order of pfgOrders) {
    if (!order.items) continue;
    const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
    for (const li of items) {
      const invItemId = itemByNumber.get(String(li.itemNumber || li.productId));
      const cat = invItemId ? getItemCategory(invItemId) : "Other";
      getOrCreate(cat).purchases += Number(li.total) || 0;
    }
  }

  // Purchases - match PA items by pa_product_id
  for (const order of paOrders) {
    if (!order.items) continue;
    const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
    for (const li of items) {
      const invItemId = itemByPaId.get(String(li.pa_product_id || li.item_code));
      const cat = invItemId ? getItemCategory(invItemId) : "Produce";
      getOrCreate(cat).purchases += Number(li.total) || 0;
    }
  }

  // ─── 2. THEORETICAL USAGE by category (blueprint tree-walk) ───
  const bpMap = new Map(blueprints.map(b => [b.id, b]));
  const ingByBp = new Map<string, typeof allIngredients>();
  for (const ing of allIngredients) {
    const list = ingByBp.get(ing.blueprint_id) || [];
    list.push(ing);
    ingByBp.set(ing.blueprint_id, list);
  }

  // Get units sold per POS mapping from product_mix
  const unitsSoldByMapping = new Map<string, number>();
  for (const mapping of posMappings) {
    if (!mapping.blueprint_id) continue;
    let sold = 0;
    const posCats = mapping.pos_categories || [];
    const posItems = mapping.pos_items || [];

    for (const day of salesData.dailyMix) {
      for (const mixItem of day) {
        const matchesCat = posCats.length > 0 && posCats.includes(mixItem.category);
        const matchesItem = posItems.length > 0 && posItems.includes(mixItem.itemName);
        if (matchesCat || matchesItem) {
          sold += mixItem.quantity;
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

  // Aggregate theoretical cost by category
  const catTheoretical = new Map<string, number>();
  let mappedCount = 0;

  for (const mapping of posMappings) {
    if (!mapping.blueprint_id) continue;
    const unitsSold = unitsSoldByMapping.get(mapping.id);
    if (!unitsSold) continue;

    mappedCount++;
    const bp = bpMap.get(mapping.blueprint_id);
    if (!bp) continue;
    const yieldQty = bp.yield_qty || 1;
    const breakdown = resolveBreakdown(mapping.blueprint_id);

    for (const [itemId, batchCost] of breakdown) {
      const cat = getItemCategory(itemId);
      const theoreticalCost = (batchCost / yieldQty) * unitsSold;
      catTheoretical.set(cat, (catTheoretical.get(cat) || 0) + theoreticalCost);
    }
  }

  // ─── 3. Build rows ───
  const allCategories = new Set([...catActual.keys(), ...catTheoretical.keys()]);
  const rows: VarianceCategoryRow[] = [];
  let totalBeginning = 0, totalPurchases = 0, totalEnding = 0, totalActual = 0, totalTheoretical = 0;

  for (const cat of allCategories) {
    const actual = catActual.get(cat) || { beginning: 0, purchases: 0, ending: 0 };
    const theoretical = catTheoretical.get(cat) || 0;
    const actualUsage = actual.beginning + actual.purchases - actual.ending;

    totalBeginning += actual.beginning;
    totalPurchases += actual.purchases;
    totalEnding += actual.ending;
    totalActual += actualUsage;
    totalTheoretical += theoretical;

    rows.push({
      category: cat,
      beginningValue: round2(actual.beginning),
      purchaseValue: round2(actual.purchases),
      endingValue: round2(actual.ending),
      actualUsage: round2(actualUsage),
      actualPct: netSales > 0 ? round2((actualUsage / netSales) * 100) : 0,
      theoreticalValue: round2(theoretical),
      theoreticalPct: netSales > 0 ? round2((theoretical / netSales) * 100) : 0,
      varianceValue: round2(actualUsage - theoretical),
      variancePct: netSales > 0 ? round2(((actualUsage - theoretical) / netSales) * 100) : 0,
    });
  }

  // Sort by actual usage descending
  rows.sort((a, b) => Math.abs(b.actualUsage) - Math.abs(a.actualUsage));

  const totalVariance = totalActual - totalTheoretical;

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
    .select("id, name, category, cost_per_unit, blended_price, pack_quantity, pack_quantity_override, pack_size, item_number, pa_item_id, count_unit, count_units_per_case")
    .eq("location_id", locationId);
  if (error) throw error;
  return data || [];
}

async function fetchPosMappings(locationId: string) {
  const { data, error } = await supabase
    .from("inventory_product_groups")
    .select("id, name, blueprint_id, pos_categories, pos_items")
    .eq("location_id", locationId)
    .eq("is_active", true);
  if (error) throw error;
  return data || [];
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
