import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Sparkles, Radio, CheckCircle2, PencilLine } from 'lucide-react';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  onSaveOverride: (value: number, excludedDates?: string[]) => Promise<void> | void;
  onResetToProjection: () => Promise<void> | void;
}

interface CacheRow {
  net_sales: number | null;
  initial_projection: number | null;
  living_projection: number | null;
  override_projection: number | null;
  override_at: string | null;
  projected_sales: number | null;
  override_excluded_dates: string[] | null;
}

interface NearbyEvent {
  id: string;
  date: string;
  name: string;
  kind: 'holiday' | 'event';
}

const BUSINESS_ZONE = 'America/Los_Angeles';
const fromBusinessDate = (date: string) => DateTime.fromFormat(date, 'yyyy-MM-dd', { zone: BUSINESS_ZONE });
const displayDate = (date: string, format = 'MMM d, yyyy') => fromBusinessDate(date).toFormat(format);

const nthWeekday = (year: number, month: number, weekday: number, occurrence: number) => {
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: BUSINESS_ZONE });
  const offset = (weekday - first.weekday + 7) % 7;
  return first.plus({ days: offset + (occurrence - 1) * 7 });
};

const lastWeekday = (year: number, month: number, weekday: number) => {
  const last = DateTime.fromObject({ year, month, day: 1 }, { zone: BUSINESS_ZONE }).endOf('month').startOf('day');
  return last.minus({ days: (last.weekday - weekday + 7) % 7 });
};

