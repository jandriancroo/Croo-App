import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Filter, Eye, EyeOff, Info } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TheoMappingTabProps {
  brandId: string;
  excludedCategories: string[];
  locations: { id: string; name: string; store_number?: string }[];
}

interface PosCategoryInfo {
  category: string;
  totalQuantity: number;
  itemCount: number;
}

export default function TheoMappingTab({ brandId, excludedCategories, locations }: TheoMappingTabProps) {
  const queryClient = useQueryClient();
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  // Pull distinct POS categories from recent product_mix across all brand locations
  const { data: posCategories = [], isLoading } = useQuery({
    queryKey: ["pos-categories-for-brand", brandId, locations.map(l => l.id).join(",")],
    queryFn: async () => {
      const locationIds = locations.map(l => l.id);
      if (locationIds.length === 0) return [];

      // Fetch recent 30 days of product_mix from all locations
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startDate = thirtyDaysAgo.toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("sales_cache")
        .select("product_mix")
        .in("location_id", locationIds)
        .gte("sale_date", startDate)
        .not("product_mix", "is", null);

      if (error) throw error;

      // Aggregate categories
      const catMap = new Map<string, { quantity: number; items: Set<string> }>();
      for (const row of data || []) {
        const mix = row.product_mix as any[];
        if (!Array.isArray(mix)) continue;
        for (const item of mix) {
          const cat = item.category || "Uncategorized";
          const existing = catMap.get(cat);
          if (existing) {
            existing.quantity += Number(item.quantity) || 0;
            existing.items.add(item.name);
          } else {
            catMap.set(cat, { quantity: Number(item.quantity) || 0, items: new Set([item.name]) });
          }
        }
      }

      const result: PosCategoryInfo[] = [];
      for (const [category, info] of catMap) {
        result.push({
          category,
          totalQuantity: info.quantity,
          itemCount: info.items.size,
        });
      }

      // Sort by quantity descending
      result.sort((a, b) => b.totalQuantity - a.totalQuantity);
      return result;
    },
    enabled: locations.length > 0,
  });

  const toggleCategory = useMutation({
    mutationFn: async ({ category, exclude }: { category: string; exclude: boolean }) => {
      setSavingCategory(category);
      const newList = exclude
        ? [...excludedCategories, category]
        : excludedCategories.filter(c => c !== category);

      const { error } = await supabase
        .from("brands")
        .update({ pos_excluded_categories: newList })
        .eq("id", brandId);

      if (error) throw error;
      return newList;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-detail", brandId] });
      toast.success("Updated");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update");
    },
    onSettled: () => setSavingCategory(null),
  });

  const excludedSet = useMemo(() => new Set(excludedCategories), [excludedCategories]);

  const includedCategories = posCategories.filter(c => !excludedSet.has(c.category));
  const ignoredCategories = posCategories.filter(c => excludedSet.has(c.category));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading POS categories...</span>
        </CardContent>
      </Card>
    );
  }

  if (posCategories.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Filter className="h-10 w-10 text-muted-foreground mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">No POS sales data found for this brand's locations</p>
          <p className="text-xs text-muted-foreground mt-1">Categories will appear once sales data is synced</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" />
                POS Category Filter
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Exclude modifier categories from the Unmatched section of your variance report. 
                Ingredients in these categories are already accounted for in parent recipe blueprints.
              </CardDescription>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
                    <Info className="h-3 w-3" />
                    Safe to change
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[240px] text-xs">
                  This only affects the "Unmatched" diagnostic section. It does not impact actual or theoretical COGS calculations. Clear all to reset.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Included (active) categories */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Included ({includedCategories.length})
              </span>
            </div>
            <div className="space-y-1">
              {includedCategories.map(cat => (
                <CategoryRow
                  key={cat.category}
                  category={cat}
                  excluded={false}
                  saving={savingCategory === cat.category}
                  onToggle={(exclude) => toggleCategory.mutate({ category: cat.category, exclude })}
                />
              ))}
            </div>
          </div>

          {/* Ignored categories */}
          {ignoredCategories.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Ignored ({ignoredCategories.length})
                </span>
              </div>
              <div className="space-y-1">
                {ignoredCategories.map(cat => (
                  <CategoryRow
                    key={cat.category}
                    category={cat}
                    excluded={true}
                    saving={savingCategory === cat.category}
                    onToggle={(exclude) => toggleCategory.mutate({ category: cat.category, exclude })}
                  />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryRow({
  category,
  excluded,
  saving,
  onToggle,
}: {
  category: PosCategoryInfo;
  excluded: boolean;
  saving: boolean;
  onToggle: (exclude: boolean) => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md border transition-colors ${
        excluded ? "bg-muted/30 border-border/50 opacity-60" : "bg-background border-border"
      }`}
    >
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${excluded ? "line-through text-muted-foreground" : ""}`}>
          {category.category}
        </span>
      </div>
      <Badge variant="secondary" className="text-[10px] tabular-nums shrink-0">
        {category.itemCount} items
      </Badge>
      <Badge variant="outline" className="text-[10px] tabular-nums shrink-0">
        {category.totalQuantity.toLocaleString()} sold
      </Badge>
      <div className="flex items-center gap-1.5">
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={!excluded}
            onCheckedChange={(checked) => onToggle(!checked)}
            className="scale-75"
          />
        )}
      </div>
    </div>
  );
}
