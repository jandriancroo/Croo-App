import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link2, TriangleAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type SyncRow = { sale_date: string; net_sales: number; fetched_at: string } | null;

function lastLine(label: string, row: SyncRow) {
  if (!row) return `${label}: not yet`;
  const when = new Date(row.fetched_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${label}: ${row.sale_date} · $${Number(row.net_sales).toFixed(2)} (updated ${when})`;
}

type RosterRow = { id: string; toast_user_id: string; toast_name: string; job_title: string | null };
type MappingRow = { id: string; toast_user_id: string; croo_user_id: string | null };
type StaffRow = { userId: string; name: string };

export const normName = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

function PairingSection({ locationId }: { locationId: string }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const { data: roster = [], isLoading: rosterLoading } = useQuery({
    queryKey: ['toast-roster', locationId],
    queryFn: async () => {
      const { data, error } = await supabase.from('toast_employees').select('*').eq('location_id', locationId).order('toast_name');
      if (error) throw error;
      return (data || []) as RosterRow[];
    },
  });

  const { data: mappings = [] } = useQuery({
    queryKey: ['toast-mappings', locationId],
    queryFn: async () => {
      const { data, error } = await supabase.from('toast_employee_mappings').select('id, toast_user_id, croo_user_id').eq('location_id', locationId);
      if (error) throw error;
      return (data || []) as MappingRow[];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['toast-staff', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_locations')
        .select('user_id, profiles(full_name, nickname)')
        .eq('location_id', locationId);
      if (error) throw error;
      return (data || [])
        .map((r: any) => ({ userId: r.user_id, name: r.profiles?.full_name || r.profiles?.nickname || '' }))
        .filter((r: StaffRow) => r.name) as StaffRow[];
    },
  });

  const mapByToast = useMemo(() => new Map(mappings.map((m) => [m.toast_user_id, m])), [mappings]);
  const takenCroo = useMemo(() => new Set(mappings.filter((m) => m.croo_user_id).map((m) => m.croo_user_id)), [mappings]);

  // Auto-suggest matches by name; pre-fill picks from saved links first, then suggestions.
  const suggested = useMemo(() => {
    const s = new Map<string, string>();
    for (const e of roster) {
      const hit = staff.find((p) => normName(p.name) === normName(e.toast_name) && !takenCroo.has(p.userId));
      if (hit) s.set(e.toast_user_id, hit.userId);
    }
    return s;
  }, [roster, staff, takenCroo]);

  useEffect(() => {
    if (roster.length === 0) return;
    setPicked((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const e of roster) {
        if (next[e.toast_user_id] !== undefined) continue;
        const mapped = mapByToast.get(e.toast_user_id);
        next[e.toast_user_id] = mapped?.croo_user_id || suggested.get(e.toast_user_id) || 'none';
      }
      return next;
    });
  }, [roster, mapByToast, suggested]);

  const linkedCount = roster.filter((e) => picked[e.toast_user_id] && picked[e.toast_user_id] !== 'none').length;
  const unmatchedCount = roster.filter((e) => picked[e.toast_user_id] === 'none' && !suggested.has(e.toast_user_id)).length;

  const visibleRoster = useMemo(() => {
    const q = normName(search);
    if (!q) return roster;
    return roster.filter((e) => normName(e.toast_name).includes(q) || normName(e.job_title || '').includes(q));
  }, [roster, search]);

  const save = async () => {
    setSaving(true);
    try {
      let changed = 0;
      for (const e of roster) {
        const pick = picked[e.toast_user_id];
        if (pick === undefined) continue;
        const crooId = pick === 'none' ? null : pick;
        const existing = mapByToast.get(e.toast_user_id);
        if (existing) {
          if ((existing.croo_user_id || null) === crooId) continue;
          const { error } = await supabase
            .from('toast_employee_mappings')
            .update({ croo_user_id: crooId, match_method: 'manual' })
            .eq('id', existing.id);
          if (error) throw error;
          changed++;
        } else if (crooId) {
          const { error } = await supabase
            .from('toast_employee_mappings')
            .upsert(
              { location_id: locationId, toast_user_id: e.toast_user_id, toast_name: e.toast_name, croo_user_id: crooId, match_method: 'manual' },
              { onConflict: 'location_id,toast_user_id' },
            );
          if (error) throw error;
          changed++;
        }
      }
      setDirty(false);
      toast.success(changed > 0 ? `Saved ${changed} staff link${changed === 1 ? '' : 's'} — Toast pay rates fill in automatically` : 'Nothing to save');
      qc.invalidateQueries({ queryKey: ['toast-mappings', locationId] });
      qc.invalidateQueries({ queryKey: ['toast-roster', locationId] });
      qc.invalidateQueries({ queryKey: ['toast-shifts'] });
      qc.invalidateQueries({ queryKey: ['user-management-users'] });
    } catch (e: any) {
      toast.error('Could not save — check your connection and try again');
      console.error('[toast-pairing] save failed', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t">
      <div className="flex items-start gap-2">
        <Link2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium">Link staff to CrooHQ</p>
          <p className="text-xs text-muted-foreground">
            Likely matches are filled in by name. Linked staff get their Toast pay rate automatically and start receiving late clock-in / missing clock-out alerts.
          </p>
        </div>
      </div>

      {rosterLoading ? (
        <p className="text-xs text-muted-foreground">Loading Toast staff…</p>
      ) : roster.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          The Toast staff list appears here after the live sync pulls it (about once an hour while the robot is running).
        </p>
      ) : (
        <>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Toast staff…"
            className="h-8 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {linkedCount} of {roster.length} linked{unmatchedCount > 0 ? ` · ${unmatchedCount} need attention` : ''}
          </p>
          <div className="max-h-[50vh] overflow-y-auto rounded-md border divide-y">
            {visibleRoster.map((e) => {
              const suggestedHit = suggested.has(e.toast_user_id);
              return (
                <div key={e.toast_user_id} className="flex items-center gap-2 px-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {suggestedHit && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Matched by name" />}
                      {picked[e.toast_user_id] === 'none' && !suggestedHit && (
                        <TriangleAlert className="h-3 w-3 text-amber-500 shrink-0" />
                      )}
                      <span className="text-sm truncate">{e.toast_name}</span>
                    </div>
                    {e.job_title && <p className="text-[11px] text-muted-foreground truncate">{e.job_title}</p>}
                  </div>
                  <Select
                    value={picked[e.toast_user_id] ?? 'none'}
                    onValueChange={(v) => { setPicked((p) => ({ ...p, [e.toast_user_id]: v })); setDirty(true); }}
                  >
                    <SelectTrigger className="w-[46%] h-8 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {staff
                        .filter((p) => !takenCroo.has(p.userId) || picked[e.toast_user_id] === p.userId)
                        .map((p) => (
                          <SelectItem key={p.userId} value={p.userId}>{p.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
          <Button className="w-full" size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save links' : 'All saved'}
          </Button>
        </>
      )}
    </div>
  );
}

export default function ToastIntegrationCard({ locationId, integration }: { locationId: string; integration: any }) {
  const qc = useQueryClient();
  const [guid, setGuid] = useState('');
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGuid(integration?.credentials?.restaurant_guid ?? '');
    setActive(!!integration?.is_active);
  }, [integration]);

  const { data: status } = useQuery({
    queryKey: ['toast-status', locationId],
    enabled: !!integration,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('toast-service', { body: { action: 'status', locationId } });
      if (error) throw error;
      return data as { lastExport: SyncRow; lastLive: SyncRow };
    },
  });

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.functions.invoke('toast-service', {
      body: { action: 'save', locationId, restaurantGuid: guid.trim(), isActive: active },
    });
    setSaving(false);
    if (error) { toast.error('Could not save Toast settings'); return; }
    toast.success(active ? 'Toast turned on' : 'Toast settings saved');
    qc.invalidateQueries({ queryKey: ['location-integration', locationId, 'toast'] });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sales, hourly sales and payments/tips come in from Toast, refreshed every 90 seconds during open hours.
      </p>
      <div className="space-y-2">
        <label htmlFor="toast-guid" className="text-sm font-medium">Toast restaurant ID</label>
        <Input id="toast-guid" value={guid} onChange={(e) => setGuid(e.target.value)} placeholder="From the Toast Web address bar" />
      </div>
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">Use Toast for this store</p>
          <p className="text-xs text-muted-foreground">Sales on the dashboard will come from Toast.</p>
        </div>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>
      {integration && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{lastLine('Live check', status?.lastLive ?? null)}</p>
        </div>
      )}
      <Button className="w-full" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>

      <PairingSection locationId={locationId} />
    </div>
  );
}
