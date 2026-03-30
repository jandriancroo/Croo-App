import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// Separator removed — unused
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft, Package, BookOpen, Search, Plus, Archive, Tag, ChefHat,
  BarChart3, Building2, CheckCircle2, Clock, Zap, ArrowRight, GitBranch, Eye,
  RefreshCw, Shield, FileText, MoreHorizontal, Pencil, AlertTriangle,
} from 'lucide-react';
import BrandTriageTab from '@/components/inventory/BrandTriageTab';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import RecipeCatalog from '@/components/inventory/RecipeCatalog';

const INVENTORY_CATEGORIES = [
  "Dough", "Sauce", "Cheese", "Meat", "Veggie", "Condiments", "Desserts",
  "Dry Goods", "Beverages", "Paper Goods", "Cleaning", "Other"
];

export default function BrandInventory() {
  const { brandId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isSuperAdmin, isBrandAdmin, loading: roleLoading } = useUserRole();
  const [activeTab, setActiveTab] = useState('catalog');
  const [catalogFilter, setCatalogFilter] = useState<'live' | 'draft' | 'archived'>('live');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [newItemDialog, setNewItemDialog] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemIsRecipe, setNewItemIsRecipe] = useState(false);

  // Source location for recipe catalog
  const [sourceLocationId, setSourceLocationId] = useState<string | null>(null);

  const { data: brand, isLoading: brandLoading } = useQuery({
    queryKey: ['brand-detail', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('*')
        .eq('id', brandId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!brandId,
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['brand-templates', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_inventory_templates')
        .select('*')
        .eq('brand_id', brandId!)
        .order('category', { ascending: true })
        .order('product_name', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!brandId,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['brand-locations', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, locations(id, name, store_number)')
        .eq('brand_id', brandId!);
      if (error) throw error;
      const locs = data?.flatMap(org => org.locations || []) || [];
      // Auto-select first location as source if not set
      if (locs.length > 0 && !sourceLocationId) {
        setSourceLocationId(locs[0].id);
      }
      return locs;
    },
    enabled: !!brandId,
  });

  // Activation stats per location
  const { data: activationStats = [] } = useQuery({
    queryKey: ['brand-activation-stats', brandId],
    queryFn: async () => {
      const locationIds = locations.map((l: any) => l.id);
      if (locationIds.length === 0) return [];
      const { data, error } = await supabase
        .from('inventory_items')
        .select('location_id, brand_item_id, is_active')
        .not('brand_item_id', 'is', null)
        .in('location_id', locationIds);
      if (error) throw error;
      return data || [];
    },
    enabled: locations.length > 0,
  });

  const locationActivationMap = useMemo(() => {
    const map = new Map<string, { active: number; total: number }>();
    for (const stat of activationStats) {
      const key = stat.location_id;
      if (!map.has(key)) map.set(key, { active: 0, total: 0 });
      const entry = map.get(key)!;
      entry.total++;
      if (stat.is_active) entry.active++;
    }
    return map;
  }, [activationStats]);

  // Status counts
  const statusCounts = useMemo(() => ({
    live: templates.filter(t => t.status === 'live' || !t.status).length,
    draft: templates.filter(t => t.status === 'draft').length,
    archived: templates.filter(t => t.status === 'archived').length,
  }), [templates]);

  const filteredTemplates = useMemo(() => {
    let items = templates.filter(t => {
      const status = t.status || 'live';
      return status === catalogFilter;
    });
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i =>
        i.product_name.toLowerCase().includes(q) ||
        (i.common_name || '').toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q)
      );
    }
    return items;
  }, [templates, catalogFilter, searchQuery]);

  const groupedTemplates = useMemo(() => {
    const groups: Record<string, typeof filteredTemplates> = {};
    filteredTemplates.forEach(t => {
      const cat = t.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });
    return groups;
  }, [filteredTemplates]);

  // Status change mutation
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('brand_inventory_templates')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['brand-templates', brandId] });
      toast.success(`Item ${status === 'live' ? 'published' : status === 'archived' ? 'archived' : 'set to draft'}`);
    },
    onError: () => toast.error('Failed to update status'),
  });

  // Update template mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: { id: string; product_name?: string; common_name?: string; category?: string }) => {
      const { id, ...fields } = updates;
      const { error } = await supabase
        .from('brand_inventory_templates')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-templates', brandId] });
      toast.success('Item updated');
      setEditingTemplate(null);
    },
    onError: () => toast.error('Failed to update'),
  });

  // Create new item mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('brand_inventory_templates')
        .insert({
          brand_id: brandId!,
          product_name: newItemName,
          category: newItemCategory || null,
          is_recipe: newItemIsRecipe,
          status: 'draft',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-templates', brandId] });
      toast.success('Item created as draft');
      setNewItemDialog(false);
      setNewItemName('');
      setNewItemCategory('');
      setNewItemIsRecipe(false);
    },
    onError: () => toast.error('Failed to create item'),
  });

  if (roleLoading || brandLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </Layout>
    );
  }

  if (!isSuperAdmin && !isBrandAdmin) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Shield className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">Only brand administrators can access brand inventory.</p>
          <Button variant="outline" onClick={() => navigate('/brands')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Brands
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/brands')} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {brand?.logo_url && (
              <img src={brand.logo_url} alt={brand?.name} className="h-9 w-9 object-contain rounded-lg border bg-background p-1" />
            )}
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">{brand?.name} Inventory</h1>
              <p className="text-xs text-muted-foreground">
                Brand catalog • {statusCounts.live} live • {locations.length} locations
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="catalog" className="gap-1.5">
              <Package className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Catalog</span>
            </TabsTrigger>
            <TabsTrigger value="recipes" className="gap-1.5">
              <ChefHat className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Recipes</span>
            </TabsTrigger>
            <TabsTrigger value="locations" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Locations</span>
            </TabsTrigger>
            <TabsTrigger value="guide" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Guide</span>
            </TabsTrigger>
          </TabsList>

          {/* ===== CATALOG TAB ===== */}
          <TabsContent value="catalog" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex gap-2">
                {(['live', 'draft', 'archived'] as const).map(filter => (
                  <Button
                    key={filter}
                    variant={catalogFilter === filter ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCatalogFilter(filter)}
                    className="capitalize"
                  >
                    {filter === 'live' && <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                    {filter === 'draft' && <Clock className="h-3.5 w-3.5 mr-1.5" />}
                    {filter === 'archived' && <Archive className="h-3.5 w-3.5 mr-1.5" />}
                    {filter}
                    <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">
                      {statusCounts[filter]}
                    </Badge>
                  </Button>
                ))}
              </div>
              <div className="flex-1 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search items..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setNewItemDialog(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  New Item
                </Button>
              </div>
            </div>

            {templatesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading catalog...</div>
            ) : filteredTemplates.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-1">
                    {searchQuery ? 'No items match your search' : `No ${catalogFilter} items`}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                    {catalogFilter === 'live' && !searchQuery && "Create items or promote drafts to populate the live catalog."}
                    {catalogFilter === 'draft' && "Draft items are being tested before going live."}
                    {catalogFilter === 'archived' && "Archived items are hidden from locations but data is preserved."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {Object.entries(groupedTemplates)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([category, items]) => (
                    <Card key={category}>
                      <CardHeader className="py-3 px-4">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                            {category}
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px]">
                              {items.length} items
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {items.filter(i => i.is_recipe).length} recipes
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="px-4 pb-3 pt-0">
                        <div className="divide-y divide-border">
                          {items.map(item => (
                            <div key={item.id} className="flex items-center justify-between py-2.5 gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm truncate">
                                    {item.common_name || item.product_name}
                                  </span>
                                  {item.is_recipe && (
                                    <Badge variant="outline" className="text-[10px] shrink-0">Recipe</Badge>
                                  )}
                                  {item.status === 'draft' && (
                                    <Badge variant="secondary" className="text-[10px] shrink-0 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                                      Draft
                                    </Badge>
                                  )}
                                </div>
                                {item.common_name && (
                                  <p className="text-xs text-muted-foreground truncate">{item.product_name}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {item.product_group_name ? (
                                  <Badge variant="secondary" className="text-[10px]">POS ✓</Badge>
                                ) : item.is_recipe ? (
                                  <Badge variant="outline" className="text-[10px] text-muted-foreground">No POS</Badge>
                                ) : null}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => setEditingTemplate(item)}>
                                      <Pencil className="h-3.5 w-3.5 mr-2" />
                                      Edit
                                    </DropdownMenuItem>
                                    {(item.status === 'draft' || !item.status) && (
                                      <DropdownMenuItem onClick={() => statusMutation.mutate({ id: item.id, status: 'live' })}>
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                                        Publish (Live)
                                      </DropdownMenuItem>
                                    )}
                                    {item.status === 'live' && (
                                      <DropdownMenuItem onClick={() => statusMutation.mutate({ id: item.id, status: 'draft' })}>
                                        <Clock className="h-3.5 w-3.5 mr-2" />
                                        Revert to Draft
                                      </DropdownMenuItem>
                                    )}
                                    {item.status !== 'archived' && (
                                      <DropdownMenuItem
                                        className="text-destructive"
                                        onClick={() => statusMutation.mutate({ id: item.id, status: 'archived' })}
                                      >
                                        <Archive className="h-3.5 w-3.5 mr-2" />
                                        Archive
                                      </DropdownMenuItem>
                                    )}
                                    {item.status === 'archived' && (
                                      <DropdownMenuItem onClick={() => statusMutation.mutate({ id: item.id, status: 'live' })}>
                                        <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                        Restore to Live
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}
          </TabsContent>

          {/* ===== RECIPES TAB ===== */}
          <TabsContent value="recipes" className="space-y-4">
            {/* Source location picker */}
            <Card>
              <CardContent className="p-3 flex items-center gap-3">
                <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Recipe data source</p>
                </div>
                <Select
                  value={sourceLocationId || ''}
                  onValueChange={setSourceLocationId}
                >
                  <SelectTrigger className="h-8 w-auto max-w-[200px] text-xs">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc: any) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name} {loc.store_number ? `#${loc.store_number}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {sourceLocationId ? (
              <RecipeCatalog locationId={sourceLocationId} />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <ChefHat className="h-10 w-10 text-muted-foreground mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground">Select a source location to view recipes</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===== LOCATIONS TAB ===== */}
          <TabsContent value="locations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Location Activation Status
                </CardTitle>
                <CardDescription className="text-xs">
                  How many brand catalog items each location has activated
                </CardDescription>
              </CardHeader>
              <CardContent>
                {locations.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No locations found</p>
                ) : (
                  <div className="divide-y divide-border">
                    {locations.map((loc: any) => {
                      const stats = locationActivationMap.get(loc.id);
                      const active = stats?.active || 0;
                      const _total = stats?.total || 0;
                      const liveCount = statusCounts.live;
                      const pct = liveCount > 0 ? Math.round((active / liveCount) * 100) : 0;
                      return (
                        <div key={loc.id} className="flex items-center justify-between py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{loc.name}</span>
                              {loc.store_number && (
                                <Badge variant="outline" className="text-[10px]">#{loc.store_number}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 max-w-[120px] h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground">
                                {active}/{liveCount} active
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs"
                            onClick={() => navigate(`/inventory/${loc.id}`)}
                          >
                            View
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Category overview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Categories
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(templates.map(t => t.category).filter(Boolean))].sort().map(cat => (
                    <Badge key={cat} variant="outline" className="text-xs">{cat}</Badge>
                  ))}
                  {templates.every(t => !t.category) && (
                    <p className="text-xs text-muted-foreground">No categories defined</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== GUIDE TAB ===== */}
          <TabsContent value="guide" className="space-y-4">
            <BrandInventoryGuide locationCount={locations.length} itemCount={statusCounts.live} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Template Dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Brand Item</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <EditTemplateForm
              template={editingTemplate}
              onSave={(updates) => updateMutation.mutate({ id: editingTemplate.id, ...updates })}
              isPending={updateMutation.isPending}
              onCancel={() => setEditingTemplate(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* New Item Dialog */}
      <Dialog open={newItemDialog} onOpenChange={setNewItemDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">New Brand Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Product Name</Label>
              <Input
                placeholder="e.g. Mozzarella Shredded"
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={newItemCategory || '__none__'} onValueChange={v => setNewItemCategory(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {INVENTORY_CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Is Recipe / Prep Item</Label>
              <Switch checked={newItemIsRecipe} onCheckedChange={setNewItemIsRecipe} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setNewItemDialog(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={!newItemName.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Creating...' : 'Create as Draft'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// ─── Edit Form Component ────────────────────────────────────
function EditTemplateForm({
  template,
  onSave,
  isPending,
  onCancel,
}: {
  template: any;
  onSave: (updates: { product_name?: string; common_name?: string; category?: string }) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template.product_name || '');
  const [commonName, setCommonName] = useState(template.common_name || '');
  const [category, setCategory] = useState(template.category || '');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Product Name</Label>
        <Input value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Common Name</Label>
        <Input
          placeholder="Short display name"
          value={commonName}
          onChange={e => setCommonName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={category || '__none__'} onValueChange={v => setCategory(v === '__none__' ? '' : v)}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No category</SelectItem>
            {INVENTORY_CATEGORIES.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button
          className="flex-1"
          disabled={isPending || !name.trim()}
          onClick={() => onSave({ product_name: name, common_name: commonName || null, category: category || null } as any)}
        >
          {isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// ─── How It Works Guide Component ───────────────────────────────────
function BrandInventoryGuide({ locationCount, itemCount }: { locationCount: number; itemCount: number }) {
  return (
    <ScrollArea className="h-[calc(100vh-220px)]">
      <div className="space-y-6 pb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Brand Inventory — The Control Room
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              This page is the <strong className="text-foreground">single source of truth</strong> for your entire brand's inventory system.
              Every recipe, every ingredient, every POS mapping is defined here once and shared across all {locationCount} locations.
            </p>
            <p>
              Think of it like a franchise playbook — you write the rules here, and each store follows them.
              Stores can choose which items they carry (activation), but they can't change what a recipe <em>is</em>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              Brand vs Location — Who Controls What
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  Brand Controls (This Page)
                </h4>
                <ul className="space-y-1.5 text-muted-foreground">
                  {[
                    'Item names, categories, common names',
                    'Recipe definitions (MI, BASE, CORE, PREP)',
                    'POS mapping strings',
                    'Pan baseline conversion math',
                    'Product group definitions',
                    'Item lifecycle (draft → live → archive)',
                  ].map(t => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-blue-500" />
                  Location Controls (Store Pages)
                </h4>
                <ul className="space-y-1.5 text-muted-foreground">
                  {[
                    'Item activation (toggle what they count)',
                    'Storage locations (Walk-in, Dry, Line)',
                    'Vendor SKU/cost links (PFG/PA)',
                    'Count shortcuts & ordering',
                    'Pan size toggles (which sizes they use)',
                    'PFG/PA sync triggers',
                  ].map(t => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              Item Lifecycle
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-full px-3 py-1 text-xs font-medium">
                <Clock className="h-3 w-3" />
                Draft
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-1.5 bg-green-500/10 text-green-700 dark:text-green-400 rounded-full px-3 py-1 text-xs font-medium">
                <CheckCircle2 className="h-3 w-3" />
                Live
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-1.5 bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs font-medium">
                <Archive className="h-3 w-3" />
                Archived
              </div>
            </div>
            <ul className="space-y-2 mt-3">
              <li>
                <strong className="text-foreground">Draft:</strong> Testing phase. Only brand admins see it.
                Use a source location's sales data to validate recipes before publishing.
              </li>
              <li>
                <strong className="text-foreground">Live:</strong> Available to all locations for activation.
                Test products can be live but only activated at specific test stores.
              </li>
              <li>
                <strong className="text-foreground">Archived:</strong> Soft-deleted. Removed from future counts.
                Historical data preserved. Can be restored anytime.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              What Locations See
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              On the <strong className="text-foreground">Items tab</strong>, store managers see a "Brand Catalog" banner
              showing available items with simple on/off toggles. Only <strong>ingredients and prep recipes</strong> need
              activation — the Recipe Catalog (MIs, BASEs, COREs) is always present since POS menus are the same everywhere.
            </p>
            <div className="bg-muted/50 rounded-lg p-3 space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span>Mozzarella</span>
                <span className="text-green-500">✅ Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pepperoni</span>
                <span className="text-green-500">✅ Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Birria Seasoning (test)</span>
                <span className="text-muted-foreground">⬚ Inactive</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Edge Cases
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ul className="space-y-3">
              <li>
                <strong className="text-foreground">Vendor SKU changes:</strong> Location-level operation.
                Brand catalog doesn't care about vendor SKUs — each store maps their own distributor.
              </li>
              <li>
                <strong className="text-foreground">Test products:</strong> Published as Live, only activated at test stores.
                Other locations see it in their catalog but leave it off.
              </li>
              <li>
                <strong className="text-foreground">Recipe doesn't sell at a location:</strong> The recipe catalog
                is always present (POS menu is the same). Zero sales = zero depletion. No action needed.
              </li>
              <li>
                <strong className="text-foreground">Item archived while active:</strong> Removed from future counts.
                In-progress counts finish normally. Historical data preserved.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Current Status
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">{itemCount} live items</strong> across{' '}
              <strong className="text-foreground">{locationCount} locations</strong>.
              Brand-managed fields (names, categories, recipes, POS mappings) are read-only at the location level.
            </p>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
