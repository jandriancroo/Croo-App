import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChefHat, ChevronDown, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ArchivedRecipesSectionProps {
  brandId: string;
  searchQuery?: string;
}

export default function ArchivedRecipesSection({ brandId, searchQuery = "" }: ArchivedRecipesSectionProps) {
  const queryClient = useQueryClient();

  const { data: archivedRecipes = [] } = useQuery({
    queryKey: ["archived-recipe-blueprints", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name, category, yield_qty, yield_unit, source")
        .eq("brand_id", brandId)
        .is("location_id", null)
        .eq("is_active", false)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as Array<{ id: string; name: string; category: string | null; yield_qty: number | null; yield_unit: string | null; source: string | null }>;
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (blueprintId: string) => {
      const { error } = await supabase
        .from("recipe_blueprints" as any)
        .update({ is_active: true } as any)
        .eq("id", blueprintId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["archived-recipe-blueprints", brandId] });
      queryClient.invalidateQueries({ queryKey: ["recipe-catalog-blueprints"] });
      queryClient.invalidateQueries({ queryKey: ["blueprints-for-recipe"] });
      toast.success("Recipe restored");
    },
    onError: () => toast.error("Failed to restore recipe"),
  });

  const filtered = searchQuery
    ? archivedRecipes.filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : archivedRecipes;

  if (filtered.length === 0) return null;

  // Group by category
  const grouped = filtered.reduce((acc, r) => {
    const cat = r.category || "Uncategorized";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {} as Record<string, typeof filtered>);

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-2.5 border-t border-border hover:bg-muted/30 transition-colors">
        <ChefHat className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recipes</span>
        <Badge variant="secondary" className="text-[10px]">{filtered.length}</Badge>
        <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-border">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, recipes]) => (
            <Collapsible key={category} defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-2 w-full px-6 py-2 hover:bg-muted/20 transition-colors">
                <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
                <span className="text-sm font-medium">{category}</span>
                <Badge variant="outline" className="text-[10px]">{recipes.length}</Badge>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {recipes.map(recipe => (
                  <div
                    key={recipe.id}
                    className="flex items-center justify-between px-8 py-2 text-sm text-muted-foreground hover:bg-muted/10"
                  >
                    <span>{recipe.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => restoreMutation.mutate(recipe.id)}
                      disabled={restoreMutation.isPending}
                    >
                      {restoreMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      Restore
                    </Button>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
