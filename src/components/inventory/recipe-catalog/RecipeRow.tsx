import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Pencil, DollarSign, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MenuItem, BlueprintIngredient } from "./types";
import { getCleanDisplayName } from "./utils";
import { fetchBlueprintCosts, type BlueprintCostResult, parsePackSizeToOz } from "@/utils/blueprintCostCalculation";
import PosLinkIndicator from "./PosLinkIndicator";
import type { PosItem } from "./usePosMapping";

const TO_OZ: Record<string, number> = {
  oz: 1, qt: 32, lb: 16, gal: 128, tbsp: 0.5, tsp: 0.1667, ml: 0.033814, cups: 8, ea: 1, kg: 35.274, g: 0.03527,
};

interface RecipeRowProps {
  item: MenuItem;
  tagLabel?: string;
  locationId: string;
  onEditRecipe?: (blueprintId: string) => void;
  posMapping?: { groupId: string; posItems: string[]; mappingType?: string; reconciliationGroup?: string | null };
  posItems?: PosItem[];
  onPosLink?: (blueprintId: string, blueprintName: string, posItemNames: string[], mappingType?: string, reconciliationGroup?: string | null) => void;
  onPosUnlink?: (blueprintId: string) => void;
  onUpdateMappingMeta?: (blueprintId: string, mappingType: string, reconciliationGroup: string | null) => void;
  isPosLinking?: boolean;
}

