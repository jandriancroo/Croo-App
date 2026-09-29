import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type MappingRow = { id: string; toast_user_id: string; toast_name: string | null };
type RosterRow = { toast_user_id: string; toast_name: string; job_title: string | null };

const normName = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

interface ToastLinkFieldProps {
  userId: string;
  currentLocationId: string;
  onLinked?: () => void;
}

export function ToastLinkField({ userId, currentLocationId, onLinked }: ToastLinkFieldProps) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: mapping } = useQuery({
    queryKey: ['toast-link', currentLocationId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('toast_employee_mappings')
        .select('id, toast_user_id, toast_name')
        .eq('croo_user_id', userId)
        .eq('location_id', currentLocationId)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as MappingRow | null;
    },
  });

  const { data: unlinkedRoster = [], isLoading: rosterLoading } = useQuery({
    queryKey: ['toast-roster-unlinked', currentLocationId],
    enabled: picking,
    queryFn: async () => {
      const [{ data: roster, error: e1 }, { data: mappings, error: e2 }] = await Promise.all([
        supabase.from('toast_employees').select('toast_user_id, toast_name, job_title').eq('location_id', currentLocationId).order('toast_name'),
        supabase.from('toast_employee_mappings').select('toast_user_id, croo_user_id').eq('location_id', currentLocationId),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const taken = new Set((mappings || []).filter((m: any) => m.croo_user_id).map((m: any) => m.toast_user_id));
      return ((roster || []) as RosterRow[]).filter((r) => !taken.has(r.toast_user_id));
    },
  });

  const link = async (toastUserId: string, toastName: string) => {
    setSaving(true);
    const { error } = await supabase
      .from('toast_employee_mappings')
      .upsert(
        { location_id: currentLocationId, toast_user_id: toastUserId, toast_name: toastName, croo_user_id: userId, match_method: 'manual' },
        { onConflict: 'location_id,toast_user_id' },
      );
    setSaving(false);
    if (error) { toast.error('Could not link this person'); return; }
    toast.success(`Linked to ${toastName} — pay rate comes from Toast`);
    setPicking(false);
    setSearch('');
    qc.invalidateQueries({ queryKey: ['toast-link', currentLocationId, userId] });
    qc.invalidateQueries({ queryKey: ['toast-roster-unlinked', currentLocationId] });
    qc.invalidateQueries({ queryKey: ['toast-mappings'] });
    qc.invalidateQueries({ queryKey: ['toast-shifts'] });
    qc.invalidateQueries({ queryKey: ['user-management-users'] });
    onLinked?.();
  };

  const unlink = async () => {
    if (!mapping) return;
    setSaving(true);
    const { error } = await supabase.from('toast_employee_mappings').update({ croo_user_id: null, match_method: 'manual' }).eq('id', mapping.id);
    setSaving(false);
    if (error) { toast.error('Could not unlink this person'); return; }
    toast.success('Unlinked from Toast');
    qc.invalidateQueries({ queryKey: ['toast-link', currentLocationId, userId] });
    qc.invalidateQueries({ queryKey: ['toast-roster-unlinked', currentLocationId] });
    qc.invalidateQueries({ queryKey: ['toast-mappings'] });
    qc.invalidateQueries({ queryKey: ['toast-shifts'] });
    onLinked?.();
  };

  const q = normName(search);
  const visible = q ? unlinkedRoster.filter((r) => normName(r.toast_name).includes(q) || normName(r.job_title || '').includes(q)) : unlinkedRoster;

  return (
    <div className="pt-1">
      {mapping ? (
        <div className="flex items-center gap-2 text-xs">
          <Link2 className="h-3 w-3 text-emerald-500 shrink-0" />
          <span className="text-muted-foreground truncate flex-1">
            Linked to Toast: <span className="font-medium text-foreground">{mapping.toast_name || mapping.toast_user_id}</span>
          </span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={saving} onClick={unlink}>Unlink</Button>
        </div>
      ) : picking ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Toast staff…"
              className="h-7 text-xs"
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setPicking(false); setSearch(''); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {rosterLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-xs text-muted-foreground">No unlinked Toast staff match.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
              {visible.map((r) => (
                <button
                  key={r.toast_user_id}
                  type="button"
                  disabled={saving}
                  onClick={() => link(r.toast_user_id, r.toast_name)}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted/60 disabled:opacity-50"
                >
                  <span className="font-medium">{r.toast_name}</span>
                  {r.job_title && <span className="text-muted-foreground"> · {r.job_title}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPicking(true)}>
          <Link2 className="h-3 w-3 mr-1" /> Link to Toast
        </Button>
      )}
    </div>
  );
}
