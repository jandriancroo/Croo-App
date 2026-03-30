import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Search, AlertTriangle, CheckCircle2, Package, Upload, Trash2,
  ArrowRight, Plus, Loader2, Merge, X,
} from 'lucide-react';

interface BrandTriageTabProps {
  brandId: string;
  locations: { id: string; name: string; store_number?: string }[];
}

interface StagingItem {
  id: string;
  product_name: string;
  item_number: string | null;
  vendor_source: string | null;
  category: string | null;
  matched_template_id: string | null;
  status: string;
}

interface CatalogItem {
  id: string;
  product_name: string;
  item_number: string | null;
  vendor_source: string | null;
  category: string | null;
  status: string;
}

export default function BrandTriageTab({ brandId, locations }: BrandTriageTabProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [importText, setImportText] = useState('');
  const [importDialog, setImportDialog] = useState(false);
  const [importVendor, setImportVendor] = useState('');
  const [consumeTarget, setConsumeTarget] = useState<CatalogItem | null>(null);
  const [selectedForConsume, setSelectedForConsume] = useState<Set<string>>(new Set());

  // Fetch staging items
  const { data: stagingItems = [], isLoading: loadingStaging } = useQuery({
    queryKey: ['brand-triage-staging', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_inventory_staging' as any)
        .select('id, product_name, item_number, vendor_source, category, matched_template_id, status')
        .eq('brand_id', brandId)
        .eq('status', 'pending')
        .order('product_name');
      if (error) throw error;
      return (data || []) as unknown as StagingItem[];
    },
  });

  // Fetch catalog items for matching
  const { data: catalogItems = [] } = useQuery({
    queryKey: ['brand-triage-catalog', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_inventory_templates')
        .select('id, product_name, item_number, vendor_source, category, status')
        .eq('brand_id', brandId)
        .in('status', ['live', 'draft'])
        .order('product_name');
      if (error) throw error;
      return (data || []) as CatalogItem[];
    },
  });

  // Auto-match: group staging items by best catalog match
  const { matchedGroups, unmatchedStaging } = useMemo(() => {
    const matched: Map<string, { catalog: CatalogItem; staging: StagingItem[] }> = new Map();
    const unmatched: StagingItem[] = [];

    for (const item of stagingItems) {
      const nameNorm = item.product_name.toLowerCase().trim();
      // Try exact name match first, then fuzzy
      let bestMatch: CatalogItem | null = null;
      let bestScore = 0;

      for (const cat of catalogItems) {
        const catNorm = cat.product_name.toLowerCase().trim();
        // Exact match
        if (catNorm === nameNorm) {
          bestMatch = cat;
          bestScore = 100;
          break;
        }
        // Item number match
        if (item.item_number && cat.item_number && item.item_number === cat.item_number) {
          bestMatch = cat;
          bestScore = 90;
          break;
        }
        // Fuzzy: one contains the other
        if (catNorm.includes(nameNorm) || nameNorm.includes(catNorm)) {
          const score = Math.min(catNorm.length, nameNorm.length) / Math.max(catNorm.length, nameNorm.length) * 80;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = cat;
          }
        }
      }

      if (bestMatch && bestScore >= 40) {
        if (!matched.has(bestMatch.id)) {
          matched.set(bestMatch.id, { catalog: bestMatch, staging: [] });
        }
        matched.get(bestMatch.id)!.staging.push(item);
      } else {
        unmatched.push(item);
      }
    }

    return {
      matchedGroups: Array.from(matched.values()).sort((a, b) => b.staging.length - a.staging.length),
      unmatchedStaging: unmatched,
    };
  }, [stagingItems, catalogItems]);

  // Filter
  const filteredMatched = useMemo(() => {
    if (!search) return matchedGroups;
    const q = search.toLowerCase();
    return matchedGroups.filter(g =>
      g.catalog.product_name.toLowerCase().includes(q) ||
      g.staging.some(s => s.product_name.toLowerCase().includes(q))
    );
  }, [matchedGroups, search]);

  const filteredUnmatched = useMemo(() => {
    if (!search) return unmatchedStaging;
    const q = search.toLowerCase();
    return unmatchedStaging.filter(s =>
      s.product_name.toLowerCase().includes(q) ||
      (s.item_number || '').toLowerCase().includes(q)
    );
  }, [unmatchedStaging, search]);

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async ({ lines, vendor }: { lines: string[]; vendor: string }) => {
      const rows = lines
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => ({
          brand_id: brandId,
          product_name: l,
          vendor_source: vendor || null,
          status: 'pending',
        }));
      if (rows.length === 0) throw new Error('No items to import');
      const { error } = await supabase.from('brand_inventory_staging' as any).insert(rows as any);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(`Imported ${count} items to staging`);
      setImportDialog(false);
      setImportText('');
      setImportVendor('');
      queryClient.invalidateQueries({ queryKey: ['brand-triage-staging'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Consume mutation — deletes staging items, keeps catalog item
  const consumeMutation = useMutation({
    mutationFn: async (stagingIds: string[]) => {
      const { error } = await supabase
        .from('brand_inventory_staging' as any)
        .update({ status: 'consumed' } as any)
        .in('id', stagingIds);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Duplicates consumed!');
      setConsumeTarget(null);
      setSelectedForConsume(new Set());
      queryClient.invalidateQueries({ queryKey: ['brand-triage-staging'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Promote mutation — add staging item to catalog
  const promoteMutation = useMutation({
    mutationFn: async (item: StagingItem) => {
      const { error: insertErr } = await supabase
        .from('brand_inventory_templates')
        .insert({
          brand_id: brandId,
          product_name: item.product_name,
          item_number: item.item_number,
          vendor_source: item.vendor_source,
          category: item.category || 'Other',
          status: 'draft',
        } as any);
      if (insertErr) throw insertErr;
      const { error: updateErr } = await supabase
        .from('brand_inventory_staging' as any)
        .update({ status: 'promoted' } as any)
        .eq('id', item.id);
      if (updateErr) throw updateErr;
    },
    onSuccess: () => {
      toast.success('Item added to catalog');
      queryClient.invalidateQueries({ queryKey: ['brand-triage-staging'] });
      queryClient.invalidateQueries({ queryKey: ['brand-triage-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['brand-catalog-templates'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Discard mutation
  const discardMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('brand_inventory_staging' as any)
        .delete()
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Discarded');
      queryClient.invalidateQueries({ queryKey: ['brand-triage-staging'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const totalPending = stagingItems.length;

  // Consume dialog — pick which staging items the MAIN item eats
  const openConsumeDialog = (catalog: CatalogItem, staging: StagingItem[]) => {
    setConsumeTarget(catalog);
    setSelectedForConsume(new Set(staging.map(s => s.id)));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Merge className="h-4 w-4 text-primary" />
                Import Triage
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Import vendor items, match them to your catalog, consume duplicates, and promote new items.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setImportDialog(true)} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Import Items
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-3">
            <Badge
              variant={totalPending === 0 ? 'default' : 'outline'}
              className={totalPending === 0
                ? 'bg-green-500/10 text-green-700 border-green-500/30'
                : 'text-amber-600 border-amber-500/30'
              }
            >
              {totalPending === 0 ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" />Staging clear</>
              ) : (
                <><AlertTriangle className="h-3 w-3 mr-1" />{totalPending} items in staging</>
              )}
            </Badge>
            {matchedGroups.length > 0 && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {matchedGroups.length} matched · {unmatchedStaging.length} new
              </Badge>
            )}
          </div>

          {totalPending > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search staging & catalog items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {loadingStaging ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
          Loading staging data...
        </div>
      ) : totalPending === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4 opacity-60" />
            <h3 className="font-medium mb-1">Staging Clear</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              No items in the staging queue. Use "Import Items" to paste vendor lists for triage.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* MATCHED ITEMS — catalog items that have staging dupes */}
          {filteredMatched.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                Matched — Consume Duplicates ({filteredMatched.reduce((s, g) => s + g.staging.length, 0)})
              </h3>
              {filteredMatched.map(({ catalog, staging }) => (
                <Card key={catalog.id} className="overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{catalog.product_name}</span>
                        <Badge variant="default" className="text-[9px] shrink-0 bg-primary/10 text-primary border-primary/30">
                          MAIN
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {catalog.vendor_source && (
                          <span className="text-[10px] text-muted-foreground">{catalog.vendor_source}</span>
                        )}
                        {catalog.item_number && (
                          <span className="text-[10px] text-muted-foreground">#{catalog.item_number}</span>
                        )}
                        {catalog.category && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0">{catalog.category}</Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1 text-xs h-7"
                      onClick={() => openConsumeDialog(catalog, staging)}
                    >
                      <Merge className="h-3 w-3" />
                      Eat {staging.length}
                    </Button>
                  </div>
                  <div className="border-t border-border bg-muted/30 px-4 py-2 space-y-1">
                    {staging.map(s => (
                      <div key={s.id} className="flex items-center justify-between text-xs py-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate text-muted-foreground">{s.product_name}</span>
                          {s.item_number && <span className="text-[10px] text-muted-foreground">#{s.item_number}</span>}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{s.vendor_source}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* UNMATCHED ITEMS — new items to promote or discard */}
          {filteredUnmatched.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  New Items — Promote or Discard ({filteredUnmatched.length})
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-destructive h-6"
                  onClick={() => discardMutation.mutate(filteredUnmatched.map(i => i.id))}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Discard All
                </Button>
              </div>
              {filteredUnmatched.map(item => (
                <Card key={item.id}>
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{item.product_name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {item.vendor_source && (
                          <span className="text-[10px] text-muted-foreground">{item.vendor_source}</span>
                        )}
                        {item.item_number && (
                          <span className="text-[10px] text-muted-foreground">#{item.item_number}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1"
                        onClick={() => promoteMutation.mutate(item)}
                        disabled={promoteMutation.isPending}
                      >
                        <Plus className="h-3 w-3" />
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7 text-destructive"
                        onClick={() => discardMutation.mutate([item.id])}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* IMPORT DIALOG */}
      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Vendor Items</DialogTitle>
            <DialogDescription className="text-xs">
              Paste one item name per line from your vendor order guide.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Vendor name (e.g. PFG, Produce Alliance)"
              value={importVendor}
              onChange={e => setImportVendor(e.target.value)}
              className="h-9"
            />
            <textarea
              className="w-full h-40 rounded-lg border border-input/50 bg-muted px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={"Mozzarella Shredded 5lb\nPepperoni Sliced 2lb\nSausage Italian 5lb\n..."}
              value={importText}
              onChange={e => setImportText(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {importText.split('\n').filter(l => l.trim()).length} items
              </span>
              <Button
                size="sm"
                onClick={() => importMutation.mutate({
                  lines: importText.split('\n'),
                  vendor: importVendor,
                })}
                disabled={importMutation.isPending || !importText.trim()}
                className="gap-1"
              >
                {importMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                Import to Staging
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* CONSUME CONFIRMATION DIALOG */}
      <Dialog open={!!consumeTarget} onOpenChange={() => setConsumeTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Consume Duplicates</DialogTitle>
            <DialogDescription className="text-xs">
              The MAIN item will persist. Selected staging items will be removed.
            </DialogDescription>
          </DialogHeader>
          {consumeTarget && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Package className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <span className="text-sm font-semibold block truncate">{consumeTarget.product_name}</span>
                  <span className="text-[10px] text-muted-foreground">MAIN — stays in catalog</span>
                </div>
              </div>
              <ScrollArea className="max-h-48">
                <div className="space-y-1">
                  {matchedGroups
                    .find(g => g.catalog.id === consumeTarget.id)
                    ?.staging.map(s => {
                      const isSelected = selectedForConsume.has(s.id);
                      return (
                        <div
                          key={s.id}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                            isSelected ? 'bg-destructive/10 border border-destructive/20' : 'hover:bg-muted'
                          }`}
                          onClick={() => {
                            const next = new Set(selectedForConsume);
                            if (isSelected) next.delete(s.id);
                            else next.add(s.id);
                            setSelectedForConsume(next);
                          }}
                        >
                          <Trash2 className={`h-3 w-3 shrink-0 ${isSelected ? 'text-destructive' : 'text-muted-foreground'}`} />
                          <span className="text-sm truncate">{s.product_name}</span>
                        </div>
                      );
                    })}
                </div>
              </ScrollArea>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConsumeTarget(null)}>Cancel</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1"
                  disabled={selectedForConsume.size === 0 || consumeMutation.isPending}
                  onClick={() => consumeMutation.mutate(Array.from(selectedForConsume))}
                >
                  {consumeMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Merge className="h-3 w-3" />
                  )}
                  Consume {selectedForConsume.size}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