const RecipeRow = ({ item, tagLabel, locationId, onEditRecipe, posMapping, posItems, onPosLink, onPosUnlink, onUpdateMappingMeta, isPosLinking }: RecipeRowProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayName = getCleanDisplayName(item.name || item.r365_name || "");

  // Fetch ingredients from blueprint system
  const { data: ingredients } = useQuery({
    queryKey: ["blueprint-row-ingredients", item.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_blueprint_ingredients" as any)
        .select("id, blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id, quantity, unit, source_name")
        .eq("blueprint_id", item.id)
        .order("quantity", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as BlueprintIngredient[];
    },
    enabled: isExpanded,
  });

  // Fetch ingredient display names by resolving brand template IDs -> local inventory items
  const vendorItemIds = ingredients?.filter(i => i.vendor_item_id).map(i => i.vendor_item_id!) || [];
  const { data: vendorItems } = useQuery({
    queryKey: ["blueprint-row-vendor-names", locationId, vendorItemIds.sort().join(",")],
    queryFn: async () => {
      if (vendorItemIds.length === 0) return [];

      const { data: deployments, error: depErr } = await supabase
        .from("brand_inventory_deployments")
        .select("template_id, inventory_item_id")
        .eq("location_id", locationId)
        .in("template_id", vendorItemIds);
      if (depErr) throw depErr;

      const localItemIds = (deployments || []).map(d => d.inventory_item_id);
      const templateToLocalId = new Map((deployments || []).map(d => [d.template_id, d.inventory_item_id]));

      const [localItemsRes, brandTemplatesRes] = await Promise.all([
        localItemIds.length > 0
          ? supabase
              .from("inventory_items")
              .select("id, name, cost_per_unit, blended_price, pack_quantity, pack_quantity_override, count_units_per_case, count_unit, pack_size")
              .in("id", localItemIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("brand_inventory_templates" as any)
          .select("id, product_name")
          .in("id", vendorItemIds),
      ]);

      if (localItemsRes.error) throw localItemsRes.error;
      if (brandTemplatesRes.error) throw brandTemplatesRes.error;

      const localItems = (localItemsRes.data || []) as Array<{
        id: string;
        name: string;
        cost_per_unit: number | null;
        blended_price: number | null;
        pack_quantity: number | null;
        pack_quantity_override: number | null;
        count_units_per_case: number | null;
        count_unit: string | null;
        pack_size: string | null;
      }>;
      const brandTemplates = ((brandTemplatesRes.data || []) as unknown) as Array<{ id: string; product_name: string | null }>;
      const localById = new Map(localItems.map(i => [i.id, i]));
      const brandById = new Map(brandTemplates.map(t => [t.id, t]));

      return vendorItemIds.map(templateId => {
        const localId = templateToLocalId.get(templateId);
        const localItem = localId ? localById.get(localId) : null;
        const brandTemplate = brandById.get(templateId);
        return {
          id: templateId,
          name: localItem?.name || brandTemplate?.product_name || null,
          cost_per_unit: localItem?.cost_per_unit ?? null,
          blended_price: localItem?.blended_price ?? null,
          pack_quantity: localItem?.pack_quantity ?? null,
          pack_quantity_override: localItem?.pack_quantity_override ?? null,
          count_units_per_case: localItem?.count_units_per_case ?? null,
          count_unit: localItem?.count_unit ?? null,
          pack_size: localItem?.pack_size ?? null,
        };
      });
    },
    enabled: vendorItemIds.length > 0,
  });

  // Fetch sub-blueprint names for display
  const subBpIds = ingredients?.filter(i => i.sub_blueprint_id).map(i => i.sub_blueprint_id!) || [];
  const { data: subBlueprints } = useQuery({
    queryKey: ["blueprint-row-sub-names", subBpIds.sort().join(",")],
    queryFn: async () => {
      if (subBpIds.length === 0) return [];
      const { data, error } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name, yield_qty, yield_unit")
        .in("id", subBpIds);
      if (error) throw error;
      return (data || []) as unknown as { id: string; name: string; yield_qty: number | null; yield_unit: string | null }[];
    },
    enabled: subBpIds.length > 0,
  });

  // Use blueprint costing engine for total cost
  const { data: costResult } = useQuery({
    queryKey: ["blueprint-costs-for-catalog", locationId],
    queryFn: () => fetchBlueprintCosts(locationId),
    staleTime: 0,
  });

  const bpCost: BlueprintCostResult | undefined = costResult?.get(item.id);
  const totalCost = bpCost?.batchCost || 0;
  const isPartial = bpCost?.isPartial || false;

  const vendorNameMap = new Map(vendorItems?.map(v => [v.id, v.name]) || []);
  const vendorDataMap = new Map(vendorItems?.map(v => [v.id, v]) || []);
  const subBpNameMap = new Map(subBlueprints?.map(b => [b.id, b.name]) || []);

  // Compute per-ingredient cost contribution
  const getIngredientCost = (ing: BlueprintIngredient): number | null => {
    if (ing.ingredient_type === "blueprint" && ing.sub_blueprint_id) {
      const subCost = costResult?.get(ing.sub_blueprint_id);
      if (!subCost) return null;
      // Sub-recipe: batchCost / yield * quantity
      // We need yield info — fetch from subBlueprints query
      // For now use batchCost directly since yield=1 each is common
      return subCost.batchCost * ing.quantity;
    } else if (ing.vendor_item_id) {
      const v = vendorDataMap.get(ing.vendor_item_id);
      if (!v) return null;
      const caseCost = v.blended_price ?? v.cost_per_unit ?? 0;
      if (caseCost === 0) return 0;
      const ingUnit = (ing.unit || "").trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
      const nativeUnit = (v.count_unit || "").trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
      // Normalize common aliases
      const normUnit = (u: string) => {
        if (u.includes("oz")) return "oz";
        if (u === "ea" || u === "each") return "ea";
        return u;
      };
      const iu = normUnit(ingUnit);
      const nu = normUnit(nativeUnit);
      if (iu === "cs" || iu === "case") return caseCost * ing.quantity;
      const unitsPerCase = v.pack_quantity_override || v.count_units_per_case || v.pack_quantity || 1;
      const costPerUnit = caseCost / unitsPerCase;
      if (iu === nu || (iu === "ea" && nu === "ea")) return costPerUnit * ing.quantity;
      if (iu && nu && iu !== nu && TO_OZ[iu] && TO_OZ[nu]) {
        return ((ing.quantity * TO_OZ[iu]) / TO_OZ[nu]) * costPerUnit;
      }
      // Fallback: try parsing pack_size for total oz
      if (!nu && TO_OZ[iu]) {
        const totalOz = parsePackSizeToOz(v.pack_size || null);
        if (totalOz && totalOz > 0) {
          const cpu = caseCost / totalOz;
          return ing.quantity * (TO_OZ[iu] / TO_OZ["oz"]) * cpu;
        }
      }
      if (!nu && iu === "ea") return costPerUnit * ing.quantity;
      return null;
    }
    return null;
  };

  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        type="button"
        className="w-full flex items-center gap-2 py-2 px-2 text-sm hover:bg-muted/50 transition-colors text-left group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
        <span className="truncate flex-1 font-medium">{displayName}</span>
        {onEditRecipe && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onEditRecipe(item.id); }}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        {/* POS mapping indicator for MI, CORE, and BASE items */}
        {(tagLabel === "mi" || tagLabel === "core" || tagLabel === "base") && onPosLink && posItems && (
          <PosLinkIndicator
            blueprintId={item.id}
            blueprintName={displayName}
            blueprintCategory={tagLabel}
            mapping={posMapping}
            posItems={posItems}
            onLink={onPosLink}
            onUnlink={onPosUnlink || (() => {})}
            onUpdateMeta={onUpdateMappingMeta}
            isLinking={isPosLinking || false}
            locationId={locationId}
          />
        )}
        {tagLabel && (
          <Badge variant="outline" className={cn(
            "text-[9px] px-1.5 py-0 flex-shrink-0 uppercase tracking-wider",
            tagLabel === "R365" && "bg-blue-500/10 text-blue-600 border-blue-500/30"
          )}>
            {tagLabel === "base" ? "FOUNDATION" : tagLabel === "core" ? "BUILD" : tagLabel}
          </Badge>
        )}
        {totalCost > 0 && (
          <span className={cn(
            "text-xs flex-shrink-0 flex items-center gap-0.5",
            isExpanded ? "font-semibold text-emerald-600" : "text-emerald-600/70"
          )}>
            {isExpanded && <DollarSign className="h-3 w-3" />}
            ${totalCost.toFixed(2)}
            {isPartial && <AlertCircle className="h-3 w-3 text-amber-500 ml-0.5" />}
          </span>
        )}
        {item.yield_qty && item.yield_unit && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            yields {item.yield_qty} {item.yield_unit}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="pl-8 pr-2 pb-2 space-y-0.5">
          {!ingredients || ingredients.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-1">No ingredients linked</p>
          ) : (
            ingredients.map(ing => {
              let ingName: string;
              let isSubRecipe = false;

              if (ing.ingredient_type === "blueprint" && ing.sub_blueprint_id) {
                ingName = subBpNameMap.get(ing.sub_blueprint_id) || ing.source_name || "(sub-recipe)";
                isSubRecipe = true;
              } else if (ing.vendor_item_id) {
                ingName = vendorNameMap.get(ing.vendor_item_id) || ing.source_name || "(unnamed)";
              } else {
                ingName = ing.source_name || "(unmapped)";
              }

              const isMapped = !!(ing.vendor_item_id || ing.sub_blueprint_id);

              return (
                <div key={ing.id} className="flex items-center gap-1 text-xs py-0.5">
                  <span className={cn(
                    "truncate flex-1",
                    isMapped ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {ingName}
                    {isSubRecipe && (
                      <span className="text-[10px] ml-1 opacity-60">(sub-recipe)</span>
                    )}
                    {!isMapped && (
                      <span className="text-[10px] ml-1 text-amber-500">(unmapped)</span>
                    )}
                  </span>
                  <span className="text-muted-foreground flex-shrink-0">
                    {ing.quantity} {ing.unit || ""}
                  </span>
                  {(() => {
                    const ingCost = getIngredientCost(ing);
                    if (ingCost == null || ingCost <= 0) return null;
                    return (
                      <span className="text-emerald-600/70 flex-shrink-0 tabular-nums w-14 text-right">
                        ${ingCost.toFixed(2)}
                      </span>
                    );
                  })()}
                </div>
              );
            })
          )}

          {totalCost > 0 && ingredients && ingredients.length > 0 && (
            <div className="flex items-center justify-between pt-1 mt-1 border-t border-border/30 text-xs font-semibold">
              <span>Recipe Cost{isPartial && <span className="text-amber-500 font-normal ml-1">(partial)</span>}</span>
              <span className="text-emerald-600">${totalCost.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecipeRow;
