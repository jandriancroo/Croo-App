import { PageTitle } from '@/components/PageTitle';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Edit2, X, RotateCcw, UserPen, ScanLine, HelpCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { getTodayInPST, getDateInPSTOffset } from '@/utils/dateUtils';
import { useUserRole } from '@/hooks/useUserRole';
import { DuoPage } from '@/components/duo/DuoPage';

// Super Admin only. Rows come from get_temperature_validation_entries (server
// filters by store / store-local day / status, gated by is_super_admin).

interface Entry {
  id: string;
  created_at: string;
  local_day: string;
  location_id: string | null;
  location_name: string | null;
  checklist_title: string | null;
  item_question: string | null;
  equipment_type: string | null;
  photo_url: string | null;
  extracted_temperature: number | null;
  temperature_valid: boolean | null;
  temperature_unconfirmed: boolean | null;
  completer_name: string | null;
  ai_original: number | null;
  ai_latest: number | null;
  scan_count: number | null;
  edited_at: string | null;
  editor_name: string | null;
  editor_email: string | null;
  previous_value: number | null;
  read_issue_count: number;
  read_issue_reasons: string[] | null;
  tracked: boolean;
  is_rescan: boolean;
  is_override: boolean;
  is_confirmed: boolean;
  total_count: number;
}

type Timeframe = 'today' | 'yesterday' | '2d' | '7d' | '30d' | 'all' | 'custom';
type Status = 'all' | 'original' | 'rescan' | 'override' | 'confirmed' | 'no_reading';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '2d', label: 'Last 2 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

const STATUSES: { value: Status; label: string }[] = [
  { value: 'all', label: 'All entries' },
  { value: 'original', label: 'Original scan' },
  { value: 'rescan', label: 'Re-scan' },
  { value: 'override', label: 'Override' },
  { value: 'confirmed', label: 'Confirmed (no change)' },
  { value: 'no_reading', label: 'No reading' },
];

const PAGE = 500;
const fmtT = (t: number | null | undefined) => (t === null || t === undefined ? '—' : `${Number(t)}°F`);
const fmtDay = (d: string) => format(new Date(`${d}T12:00:00`), 'EEE MMM d');

function rangeFor(tf: Timeframe, day: string, from: string, to: string): { from: string | null; to: string | null } {
  if (day) return { from: day, to: day };
  const today = getTodayInPST();
  switch (tf) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = getDateInPSTOffset(-1); return { from: y, to: y }; }
    case '2d': return { from: getDateInPSTOffset(-1), to: today };
    case '7d': return { from: getDateInPSTOffset(-6), to: today };
    case '30d': return { from: getDateInPSTOffset(-29), to: today };
    case 'custom': return { from: from || null, to: to || null };
    default: return { from: null, to: null };
  }
}

/** What the AI first read for this answer, as best the data allows. */
function originalScan(e: Entry): { value: number | null; known: boolean } {
  if (e.tracked) return { value: e.ai_original, known: e.ai_original !== null };
  if (e.is_override) return { value: e.previous_value, known: e.previous_value !== null };
  return { value: e.extracted_temperature, known: e.extracted_temperature !== null };
}

