import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Search, Package, AlertTriangle, Zap, Tag } from 'lucide-react';
import { toast } from 'sonner';

interface BrandItemActivationProps {
  locationId: string;
  brandId: string;
}

export default function BrandItemActivation({ locationId, brandId }: BrandItemActivationProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);

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
      return data;
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

  // Toggle activation
  const toggleMutation = useMutation({
    mutationFn: async ({ brandItemId, activate }: { brandItemId: string; activate: boolean }) => {
      const existingItemId = linkedBrandIds.get(brandItemId);
      
      if (existingItemId) {
        // Item exists locally — toggle is_active
        const { error } = await supabase
          .from('inventory_items')
          .update({ is_active: activate })
          .eq('id', existingItemId);
        if (error) throw error;
      } else if (activate) {
        // Item doesn't exist locally — create it linked to brand
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
    },
    onSuccess: (_, { activate }) => {
      queryClient.invalidateQueries({ queryKey: ['location-brand-items', locationId] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items', locationId] });
      toast.success(activate ? 'Item activated' : 'Item deactivated');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to toggle item');
    },
  });

  // Check missing dependencies for recipes
  const getMissingDeps = (brandItem: typeof brandItems[0]) => {
    if (!brandItem.is_recipe || !brandItem.recipe_ingredients) return [];
    const ingredients = Array.isArray(brandItem.recipe_ingredients) 
      ? brandItem.recipe_ingredients as any[]
      : [];
    // For now, return empty — we can enhance this later with real sub-ingredient checking
    return ingredients.filter(() => false);
  };

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

  if (brandLoading || itemsLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Loading brand catalog...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="h-4 w-4" />
            Brand Catalog Activation
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">
            {activeCount}/{totalCount} active
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Toggle which brand items this location counts
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
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
          <div className="text-center py-6 text-muted-foreground text-sm">
            {searchQuery ? 'No items match your search' : 'No brand items available'}
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
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
                    const missingDeps = getMissingDeps(item);
                    return (
                      <div key={item.id} className="flex items-center justify-between px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">
                              {item.common_name || item.product_name}
                            </span>
                            {item.is_recipe && (
                              <Badge variant="outline" className="text-[9px] shrink-0">Recipe</Badge>
                            )}
                          </div>
                          {item.common_name && (
                            <p className="text-[10px] text-muted-foreground truncate">{item.product_name}</p>
                          )}
                          {missingDeps.length > 0 && !isActive && (
                            <div className="flex items-center gap-1 text-[10px] text-amber-600 mt-0.5">
                              <AlertTriangle className="h-3 w-3" />
                              Requires {missingDeps.length} inactive ingredients
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
    </Card>
  );
}
