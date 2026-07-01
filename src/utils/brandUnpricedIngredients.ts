import { supabase } from "@/integrations/supabase/client";

/**
 * A2: Surface brand-level "unpriced" ingredients diagnostically.
 *
 * An ingredient is **unpriced** when:
 *  - the brand template is active (status='active' or null)
 *  - it is referenced as a vendor_item by ≥ 1 active recipe blueprint (brand or local)
 *  - across ALL deployments to locations, no inventory_items row has a non-zero
 *    blended_price or cost_per_unit
 *
 * No fallback price field exists. This is purely a report — fix actions are:
 *  - Re-sync vendor pricing (PFG/PA)
 *  - Archive the template
 */

export interface UnpricedIngredient {
  templateId: string;
  name: string;
  category: string | null;
  deploymentCount: number;
  /** Most recent non-zero unit_price from vendor_invoice_items (or null) */
  lastKnownPrice: number | null;
  lastKnownPriceDate: string | null;
  /** Active blueprints that reference this template */
  recipes: { blueprintId: string; name: string }[];
}

export async function fetchBrandUnpricedIngredients(
  brandId: string
): Promise<UnpricedIngredient[]> {
  // 1. All active brand templates for this brand
  const { data: templates, error: tplErr } = await supabase
    .from("brand_inventory_templates")
    .select("id, common_name, product_name, category, status, is_free")
    .eq("brand_id", brandId);

  if (tplErr) throw tplErr;

  const activeTemplates = (templates || []).filter(
    (t) => !t.status || t.status === "active"
  );
  if (activeTemplates.length === 0) return [];

  const tplIds = activeTemplates.map((t) => t.id);
  const tplById = new Map(activeTemplates.map((t) => [t.id, t]));

  // 2. Find blueprints that reference these templates
  const referencedTemplateIds = new Set<string>();
  const recipesByTemplate = new Map<string, { blueprintId: string; name: string }[]>();

  // page-load to avoid 1k cap
  const PAGE = 1000;
  let from = 0;
  const allIngs: { blueprint_id: string; vendor_item_id: string }[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("recipe_blueprint_ingredients" as any)
      .select("blueprint_id, vendor_item_id")
      .in("vendor_item_id", tplIds)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as any[];
    if (!rows.length) break;
    allIngs.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  if (allIngs.length === 0) return [];

  const bpIds = Array.from(new Set(allIngs.map((i) => i.blueprint_id)));
  const { data: bps, error: bpErr } = await supabase
    .from("recipe_blueprints" as any)
    .select("id, name, is_active")
    .in("id", bpIds);
  if (bpErr) throw bpErr;
  const activeBpById = new Map<string, string>();
  for (const b of (bps || []) as any[]) {
    if (b.is_active !== false) activeBpById.set(b.id, b.name);
  }

  for (const ing of allIngs) {
    if (!activeBpById.has(ing.blueprint_id)) continue;
    referencedTemplateIds.add(ing.vendor_item_id);
    const list = recipesByTemplate.get(ing.vendor_item_id) || [];
    if (!list.find((r) => r.blueprintId === ing.blueprint_id)) {
      list.push({
        blueprintId: ing.blueprint_id,
        name: activeBpById.get(ing.blueprint_id)!,
      });
    }
    recipesByTemplate.set(ing.vendor_item_id, list);
  }

  if (referencedTemplateIds.size === 0) return [];

  const refIds = Array.from(referencedTemplateIds);

  // 3. Resolve all deployments → inventory_items, find which templates have NO priced row
  const { data: deps, error: depErr } = await supabase
    .from("brand_inventory_deployments")
    .select("template_id, inventory_item_id")
    .in("template_id", refIds);
  if (depErr) throw depErr;

  const deploymentsByTemplate = new Map<string, string[]>();
  const allItemIds: string[] = [];
  for (const d of deps || []) {
    const list = deploymentsByTemplate.get(d.template_id) || [];
    list.push(d.inventory_item_id);
    deploymentsByTemplate.set(d.template_id, list);
    allItemIds.push(d.inventory_item_id);
  }

  // Pricing per inventory_item
  const pricedItemIds = new Set<string>();
  if (allItemIds.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < allItemIds.length; i += CHUNK) {
      const slice = allItemIds.slice(i, i + CHUNK);
      const { data: items, error: itemErr } = await supabase
        .from("inventory_items")
        .select("id, cost_per_unit, blended_price")
        .in("id", slice);
      if (itemErr) throw itemErr;
      for (const it of items || []) {
        const cost = (it.blended_price ?? 0) || (it.cost_per_unit ?? 0);
        if (cost > 0) pricedItemIds.add(it.id);
      }
    }
  }

  const unpricedTemplateIds = refIds.filter((tid) => {
    // Skip intentionally free ingredients (Water, Ice, etc.)
    if ((tplById.get(tid) as any)?.is_free === true) return false;
    const items = deploymentsByTemplate.get(tid) || [];
    // unpriced if there are no priced deployments (includes 0-deployment case)
    return !items.some((iid) => pricedItemIds.has(iid));
  });


  if (unpricedTemplateIds.length === 0) return [];

  // 4. Last known invoice price per template (most recent non-zero)
  const lastKnownByTemplate = new Map<string, { price: number; date: string }>();
  const CHUNK = 200;
  for (let i = 0; i < unpricedTemplateIds.length; i += CHUNK) {
    const slice = unpricedTemplateIds.slice(i, i + CHUNK);
    const { data: invItems } = await supabase
      .from("vendor_invoice_items" as any)
      .select("matched_template_id, unit_price, created_at")
      .in("matched_template_id", slice)
      .gt("unit_price", 0)
      .order("created_at", { ascending: false })
      .limit(1000);
    for (const r of (invItems || []) as any[]) {
      if (!lastKnownByTemplate.has(r.matched_template_id)) {
        lastKnownByTemplate.set(r.matched_template_id, {
          price: Number(r.unit_price),
          date: r.created_at,
        });
      }
    }
  }

  // 5. Build report
  const out: UnpricedIngredient[] = unpricedTemplateIds.map((tid) => {
    const tpl = tplById.get(tid)!;
    const last = lastKnownByTemplate.get(tid);
    return {
      templateId: tid,
      name: tpl.common_name || tpl.product_name || tid,
      category: tpl.category,
      deploymentCount: (deploymentsByTemplate.get(tid) || []).length,
      lastKnownPrice: last?.price ?? null,
      lastKnownPriceDate: last?.date ?? null,
      recipes: recipesByTemplate.get(tid) || [],
    };
  });

  out.sort((a, b) => b.recipes.length - a.recipes.length);
  return out;
}
