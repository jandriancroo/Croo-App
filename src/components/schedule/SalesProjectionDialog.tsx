import { useEffect, useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { Loader2, RotateCcw, Sparkles, Radio, CheckCircle2, PencilLine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { resolveProjection } from '@/hooks/useResolvedProjection';

interface SalesProjectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId?: string;
  /** yyyy-MM-dd business date for the column that was tapped */
  dateStr: string;
  /** Business "today" in the store's timezone (yyyy-MM-dd) */
  todayStr: string;
  /** Value currently displayed in the grid */
  currentValue: number;
  currentSource?: 'manual' | 'historical' | 'ai' | 'override' | 'living' | 'initial';
  canEdit: boolean;
  onSaveOverride: (value: number) => Promise<void> | void;
  onResetToProjection: () => Promise<void> | void;
}

interface CacheRow {
  net_sales: number | null;
  initial_projection: number | null;
  living_projection: number | null;
  override_projection: number | null;
  override_at: string | null;
  projected_sales: number | null;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function SalesProjectionDialog({
  open,
  onOpenChange,
  locationId,
  dateStr,
  todayStr,
  currentValue,
  currentSource,
  canEdit,
  onSaveOverride,
  onResetToProjection,
}: SalesProjectionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [row, setRow] = useState<CacheRow | null>(null);
  const [history, setHistory] = useState<{ date: string; net_sales: number | null }[]>([]);
  const [lastYear, setLastYear] = useState<{ date: string; net_sales: number | null } | null>(null);
  const [draft, setDraft] = useState('');

  const isPast = dateStr < todayStr;
  const isToday = dateStr === todayStr;

  // Same weekday for the previous 4 weeks, plus the same weekday one year back (-364d).
  const historyDates = useMemo(
    () => [7, 14, 21, 28].map(d => format(subDays(parseISO(dateStr), d), 'yyyy-MM-dd')),
    [dateStr]
  );
  const lastYearDate = useMemo(() => format(subDays(parseISO(dateStr), 364), 'yyyy-MM-dd'), [dateStr]);

  useEffect(() => {
    if (!open || !locationId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [rowRes, histRes] = await Promise.all([
        supabase
          .from('sales_cache')
          .select('net_sales, initial_projection, living_projection, override_projection, override_at, projected_sales')
          .eq('location_id', locationId)
          .eq('sale_date', dateStr)
          .maybeSingle(),
        supabase
          .from('sales_cache')
          .select('sale_date, net_sales')
          .eq('location_id', locationId)
          .in('sale_date', [...historyDates, lastYearDate]),
      ]);
      if (cancelled) return;
      setRow((rowRes.data as CacheRow) || null);
      const rows = (histRes.data as any[]) || [];
      setHistory(
        historyDates.map(d => ({
          date: d,
          net_sales: rows.find(r => r.sale_date === d)?.net_sales ?? null,
        }))
      );
      const ly = rows.find(r => r.sale_date === lastYearDate);
      setLastYear(ly ? { date: lastYearDate, net_sales: ly.net_sales } : { date: lastYearDate, net_sales: null });
      setDraft(currentValue ? String(Math.round(currentValue * 100) / 100) : '');
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, locationId, dateStr, historyDates, lastYearDate, currentValue]);

  const usableHistory = history.filter(h => (h.net_sales ?? 0) > 0);
  const fourWeekAvg = usableHistory.length
    ? usableHistory.reduce((s, h) => s + (h.net_sales || 0), 0) / usableHistory.length
    : 0;

  const resolved = resolveProjection(row || undefined);
  const hasOverride = (row?.override_projection ?? 0) > 0;

  const sourceBadge = (() => {
    if (currentSource === 'historical') {
      return <Badge variant="outline" className="gap-1 border-green-500/40 text-green-600"><CheckCircle2 className="h-3 w-3" />Actual sales</Badge>;
    }
    if (currentSource === 'override' || currentSource === 'manual') {
      return <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600"><PencilLine className="h-3 w-3" />Manager override</Badge>;
    }
    if (currentSource === 'living') {
      return <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><Radio className="h-3 w-3" />Live goal</Badge>;
    }
    return <Badge variant="outline" className="gap-1 border-primary/30 text-primary"><Sparkles className="h-3 w-3" />Goal</Badge>;
  })();

  const handleSave = async () => {
    const value = parseFloat(draft);
    if (!(value >= 0)) return;
    setSaving(true);
    try {
      await onSaveOverride(Math.round(value * 100) / 100);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await onResetToProjection();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {format(parseISO(dateStr), 'EEEE, MMM d')}
            {sourceBadge}
          </DialogTitle>
          <DialogDescription>
            {isPast
              ? 'Completed day — this is what the store actually rang up.'
              : isToday
                ? 'In progress today — actual sales so far, tracking against the goal.'
                : 'Upcoming day — here is how the goal was built.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Showing</span>
              <span className="text-lg font-bold">{money(currentValue || 0)}</span>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Same weekday history
              </p>
              {history.map(h => (
                <div key={h.date} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{format(parseISO(h.date), 'MMM d, yyyy')}</span>
                  <span className={(h.net_sales ?? 0) > 0 ? '' : 'text-muted-foreground'}>
                    {(h.net_sales ?? 0) > 0 ? money(h.net_sales as number) : 'no sales recorded'}
                  </span>
                </div>
              ))}
              <Separator className="my-1" />
              <div className="flex items-center justify-between font-medium">
                <span>{usableHistory.length}-week average</span>
                <span>{fourWeekAvg > 0 ? money(fourWeekAvg) : '—'}</span>
              </div>
              {lastYear && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Same weekday last year ({format(parseISO(lastYear.date), 'MMM d, yyyy')})
                  </span>
                  <span className={(lastYear.net_sales ?? 0) > 0 ? '' : 'text-muted-foreground'}>
                    {(lastYear.net_sales ?? 0) > 0 ? money(lastYear.net_sales as number) : '—'}
                  </span>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Saved numbers for this day
              </p>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Actual sales</span>
                <span>{(row?.net_sales ?? 0) > 0 ? money(row!.net_sales as number) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Original goal</span>
                <span>{(row?.initial_projection ?? 0) > 0 ? money(row!.initial_projection as number) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Latest goal</span>
                <span>{(row?.living_projection ?? 0) > 0 ? money(row!.living_projection as number) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Manager override</span>
                <span className={hasOverride ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>
                  {hasOverride ? money(row!.override_projection as number) : 'none'}
                </span>
              </div>
              {hasOverride && row?.override_at && (
                <p className="text-xs text-muted-foreground">
                  Set {format(new Date(row.override_at), 'MMM d, yyyy h:mm a')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Order used: manager override, then latest goal, then original goal
                {resolved.source ? ` — currently ${resolved.source === 'legacy' ? 'a saved number' : resolved.source}.` : '.'}
              </p>
            </div>

            {canEdit && !isPast && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Set your own number
                  </p>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="$0"
                    className="h-9"
                  />
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {canEdit && !isPast ? (
            <>
              <Button variant="outline" onClick={handleReset} disabled={saving} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Use goal
              </Button>
              <Button onClick={handleSave} disabled={saving || draft === ''}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save number'}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
