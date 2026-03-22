import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Pencil, Trash2, Check, X, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { MenuItem, RecipeIngredient, ResolvedCost } from "./types";
import { getCleanDisplayName } from "./utils";

interface RecipeRowProps {
  item: MenuItem;
  tagLabel?: string;
  locationId: string;
}

const RecipeRow = ({ item, tagLabel, locationId }: RecipeRowProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const queryClient = useQueryClient();

  const displayName = item.clean_name || getCleanDisplayName(item.r365_name);

  // Fetch ingredients when expanded
  const { data: ingredients } = useQuery({
    queryKey: ["recipe-row-ingredients", item.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bom_recipe_ingredients")
        .select("id, menu_item_id, quantity, unit_of_measure, ingredient:bom_ingredients(id, r365_name, clean_name, inventory_item_id)")
        .eq("menu_item_id", item.id)
        .order("quantity", { ascending: false });
      if (error) throw error;
      return data as unknown as RecipeIngredient[];
    },
    enabled: isExpanded,
  });

  // Fetch resolved costs when expanded
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

  // Update ingredient quantity
  const updateMutation = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      const { error } = await supabase
        .from("bom_recipe_ingredients")
        .update({ quantity })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-row-ingredients", item.id] });
      queryClient.invalidateQueries({ queryKey: ["recipe-row-costs", item.id] });
      setEditingId(null);
      toast.success("Quantity updated");
    },
    onError: () => toast.error("Failed to update"),
  });

  // Delete ingredient
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bom_recipe_ingredients")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-row-ingredients", item.id] });
      queryClient.invalidateQueries({ queryKey: ["recipe-row-costs", item.id] });
      toast.success("Ingredient removed");
    },
    onError: () => toast.error("Failed to remove"),
  });

  const handleSaveQty = (id: string) => {
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty <= 0) return;
    updateMutation.mutate({ id, quantity: qty });
  };

  // Build cost lookup by ingredient name for display
  const costByIngredient = new Map<string, number>();
  resolvedCosts?.forEach(c => {
    const existing = costByIngredient.get(c.ingredient_name) || 0;
    costByIngredient.set(c.ingredient_name, existing + (c.total_cost || 0));
  });

  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        type="button"
        className="w-full flex items-center gap-2 py-2 px-2 text-sm hover:bg-muted/50 transition-colors text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
        <span className="truncate flex-1 font-medium">{displayName}</span>
        {tagLabel && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 flex-shrink-0 uppercase tracking-wider">
            {tagLabel}
          </Badge>
        )}
        {isExpanded && totalCost > 0 && (
          <span className="text-xs font-semibold text-emerald-600 flex-shrink-0 flex items-center gap-0.5">
            <DollarSign className="h-3 w-3" />
            {totalCost.toFixed(2)}
          </span>
        )}
        {item.recipe_yield_qty && item.recipe_yield_unit && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            yields {item.recipe_yield_qty} {item.recipe_yield_unit}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="pl-8 pr-2 pb-2 space-y-0.5">
          {!ingredients || ingredients.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-1">No ingredients linked</p>
          ) : (
            ingredients.map(ing => {
              const ingName = ing.ingredient?.clean_name || ing.ingredient?.r365_name || "Unknown";
              const ingCost = costByIngredient.get(ing.ingredient?.r365_name || "") || 0;
              const isEditing = editingId === ing.id;

              return (
                <div key={ing.id} className="flex items-center gap-1 text-xs py-0.5 group">
                  <span className={cn(
                    "truncate flex-1",
                    ing.ingredient?.inventory_item_id ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {ingName}
                  </span>

                  {ingCost > 0 && !isEditing && (
                    <span className="text-[10px] text-emerald-600/70 flex-shrink-0">
                      ${ingCost.toFixed(3)}
                    </span>
                  )}

                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Input
                        type="number"
                        value={editQty}
                        onChange={e => setEditQty(e.target.value)}
                        className="h-5 w-16 text-xs px-1"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === "Enter") handleSaveQty(ing.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <span className="text-muted-foreground">{ing.unit_of_measure || ""}</span>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => handleSaveQty(ing.id)}>
                        <Check className="h-3 w-3 text-emerald-600" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditingId(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-muted-foreground">
                        {ing.quantity} {ing.unit_of_measure || ""}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          setEditingId(ing.id);
                          setEditQty(String(ing.quantity));
                        }}
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                        onClick={() => {
                          if (confirm(`Remove ${ingName}?`)) {
                            deleteMutation.mutate(ing.id);
                          }
                        }}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {totalCost > 0 && ingredients && ingredients.length > 0 && (
            <div className="flex items-center justify-between pt-1 mt-1 border-t border-border/30 text-xs font-semibold">
              <span>Recipe Cost</span>
              <span className="text-emerald-600">${totalCost.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecipeRow;
