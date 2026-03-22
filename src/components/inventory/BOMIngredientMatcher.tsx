import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Check, X, Link2, Unlink, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  locationId: string;
}

interface BOMIngredient {
  id: string;
  r365_name: string;
  clean_name: string | null;
  category: string | null;
  unit_standard: string | null;
  inventory_item_id: string | null;
}

interface InventoryItem {
  id: string;
  name: string;
  common_name: string | null;
  brand: string | null;
  unit: string | null;
  pack_size: string | null;
  category: string | null;
  vendor_source: string | null;
}

function scoreSimilarity(a: string, b: string): number {
  const aLow = a.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const bLow = b.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  if (aLow === bLow) return 100;
  if (bLow.includes(aLow) || aLow.includes(bLow)) return 80;
  const aWords = aLow.split(/\s+/);
  const bWords = bLow.split(/\s+/);
  const matches = aWords.filter(w => bWords.some(bw => bw.includes(w) || w.includes(bw)));
  if (matches.length === 0) return 0;
  return Math.round((matches.length / Math.max(aWords.length, 1)) * 60);
}

const CATEGORY_ORDER = ["MEAT", "DAIRY", "PROD", "DRY", "OTHER", "PAPER", "MI", "NA_BEV", "BEER", "WINE"];
const CATEGORY_LABELS: Record<string, string> = {
  MEAT: "Meat", DAIRY: "Dairy", PROD: "Produce", DRY: "Dry Goods",
  OTHER: "Other / Bases", PAPER: "Paper / Supplies", MI: "Menu Items",
  NA_BEV: "Non-Alc Beverages", BEER: "Beer", WINE: "Wine",
};

