import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Search, Package, AlertTriangle, Zap, Tag, ChevronDown, ChefHat, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface BrandItemActivationProps {
  locationId: string;
  brandId: string;
}

interface BrandTemplate {
  id: string;
  product_name: string;
  common_name: string | null;
  category: string | null;
  is_recipe: boolean;
  recipe_ingredients: any;
}

export default function BrandItemActivation({ locationId, brandId }: BrandItemActivationProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);
  const [depPrompt, setDepPrompt] = useState<{ recipe: BrandTemplate; deps: BrandTemplate[] } | null>(null);

  // Fetch brand templates (live only)
  const { data: brandItems = [], isLoading: brandLoading } = useQuery({
    queryKey: ['brand-templates-activation', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_inventory_templates')
        .select('id, product_name, common_name, category, is_recipe, recipe_ingredients')
        .eq('brand_id', brandId)
        .eq('status', 'live')
        .order('category')
        .order('product_name');
      if (error) throw error;
      return data as BrandTemplate[];
    },
  });

  // Fetch location's active brand-linked items
  const { data: activeItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['location-brand-items', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, brand_item_id, is_active, name')
        .eq('location_id', locationId)
        .not('brand_item_id', 'is', null);
      if (error) throw error;
      return data;
    },
  });

  const activeBrandIds = useMemo(() => {
    const set = new Set<string>();
    activeItems.forEach(item => {
      if (item.brand_item_id && item.is_active) set.add(item.brand_item_id);
    });
    return set;
  }, [activeItems]);

  const linkedBrandIds = useMemo(() => {
    const map = new Map<string, string>();
    activeItems.forEach(item => {
      if (item.brand_item_id) map.set(item.brand_item_id, item.id);
    });
    return map;
  }, [activeItems]);

  // Build a map from product_name → brand template id for dependency resolution
  const nameToTemplateId = useMemo(() => {
    const map = new Map<string, string>();
    brandItems.forEach(item => {
      map.set(item.product_name.toLowerCase(), item.id);
      if (item.common_name) map.set(item.common_name.toLowerCase(), item.id);
    });
    return map;
  }, [brandItems]);

  // Get missing dependencies for a recipe
  const getMissingDeps = (brandItem: BrandTemplate): BrandTemplate[] => {
    if (!brandItem.is_recipe || !brandItem.recipe_ingredients) return [];
    const ingredients = Array.isArray(brandItem.recipe_ingredients)
      ? brandItem.recipe_ingredients as any[]
      : [];

    const missing: BrandTemplate[] = [];
    for (const ing of ingredients) {
      const ingName = (ing.name || ing.product_name || '').toLowerCase();
      const ingBrandId = ing.brand_item_id || nameToTemplateId.get(ingName);
      if (ingBrandId && !activeBrandIds.has(ingBrandId)) {
        const tmpl = brandItems.find(bi => bi.id === ingBrandId);
        if (tmpl) missing.push(tmpl);
      }
    }
    return missing;
  };

  // Core activation function
  const activateSingle = async (brandItemId: string, activate: boolean) => {
    const existingItemId = linkedBrandIds.get(brandItemId);
    if (existingItemId) {
      const { error } = await supabase
        .from('inventory_items')
        .update({ is_active: activate })
        .eq('id', existingItemId);
      if (error) throw error;
    } else if (activate) {
      const brandItem = brandItems.find(bi => bi.id === brandItemId);
      if (!brandItem) throw new Error('Brand item not found');
      const { error } = await supabase
        .from('inventory_items')
        .insert({
          location_id: locationId,
          name: brandItem.product_name,
          brand_item_id: brandItemId,
          category: brandItem.category,
          common_name: brandItem.common_name,
          is_active: true,
          is_recipe: brandItem.is_recipe || false,
        });
      if (error) throw error;
    }
  };

  // Toggle activation
  const toggleMutation = useMutation({
    mutationFn: async ({ brandItemId, activate }: { brandItemId: string; activate: boolean }) => {
      // If activating a recipe, check for missing deps
      if (activate) {
        const brandItem = brandItems.find(bi => bi.id === brandItemId);
        if (brandItem?.is_recipe) {
          const missing = getMissingDeps(brandItem);
          if (missing.length > 0) {
            // Show dependency prompt instead of activating directly
            setDepPrompt({ recipe: brandItem, deps: missing });
            return 'dep_prompt';
          }
        }
      }
      await activateSingle(brandItemId, activate);
      return 'done';
    },
    onSuccess: (result, { activate }) => {
      if (result === 'dep_prompt') return; // Don't toast — dialog handles it
      queryClient.invalidateQueries({ queryKey: ['location-brand-items', locationId] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items', locationId] });
      toast.success(activate ? 'Item activated' : 'Item deactivated');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to toggle item');
    },
  });

  // Activate recipe + all dependencies in one tap
  const activateWithDepsMutation = useMutation({
    mutationFn: async ({ recipe, deps }: { recipe: BrandTemplate; deps: BrandTemplate[] }) => {
      // Activate all deps first
      for (const dep of deps) {
        await activateSingle(dep.id, true);
      }
      // Then activate the recipe
      await activateSingle(recipe.id, true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-brand-items', locationId] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items', locationId] });
      setDepPrompt(null);
      toast.success('Recipe and ingredients activated');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to activate');
    },
  });

  // Filter and group
  const filtered = useMemo(() => {
    let items = brandItems;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i =>
        i.product_name.toLowerCase().includes(q) ||
        (i.common_name || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q)
      );
    }
    if (showInactiveOnly) {
      items = items.filter(i => !activeBrandIds.has(i.id));
    }
    return items;
  }, [brandItems, searchQuery, showInactiveOnly, activeBrandIds]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    filtered.forEach(item => {
      const cat = item.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [filtered]);

  const activeCount = activeBrandIds.size;
  const totalCount = brandItems.length;
  const inactiveCount = totalCount - activeCount;

  if (brandLoading || itemsLoading) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-muted-foreground text-sm">
          Loading brand catalog...
        </CardContent>
      </Card>
    );
  }

  if (totalCount === 0) return null;

  return (
    <>
      <Card>
        <Collapsible defaultOpen={inactiveCount > 0}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left">
              <Package className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold flex-1">Brand Catalog</span>
              <Badge variant="secondary" className="text-[10px]">
                {activeCount}/{totalCount} active
              </Badge>
              {inactiveCount > 0 && (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                  {inactiveCount} available
                </Badge>
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                Toggle which brand items this location stocks and counts
              </p>

              {/* Search + filter */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search brand items..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                <Button
                  variant={showInactiveOnly ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowInactiveOnly(!showInactiveOnly)}
                  className="text-xs shrink-0"
                >
                  Inactive only
                </Button>
              </div>

              {/* Grouped items */}
              {Object.keys(grouped).length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  {searchQuery ? 'No items match your search' : 'No brand items available'}
                </div>
              ) : (
                <div className="space-y-3 max-h-[50vh] overflow-y-auto">
                  {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => (
                    <div key={category}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{category}</span>
                        <Badge variant="outline" className="text-[9px] ml-auto">
                          {items.filter(i => activeBrandIds.has(i.id)).length}/{items.length}
                        </Badge>
                      </div>
                      <div className="divide-y divide-border rounded-lg border">
                        {items.map(item => {
                          const isActive = activeBrandIds.has(item.id);
                          const missingDeps = item.is_recipe ? getMissingDeps(item) : [];
                          return (
                            <div key={item.id} className="flex items-center justify-between px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium truncate">
                                    {item.common_name || item.product_name}
                                  </span>
                                  {item.is_recipe && (
                                    <Badge variant="outline" className="text-[9px] shrink-0">
                                      <ChefHat className="h-2.5 w-2.5 mr-0.5" />
                                      Recipe
                                    </Badge>
                                  )}
                                </div>
                                {item.common_name && (
                                  <p className="text-[10px] text-muted-foreground truncate">{item.product_name}</p>
                                )}
                                {missingDeps.length > 0 && !isActive && (
                                  <div className="flex items-center gap-1 text-[10px] text-amber-600 mt-0.5">
                                    <AlertTriangle className="h-3 w-3" />
                                    {missingDeps.length} inactive ingredient{missingDeps.length > 1 ? 's' : ''} needed
                                  </div>
                                )}
                              </div>
                              <Switch
                                checked={isActive}
                                onCheckedChange={(checked) => {
                                  toggleMutation.mutate({ brandItemId: item.id, activate: checked });
                                }}
                                disabled={toggleMutation.isPending}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick activate all */}
              {totalCount > 0 && activeCount < totalCount && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 text-xs"
                  onClick={() => {
                    const inactive = brandItems.filter(i => !activeBrandIds.has(i.id));
                    if (inactive.length > 20) {
                      toast.info(`This would activate ${inactive.length} items. Use the toggles individually for safety.`);
                      return;
                    }
                    inactive.forEach(item => {
                      toggleMutation.mutate({ brandItemId: item.id, activate: true });
                    });
                  }}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Activate all ({totalCount - activeCount} remaining)
                </Button>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Dependency Activation Prompt */}
      <Dialog open={!!depPrompt} onOpenChange={(open) => !open && setDepPrompt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <ChefHat className="h-4 w-4" />
              Activate Recipe + Ingredients
            </DialogTitle>
            <DialogDescription className="text-xs">
              <strong>{depPrompt?.recipe.common_name || depPrompt?.recipe.product_name}</strong> requires {depPrompt?.deps.length} ingredient{(depPrompt?.deps.length || 0) > 1 ? 's' : ''} that aren't active yet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border divide-y divide-border">
              {depPrompt?.deps.map(dep => (
                <div key={dep.id} className="flex items-center gap-2 px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  <span className="text-sm truncate">{dep.common_name || dep.product_name}</span>
                  <Badge variant="outline" className="text-[9px] ml-auto shrink-0">{dep.category}</Badge>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDepPrompt(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 gap-1.5"
                disabled={activateWithDepsMutation.isPending}
                onClick={() => {
                  if (depPrompt) {
                    activateWithDepsMutation.mutate({
                      recipe: depPrompt.recipe,
                      deps: depPrompt.deps,
                    });
                  }
                }}
              >
                <Zap className="h-3.5 w-3.5" />
                {activateWithDepsMutation.isPending ? 'Activating...' : `Activate all (${(depPrompt?.deps.length || 0) + 1})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
