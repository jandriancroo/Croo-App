import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Package, BookOpen, Settings, History, Search, Plus, Archive, FileText, Layers, Tag, ChefHat, Utensils, BarChart3, Building2, CheckCircle2, XCircle, Clock, Zap, ArrowRight, GitBranch, Eye, EyeOff, RefreshCw, Shield } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function BrandInventory() {
  const { brandId } = useParams();
  const navigate = useNavigate();
  const { isSuperAdmin, isBrandAdmin, loading: roleLoading } = useUserRole();
  const [activeTab, setActiveTab] = useState('catalog');
  const [catalogFilter, setCatalogFilter] = useState<'live' | 'draft' | 'archived'>('live');
  const [searchQuery, setSearchQuery] = useState('');

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
      return data?.flatMap(org => org.locations || []) || [];
    },
    enabled: !!brandId,
  });

  // Group templates by category
  const groupedTemplates = templates.reduce((acc: Record<string, typeof templates>, t) => {
    const cat = t.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  const recipeTemplates = templates.filter(t => t.is_recipe);
  const ingredientTemplates = templates.filter(t => !t.is_recipe);

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
                Brand catalog • {templates.length} items • {locations.length} locations
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
            <TabsTrigger value="settings" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </TabsTrigger>
            <TabsTrigger value="guide" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">How It Works</span>
            </TabsTrigger>
          </TabsList>

          {/* ===== CATALOG TAB ===== */}
          <TabsContent value="catalog" className="space-y-4">
            {/* Filter pills + search */}
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
                      {filter === 'live' ? templates.length : 0}
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
                <Button size="sm" className="gap-1.5 shrink-0">
                  <Plus className="h-3.5 w-3.5" />
                  New Item
                </Button>
              </div>
            </div>

            {/* Items grouped by category */}
            {templatesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading catalog...</div>
            ) : templates.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Package className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-1">Empty Catalog</h3>
                  <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                    This brand has no inventory items yet. Import from a source location or create items manually.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      <Upload className="h-4 w-4 mr-2" />
                      Import from Location
                    </Button>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Item
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {Object.entries(groupedTemplates)
                  .filter(([_, items]) => {
                    if (!searchQuery) return true;
                    return items.some(i => i.product_name.toLowerCase().includes(searchQuery.toLowerCase()));
                  })
                  .map(([category, items]) => {
                    const filteredItems = searchQuery
                      ? items.filter(i => i.product_name.toLowerCase().includes(searchQuery.toLowerCase()))
                      : items;
                    
                    return (
                      <Card key={category}>
                        <CardHeader className="py-3 px-4">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                              {category}
                            </CardTitle>
                            <Badge variant="secondary" className="text-[10px]">
                              {filteredItems.length} items
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="px-4 pb-3 pt-0">
                          <div className="divide-y divide-border">
                            {filteredItems.map(item => (
                              <div key={item.id} className="flex items-center justify-between py-2.5 gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm truncate">{item.product_name}</span>
                                    {item.is_recipe && (
                                      <Badge variant="outline" className="text-[10px] shrink-0">Recipe</Badge>
                                    )}
                                  </div>
                                  {item.common_name && (
                                    <p className="text-xs text-muted-foreground truncate">{item.common_name}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {item.product_group_name ? (
                                    <Badge variant="secondary" className="text-[10px]">POS ✓</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] text-muted-foreground">No POS</Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            )}
          </TabsContent>

          {/* ===== RECIPES TAB ===== */}
          <TabsContent value="recipes" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Recipe Catalog</CardTitle>
                    <CardDescription>Brand-standard recipes — MI, BASE, CORE, PREP definitions</CardDescription>
                  </div>
                  <Badge variant="secondary">{recipeTemplates.length} recipes</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {recipeTemplates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ChefHat className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No recipes in the brand catalog yet.</p>
                    <p className="text-xs mt-1">Import from your source location to populate.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {recipeTemplates.map(r => (
                      <div key={r.id} className="flex items-center justify-between py-2.5">
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-sm">{r.product_name}</span>
                          {r.recipe_yield_qty && r.recipe_yield_unit && (
                            <p className="text-xs text-muted-foreground">
                              Yields {r.recipe_yield_qty} {r.recipe_yield_unit}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {r.recipe_ingredients ? (
                            <Badge variant="secondary" className="text-[10px]">
                              {Array.isArray(r.recipe_ingredients) ? (r.recipe_ingredients as any[]).length : 0} ingredients
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">Empty</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== SETTINGS TAB ===== */}
          <TabsContent value="settings" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Categories
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Item categories used across all locations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set(templates.map(t => t.category).filter(Boolean))].map(cat => (
                      <Badge key={cat} variant="outline" className="text-xs">{cat}</Badge>
                    ))}
                    {templates.every(t => !t.category) && (
                      <p className="text-xs text-muted-foreground">No categories defined</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Pan Baselines
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Weight-to-unit conversion standards
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {templates.filter(t => t.pan_baseline_key !== 'full').length} items with custom baselines
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Locations
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Stores referencing this brand catalog
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {locations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No locations found</p>
                  ) : (
                    <div className="space-y-1.5">
                      {locations.map((loc: any) => (
                        <div key={loc.id} className="flex items-center justify-between text-sm">
                          <span>{loc.name}</span>
                          {loc.store_number && (
                            <Badge variant="outline" className="text-[10px]">#{loc.store_number}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Source Location
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Validation data source for recipe accuracy
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Uses Hemet sales data for theoretical COGS validation
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ===== HOW IT WORKS TAB ===== */}
          <TabsContent value="guide" className="space-y-4">
            <BrandInventoryGuide locationCount={locations.length} itemCount={templates.length} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

// ─── How It Works Guide Component ───────────────────────────────────
function BrandInventoryGuide({ locationCount, itemCount }: { locationCount: number; itemCount: number }) {
  return (
    <ScrollArea className="h-[calc(100vh-220px)]">
      <div className="space-y-6 pb-8">
        {/* Overview */}
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
              Stores can choose which items they carry, but they can't change what a "Large Pepperoni Pizza" <em>is</em>.
            </p>
          </CardContent>
        </Card>

        {/* Brand vs Location */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              Brand Level vs Location Level
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
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                    Recipe definitions (MI, BASE, CORE, PREP)
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                    POS mapping strings (what QU item links to what recipe)
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                    Categories & common names
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                    Pan baseline conversion math
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                    Product group definitions
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
                    Item lifecycle (draft → live → archive)
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-blue-500" />
                  Location Controls (Store Pages)
                </h4>
                <ul className="space-y-1.5 text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
                    Item activation (toggle what they count)
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
                    Storage locations (Walk-in, Dry, Line, etc.)
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
                    Vendor SKU/cost overrides
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
                    PFG/PA sync triggers
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
                    Count shortcuts
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
                    Pan size toggles (which sizes they use)
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Item Lifecycle */}
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
                <strong className="text-foreground">Draft:</strong> Testing phase. Item exists only in the catalog. 
                Use your source location's sales data to validate recipes before going live.
                Only brand admins can see drafts.
              </li>
              <li>
                <strong className="text-foreground">Live:</strong> Available to all locations. 
                Store managers can activate/deactivate live items for their specific store.
                Changes to live items take effect on the next count cycle (never mid-count).
              </li>
              <li>
                <strong className="text-foreground">Archived:</strong> Soft-deleted. Removed from all future count sheets. 
                Historical data (past counts, COGS) is fully preserved. 
                Can be restored if a product comes back.
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* How Locations See It */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              What Locations See
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              When a store manager opens their inventory settings, they see a <strong className="text-foreground">catalog of all live brand items</strong> with 
              simple on/off toggles. Think of it like a PFG catalog — thousands of products exist, but you only order what your store needs.
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
                <span>Birria Pizza</span>
                <span className="text-muted-foreground">⬚ Inactive</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Goat Cheese</span>
                <span className="text-muted-foreground">⬚ Inactive</span>
              </div>
            </div>
            <p>
              Activating a recipe automatically checks for missing sub-ingredients and prompts a one-tap activation for all dependencies.
            </p>
          </CardContent>
        </Card>

        {/* Edge Cases */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Edge Cases & Safety
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ul className="space-y-3">
              <li>
                <strong className="text-foreground">Recipe updated mid-count:</strong> Changes take effect next count cycle. 
                Active counts keep the recipe version they started with.
              </li>
              <li>
                <strong className="text-foreground">Item archived while active at stores:</strong> Removed from future count sheets. 
                In-progress counts complete normally. All historical data preserved.
              </li>
              <li>
                <strong className="text-foreground">Vendor SKU varies by region:</strong> Brand item = "Pepperoni" with standard recipe. 
                Local vendor SKU/cost is location-level data — each store links their own distributor's SKU.
              </li>
              <li>
                <strong className="text-foreground">POS item doesn't exist at a location:</strong> Mapping is by string name. 
                If the store hasn't added it to QU yet, reconciliation shows zero sales — no error.
              </li>
              <li>
                <strong className="text-foreground">Test product at one location:</strong> Create as draft, validate with that location's data, 
                then promote to live when ready. Other locations see it but don't have to activate it.
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Triage & Vendor Sync */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Utensils className="h-4 w-4 text-primary" />
              Triage & Vendor Sync
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              The <strong className="text-foreground">Brand Triage Queue</strong> handles unmapped vendor items from all locations in one view. 
              When PFG swaps a SKU (same product, new number), the swap detection engine identifies the change 
              automatically using fuzzy name matching and price correlation.
            </p>
            <p>
              Confirming a swap at the brand level instantly updates the vendor SKU link for <em>all</em> locations 
              referencing that item. No store-level mapping needed.
            </p>
          </CardContent>
        </Card>

        {/* Permissions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Who Can Do What
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-foreground mb-1">Super Admin / Brand Admin</h4>
                <p className="text-muted-foreground text-xs">
                  Full control over brand catalog: create/edit/archive items, manage recipes, 
                  set POS mappings, define categories, configure pan baselines. 
                  This is you — the franchise operator.
                </p>
              </div>
              <Separator />
              <div>
                <h4 className="font-semibold text-foreground mb-1">Org Admin / Location Admin</h4>
                <p className="text-muted-foreground text-xs">
                  Activate/deactivate brand items for their store, manage storage locations, 
                  set local vendor SKUs, trigger PFG/PA syncs, toggle pan sizes.
                  Can't change recipes or categories.
                </p>
              </div>
              <Separator />
              <div>
                <h4 className="font-semibold text-foreground mb-1">Manager / Team Member</h4>
                <p className="text-muted-foreground text-xs">
                  Count inventory, view items. Can trigger syncs if permission is enabled. 
                  Cannot change any settings.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Migration Note */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Migration Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Currently <strong className="text-foreground">{itemCount} items</strong> are in the brand catalog 
              across <strong className="text-foreground">{locationCount} locations</strong>.
            </p>
            <p>
              The full migration will promote Hemet's inventory data as the brand standard, 
              link all location items to brand references, and transition the location inventory pages 
              to read-only mode for brand-controlled fields (recipes, categories, POS mappings).
            </p>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
