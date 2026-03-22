import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { FlaskConical, Plus, Trash2, Pencil, X, MapPin, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchRecipeCosts } from "@/utils/recipeCostCalculation";
import RecipeBuilderDialog from "../RecipeBuilderDialog";

interface PrepRecipesSectionProps {
  locationId: string;
}

const PrepRecipesSection = ({ locationId }: PrepRecipesSectionProps) => {
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);
  const [editRecipeId, setEditRecipeId] = useState<string | null>(null);
  const [purgeMode, setPurgeMode] = useState(false);
  const [purgeSelection, setPurgeSelection] = useState<Set<string>>(new Set());
  const [isPurging, setIsPurging] = useState(false);
  const queryClient = useQueryClient();

  const { data: items } = useQuery({
    queryKey: ["prep-recipe-items", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, common_name, is_recipe, recipe_yield_qty, recipe_yield_unit, cost_per_unit, storage_location_id, source, countable")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .eq("is_recipe", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: storageLocations } = useQuery({
    queryKey: ["inventory-storage-locations", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_storage_locations")
        .select("id, name, display_order")
        .eq("location_id", locationId)
        .order("display_order");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: recipeCosts } = useQuery({
    queryKey: ["recipe-costs", locationId],
    queryFn: () => fetchRecipeCosts(locationId),
    staleTime: 5 * 60 * 1000,
  });

  const recipeItems = items || [];

  // Group by storage location
  const recipesByLocation = new Map<string, typeof recipeItems>();
  const unassignedRecipes: typeof recipeItems = [];
  for (const recipe of recipeItems) {
    if (recipe.storage_location_id) {
      const existing = recipesByLocation.get(recipe.storage_location_id) || [];
      existing.push(recipe);
      recipesByLocation.set(recipe.storage_location_id, existing);
    } else {
      unassignedRecipes.push(recipe);
    }
  }

  const handlePurgeSelected = async () => {
    if (purgeSelection.size === 0) return;
    setIsPurging(true);
    try {
      const ids = Array.from(purgeSelection);
      await supabase.from("inventory_recipe_ingredients").delete().in("recipe_item_id", ids);
      const { error } = await supabase
        .from("inventory_items")
        .update({ is_active: false, is_recipe: false } as any)
        .in("id", ids);
      if (error) throw error;
      toast.success(`Removed ${ids.length} recipe${ids.length > 1 ? "s" : ""}`);
      setPurgeSelection(new Set());
      setPurgeMode(false);
      queryClient.invalidateQueries({ queryKey: ["prep-recipe-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to remove recipes");
    } finally {
      setIsPurging(false);
    }
  };

  const renderRecipeRow = (item: any) => (
    <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-muted/50 rounded text-sm group">
      <div className="flex items-center gap-2 truncate flex-1">
        {purgeMode && (
          <button
            type="button"
            className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
              purgeSelection.has(item.id)
                ? "bg-destructive border-destructive text-destructive-foreground"
                : "border-border hover:border-destructive/50"
            }`}
            onClick={() => {
              setPurgeSelection(prev => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            }}
          >
            {purgeSelection.has(item.id) && <X className="h-3 w-3" />}
          </button>
        )}
        <span className="truncate">{item.common_name || item.name}</span>
        {item.source === "r365_import" && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 flex-shrink-0 opacity-60">R365</Badge>
        )}
        {item.countable === false && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">Not counted</Badge>
        )}
      </div>
      {!purgeMode && (
        <div className="flex items-center gap-2 text-muted-foreground">
          {item.recipe_yield_qty && item.recipe_yield_unit && (
            <span className="text-xs">
              yields {item.recipe_yield_qty} {item.recipe_yield_unit}
            </span>
          )}
          {(() => {
            const displayCost = item.cost_per_unit ? Number(item.cost_per_unit) : recipeCosts?.get(item.id) ?? null;
            if (displayCost == null || displayCost <= 0) return null;
            const yieldQty = item.recipe_yield_qty || 0;
            const yieldUnit = item.recipe_yield_unit || "ea";
            if (yieldQty > 1) {
              const perUnit = displayCost / yieldQty;
              return <span className="text-xs text-primary">${perUnit.toFixed(2)}/{yieldUnit}</span>;
            }
            return <span className="text-xs text-primary">${displayCost.toFixed(2)}/ea</span>;
          })()}
          <Select
            value={item.storage_location_id || "__unassigned__"}
            onValueChange={async (val) => {
              const newLocId = val === "__unassigned__" ? null : val;
              const { error } = await supabase
                .from("inventory_items")
                .update({ storage_location_id: newLocId } as any)
                .eq("id", item.id);
              if (error) {
                toast.error("Failed to move recipe");
              } else {
                queryClient.invalidateQueries({ queryKey: ["prep-recipe-items", locationId] });
                queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
              }
            }}
          >
            <SelectTrigger className="h-6 w-auto min-w-0 text-[10px] border-none bg-transparent px-1 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <MapPin className="h-3 w-3 flex-shrink-0" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned__">Unassigned</SelectItem>
              {storageLocations?.map(loc => (
                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => { setEditRecipeId(item.id); setShowRecipeDialog(true); }}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="px-2 pb-2 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm px-2 pt-3">
          <FlaskConical className="h-4 w-4" />
          Prep Recipes
          <Badge variant="secondary" className="text-xs">{recipeItems.length}</Badge>
          <div className="ml-auto flex items-center gap-1">
            {purgeMode ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    const r365Ids = recipeItems.filter((r: any) => r.source === "r365_import").map(r => r.id);
                    setPurgeSelection(new Set(r365Ids));
                  }}
                >
                  Select R365
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { setPurgeMode(false); setPurgeSelection(new Set()); }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setPurgeMode(true)}
                title="Bulk remove recipes"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => { setEditRecipeId(null); setShowRecipeDialog(true); }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {recipeItems.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2">No prep recipes yet. Tap + to create one.</p>
        ) : (
          <>
            {storageLocations?.map(loc => {
              const locRecipes = recipesByLocation.get(loc.id);
              if (!locRecipes || locRecipes.length === 0) return null;
              return (
                <div key={loc.id}>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5 px-2">
                    <MapPin className="h-3 w-3" />
                    {loc.name}
                    <span className="text-muted-foreground/60">({locRecipes.length})</span>
                  </h4>
                  <div className="grid gap-1">{locRecipes.map(renderRecipeRow)}</div>
                </div>
              );
            })}

            {unassignedRecipes.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5 px-2">
                  <Package className="h-3 w-3" />
                  Unassigned
                  <span className="text-muted-foreground/60">({unassignedRecipes.length})</span>
                </h4>
                <div className="grid gap-1">{unassignedRecipes.map(renderRecipeRow)}</div>
              </div>
            )}

            {purgeMode && purgeSelection.size > 0 && (
              <div className="flex items-center justify-between p-2 bg-destructive/10 border border-destructive/20 rounded-md">
                <span className="text-xs font-medium text-destructive">
                  {purgeSelection.size} selected for removal
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handlePurgeSelected}
                  disabled={isPurging}
                >
                  {isPurging ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                  Remove
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <RecipeBuilderDialog
        open={showRecipeDialog}
        onOpenChange={setShowRecipeDialog}
        locationId={locationId}
        editRecipeId={editRecipeId}
      />
    </>
  );
};

export default PrepRecipesSection;