export default function TemperatureValidation() {
  const { isSuperAdmin, loading: roleLoading } = useUserRole();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [store, setStore] = useState<string>('all');
  const [timeframe, setTimeframe] = useState<Timeframe>('7d');
  const [day, setDay] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const range = useMemo(() => rangeFor(timeframe, day, customFrom, customTo), [timeframe, day, customFrom, customTo]);
  const filtersActive = store !== 'all' || timeframe !== '7d' || !!day || status !== 'all';

  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from('locations').select('id, name').order('name').then(({ data, error }) => {
      if (error) console.error('Error loading stores:', error);
      setLocations(((data as { id: string; name: string }[] | null) ?? []).filter((l) => l.name));
    });
  }, [isSuperAdmin]);

  const fetchPage = useCallback(async (offset: number) => {
    const { data, error } = await (supabase.rpc as any)('get_temperature_validation_entries', {
      p_location_id: store === 'all' ? null : store,
      p_from: range.from,
      p_to: range.to,
      p_status: status,
      p_limit: PAGE,
      p_offset: offset,
    });
    if (error) throw error;
    return (data ?? []) as Entry[];
  }, [store, range.from, range.to, status]);

  const fetchReadings = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchPage(0);
      setEntries(rows);
      setTotal(rows[0]?.total_count ? Number(rows[0].total_count) : 0);
    } catch (error) {
      console.error('Error fetching temperature readings:', error);
      toast.error('Failed to load temperature readings');
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (isSuperAdmin) fetchReadings();
  }, [isSuperAdmin, fetchReadings]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await fetchPage(entries.length);
      setEntries((prev) => [...prev, ...rows]);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  const resetFilters = () => {
    setStore('all'); setTimeframe('7d'); setDay(''); setCustomFrom(''); setCustomTo(''); setStatus('all');
  };

  const handleConfirm = async (readingId: string) => {
    try {
      const { error } = await supabase
        .from('checklist_responses')
        .update({
          temperature_validated_at: new Date().toISOString(),
          temperature_unconfirmed: false,
          temperature_edited_at: new Date().toISOString(), // server stamps who/when/replaced value
        })
        .eq('id', readingId);
      if (error) throw error;
      toast.success('Temperature confirmed');
      fetchReadings();
    } catch (error) {
      console.error('Error confirming temperature:', error);
      toast.error('Failed to confirm temperature');
    }
  };

  const handleSave = async (readingId: string) => {
    const temp = parseFloat(editValue);
    if (isNaN(temp)) {
      toast.error('Please enter a valid number');
      return;
    }
    try {
      // Food safety: ≤41.0°F (cold) or ≥135.0°F (hot holding)
      const isValid = temp <= 41.0 || temp >= 135.0;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('checklist_responses')
        .update({
          extracted_temperature: temp,
          temperature_valid: isValid,
          temperature_unconfirmed: false,
          temperature_validated_at: now,
          temperature_edited_at: now, // logs this as an override; server stamps who + replaced value
        })
        .eq('id', readingId);
      if (error) throw error;
      toast.success('Temperature corrected');
      setEditingId(null);
      fetchReadings();
    } catch (error) {
      console.error('Error updating temperature:', error);
      toast.error('Failed to update temperature');
    }
  };

  const handleRescanAll = async () => {
    setRescanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=rescan-temperatures', {
        body: { targetDate: getTodayInPST() },
      });
      if (error) throw error;
      toast.success(`Rescanned ${data.summary.successful} of ${data.summary.total} readings. ${data.summary.changed} changed.`);
      await fetchReadings();
    } catch (error) {
      console.error('Error rescanning temperatures:', error);
      toast.error('Failed to rescan temperatures');
    } finally {
      setRescanning(false);
    }
  };

  const counts = useMemo(() => ({
    original: entries.filter((e) => e.extracted_temperature !== null && !e.is_rescan && !e.is_override).length,
    rescan: entries.filter((e) => e.is_rescan).length,
    override: entries.filter((e) => e.is_override).length,
  }), [entries]);

  if (roleLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </Layout>
    );
  }
  if (!isSuperAdmin) return <Navigate to="/" replace />;

  const rangeLabel = range.from && range.to
    ? (range.from === range.to ? fmtDay(range.from) : `${fmtDay(range.from)} – ${fmtDay(range.to)}`)
    : range.from ? `From ${fmtDay(range.from)}` : range.to ? `Until ${fmtDay(range.to)}` : 'All time';

  return (
    <Layout>
    <DuoPage>
      <div className="container mx-auto p-4 md:p-6 [&>*:not(:first-child):not(:nth-child(2))]:mt-4 max-w-full md:max-w-5xl">
        <PageTitle color="red" subtitle="Review AI temperature scans, re-scans and overrides" action={
          <Button onClick={handleRescanAll} disabled={rescanning || loading} variant="outline">
            {rescanning ? 'Rescanning...' : 'Rescan All Today'}
          </Button>
        }>Temperature Validation</PageTitle>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Store</Label>
                <Select value={store} onValueChange={setStore}>
                  <SelectTrigger><SelectValue placeholder="All stores" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">All stores</SelectItem>
                    {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Timeframe</Label>
                <Select value={day ? 'day' : timeframe} onValueChange={(v) => { setDay(''); setTimeframe(v as Timeframe); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {day && <SelectItem value="day" disabled>Single day</SelectItem>}
                    {TIMEFRAMES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Day</Label>
                <div className="flex gap-1">
                  <Input type="date" value={day} max={getTodayInPST()} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
                  {day && (
                    <Button variant="ghost" size="icon" onClick={() => setDay('')} aria-label="Clear day"><X className="w-4 h-4" /></Button>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {timeframe === 'custom' && !day && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={customFrom} max={customTo || getTodayInPST()} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={customTo} min={customFrom || undefined} max={getTodayInPST()} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {loading ? 'Loading…' : `${total} ${total === 1 ? 'entry' : 'entries'}`} · {rangeLabel} (store local day)
              </span>
              {!loading && entries.length > 0 && (
                <>
                  <Badge variant="outline">{counts.original} original</Badge>
                  <Badge variant="outline">{counts.rescan} re-scan</Badge>
                  <Badge variant="outline">{counts.override} override</Badge>
                  {entries.length < total && <span className="text-xs text-muted-foreground">(counts for first {entries.length})</span>}
                </>
              )}
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="ml-auto">
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />Reset filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-muted-foreground">Loading temperature readings...</p>
          </div>
        ) : entries.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No temperature readings match these filters
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {entries.map((e) => {
              const orig = originalScan(e);
              const scans = e.scan_count ?? null;
              return (
                <Card key={e.id}>
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                      {e.photo_url ? (
                        <img
                          src={e.photo_url}
                          alt="Thermometer reading"
                          loading="lazy"
                          className="w-full sm:w-44 h-52 sm:h-44 object-contain rounded-lg border cursor-pointer bg-muted flex-shrink-0"
                          onClick={() => setPreviewImage(e.photo_url)}
                        />
                      ) : (
                        <div className="w-full sm:w-44 h-24 sm:h-44 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">No photo</div>
                      )}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {e.extracted_temperature === null ? (
                            <Badge variant="secondary"><HelpCircle className="w-3 h-3 mr-1" />No reading</Badge>
                          ) : !e.is_rescan && !e.is_override ? (
                            <Badge variant="secondary"><ScanLine className="w-3 h-3 mr-1" />Original scan</Badge>
                          ) : null}
                          {e.is_rescan && (
                            <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                              <RotateCcw className="w-3 h-3 mr-1" />Re-scan{scans && scans > 1 ? ` · ${scans} reads` : ''}
                            </Badge>
                          )}
                          {e.is_override && (
                            <Badge className="bg-purple-600 text-white hover:bg-purple-600"><UserPen className="w-3 h-3 mr-1" />Override</Badge>
                          )}
                          {e.is_confirmed && (
                            <Badge variant="outline"><CheckCircle2 className="w-3 h-3 mr-1" />Confirmed</Badge>
                          )}
                          {e.extracted_temperature !== null && (e.temperature_valid ? (
                            <Badge className="bg-green-600 text-white hover:bg-green-600">Safe</Badge>
                          ) : (
                            <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Out of range</Badge>
                          ))}
                          {e.temperature_unconfirmed && <Badge variant="outline">Unconfirmed read</Badge>}
                          {!e.tracked && <Badge variant="outline" className="text-muted-foreground">Before scan tracking</Badge>}
                        </div>

                        <div className="text-sm">
                          <p className="font-medium truncate">{e.item_question || 'Unknown task'}</p>
                          <p className="text-muted-foreground text-xs">
                            {e.location_name || 'Unknown store'} · {e.checklist_title || 'Unknown checklist'}
                            {e.equipment_type ? ` · ${e.equipment_type.replace(/_/g, ' ')}` : ''}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {format(new Date(e.created_at), 'MMM d, yyyy h:mm a')} · by {e.completer_name || 'Unknown'}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                          <div className="rounded-md border p-2">
                            <p className="text-[11px] text-muted-foreground">Original AI scan</p>
                            <p className="font-semibold">{orig.known ? fmtT(orig.value) : 'Not recorded'}</p>
                          </div>
                          {e.is_rescan && e.tracked && e.ai_latest !== null && e.ai_latest !== e.ai_original && (
                            <div className="rounded-md border p-2">
                              <p className="text-[11px] text-muted-foreground">Latest AI scan</p>
                              <p className="font-semibold">{fmtT(e.ai_latest)}</p>
                            </div>
                          )}
                          <div className="rounded-md border p-2">
                            <p className="text-[11px] text-muted-foreground">Final saved</p>
                            <p className="font-semibold">{fmtT(e.extracted_temperature)}</p>
                          </div>
                        </div>

                        {(e.is_override || e.is_confirmed) && (
                          <p className="text-xs">
                            <span className="font-medium">{e.is_override ? 'Overridden by ' : 'Confirmed by '}</span>
                            {e.editor_name || e.editor_email || 'Unknown user'}
                            {e.editor_name && e.editor_email ? <span className="text-muted-foreground"> ({e.editor_email})</span> : null}
                            {e.edited_at ? <span className="text-muted-foreground"> · {format(new Date(e.edited_at), 'MMM d h:mm a')}</span> : null}
                            {e.is_override && (
                              <span className="text-muted-foreground"> · {fmtT(e.tracked ? e.ai_latest : e.previous_value)} → {fmtT(e.extracted_temperature)}</span>
                            )}
                          </p>
                        )}
                        {e.read_issue_count > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Read log: {e.read_issue_count} {e.read_issue_count === 1 ? 'issue' : 'issues'} ({(e.read_issue_reasons ?? []).join(', ').replace(/_/g, ' ')})
                          </p>
                        )}

                        {editingId === e.id ? (
                          <div className="space-y-1">
                            <div className="flex gap-2 flex-wrap items-center">
                              <Input type="number" step="0.1" value={editValue} onChange={(ev) => setEditValue(ev.target.value)} className="w-28" autoFocus />
                              <Button size="sm" onClick={() => handleSave(e.id)}>Apply</Button>
                              <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditValue(''); }}><X className="w-4 h-4" /></Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Saved as an override under your name. Safe: ≤41.0°F or ≥135.0°F</p>
                          </div>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            <Button size="sm" variant="outline" onClick={() => handleConfirm(e.id)} disabled={e.extracted_temperature === null}>
                              <CheckCircle2 className="w-4 h-4 mr-1" />Confirm
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setEditingId(e.id); setEditValue(e.extracted_temperature?.toString() || ''); }}>
                              <Edit2 className="w-4 h-4 mr-1" />Edit
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {entries.length < total && (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load more (${total - entries.length} left)`}
              </Button>
            )}
          </div>
        )}

        <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
            {previewImage && <img src={previewImage} alt="Full size thermometer" className="w-full h-auto" />}
          </DialogContent>
        </Dialog>
      </div>
    </DuoPage>
    </Layout>
  );
}