const standardUSSalesEvents = (years: number[]): NearbyEvent[] => years.flatMap(year => [
  { id: `new-year-${year}`, date: `${year}-01-01`, name: "New Year's Day", kind: 'holiday' as const },
  { id: `mlk-${year}`, date: nthWeekday(year, 1, 1, 3).toFormat('yyyy-MM-dd'), name: 'Martin Luther King Jr. Day', kind: 'holiday' as const },
  { id: `presidents-${year}`, date: nthWeekday(year, 2, 1, 3).toFormat('yyyy-MM-dd'), name: "Presidents' Day", kind: 'holiday' as const },
  { id: `memorial-${year}`, date: lastWeekday(year, 5, 1).toFormat('yyyy-MM-dd'), name: 'Memorial Day', kind: 'holiday' as const },
  { id: `juneteenth-${year}`, date: `${year}-06-19`, name: 'Juneteenth', kind: 'holiday' as const },
  { id: `independence-${year}`, date: `${year}-07-04`, name: 'Independence Day', kind: 'holiday' as const },
  { id: `labor-${year}`, date: nthWeekday(year, 9, 1, 1).toFormat('yyyy-MM-dd'), name: 'Labor Day', kind: 'holiday' as const },
  { id: `thanksgiving-${year}`, date: nthWeekday(year, 11, 4, 4).toFormat('yyyy-MM-dd'), name: 'Thanksgiving', kind: 'holiday' as const },
  { id: `christmas-${year}`, date: `${year}-12-25`, name: 'Christmas Day', kind: 'holiday' as const },
]);

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
  const [includedDates, setIncludedDates] = useState<Set<string>>(new Set());
  const [nearbyEvents, setNearbyEvents] = useState<NearbyEvent[]>([]);
  const [draft, setDraft] = useState('');

  const isPast = dateStr < todayStr;
  const isToday = dateStr === todayStr;

  // Same weekday for the previous 4 weeks, plus the same weekday one year back (-364d).
  const historyDates = useMemo(
    () => [7, 14, 21, 28].map(days => fromBusinessDate(dateStr).minus({ days }).toFormat('yyyy-MM-dd')),
    [dateStr]
  );
  const lastYearDate = useMemo(() => fromBusinessDate(dateStr).minus({ days: 364 }).toFormat('yyyy-MM-dd'), [dateStr]);

  useEffect(() => {
    if (!open || !locationId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const annotationStart = fromBusinessDate(historyDates[historyDates.length - 1]).minus({ days: 3 }).toFormat('yyyy-MM-dd');
      const annotationEnd = fromBusinessDate(historyDates[0]).plus({ days: 3 }).toFormat('yyyy-MM-dd');
      const annotationYears = Array.from(new Set([fromBusinessDate(annotationStart).year, fromBusinessDate(annotationEnd).year]));
      const [rowRes, histRes, holidayRes, eventRes] = await Promise.all([
        supabase
          .from('sales_cache')
          .select('net_sales, initial_projection, living_projection, override_projection, override_at, projected_sales, override_excluded_dates')
          .eq('location_id', locationId)
          .eq('sale_date', dateStr)
          .maybeSingle(),
        supabase
          .from('sales_cache')
          .select('sale_date, net_sales')
          .eq('location_id', locationId)
          .in('sale_date', [...historyDates, lastYearDate]),
        supabase
          .from('holidays')
          .select('id, holiday_date, holiday_name, holiday_type, is_recurring')
          .or(`location_id.eq.${locationId},location_id.is.null`)
          .neq('holiday_type', 'birthday')
          .gte('holiday_date', annotationStart)
          .lte('holiday_date', annotationEnd),
        supabase
          .from('schedule_events')
          .select('id, event_date, event_name')
          .eq('location_id', locationId)
          .eq('is_daily_task', false)
          .not('event_date', 'is', null)
          .gte('event_date', annotationStart)
          .lte('event_date', annotationEnd),
      ]);
      if (cancelled) return;
      setRow((rowRes.data as unknown as CacheRow) || null);
      const rows = (histRes.data as any[]) || [];
      const nextHistory = historyDates.map(d => ({
          date: d,
          net_sales: rows.find(r => r.sale_date === d)?.net_sales ?? null,
        }));
      setHistory(nextHistory);
      const savedExcluded = new Set(
        Array.isArray((rowRes.data as any)?.override_excluded_dates)
          ? ((rowRes.data as any).override_excluded_dates as string[])
          : []
      );
      setIncludedDates(
        new Set(
          nextHistory
            .filter(item => (item.net_sales ?? 0) > 0 && !savedExcluded.has(item.date))
            .map(item => item.date)
        )
      );
      const loadedEvents: NearbyEvent[] = [
        ...standardUSSalesEvents(annotationYears),
        ...((holidayRes.data || []).map(holiday => ({
          id: holiday.id,
          date: holiday.holiday_date,
          name: holiday.holiday_name,
          kind: 'holiday' as const,
        }))),
        ...((eventRes.data || []).flatMap(event => event.event_date ? [{
          id: event.id,
          date: event.event_date,
          name: event.event_name,
          kind: 'event' as const,
        }] : [])),
      ];
      setNearbyEvents(Array.from(new Map(loadedEvents.map(event => [`${event.date}:${event.name.toLowerCase()}`, event])).values()));
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

  const usableHistory = history.filter(h => (h.net_sales ?? 0) > 0 && includedDates.has(h.date));
  const fourWeekAvg = usableHistory.length
    ? usableHistory.reduce((s, h) => s + (h.net_sales || 0), 0) / usableHistory.length
    : 0;

  const resolved = resolveProjection(row || undefined);
  const hasOverride = (row?.override_projection ?? 0) > 0;

  const annotationsFor = (historyDate: string) => nearbyEvents
    .map(event => ({
      ...event,
      offset: Math.round(fromBusinessDate(event.date).diff(fromBusinessDate(historyDate), 'days').days),
    }))
    .filter(event => Math.abs(event.offset) <= 3)
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));

  const toggleHistoryDate = (historyDate: string, checked: boolean) => {
    const next = new Set(includedDates);
    if (checked) next.add(historyDate);
    else next.delete(historyDate);
    setIncludedDates(next);
    const included = history.filter(item => (item.net_sales ?? 0) > 0 && next.has(item.date));
    const average = included.length
      ? included.reduce((sum, item) => sum + (item.net_sales || 0), 0) / included.length
      : 0;
    setDraft(average > 0 ? String(Math.round(average * 100) / 100) : '');
  };

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
      const excludedDates = history
        .filter(item => (item.net_sales ?? 0) > 0 && !includedDates.has(item.date))
        .map(item => item.date);
      await onSaveOverride(Math.round(value * 100) / 100, excludedDates);
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
             {displayDate(dateStr, 'EEEE, MMM d')}
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
              <span className="text-muted-foreground">{canEdit && !isPast ? 'Goal' : 'Showing'}</span>
              <span className="text-lg font-bold">
                {money(canEdit && !isPast && draft !== '' && !isNaN(parseFloat(draft)) ? parseFloat(draft) : currentValue || 0)}
              </span>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Same weekday history
              </p>
               {history.map(h => {
                 const hasSales = (h.net_sales ?? 0) > 0;
                 const annotations = annotationsFor(h.date);
                 const annotation = annotations[0];
                 return (
                   <div key={h.date} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                     {canEdit && !isPast && (
                       <Checkbox
                         checked={includedDates.has(h.date)}
                         disabled={!hasSales}
                         onCheckedChange={checked => toggleHistoryDate(h.date, checked === true)}
                         aria-label={`${includedDates.has(h.date) ? 'Exclude' : 'Include'} ${displayDate(h.date)} in goal math`}
                       />
                     )}
                     <span className="min-w-0 shrink-0 text-muted-foreground">{displayDate(h.date)}</span>
                     {annotation && (
                       <Badge variant="secondary" className="min-w-0 max-w-[45%] flex-1 justify-start whitespace-nowrap px-1.5 font-normal">
                         <span className="truncate">{annotation.offset < 0 && `${Math.abs(annotation.offset)}d ← `}{annotation.name}{annotation.offset > 0 && ` → ${annotation.offset}d`}</span>
                       </Badge>
                     )}
                     <span className={`min-w-0 ml-auto shrink-0 ${hasSales && includedDates.has(h.date) ? '' : 'text-muted-foreground line-through'}`}>
                       {hasSales ? money(h.net_sales as number) : 'no sales'}
                     </span>
                   </div>
                 );
               })}
              <Separator className="my-1" />
              <div className="flex items-center justify-between font-medium">
                <span>{usableHistory.length}-week average</span>
                <span>{fourWeekAvg > 0 ? money(fourWeekAvg) : '—'}</span>
              </div>
              {lastYear && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                     Same weekday last year ({displayDate(lastYear.date)})
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
                   Set {DateTime.fromISO(row.override_at, { setZone: true }).setZone(BUSINESS_ZONE).toFormat('MMM d, yyyy h:mm a')}
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
