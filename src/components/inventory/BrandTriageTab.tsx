import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, CheckCircle2, Upload, Trash2,
  ArrowRight, Plus, Loader2, X, ChevronRight, ChevronLeft,
  TreePine, Utensils, Sparkles,
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

type TriageCard = 
  | { type: 'matched'; catalog: CatalogItem; staging: StagingItem[] }
  | { type: 'unmatched'; staging: StagingItem[] };

export default function BrandTriageTab({ brandId, locations }: BrandTriageTabProps) {
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [importText, setImportText] = useState('');
  const [importDialog, setImportDialog] = useState(false);
  const [importVendor, setImportVendor] = useState('');
  // Track items removed from the current card's branches
  const [removedFromCard, setRemovedFromCard] = useState<Set<string>>(new Set());

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

  // Build triage cards: matched groups first, then one "unmatched" card at the end
  const triageCards: TriageCard[] = useMemo(() => {
    const matched: Map<string, { catalog: CatalogItem; staging: StagingItem[] }> = new Map();
    const unmatched: StagingItem[] = [];

    for (const item of stagingItems) {
      const nameNorm = item.product_name.toLowerCase().trim();
      let bestMatch: CatalogItem | null = null;
      let bestScore = 0;

      for (const cat of catalogItems) {
        const catNorm = cat.product_name.toLowerCase().trim();
        if (catNorm === nameNorm) { bestMatch = cat; bestScore = 100; break; }
        if (item.item_number && cat.item_number && item.item_number === cat.item_number) {
          bestMatch = cat; bestScore = 90; break;
        }
        if (catNorm.includes(nameNorm) || nameNorm.includes(catNorm)) {
          const score = Math.min(catNorm.length, nameNorm.length) / Math.max(catNorm.length, nameNorm.length) * 80;
          if (score > bestScore) { bestScore = score; bestMatch = cat; }
        }
      }

      if (bestMatch && bestScore >= 40) {
        if (!matched.has(bestMatch.id)) matched.set(bestMatch.id, { catalog: bestMatch, staging: [] });
        matched.get(bestMatch.id)!.staging.push(item);
      } else {
        unmatched.push(item);
      }
    }

    const cards: TriageCard[] = Array.from(matched.values())
      .sort((a, b) => b.staging.length - a.staging.length)
      .map(g => ({ type: 'matched' as const, catalog: g.catalog, staging: g.staging }));

    if (unmatched.length > 0) {
      cards.push({ type: 'unmatched' as const, staging: unmatched });
    }

    return cards;
  }, [stagingItems, catalogItems]);

  const totalCards = triageCards.length;
  const safeIndex = Math.min(currentIndex, Math.max(0, totalCards - 1));
  const currentCard = triageCards[safeIndex] || null;

  // Get active branches for the current card (excluding removed ones)
  const activeBranches = useMemo(() => {
    if (!currentCard) return [];
    return currentCard.staging.filter(s => !removedFromCard.has(s.id));
  }, [currentCard, removedFromCard]);

  // Search: find staging items NOT in current card's branches to manually add
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !currentCard || currentCard.type !== 'matched') return [];
    const q = searchQuery.toLowerCase();
    const currentIds = new Set(currentCard.staging.map(s => s.id));
    return stagingItems.filter(s =>
      !currentIds.has(s.id) &&
      !removedFromCard.has(s.id) &&
      (s.product_name.toLowerCase().includes(q) || (s.item_number || '').includes(q))
    ).slice(0, 8);
  }, [searchQuery, currentCard, stagingItems, removedFromCard]);

  const goNext = useCallback(() => {
    setRemovedFromCard(new Set());
    setSearchQuery('');
    setCurrentIndex(i => Math.min(i + 1, totalCards - 1));
  }, [totalCards]);

  const goPrev = useCallback(() => {
    setRemovedFromCard(new Set());
    setSearchQuery('');
    setCurrentIndex(i => Math.max(i - 1, 0));
  }, []);

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async ({ lines, vendor }: { lines: string[]; vendor: string }) => {
      const rows = lines.map(l => l.trim()).filter(l => l.length > 0)
        .map(l => ({ brand_id: brandId, product_name: l, vendor_source: vendor || null, status: 'pending' }));
      if (rows.length === 0) throw new Error('No items to import');
      const { error } = await supabase.from('brand_inventory_staging' as any).insert(rows as any);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(`Imported ${count} items to staging`);
      setImportDialog(false); setImportText(''); setImportVendor('');
      queryClient.invalidateQueries({ queryKey: ['brand-triage-staging'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // EAT mutation — consume (delete) staging items, keep MAIN
  const eatMutation = useMutation({
    mutationFn: async (stagingIds: string[]) => {
      const { error } = await supabase
        .from('brand_inventory_staging' as any)
        .update({ status: 'consumed' } as any)
        .in('id', stagingIds);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('🍽️ Nom nom! Duplicates consumed');
      setRemovedFromCard(new Set());
      setSearchQuery('');
      queryClient.invalidateQueries({ queryKey: ['brand-triage-staging'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Promote mutation — add unmatched item to catalog
  const promoteMutation = useMutation({
    mutationFn: async (item: StagingItem) => {
      const { error: insertErr } = await supabase
        .from('brand_inventory_templates')
        .insert({
          brand_id: brandId, product_name: item.product_name,
          item_number: item.item_number, vendor_source: item.vendor_source,
          category: item.category || 'Other', status: 'draft',
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
      const { error } = await supabase.from('brand_inventory_staging' as any).delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Discarded');
      queryClient.invalidateQueries({ queryKey: ['brand-triage-staging'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleEat = () => {
    if (!currentCard || currentCard.type !== 'matched') return;
    const idsToEat = activeBranches.map(s => s.id);
    if (idsToEat.length === 0) { goNext(); return; }
    eatMutation.mutate(idsToEat);
  };

  const handleRemoveBranch = (id: string) => {
    setRemovedFromCard(prev => new Set(prev).add(id));
  };

  const handleAddFromSearch = (item: StagingItem) => {
    if (!currentCard || currentCard.type !== 'matched') return;
    // Add to current card's staging list in-memory
    currentCard.staging.push(item);
    setSearchQuery('');
  };

  const totalPending = stagingItems.length;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <TreePine className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold">Item Triage</h2>
            <p className="text-[11px] text-muted-foreground">
              {totalPending === 0 ? 'All clear!' : `${totalPending} items to resolve`}
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setImportDialog(true)} className="gap-1.5 text-xs">
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
      </div>

      {loadingStaging ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />
          Loading triage data...
        </div>
      ) : totalPending === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-16 w-16 rounded-2xl bg-green-500/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <h3 className="font-semibold mb-1">Staging Clear</h3>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              No items to triage. Import vendor lists to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${totalCards > 0 ? ((safeIndex + 1) / totalCards) * 100 : 0}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              {safeIndex + 1} / {totalCards}
            </span>
          </div>

          {/* Card */}
          <AnimatePresence mode="wait">
            {currentCard && (
              <motion.div
                key={`card-${safeIndex}`}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.25 }}
              >
                {currentCard.type === 'matched' ? (
                  /* ============ MATCHED CARD — TREE LAYOUT ============ */
                  <Card className="overflow-hidden">
                    <CardContent className="p-0">
                      {/* Three-column tree */}
                      <div className="grid grid-cols-[1fr_auto_1fr] min-h-[200px]">
                        {/* Column 1: MAIN item (the trunk) */}
                        <div className="p-4 md:p-6 flex flex-col justify-center border-r border-border/50">
                          <Badge className="w-fit mb-2 bg-primary/10 text-primary border-primary/30 text-[10px]">
                            MAIN ITEM
                          </Badge>
                          <h3 className="text-base md:text-lg font-bold leading-tight">
                            {currentCard.catalog.product_name}
                          </h3>
                          {currentCard.catalog.category && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-muted/50 w-fit mt-2">
                              {currentCard.catalog.category}
                            </Badge>
                          )}
                        </div>

                        {/* Column 2: Branches (imported items with arrows) */}
                        <div className="flex flex-col justify-center px-2 md:px-4 py-4 bg-muted/20 min-w-[200px] md:min-w-[280px]">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                            Vendor Matches ({activeBranches.length})
                          </span>
                          <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                            {activeBranches.map((s, idx) => (
                              <motion.div
                                key={s.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                className="flex items-center gap-2 group"
                              >
                                <ArrowRight className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                                <div className="flex-1 min-w-0 bg-background rounded-lg px-2.5 py-1.5 border border-border/40 flex items-center justify-between gap-1">
                                  <div className="min-w-0">
                                    <span className="text-xs font-medium truncate block">{s.product_name}</span>
                                    <div className="flex items-center gap-1.5">
                                      {s.item_number && (
                                        <span className="text-[10px] text-muted-foreground font-mono">#{s.item_number}</span>
                                      )}
                                      {s.vendor_source && (
                                        <span className="text-[10px] text-muted-foreground">{s.vendor_source}</span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleRemoveBranch(s.id)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-destructive/10 rounded"
                                  >
                                    <X className="h-3 w-3 text-destructive" />
                                  </button>
                                </div>
                              </motion.div>
                            ))}
                            {activeBranches.length === 0 && (
                              <p className="text-xs text-muted-foreground italic px-1">
                                No branches — skip or search to add
                              </p>
                            )}
                          </div>

                          {/* Search to add more branches */}
                          <div className="mt-3 relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <Input
                              placeholder="Search to add items..."
                              value={searchQuery}
                              onChange={e => setSearchQuery(e.target.value)}
                              className="pl-7 h-7 text-xs"
                            />
                            {searchResults.length > 0 && (
                              <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                {searchResults.map(r => (
                                  <button
                                    key={r.id}
                                    onClick={() => handleAddFromSearch(r)}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
                                  >
                                    <Plus className="h-3 w-3 text-primary shrink-0" />
                                    <span className="truncate">{r.product_name}</span>
                                    {r.item_number && (
                                      <span className="text-[10px] text-muted-foreground ml-auto shrink-0">#{r.item_number}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Column 3: EAT button */}
                        <div className="flex flex-col items-center justify-center p-4 md:p-6 border-l border-border/50">
                          <Button
                            size="lg"
                            onClick={handleEat}
                            disabled={eatMutation.isPending}
                            className="gap-2 h-14 w-full max-w-[140px] rounded-xl text-base font-bold bg-gradient-to-b from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg"
                          >
                            {eatMutation.isPending ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Utensils className="h-5 w-5" />
                            )}
                            EAT
                          </Button>
                          <span className="text-[10px] text-muted-foreground mt-2 text-center">
                            Consume {activeBranches.length} item{activeBranches.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  /* ============ UNMATCHED CARD — ADD or DISCARD ============ */
                  <Card className="overflow-hidden">
                    <CardContent className="p-4 md:p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        <h3 className="text-sm font-bold">New Items — No Match Found</h3>
                        <Badge variant="outline" className="text-[10px] ml-auto">
                          {currentCard.staging.length} items
                        </Badge>
                      </div>
                      <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                        {currentCard.staging.map(item => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/30"
                          >
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium truncate block">{item.product_name}</span>
                              <div className="flex items-center gap-1.5">
                                {item.vendor_source && (
                                  <span className="text-[10px] text-muted-foreground">{item.vendor_source}</span>
                                )}
                                {item.item_number && (
                                  <span className="text-[10px] text-muted-foreground font-mono">#{item.item_number}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-6 px-2 gap-1"
                                onClick={() => promoteMutation.mutate(item)}
                                disabled={promoteMutation.isPending}
                              >
                                <Plus className="h-3 w-3" /> Add
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-[10px] h-6 px-1.5 text-destructive"
                                onClick={() => discardMutation.mutate([item.id])}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-destructive gap-1"
                          onClick={() => discardMutation.mutate(currentCard.staging.map(i => i.id))}
                        >
                          <Trash2 className="h-3 w-3" /> Discard All
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="ghost"
              onClick={goPrev}
              disabled={safeIndex === 0}
              className="gap-1 text-xs"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {currentCard?.type === 'matched'
                ? `${activeBranches.length} branch${activeBranches.length !== 1 ? 'es' : ''}`
                : `${currentCard?.staging.length ?? 0} new items`
              }
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={goNext}
              disabled={safeIndex >= totalCards - 1}
              className="gap-1 text-xs"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
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
                onClick={() => importMutation.mutate({ lines: importText.split('\n'), vendor: importVendor })}
                disabled={importMutation.isPending || !importText.trim()}
                className="gap-1"
              >
                {importMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                Import to Staging
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
