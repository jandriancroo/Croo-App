import { useEffect, useMemo, useState, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Sparkles, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ActiveConversion } from '@/hooks/useBrandConversions';

interface CatalogItem {
  id: string;
  product_name: string;
  common_name: string | null;
  category: string | null;
}

interface ConversionSlideOverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  items: CatalogItem[];
  conversionMap: Map<string, ActiveConversion>;
  initialItemId: string | null;
  onItemChange?: (itemId: string | null) => void;
  onConversionsChanged?: () => void;
}

const CANONICAL_UNITS = ['ea', 'lb', 'oz', 'g', 'gal', 'qt'];

interface FormState {
  canonical_unit: string;
}

function conversionToForm(c: ActiveConversion | undefined): FormState {
  return { canonical_unit: c?.canonical_unit || 'ea' };
}

function StatusBadge({ source }: { source: string }) {
  if (source === 'needs_review') {
    return (
      <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 gap-1">
        <AlertTriangle className="h-3 w-3" /> Needs Review
      </Badge>
    );
  }
  if (source === 'manual_override') {
    return (
      <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Manual
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1">
      <CheckCircle2 className="h-3 w-3" /> Confirmed
    </Badge>
  );
}

export default function ConversionSlideOver({
  open,
  onOpenChange,
  brandId,
  items,
  conversionMap,
  initialItemId,
  onItemChange,
  onConversionsChanged,
}: ConversionSlideOverProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('conversion');
  const [currentItemId, setCurrentItemId] = useState<string | null>(initialItemId);
  const [form, setForm] = useState<FormState>(conversionToForm(undefined));
  const [saving, setSaving] = useState(false);

  const currentIndex = useMemo(
    () => (currentItemId ? items.findIndex((i) => i.id === currentItemId) : -1),
    [items, currentItemId]
  );
  const currentItem = currentIndex >= 0 ? items[currentIndex] : null;
  const activeConversion = currentItemId ? conversionMap.get(currentItemId) : undefined;

  const totalCount = items.length;
  const confirmedCount = useMemo(
    () =>
      items.reduce((acc, it) => {
        const c = conversionMap.get(it.id);
        if (c && c.source !== 'needs_review') return acc + 1;
        return acc;
      }, 0),
    [items, conversionMap]
  );
  const remaining = totalCount - confirmedCount;
  const progressPct = totalCount > 0 ? (confirmedCount / totalCount) * 100 : 0;

  const findNextNeedsReview = useCallback(
    (fromIdx: number): string | null => {
      if (items.length === 0) return null;
      for (let step = 1; step <= items.length; step++) {
        const idx = (fromIdx + step) % items.length;
        const c = conversionMap.get(items[idx].id);
        if (!c || c.source === 'needs_review') return items[idx].id;
      }
      return null;
    },
    [items, conversionMap]
  );
  const nextReviewId = currentIndex >= 0 ? findNextNeedsReview(currentIndex) : null;

  useEffect(() => {
    if (open) {
      let target = initialItemId;
      if (!target) {
        target = findNextNeedsReview(-1) ?? items[0]?.id ?? null;
      }
      setCurrentItemId(target);
    }
  }, [open, initialItemId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setForm(conversionToForm(activeConversion));
  }, [currentItemId, activeConversion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) onItemChange?.(currentItemId);
  }, [currentItemId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const goPrev = useCallback(() => {
    if (items.length === 0) return;
    const idx = currentIndex < 0 ? 0 : (currentIndex - 1 + items.length) % items.length;
    setCurrentItemId(items[idx].id);
  }, [items, currentIndex]);

  const goNext = useCallback(() => {
    if (items.length === 0) return;
    const idx = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    setCurrentItemId(items[idx].id);
  }, [items, currentIndex]);

  const goNextReview = useCallback(() => {
    if (nextReviewId) setCurrentItemId(nextReviewId);
  }, [nextReviewId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key.toLowerCase() === 'r') { e.preventDefault(); goNextReview(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, goPrev, goNext, goNextReview]);

  const baseline = useMemo(() => conversionToForm(activeConversion), [activeConversion?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const isDirty = form.canonical_unit !== baseline.canonical_unit;

  const persistConversion = async (sourceLabel: 'manual_override', valuesFrom: 'form' | 'current') => {
    if (!currentItemId || !activeConversion) {
      toast.error('No active conversion to update');
      return;
    }
    if (valuesFrom === 'form' && !form.canonical_unit) {
      toast.error('Tracking unit is required');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      const { error: closeErr } = await supabase
        .from('item_conversions')
        .update({ effective_to: now })
        .eq('id', activeConversion.id);
      if (closeErr) throw closeErr;

      // Carry forward all non-canonical fields. Use sensible defaults if previous row was needs_review with no data.
      const isPlaceholder = activeConversion.source === 'needs_review';
      const carry = {
        outer_qty: isPlaceholder ? 1 : (activeConversion.outer_qty ?? 1),
        outer_unit: isPlaceholder ? 'ea' : (activeConversion.outer_unit ?? 'ea'),
        has_inner: isPlaceholder ? false : !!activeConversion.has_inner,
        inner_qty: isPlaceholder ? null : activeConversion.inner_qty,
        inner_unit: isPlaceholder ? null : activeConversion.inner_unit,
        canonical_qty_per_inner: isPlaceholder ? 1 : (activeConversion.canonical_qty_per_inner ?? 1),
      };

      const canonical_unit =
        valuesFrom === 'form' ? form.canonical_unit : activeConversion.canonical_unit;

      const { error: insertErr } = await supabase.from('item_conversions').insert({
        brand_template_id: currentItemId,
        brand_id: brandId,
        ...carry,
        canonical_unit,
        source: sourceLabel,
        version: (activeConversion.version || 1) + 1,
        effective_from: now,
        effective_to: null,
      });
      if (insertErr) throw insertErr;

      toast.success(valuesFrom === 'form' ? 'Conversion saved' : 'Confirmed');
      await queryClient.invalidateQueries({ queryKey: ['brand-conversions', brandId] });
      onConversionsChanged?.();
    } catch (e: any) {
      console.error('[ConversionSlideOver] save failed', e);
      toast.error(e?.message || 'Failed to save conversion');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => persistConversion('manual_override', 'form');
  const handleConfirm = () => persistConversion('manual_override', 'current');

  const sourceLabel = activeConversion?.source ?? 'needs_review';
  const itemPosition = currentIndex >= 0 ? currentIndex + 1 : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 gap-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-xl font-bold truncate">
                {currentItem?.common_name || currentItem?.product_name || 'No item'}
              </SheetTitle>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {currentItem?.category && (
                  <Badge variant="outline" className="text-[10px]">{currentItem.category}</Badge>
                )}
                <StatusBadge source={sourceLabel} />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{confirmedCount} of {totalCount} confirmed</span>
              {remaining > 0 ? (
                <span className="text-orange-600 dark:text-orange-400 font-medium">{remaining} remaining</span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> All confirmed
                </span>
              )}
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={goPrev} className="gap-1 px-2">
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {itemPosition} of {totalCount}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={goNext} className="gap-1 px-2">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={goNextReview}
                disabled={!nextReviewId}
                className="gap-1 px-2 text-orange-600 dark:text-orange-400 disabled:text-muted-foreground"
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Next review
              </Button>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-5 mt-3 grid grid-cols-3">
            <TabsTrigger value="conversion">Conversion</TabsTrigger>
            <TabsTrigger value="count">Count</TabsTrigger>
            <TabsTrigger value="depletion">Depletion</TabsTrigger>
          </TabsList>

          <TabsContent value="conversion" className="flex-1 overflow-y-auto px-5 py-4 space-y-5 mt-0">
            {!currentItem ? (
              <div className="text-sm text-muted-foreground text-center py-12">No item selected</div>
            ) : (
              <>
                {activeConversion && activeConversion.source !== 'needs_review' && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Current
                    </div>
                    <div className="text-sm font-medium">
                      Tracked in: <span className="font-semibold">{form.canonical_unit || '—'}</span>
                    </div>
                  </div>
                )}

                {sourceLabel === 'needs_review' && (
                  <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-sm flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                    <span>What unit does your team count this item in?</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Track inventory in</Label>
                  <Select
                    value={form.canonical_unit}
                    onValueChange={(v) => setForm({ canonical_unit: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CANONICAL_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 pt-2">
                  {isDirty ? (
                    <Button onClick={handleSave} disabled={saving} className="w-full">
                      {saving ? 'Saving…' : 'Save Conversion'}
                    </Button>
                  ) : sourceLabel === 'vendor_auto' || sourceLabel === 'needs_review' ? (
                    <Button onClick={handleConfirm} disabled={saving} className="w-full gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />
                      {saving ? 'Confirming…' : 'Confirm ✓'}
                    </Button>
                  ) : null}

                  {!isDirty && nextReviewId && nextReviewId !== currentItemId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={goNextReview}
                      className="w-full gap-1.5 text-orange-600 dark:text-orange-400"
                    >
                      Next <AlertTriangle className="h-3.5 w-3.5" /> <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                <div className="border-t border-border pt-3 text-[11px] text-muted-foreground space-y-0.5">
                  <div>
                    Version {activeConversion?.version ?? '—'} · Last updated{' '}
                    {activeConversion?.effective_from
                      ? new Date(activeConversion.effective_from).toLocaleDateString()
                      : '—'}
                  </div>
                  <div>Source: {sourceLabel}</div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="count" className="flex-1 overflow-y-auto px-5 py-12 mt-0">
            <div className="text-center text-sm text-muted-foreground">
              Coming soon: configure how staff counts this item
            </div>
          </TabsContent>

          <TabsContent value="depletion" className="flex-1 overflow-y-auto px-5 py-12 mt-0">
            <div className="text-center text-sm text-muted-foreground">
              Coming soon: configure recipe and POS depletion
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
