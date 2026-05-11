import { supabase } from "@/integrations/supabase/client";
import { fetchBlueprintCosts } from "./blueprintCostCalculation";

/**
 * A1: Aggregates recipe cost data quality across all active recipes for a location.
 *
 * Surfaces three distinct conditions so they're not silently buried as "variance":
 *   - archived: ingredient's brand template was discontinued by HQ (action: re-point recipe)
 *   - unpriced: ingredient is active but has no vendor cost (action: get vendor pricing)
 *   - missing:  ingredient template was never deployed to this location (action: deploy)
 */
export interface RecipeDataIssue {
  blueprintId: string;
  recipeName: string;
  archivedNames: string[];
  unpricedNames: string[];
  missingNames: string[];
}

export interface RecipeDataQualitySummary {
  archivedRecipeCount: number;
  unpricedRecipeCount: number;
  missingRecipeCount: number;
  totalAffectedRecipes: number;
  issues: RecipeDataIssue[];
}

export async function fetchRecipeDataQuality(
  locationId: string
): Promise<RecipeDataQualitySummary> {
  const costMap = await fetchBlueprintCosts(locationId);

  // Collect all referenced template IDs across the three buckets, then resolve names in one batch
  const allTemplateIds = new Set<string>();
  const blueprintIds: string[] = [];
  for (const [bpId, result] of costMap) {
    if (!result.isPartial) continue;
    blueprintIds.push(bpId);
    result.archivedItems.forEach(id => allTemplateIds.add(id));
    result.unpricedItems.forEach(id => allTemplateIds.add(id));
    result.missingItems.forEach(id => allTemplateIds.add(id));
  }

  if (blueprintIds.length === 0) {
    return {
      archivedRecipeCount: 0,
      unpricedRecipeCount: 0,
      missingRecipeCount: 0,
      totalAffectedRecipes: 0,
      issues: [],
    };
  }

  // Recipe names — keyed by blueprint id
  const { data: bpRows } = await supabase
    .from("recipe_blueprints" as any)
    .select("id, name")
    .in("id", blueprintIds);
  const bpNameMap = new Map<string, string>(
    ((bpRows || []) as unknown as Array<{ id: string; name: string }>).map(r => [r.id, r.name])
  );

  // Template names — archived/unpriced/missing IDs are brand_inventory_templates references
  const idArr = Array.from(allTemplateIds);
  const tplNameMap = new Map<string, string>();
  if (idArr.length > 0) {
    const { data: tplRows } = await supabase
      .from("brand_inventory_templates")
      .select("id, common_name, product_name")
      .in("id", idArr);
    for (const t of ((tplRows || []) as unknown as Array<{ id: string; common_name: string | null; product_name: string | null }>)) {
      tplNameMap.set(t.id, t.common_name || t.product_name || t.id);
    }
    // Some IDs may be sub-blueprint refs in the missing bucket — fall back to blueprint table
    const unresolved = idArr.filter(id => !tplNameMap.has(id));
    if (unresolved.length > 0) {
      const { data: subBpRows } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name")
        .in("id", unresolved);
      for (const b of ((subBpRows || []) as unknown as Array<{ id: string; name: string }>)) {
        tplNameMap.set(b.id, b.name);
      }
    }
  }

  let archivedRecipeCount = 0;
  let unpricedRecipeCount = 0;
  let missingRecipeCount = 0;
  const issues: RecipeDataIssue[] = [];

  for (const bpId of blueprintIds) {
    const result = costMap.get(bpId)!;
    const archivedNames = result.archivedItems.map(id => tplNameMap.get(id) || id);
    const unpricedNames = result.unpricedItems.map(id => tplNameMap.get(id) || id);
    const missingNames = result.missingItems.map(id => tplNameMap.get(id) || id);

    if (archivedNames.length > 0) archivedRecipeCount++;
    if (unpricedNames.length > 0) unpricedRecipeCount++;
    if (missingNames.length > 0) missingRecipeCount++;

    issues.push({
      blueprintId: bpId,
      recipeName: bpNameMap.get(bpId) || bpId,
      archivedNames,
      unpricedNames,
      missingNames,
    });
  }

  // Sort by total issues descending so the worst offenders appear first
  issues.sort((a, b) => {
    const aTotal = a.archivedNames.length + a.unpricedNames.length + a.missingNames.length;
    const bTotal = b.archivedNames.length + b.unpricedNames.length + b.missingNames.length;
    return bTotal - aTotal;
  });

  return {
    archivedRecipeCount,
    unpricedRecipeCount,
    missingRecipeCount,
    totalAffectedRecipes: issues.length,
    issues,
  };
}
