import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Pencil, Trash2, Check, X, DollarSign, AlertCircle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { MenuItem, RecipeIngredient, ResolvedCost } from "./types";
import { getCleanDisplayName } from "./utils";

interface RecipeRowProps {
  item: MenuItem;
  tagLabel?: string;
  locationId: string;
  onEditRecipe?: (bomMenuItemId: string) => void;
}

interface IngredientOption {
  id: string;
  r365_name: string;
  clean_name: string | null;
}

const RecipeRow = ({ item, tagLabel, locationId, onEditRecipe }: RecipeRowProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [addingIngredientId, setAddingIngredientId] = useState<string>("");
  const [addQty, setAddQty] = useState("1");
  const [addUnit, setAddUnit] = useState("");
  const queryClient = useQueryClient();

  const displayName = item.clean_name || getCleanDisplayName(item.r365_name);

  // Fetch raw ingredients for editing (we need the bom_recipe_ingredients IDs)
  const { data: rawIngredients } = useQuery({
    queryKey: ["recipe-row-ingredients", item.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bom_recipe_ingredients")
        .select("id, menu_item_id, ingredient_id, quantity, unit_of_measure, ingredient:bom_ingredients(id, r365_name, clean_name, inventory_item_id)")
        .eq("menu_item_id", item.id)
        .order("quantity", { ascending: false });
      if (error) throw error;
      return data as unknown as RecipeIngredient[];
    },
    enabled: isExpanded,
  });

  // Fetch resolved vendor items with costs
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

  // Fetch available ingredients for add flow
  const { data: availableIngredients } = useQuery({
    queryKey: ["recipe-row-ingredient-options", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bom_ingredients")
        .select("id, r365_name, clean_name")
        .eq("location_id", locationId)
        .eq("is_ignored", false)
        .order("clean_name", { ascending: true });
      if (error) throw error;
      return (data || []) as IngredientOption[];
    },
    enabled: isExpanded,
  });

  const totalCost = resolvedCosts?.reduce((sum, c) => sum + (c.total_cost || 0), 0) || 0;
  const hasUncosted = resolvedCosts?.some(c => !c.total_cost || c.total_cost === 0);

  // Build a map: r365 ingredient name → resolved vendor row(s)
  const resolvedByIngName = new Map<string, ResolvedCost[]>();
  resolvedCosts?.forEach(c => {
    const list = resolvedByIngName.get(c.ingredient_name) || [];
    list.push(c);
    resolvedByIngName.set(c.ingredient_name, list);
  });

  const existingIngredientIds = new Set(
    (rawIngredients?.map(ing => ing.ingredient_id).filter(Boolean) as string[]) || []
  );

  const filteredIngredientOptions = (availableIngredients || []).filter(option => {
    if (existingIngredientIds.has(option.id)) return false;
    if (!ingredientSearch.trim()) return true;
    const q = ingredientSearch.toLowerCase();
    return (
      (option.clean_name || "").toLowerCase().includes(q) ||
      option.r365_name.toLowerCase().includes(q)
    );
  });

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

  // Add ingredient
  const addMutation = useMutation({
    mutationFn: async ({ ingredientId, quantity, unit }: { ingredientId: string; quantity: number; unit: string | null }) => {
      const { error } = await supabase
        .from("bom_recipe_ingredients")
        .insert({
          location_id: locationId,
          menu_item_id: item.id,
          ingredient_id: ingredientId,
          quantity,
          unit_of_measure: unit,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-row-ingredients", item.id] });
      queryClient.invalidateQueries({ queryKey: ["recipe-row-costs", item.id] });
      setIngredientSearch("");
      setAddingIngredientId("");
      setAddQty("1");
      setAddUnit("");
      toast.success("Ingredient added");
    },
    onError: () => toast.error("Failed to add ingredient"),
  });

  const handleSaveQty = (id: string) => {
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty <= 0) return;
    updateMutation.mutate({ id, quantity: qty });
  };

  const handleAddIngredient = () => {
    if (!addingIngredientId) {
      toast.error("Select an ingredient first");
      return;
    }
    if (existingIngredientIds.has(addingIngredientId)) {
      toast.error("Ingredient already linked");
      return;
    }

    const qty = parseFloat(addQty);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Quantity must be greater than 0");
      return;
    }

    addMutation.mutate({
      ingredientId: addingIngredientId,
      quantity: qty,
      unit: addUnit.trim() || null,
    });
  };

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
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 flex-shrink-0 uppercase tracking-wider">
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
              const isSubRecipe = !isMatched && resolved && resolved.length > 0;
              const isEditing = editingId === ing.id;

              // Show the vendor item name if resolved, otherwise the R365 name
              let displayIngName: string;
              let ingCost = 0;

              if (resolved && resolved.length > 0) {
                // Use vendor item name (resolved through sub-recipes to actual vendor items)
                displayIngName = resolved[0].vendor_item_name || ing.ingredient?.clean_name || r365Name;
                ingCost = resolved.reduce((sum, r) => sum + (r.total_cost || 0), 0);
              } else {
                displayIngName = ing.ingredient?.clean_name || r365Name || "Unknown";
              }

              // For sub-recipes that resolve to multiple vendor items, show them grouped
              if (isSubRecipe && resolved && resolved.length > 1) {
                return (
                  <div key={ing.id} className="space-y-0">
                    <div className="flex items-center gap-1 text-xs py-0.5 group">
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
                <div key={ing.id} className="flex items-center gap-1 text-xs py-0.5 group">
                  <span className={cn(
                    "truncate flex-1",
                    isMatched || isSubRecipe ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {displayIngName}
                    {!isMatched && !isSubRecipe && (
                      <span className="text-[10px] ml-1 text-amber-500">(unmatched)</span>
                    )}
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
                          if (confirm(`Remove ${displayIngName}?`)) {
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

          <div className="pt-2 mt-2 border-t border-border/30 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Add ingredient</p>
            <Input
              value={ingredientSearch}
              onChange={e => setIngredientSearch(e.target.value)}
              placeholder="Search ingredients or prep recipes..."
              className="h-7 text-xs"
            />
            <select
              value={addingIngredientId}
              onChange={e => setAddingIngredientId(e.target.value)}
              className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Select ingredient…</option>
              {filteredIngredientOptions.slice(0, 100).map(option => (
                <option key={option.id} value={option.id}>
                  {(option.clean_name || getCleanDisplayName(option.r365_name))}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={addQty}
                onChange={e => setAddQty(e.target.value)}
                placeholder="Qty"
                className="h-7 w-20 text-xs"
              />
              <Input
                value={addUnit}
                onChange={e => setAddUnit(e.target.value)}
                placeholder="Unit (optional)"
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-xs"
                disabled={!addingIngredientId || addMutation.isPending}
                onClick={handleAddIngredient}
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
          </div>

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
