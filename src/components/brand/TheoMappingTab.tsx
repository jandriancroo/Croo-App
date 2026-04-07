import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Filter, Eye, EyeOff, Info, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


interface TheoMappingTabProps {
  brandId: string;
  excludedCategories: string[];
  includedOverrides: string[];
  locations: { id: string; name: string; store_number?: string }[];
}

interface PosItemInfo {
  name: string;
  quantity: number;
}

interface PosCategoryInfo {
  category: string;
  totalQuantity: number;
  items: PosItemInfo[];
}

export default function TheoMappingTab({ brandId, excludedCategories, includedOverrides, locations }: TheoMappingTabProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // Pull distinct POS categories + items from recent product_mix
  const { data: posCategories = [], isLoading } = useQuery({
    queryKey: ["pos-categories-for-brand", brandId, locations.map(l => l.id).join(",")],
    queryFn: async () => {
      const locationIds = locations.map(l => l.id);
      if (locationIds.length === 0) return [];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startDate = thirtyDaysAgo.toISOString().split("T")[0];

      // Fetch from first location only to avoid 1000-row limit; POS categories are brand-wide
      const primaryLocationId = locationIds[0];
      const { data, error } = await supabase
        .from("sales_cache")
        .select("product_mix")
        .eq("location_id", primaryLocationId)
        .gte("sale_date", startDate)
        .not("product_mix", "is", null)
        .limit(60);

      if (error) throw error;

      const catMap = new Map<string, Map<string, number>>();
      for (const row of data || []) {
        const mix = row.product_mix as any[];
        if (!Array.isArray(mix)) continue;
        for (const item of mix) {
          const cat = item.category || "Uncategorized";
          const name = item.itemName || item.name;
          // Skip aggregate/totals rows (no name or "Totals")
          if (!name || name === "Totals") continue;
          if (!catMap.has(cat)) catMap.set(cat, new Map());
          const items = catMap.get(cat)!;
          items.set(name, (items.get(name) || 0) + (Number(item.quantity) || 0));
        }
      }

      const result: PosCategoryInfo[] = [];
      for (const [category, itemsMap] of catMap) {
        const items: PosItemInfo[] = [];
        let totalQuantity = 0;
        for (const [name, quantity] of itemsMap) {
          items.push({ name, quantity });
          totalQuantity += quantity;
        }
        items.sort((a, b) => b.quantity - a.quantity);
        result.push({ category, totalQuantity, items });
      }

      result.sort((a, b) => b.totalQuantity - a.totalQuantity);
      return result;
    },
    enabled: locations.length > 0,
  });

  const excludedSet = useMemo(() => new Set(excludedCategories.map(c => c.toLowerCase())), [excludedCategories]);
  const overrideSet = useMemo(() => new Set(includedOverrides.map(i => i.toLowerCase())), [includedOverrides]);

  const saveBrand = async (newExcluded: string[], newOverrides: string[]) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("brands")
        .update({
          pos_excluded_categories: newExcluded,
          pos_included_overrides: newOverrides,
        })
        .eq("id", brandId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["brand-detail", brandId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const toggleCategory = async (category: string, exclude: boolean) => {
    let newExcluded: string[];
    let newOverrides = [...includedOverrides];

    if (exclude) {
      newExcluded = [...excludedCategories, category];
      // Remove any item-level overrides for this category since the whole cat is now excluded
      const catItems = posCategories.find(c => c.category === category)?.items || [];
      const catItemNames = new Set(catItems.map(i => i.name.toLowerCase()));
      newOverrides = newOverrides.filter(o => !catItemNames.has(o.toLowerCase()));
    } else {
      newExcluded = excludedCategories.filter(c => c !== category);
      // Also remove any overrides for items in this category (no longer needed)
      const catItems = posCategories.find(c => c.category === category)?.items || [];
      const catItemNames = new Set(catItems.map(i => i.name.toLowerCase()));
      newOverrides = newOverrides.filter(o => !catItemNames.has(o.toLowerCase()));
    }

    await saveBrand(newExcluded, newOverrides);
  };

  const toggleItem = async (itemName: string, include: boolean) => {
    let newOverrides: string[];
    if (include) {
      newOverrides = [...includedOverrides, itemName];
    } else {
      newOverrides = includedOverrides.filter(o => o.toLowerCase() !== itemName.toLowerCase());
    }
    await saveBrand([...excludedCategories], newOverrides);
  };

  const toggleExpand = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

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
          <p className="text-sm text-muted-foreground">No POS sales data found</p>
          <p className="text-xs text-muted-foreground mt-1">Categories appear once sales data syncs</p>
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
                Toggle categories OFF to exclude modifier items from the Unmatched section.
                Expand a category to re-include specific items as exceptions.
              </CardDescription>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
                    <Info className="h-3 w-3" />
                    Diagnostic only
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[240px] text-xs">
                  This only filters the "Unmatched" diagnostic list. It does not impact actual or theoretical COGS. Clear all to reset.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {posCategories.map(cat => {
              const isExcluded = excludedSet.has(cat.category.toLowerCase());
              const isExpanded = expandedCats.has(cat.category);
              const overrideCount = isExcluded
                ? cat.items.filter(i => overrideSet.has(i.name.toLowerCase())).length
                : 0;

              return (
                <div key={cat.category}>
                  {/* Category row */}
                  <div
                    className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                      isExcluded ? "bg-muted/30" : ""
                    }`}
                  >
                    <button
                      className="shrink-0 p-0.5 hover:bg-muted rounded transition-colors"
                      onClick={() => toggleExpand(cat.category)}
                    >
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          isExpanded ? "" : "-rotate-90"
                        }`}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium ${isExcluded ? "text-muted-foreground" : ""}`}>
                        {cat.category}
                      </span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] tabular-nums shrink-0">
                      {cat.items.length} items
                    </Badge>
                    <Badge variant="outline" className="text-[10px] tabular-nums shrink-0">
                      {cat.totalQuantity.toLocaleString()} sold
                    </Badge>
                    {isExcluded && overrideCount > 0 && (
                      <Badge variant="default" className="text-[10px] tabular-nums shrink-0">
                        {overrideCount} exception{overrideCount !== 1 ? "s" : ""}
                      </Badge>
                    )}
                    {isExcluded ? (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <Switch
                      checked={!isExcluded}
                      onCheckedChange={(checked) => toggleCategory(cat.category, !checked)}
                      disabled={saving}
                      className="scale-75 shrink-0"
                    />
                  </div>

                  {/* Expanded items */}
                  {isExpanded && (
                    <div className="border-t border-border/50 bg-muted/10">
                      {cat.items.map(item => {
                        const itemExcluded = isExcluded && !overrideSet.has(item.name.toLowerCase());
                        return (
                          <div
                            key={item.name}
                            className={`flex items-center gap-3 pl-12 pr-4 py-1.5 text-xs transition-colors ${
                              itemExcluded ? "opacity-40" : ""
                            }`}
                          >
                            <span className={`flex-1 min-w-0 truncate ${itemExcluded ? "line-through text-muted-foreground" : ""}`}>
                              {item.name}
                            </span>
                            <span className="text-muted-foreground tabular-nums shrink-0">
                              {item.quantity.toLocaleString()}
                            </span>
                            {isExcluded && (
                              <Switch
                                checked={!itemExcluded}
                                onCheckedChange={(checked) => toggleItem(item.name, checked)}
                                disabled={saving}
                                className="scale-[0.6] shrink-0"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {saving && (
        <div className="flex items-center justify-center gap-2 text-muted-foreground text-xs py-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
}
