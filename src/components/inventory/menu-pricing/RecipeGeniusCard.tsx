import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlaskConical, Plus, Loader2, Trash2, AlertCircle } from "lucide-react";
import { fetchBlueprintCosts, getBlueprintUnitCost } from "@/utils/blueprintCostCalculation";
import { getCleanDisplayName } from "../recipe-catalog/utils";
import RecipeBuilderDialog from "../RecipeBuilderDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface RecipeGeniusCardProps {
  locationId: string;
}

interface SimRecipe {
  id: string;
  name: string;
  yield_qty: number | null;
  yield_unit: string | null;
}

const RecipeGeniusCard = ({ locationId }: RecipeGeniusCardProps) => {
  const queryClient = useQueryClient();
  const [showBuilder, setShowBuilder] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: simRecipes, isLoading } = useQuery({
    queryKey: ["recipe-genius-blueprints", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name, yield_qty, yield_unit")
        .eq("location_id", locationId)
        .eq("source", "simulator")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as SimRecipe[];
    },
  });

  const { data: costMap } = useQuery({
    queryKey: ["recipe-genius-costs", locationId],
    queryFn: () => fetchBlueprintCosts(locationId),
    enabled: !!simRecipes && simRecipes.length > 0,
  });

  const { data: savedPrices } = useQuery({
    queryKey: ["menu-price-overrides", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_price_overrides" as any)
        .select("blueprint_id, menu_price")
        .eq("location_id", locationId);
      if (error) throw error;
      return new Map(
        ((data || []) as any[]).map((r: any) => [r.blueprint_id, Number(r.menu_price)])
      );
    },
  });

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("recipe_blueprints" as any)
      .update({ is_active: false })
      .eq("id", id);
    if (error) {
      toast.error("Failed to delete recipe");
    } else {
      toast.success("Recipe removed");
      queryClient.invalidateQueries({ queryKey: ["recipe-genius-blueprints", locationId] });
    }
  };

  const getFoodCostColor = (pct: number | null) => {
    if (pct === null) return "text-muted-foreground";
    if (pct <= 28) return "text-emerald-600 dark:text-emerald-400";
    if (pct <= 33) return "text-amber-600 dark:text-amber-400";
    return "text-destructive";
  };

  return (
    <>
      <Card>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <FlaskConical className="h-4 w-4 text-accent-foreground" />
          <span className="font-semibold text-sm">Recipe Genius</span>
          <Badge variant="secondary" className="text-xs tabular-nums">
            {simRecipes?.length || 0} ideas
          </Badge>
          <div className="ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => { setEditId(null); setShowBuilder(true); }}
            >
              <Plus className="h-3 w-3" />
              Simulate
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !simRecipes || simRecipes.length === 0 ? (
          <div className="p-6 text-center">
            <FlaskConical className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No simulated recipes yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Create sandbox recipes to prototype menu ideas with real costs.
            </p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_80px_80px_70px_32px] items-center gap-1 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold bg-muted/30">
              <span>Recipe</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Price</span>
              <span className="text-right">FC%</span>
              <span />
            </div>

            {simRecipes.map(recipe => {
              const cost = costMap?.get(recipe.id);
              const batchCost = cost?.batchCost || 0;
              const recipeCost = getBlueprintUnitCost(batchCost, recipe.yield_qty);
              const menuPrice = savedPrices?.get(recipe.id) ?? null;
              const foodCostPct = menuPrice && menuPrice > 0
                ? (recipeCost / menuPrice) * 100
                : null;

              return (
                <div
                  key={recipe.id}
                  className="grid grid-cols-[1fr_80px_80px_70px_32px] items-center gap-1 px-3 py-2 border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors text-sm group cursor-pointer"
                  onClick={() => { setEditId(recipe.id); setShowBuilder(true); }}
                >
                  <div className="truncate font-medium flex items-center gap-1 text-foreground">
                    {getCleanDisplayName(recipe.name)}
                    {cost?.isPartial && <AlertCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                  </div>
                  <div className="text-right tabular-nums text-emerald-600 dark:text-emerald-400 text-xs">
                    {recipeCost > 0 ? `$${recipeCost.toFixed(2)}` : "—"}
                  </div>
                  <div className="text-right tabular-nums text-xs text-foreground">
                    {menuPrice !== null ? `$${menuPrice.toFixed(2)}` : "—"}
                  </div>
                  <div className={cn("text-right tabular-nums text-xs font-semibold", getFoodCostColor(foodCostPct))}>
                    {foodCostPct !== null ? `${foodCostPct.toFixed(1)}%` : "—"}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); handleDelete(recipe.id); }}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <RecipeBuilderDialog
        open={showBuilder}
        onOpenChange={(open) => {
          setShowBuilder(open);
          if (!open) setEditId(null);
        }}
        locationId={locationId}
        editBlueprintId={editId}
        simulatorMode
      />
    </>
  );
};

export default RecipeGeniusCard;
