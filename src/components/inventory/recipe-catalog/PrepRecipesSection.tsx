import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { FlaskConical, Plus, Trash2, Pencil, X, MapPin, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchBlueprintCosts } from "@/utils/blueprintCostCalculation";
import { fetchRecipeCosts } from "@/utils/recipeCostCalculation";
import RecipeBuilderDialog from "../RecipeBuilderDialog";

interface PrepRecipesSectionProps {
  locationId: string;
}

const PrepRecipesSection = ({ locationId }: PrepRecipesSectionProps) => {
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);
  const [editRecipeId, setEditRecipeId] = useState<string | null>(null);
  const [editBlueprintId, setEditBlueprintId] = useState<string | null>(null);
  const [purgeMode, setPurgeMode] = useState(false);
  const [purgeSelection, setPurgeSelection] = useState<Set<string>>(new Set());
  const [isPurging, setIsPurging] = useState(false);
  const queryClient = useQueryClient();

  // Fetch blueprints (new architecture)
  const { data: blueprints } = useQuery({
    queryKey: ["blueprint-recipes", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name, category, yield_qty, yield_unit, produces_item_id, source")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as {
        id: string; name: string; category: string | null;
        yield_qty: number | null; yield_unit: string | null;
        produces_item_id: string | null; source: string | null;
      }[];
    },
  });

  // Fetch produced items for countable/storage info
  const producedItemIds = blueprints?.filter(b => b.produces_item_id).map(b => b.produces_item_id!) || [];
  const { data: producedItems } = useQuery({
    queryKey: ["produced-items", producedItemIds],
    queryFn: async () => {
      if (producedItemIds.length === 0) return [];
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, countable, storage_location_id")
        .in("id", producedItemIds);
      if (error) throw error;
      return data || [];
    },
    enabled: producedItemIds.length > 0,
  });

  // Fetch legacy recipes (inventory_items is_recipe=true)
  const { data: legacyItems } = useQuery({
    queryKey: ["prep-recipe-items-legacy", locationId],
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
        .from("inventory_storage_locations" as any)
        .select("id, name, display_order")
        .eq("location_id", locationId)
        .order("display_order");
      if (error) throw error;
      return (data || []) as unknown as { id: string; name: string; display_order: number }[];
    },
  });

  const { data: blueprintCosts } = useQuery({
    queryKey: ["blueprint-costs", locationId],
    queryFn: () => fetchBlueprintCosts(locationId),
    staleTime: 5 * 60 * 1000,
  });

  const { data: legacyCosts } = useQuery({
    queryKey: ["recipe-costs", locationId],
    queryFn: () => fetchRecipeCosts(locationId),
    staleTime: 5 * 60 * 1000,
    enabled: (legacyItems?.length || 0) > 0,
  });

  // Build unified list
  type RecipeRow = {
    id: string;
    name: string;
    type: "blueprint" | "legacy";
    yield_qty: number | null;
    yield_unit: string | null;
    cost: number | null;
    isPartial: boolean;
    storage_location_id: string | null;
    source: string | null;
    countable: boolean;
  };

  const allRecipes: RecipeRow[] = [];

  // Add blueprints
  blueprints?.forEach(bp => {
    const produced = producedItems?.find(p => p.id === bp.produces_item_id);
    const costResult = blueprintCosts?.get(bp.id);
    allRecipes.push({
      id: bp.id,
      name: bp.name,
      type: "blueprint",
      yield_qty: bp.yield_qty,
      yield_unit: bp.yield_unit,
      cost: costResult?.batchCost ?? null,
      isPartial: costResult?.isPartial ?? false,
      storage_location_id: produced?.storage_location_id || null,
      source: bp.source,
      countable: produced?.countable !== false,
    });
  });

  // Add legacy recipes (not duplicated by blueprints)
  legacyItems?.forEach(item => {
    allRecipes.push({
      id: item.id,
      name: item.common_name || item.name,
      type: "legacy",
      yield_qty: item.recipe_yield_qty,
      yield_unit: item.recipe_yield_unit,
      cost: item.cost_per_unit ? Number(item.cost_per_unit) : legacyCosts?.get(item.id) ?? null,
      isPartial: false,
      storage_location_id: item.storage_location_id,
      source: item.source,
      countable: (item as any).countable !== false,
    });
  });

  // Group by storage location
  const byLocation = new Map<string, RecipeRow[]>();
  const unassigned: RecipeRow[] = [];
  for (const recipe of allRecipes) {
    if (recipe.storage_location_id) {
      const list = byLocation.get(recipe.storage_location_id) || [];
      list.push(recipe);
      byLocation.set(recipe.storage_location_id, list);
    } else {
      unassigned.push(recipe);
    }
  }

  const handlePurgeSelected = async () => {
    if (purgeSelection.size === 0) return;
    setIsPurging(true);
    try {
      const ids = Array.from(purgeSelection);
      // Separate blueprint vs legacy IDs
      const bpIds = ids.filter(id => allRecipes.find(r => r.id === id)?.type === "blueprint");
      const legacyIds = ids.filter(id => allRecipes.find(r => r.id === id)?.type === "legacy");

      if (bpIds.length > 0) {
        await supabase.from("recipe_blueprint_ingredients" as any).delete().in("blueprint_id", bpIds);
        await supabase.from("recipe_blueprints" as any).update({ is_active: false } as any).in("id", bpIds);
      }
      if (legacyIds.length > 0) {
        await supabase.from("inventory_recipe_ingredients").delete().in("recipe_item_id", legacyIds);
        await supabase.from("inventory_items").update({ is_active: false, is_recipe: false } as any).in("id", legacyIds);
      }

      toast.success(`Removed ${ids.length} recipe${ids.length > 1 ? "s" : ""}`);
      setPurgeSelection(new Set());
      setPurgeMode(false);
      queryClient.invalidateQueries({ queryKey: ["blueprint-recipes", locationId] });
      queryClient.invalidateQueries({ queryKey: ["prep-recipe-items-legacy", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to remove recipes");
    } finally {
      setIsPurging(false);
    }
  };

  const renderRecipeRow = (item: RecipeRow) => (
    <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-muted/50 rounded text-sm group">
      <div className="flex items-center gap-2 truncate flex-1">
        {purgeMode && (
          <button type="button"
            className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
              purgeSelection.has(item.id) ? "bg-destructive border-destructive text-destructive-foreground" : "border-border hover:border-destructive/50"
            }`}
            onClick={() => {
              setPurgeSelection(prev => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                return next;
              });
            }}
          >
            {purgeSelection.has(item.id) && <X className="h-3 w-3" />}
          </button>
        )}
        <span className="truncate">{item.name}</span>
        {item.source === "r365_import" && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 flex-shrink-0 opacity-60">R365</Badge>
        )}
        {item.type === "legacy" && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 flex-shrink-0 opacity-40">Legacy</Badge>
        )}
        {!item.countable && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">Not counted</Badge>
        )}
      </div>
      {!purgeMode && (
        <div className="flex items-center gap-2 text-muted-foreground">
          {item.yield_qty && item.yield_unit && (
            <span className="text-xs">yields {item.yield_qty} {item.yield_unit}</span>
          )}
          {(() => {
            const displayCost = item.cost;
            if (displayCost == null || displayCost <= 0) return null;
            const yq = item.yield_qty || 0;
            const yu = item.yield_unit || "ea";
            if (yq > 1) {
              return (
                <span className="text-xs text-primary">
                  ${(displayCost / yq).toFixed(2)}/{yu}
                  {item.isPartial && <span className="text-amber-500 ml-0.5">⚠</span>}
                </span>
              );
            }
            return <span className="text-xs text-primary">${displayCost.toFixed(2)}/ea</span>;
          })()}
          <Button variant="ghost" size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => {
              if (item.type === "blueprint") {
                setEditBlueprintId(item.id);
                setEditRecipeId(null);
              } else {
                setEditRecipeId(item.id);
                setEditBlueprintId(null);
              }
              setShowRecipeDialog(true);
            }}
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
          <Badge variant="secondary" className="text-xs">{allRecipes.length}</Badge>
          <div className="ml-auto flex items-center gap-1">
            {purgeMode ? (
              <>
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => {
                    const r365Ids = allRecipes.filter(r => r.source === "r365_import").map(r => r.id);
                    setPurgeSelection(new Set(r365Ids));
                  }}>Select R365</Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => { setPurgeMode(false); setPurgeSelection(new Set()); }}>Cancel</Button>
              </>
            ) : (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPurgeMode(true)} title="Bulk remove recipes">
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => { setEditRecipeId(null); setEditBlueprintId(null); setShowRecipeDialog(true); }}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {allRecipes.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2">No prep recipes yet. Tap + to create one.</p>
        ) : (
          <>
            {storageLocations?.map(loc => {
              const locRecipes = byLocation.get(loc.id);
              if (!locRecipes || locRecipes.length === 0) return null;
              return (
                <div key={loc.id}>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5 px-2">
                    <MapPin className="h-3 w-3" />{loc.name}
                    <span className="text-muted-foreground/60">({locRecipes.length})</span>
                  </h4>
                  <div className="grid gap-1">{locRecipes.map(renderRecipeRow)}</div>
                </div>
              );
            })}
            {unassigned.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5 px-2">
                  <Package className="h-3 w-3" />Unassigned
                  <span className="text-muted-foreground/60">({unassigned.length})</span>
                </h4>
                <div className="grid gap-1">{unassigned.map(renderRecipeRow)}</div>
              </div>
            )}
            {purgeMode && purgeSelection.size > 0 && (
              <div className="flex items-center justify-between p-2 bg-destructive/10 border border-destructive/20 rounded-md">
                <span className="text-xs font-medium text-destructive">{purgeSelection.size} selected for removal</span>
                <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={handlePurgeSelected} disabled={isPurging}>
                  {isPurging ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}Remove
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
        editBlueprintId={editBlueprintId}
      />
    </>
  );
};

export default PrepRecipesSection;