const BOMIngredientMatcher = ({ locationId }: Props) => {
  const queryClient = useQueryClient();
  const [globalFilter, setGlobalFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  
  const [saving, setSaving] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const { data: ingredients, isLoading: loadingIng } = useQuery({
    queryKey: ["bom-ingredients", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bom_ingredients")
        .select("id, r365_name, clean_name, category, unit_standard, inventory_item_id, is_prep_item")
        .eq("location_id", locationId)
        .or("is_prep_item.is.null,is_prep_item.eq.false")
        .order("clean_name");
      if (error) throw error;
      return (data || []) as BOMIngredient[];
    },
  });

  const { data: items, isLoading: loadingItems } = useQuery({
    queryKey: ["inventory-items-for-match", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, common_name, brand, unit, pack_size, category, vendor_source")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as InventoryItem[];
    },
  });

  const itemMap = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    items?.forEach(i => m.set(i.id, i));
    return m;
  }, [items]);

  const { unmatched, matched, groupedAll } = useMemo(() => {
    if (!ingredients) return { unmatched: [], matched: [], groupedAll: new Map<string, BOMIngredient[]>() };
    const filtered = globalFilter
      ? ingredients.filter(i =>
          (i.clean_name || i.r365_name).toLowerCase().includes(globalFilter.toLowerCase())
        )
      : ingredients;
    const um = filtered.filter(i => !i.inventory_item_id);
    const m = filtered.filter(i => i.inventory_item_id);
    
    // Group ALL by category (unmatched first within each group)
    const grouped = new Map<string, BOMIngredient[]>();
    filtered.forEach(ing => {
      const cat = ing.category || "OTHER";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(ing);
    });
    // Sort items within each group: unmatched first
    grouped.forEach((items, cat) => {
      grouped.set(cat, items.sort((a, b) => {
        if (!a.inventory_item_id && b.inventory_item_id) return -1;
        if (a.inventory_item_id && !b.inventory_item_id) return 1;
        return (a.clean_name || a.r365_name).localeCompare(b.clean_name || b.r365_name);
      }));
    });
    // Sort by CATEGORY_ORDER
    const sorted = new Map<string, BOMIngredient[]>();
    CATEGORY_ORDER.forEach(cat => {
      if (grouped.has(cat)) sorted.set(cat, grouped.get(cat)!);
    });
    grouped.forEach((v, k) => {
      if (!sorted.has(k)) sorted.set(k, v);
    });
    
    return { unmatched: um, matched: m, groupedAll: sorted };
  }, [ingredients, globalFilter]);

  const getSuggestions = (ingredient: BOMIngredient): (InventoryItem & { score: number })[] => {
    if (!items) return [];
    const name = ingredient.clean_name || ingredient.r365_name;
    const search = itemSearch.toLowerCase();
    
    return items
      .map(item => {
        let score = scoreSimilarity(name, item.name);
        if (item.common_name) {
          score = Math.max(score, scoreSimilarity(name, item.common_name));
        }
        // If user is searching, also filter/boost by search
        if (search) {
          const matchesSearch =
            item.name.toLowerCase().includes(search) ||
            (item.common_name?.toLowerCase().includes(search)) ||
            (item.brand?.toLowerCase().includes(search));
          if (!matchesSearch) return { ...item, score: -1 };
        }
        return { ...item, score };
      })
      .filter(i => i.score >= 0)
      .sort((a, b) => {
        // Vendor items (PFG/PA) first
        const aVendor = a.vendor_source === 'pfg' || a.vendor_source === 'produce_alliance' ? 1 : 0;
        const bVendor = b.vendor_source === 'pfg' || b.vendor_source === 'produce_alliance' ? 1 : 0;
        if (bVendor !== aVendor) return bVendor - aVendor;
        return b.score - a.score;
      })
      .slice(0, 5);
  };

  const handleLink = async (ingredientId: string, inventoryItemId: string) => {
    setSaving(ingredientId);
    try {
      const { error } = await supabase
        .from("bom_ingredients")
        .update({ inventory_item_id: inventoryItemId })
        .eq("id", ingredientId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["bom-ingredients", locationId] });
      toast.success("Ingredient linked!");
      setExpandedId(null);
      setItemSearch("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to link ingredient");
    } finally {
      setSaving(null);
    }
  };

  const handleUnlink = async (ingredientId: string) => {
    setSaving(ingredientId);
    try {
      const { error } = await supabase
        .from("bom_ingredients")
        .update({ inventory_item_id: null })
        .eq("id", ingredientId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["bom-ingredients", locationId] });
      toast.success("Unlinked");
    } catch (err) {
      toast.error("Failed to unlink");
    } finally {
      setSaving(null);
    }
  };

  if (loadingIng || loadingItems) {
    return <div className="text-sm text-muted-foreground py-4 text-center">Loading ingredients…</div>;
  }

  if (!ingredients?.length) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No BOM ingredients found. Import recipes first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Recipe Ingredient Matching</h3>
        <Badge variant={unmatched.length > 0 ? "destructive" : "secondary"} className="text-[10px]">
          {unmatched.length} unmatched
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        Link R365 recipe ingredients to your real inventory items so theoretical usage flows correctly.
      </p>

      {/* Global filter */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Filter ingredients…"
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>

      {/* Unmatched list grouped by category */}
      <div className="space-y-2">
        {Array.from(groupedAll.entries()).map(([cat, catIngredients]) => {
          const isCollapsed = collapsedCategories.has(cat);
          const label = CATEGORY_LABELS[cat] || cat;
          
          return (
            <div key={cat} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => {
                  setCollapsedCategories(prev => {
                    const next = new Set(prev);
                    if (next.has(cat)) next.delete(cat);
                    else next.add(cat);
                    return next;
                  });
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{label}</span>
                  <Badge variant="outline" className="text-[10px]">{catIngredients.filter(i => !i.inventory_item_id).length}/{catIngredients.length}</Badge>
                </div>
                {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
              
              {!isCollapsed && (
                <div className="space-y-0.5 p-1">
                  {catIngredients.map(ing => {
                    const isMatched = !!ing.inventory_item_id;
                    const linkedItem = isMatched ? itemMap.get(ing.inventory_item_id!) : null;
                    const isExpanded = expandedId === ing.id;
                    const suggestions = isExpanded ? getSuggestions(ing) : [];

                    return (
                      <div key={ing.id} className={cn(
                        "border rounded overflow-hidden",
                        isMatched ? "border-primary/30 bg-primary/5" : "border-border/50"
                      )}>
                        <button
                          onClick={() => {
                            if (!isMatched) {
                              setExpandedId(isExpanded ? null : ing.id);
                              setItemSearch("");
                            }
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2 text-left transition-colors",
                            isMatched ? "cursor-default" : "hover:bg-muted/50"
                          )}
                        >
                          <div className="min-w-0">
                            <p className={cn("text-xs font-medium truncate", isMatched && "text-muted-foreground")}>{ing.clean_name || ing.r365_name}</p>
                            {isMatched && linkedItem ? (
                              <p className="text-[10px] text-primary truncate">→ {linkedItem.name}</p>
                            ) : (
                              ing.clean_name && ing.clean_name !== ing.r365_name && (
                                <p className="text-[10px] text-muted-foreground truncate">{ing.r365_name}</p>
                              )
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {ing.unit_standard && (
                              <Badge variant="outline" className="text-[10px]">{ing.unit_standard}</Badge>
                            )}
                            {isMatched ? (
                              <>
                                <Badge variant="outline" className="text-[10px] px-1.5 border-primary/40 text-primary bg-primary/10 gap-1">
                                  <Link2 className="h-3 w-3" />
                                  matched
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => { e.stopPropagation(); handleUnlink(ing.id); }}
                                  disabled={saving === ing.id}
                                >
                                  <Unlink className="h-3 w-3 text-destructive" />
                                </Button>
                              </>
                            ) : (
                              <>{isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</>
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-border bg-muted/30 px-3 py-2 space-y-2">
                            <div className="relative">
                              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                placeholder="Search inventory items…"
                                value={itemSearch}
                                onChange={e => setItemSearch(e.target.value)}
                                className="pl-7 h-8 text-xs"
                                autoFocus
                              />
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-1">
                              {suggestions.length === 0 && (
                                <p className="text-xs text-muted-foreground py-2 text-center">No items found</p>
                              )}
                              {suggestions.map(item => (
                                <button
                                  key={item.id}
                                  onClick={() => handleLink(ing.id, item.id)}
                                  disabled={saving === ing.id}
                                  className={cn(
                                    "w-full flex items-center justify-between px-2 py-1.5 rounded text-left hover:bg-primary/10 transition-colors text-xs",
                                    item.score >= 60 && "bg-primary/5 border border-primary/20"
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                     <div className="flex items-center gap-1.5">
                                       <p className="font-medium truncate">{item.name}</p>
                                       {item.vendor_source === 'pfg' && (
                                         <Badge variant="outline" className="text-[9px] px-1 shrink-0 border-blue-500/30 text-blue-600">PFG</Badge>
                                       )}
                                       {item.vendor_source === 'produce_alliance' && (
                                         <Badge variant="outline" className="text-[9px] px-1 shrink-0 border-green-500/30 text-green-600">PA</Badge>
                                       )}
                                     </div>
                                     <div className="flex gap-1.5 mt-0.5">
                                       {item.brand && <span className="text-muted-foreground">{item.brand}</span>}
                                       {item.pack_size && <span className="text-muted-foreground">• {item.pack_size}</span>}
                                     </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                    {item.score >= 60 && (
                                      <Badge variant="secondary" className="text-[9px] px-1">suggested</Badge>
                                    )}
                                    <Check className="h-3.5 w-3.5 text-primary" />
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
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

    </div>
  );
};

export default BOMIngredientMatcher;
