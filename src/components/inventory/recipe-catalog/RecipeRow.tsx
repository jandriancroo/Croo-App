import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Pencil, DollarSign, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MenuItem, BlueprintIngredient } from "./types";
import { getCleanDisplayName } from "./utils";
import { fetchBlueprintCosts, type BlueprintCostResult } from "@/utils/blueprintCostCalculation";

interface RecipeRowProps {
  item: MenuItem;
  tagLabel?: string;
  locationId: string;
  onEditRecipe?: (blueprintId: string) => void;
}

const RecipeRow = ({ item, tagLabel, locationId, onEditRecipe }: RecipeRowProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayName = item.name || getCleanDisplayName(item.r365_name || "");

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

  // Fetch vendor item names for display
  const vendorItemIds = ingredients?.filter(i => i.vendor_item_id).map(i => i.vendor_item_id!) || [];
  const { data: vendorItems } = useQuery({
    queryKey: ["blueprint-row-vendor-names", vendorItemIds.sort().join(",")],
    queryFn: async () => {
      if (vendorItemIds.length === 0) return [];
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, common_name")
        .in("id", vendorItemIds);
      if (error) throw error;
      return data || [];
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
        .select("id, name")
        .in("id", subBpIds);
      if (error) throw error;
      return (data || []) as unknown as { id: string; name: string }[];
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

  const vendorNameMap = new Map(vendorItems?.map(v => [v.id, v.common_name || v.name]) || []);
  const subBpNameMap = new Map(subBlueprints?.map(b => [b.id, b.name]) || []);

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
        {tagLabel && (
          <Badge variant="outline" className={cn(
            "text-[9px] px-1.5 py-0 flex-shrink-0 uppercase tracking-wider",
            tagLabel === "R365" && "bg-blue-500/10 text-blue-600 border-blue-500/30"
          )}>
            {tagLabel}
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
