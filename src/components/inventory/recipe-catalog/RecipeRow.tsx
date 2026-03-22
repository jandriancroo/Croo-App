import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Pencil, DollarSign, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MenuItem, RecipeIngredient, ResolvedCost } from "./types";
import { getCleanDisplayName } from "./utils";

interface RecipeRowProps {
  item: MenuItem;
  tagLabel?: string;
  locationId: string;
  onEditRecipe?: (bomMenuItemId: string) => void;
}

const RecipeRow = ({ item, tagLabel, locationId, onEditRecipe }: RecipeRowProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayName = item.clean_name || getCleanDisplayName(item.r365_name);

  const { data: rawIngredients } = useQuery({
    queryKey: ["recipe-row-ingredients", item.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bom_recipe_ingredients")
        .select("id, menu_item_id, ingredient_id, quantity, unit_of_measure, ingredient:bom_ingredients(id, r365_name, clean_name, inventory_item_id, is_prep_item)")
        .eq("menu_item_id", item.id)
        .order("quantity", { ascending: false });
      if (error) throw error;
      return data as unknown as RecipeIngredient[];
    },
    enabled: isExpanded,
  });

  const { data: resolvedCosts } = useQuery({
    queryKey: ["recipe-row-costs", item.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_recipe_ingredients", {
        p_menu_item_id: item.id,
        p_quantity_multiplier: 1.0,
        p_location_id: locationId,
      });
      if (error) throw error;
      return (data || []) as ResolvedCost[];
    },
    enabled: isExpanded,
  });

  const totalCost = resolvedCosts?.reduce((sum, c) => sum + (c.total_cost || 0), 0) || 0;
  const hasUncosted = resolvedCosts?.some(c => !c.total_cost || c.total_cost === 0);

  const resolvedByIngName = new Map<string, ResolvedCost[]>();
  resolvedCosts?.forEach(c => {
    const list = resolvedByIngName.get(c.ingredient_name) || [];
    list.push(c);
    resolvedByIngName.set(c.ingredient_name, list);
  });

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
        {isExpanded && totalCost > 0 && (
          <span className="text-xs font-semibold text-emerald-600 flex-shrink-0 flex items-center gap-0.5">
            <DollarSign className="h-3 w-3" />
            {totalCost.toFixed(2)}
            {hasUncosted && <AlertCircle className="h-3 w-3 text-amber-500 ml-0.5" />}
          </span>
        )}
        {!isExpanded && totalCost > 0 && (
          <span className="text-[10px] text-emerald-600/70 flex-shrink-0">${totalCost.toFixed(2)}</span>
        )}
        {item.recipe_yield_qty && item.recipe_yield_unit && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            yields {item.recipe_yield_qty} {item.recipe_yield_unit}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="pl-8 pr-2 pb-2 space-y-0.5">
          {!rawIngredients || rawIngredients.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-1">No ingredients linked</p>
          ) : (
            rawIngredients.map(ing => {
              const r365Name = ing.ingredient?.r365_name || "";
              const resolved = resolvedByIngName.get(r365Name);
              const isMatched = !!ing.ingredient?.inventory_item_id;
              const isPrepItem = !!(ing.ingredient as any)?.is_prep_item;
              const isSubRecipe = isPrepItem || (!isMatched && resolved && resolved.length > 0);

              let displayIngName: string;
              let ingCost = 0;

              if (resolved && resolved.length > 0) {
                displayIngName = resolved[0].vendor_item_name || ing.ingredient?.clean_name || r365Name;
                ingCost = resolved.reduce((sum, r) => sum + (r.total_cost || 0), 0);
              } else {
                displayIngName = ing.ingredient?.clean_name || r365Name || "(unnamed ingredient)";
              }

              if (isSubRecipe && resolved && resolved.length > 1) {
                return (
                  <div key={ing.id} className="space-y-0">
                    <div className="flex items-center gap-1 text-xs py-0.5">
                      <span className="truncate flex-1 text-muted-foreground italic">
                        {ing.ingredient?.clean_name || r365Name}
                        <span className="text-[10px] ml-1 opacity-60">(sub-recipe)</span>
                      </span>
                      <span className="text-muted-foreground flex-shrink-0">
                        {ing.quantity} {ing.unit_of_measure || ""}
                      </span>
                    </div>
                    {resolved.map((r, i) => (
                      <div key={`${ing.id}-r-${i}`} className="flex items-center gap-1 text-xs py-0.5 pl-4">
                        <span className="truncate flex-1 text-foreground">
                          {r.vendor_item_name || r.ingredient_name}
                        </span>
                        {r.total_cost > 0 && (
                          <span className="text-[10px] text-emerald-600/70 flex-shrink-0">
                            ${r.total_cost.toFixed(3)}
                          </span>
                        )}
                        <span className="text-muted-foreground flex-shrink-0">
                          {r.total_quantity.toFixed(2)} {r.unit_of_measure || ""}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }

              return (
                <div key={ing.id} className="flex items-center gap-1 text-xs py-0.5">
                  <span className={cn(
                    "truncate flex-1",
                    isMatched || isSubRecipe ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {displayIngName}
                    {!isMatched && !isSubRecipe && (
                      <span className="text-[10px] ml-1 text-amber-500">(unmatched)</span>
                    )}
                  </span>
                  {resolved && resolved.length > 0 && (
                    <span className={cn("text-[10px] flex-shrink-0", ingCost > 0 ? "text-emerald-600/70" : "text-muted-foreground")}>
                      ${ingCost.toFixed(3)}
                    </span>
                  )}
                  <span className="text-muted-foreground flex-shrink-0">
                    {ing.quantity} {ing.unit_of_measure || ""}
                  </span>
                </div>
              );
            })
          )}

          {totalCost > 0 && rawIngredients && rawIngredients.length > 0 && (
            <div className="flex items-center justify-between pt-1 mt-1 border-t border-border/30 text-xs font-semibold">
              <span>Recipe Cost{hasUncosted && <span className="text-amber-500 font-normal ml-1">(partial)</span>}</span>
              <span className="text-emerald-600">${totalCost.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecipeRow;
