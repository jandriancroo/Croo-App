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
  match_keywords: string[];
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
        .select('id, product_name, common_name, category, is_recipe, recipe_ingredients, match_keywords')
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
    // First pass: set any linked item
    activeItems.forEach(item => {
      if (item.brand_item_id) map.set(item.brand_item_id, item.id);
    });
    // Second pass: prefer the active one (for duplicates)
    activeItems.forEach(item => {
      if (item.brand_item_id && item.is_active) map.set(item.brand_item_id, item.id);
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
      if (activate) {
        // Activate just the primary item
        const { error } = await supabase
          .from('inventory_items')
          .update({ is_active: true })
          .eq('id', existingItemId);
        if (error) throw error;
      } else {
        // Deactivate ALL local items linked to this brand template (handles duplicates)
        const { error } = await supabase
          .from('inventory_items')
          .update({ is_active: false })
          .eq('location_id', locationId)
          .eq('brand_item_id', brandItemId);
        if (error) throw error;
      }
    } else if (activate) {
      const brandItem = brandItems.find(bi => bi.id === brandItemId);
      if (!brandItem) throw new Error('Brand item not found');

      // FIRST: check for any existing deactivated item already linked to this brand template
      const { data: deactivatedLinked } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('location_id', locationId)
        .eq('brand_item_id', brandItemId)
        .eq('is_active', false)
        .limit(1)
        .maybeSingle();

      if (deactivatedLinked) {
        // Re-activate the existing item instead of creating a new one
        const { error } = await supabase
          .from('inventory_items')
          .update({ is_active: true, name: brandItem.product_name, category: brandItem.category })
          .eq('id', deactivatedLinked.id);
        if (error) throw error;
        return;
      }

      // Fetch pack metadata from an existing deployment (source location's item)
      let packMeta: { count_unit?: string; count_units_per_case?: number; pack_size?: string; pack_quantity?: number } = {};
      const { data: existingDeploy } = await supabase
        .from('brand_inventory_deployments')
        .select('inventory_item_id')
        .eq('template_id', brandItemId)
        .order('deployed_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existingDeploy?.inventory_item_id) {
        const { data: sourceItem } = await supabase
          .from('inventory_items')
          .select('count_unit, count_units_per_case, pack_size, pack_quantity')
          .eq('id', existingDeploy.inventory_item_id)
          .maybeSingle();
        if (sourceItem) {
          packMeta = {
            ...(sourceItem.count_unit ? { count_unit: sourceItem.count_unit } : {}),
            ...(sourceItem.count_units_per_case ? { count_units_per_case: sourceItem.count_units_per_case } : {}),
            ...(sourceItem.pack_size ? { pack_size: sourceItem.pack_size } : {}),
            ...(sourceItem.pack_quantity ? { pack_quantity: sourceItem.pack_quantity } : {}),
          };
        }
      }

      // Try to find an existing unlinked local item that matches by name/keywords
      const matchTerms = [
        brandItem.product_name.toLowerCase(),
        ...(brandItem.common_name ? [brandItem.common_name.toLowerCase()] : []),
        ...(brandItem.match_keywords || []).map(k => k.toLowerCase()),
      ];

      const { data: unlinkeds } = await supabase
        .from('inventory_items')
        .select('id, name')
        .eq('location_id', locationId)
        .is('brand_item_id', null);

      const matchedLocal = unlinkeds?.find(local => {
        const localName = (local.name || '').toLowerCase();
        return matchTerms.some(term =>
          localName.includes(term) || term.includes(localName)
        );
      });

      if (matchedLocal) {
        const { error } = await supabase
          .from('inventory_items')
          .update({
            brand_item_id: brandItemId,
            name: brandItem.product_name,
            category: brandItem.category,
            is_active: true,
            ...packMeta,
          })
          .eq('id', matchedLocal.id);
        if (error) throw error;
        toast.info(`Linked existing "${matchedLocal.name}" to brand item`);
      } else {
        const { error } = await supabase
          .from('inventory_items')
          .insert({
            location_id: locationId,
            name: brandItem.product_name,
            brand_item_id: brandItemId,
            category: brandItem.category,
            is_active: true,
            is_recipe: brandItem.is_recipe || false,
            ...packMeta,
          });
        if (error) throw error;
      }
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
            setDepPrompt({ recipe: brandItem, deps: missing });
            return 'dep_prompt';
          }
        }
      }
      await activateSingle(brandItemId, activate);
      return 'done';
    },
    onMutate: async ({ brandItemId, activate }) => {
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: ['location-brand-items', locationId] });
      const previous = queryClient.getQueryData(['location-brand-items', locationId]);
      // Optimistically update the active items list
      queryClient.setQueryData(['location-brand-items', locationId], (old: any[] | undefined) => {
        if (!old) return old;
        return old.map(item =>
          item.brand_item_id === brandItemId ? { ...item, is_active: activate } : item
        );
      });
      return { previous };
    },
    onSuccess: (result, { activate }) => {
      if (result === 'dep_prompt') return;
      queryClient.invalidateQueries({ queryKey: ['location-brand-items', locationId] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items', locationId] });
      toast.success(activate ? 'Item activated' : 'Item deactivated');
    },
    onError: (err: any, _vars, context) => {
      // Roll back optimistic update
      if (context?.previous) {
        queryClient.setQueryData(['location-brand-items', locationId], context.previous);
      }
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
