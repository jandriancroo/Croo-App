import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { diffForm, toForm, type LaborRulesForm } from '@/lib/laborRules/schema';

export interface LaborRulesHistoryRow {
  id: string;
  changed_at: string;
  changed_by: string | null;
  source: 'manual' | 'preset' | 'migration' | 'ai';
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  note: string | null;
}

/** One rules record per store; the only write is rpc('save_labor_rules'). */
export function useLaborRules(locationId: string | undefined | null) {
  const qc = useQueryClient();

  const rulesQ = useQuery({
    queryKey: ['labor-rules', locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_rules').select('*').eq('location_id', locationId!).maybeSingle();
      if (error) throw error;
      return (data as Record<string, any> | null) ?? null;
    },
  });

  const presetsQ = useQuery({
    queryKey: ['labor-rules', 'presets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('labor_rule_presets').select('*').order('preset_name');
      if (error) throw error;
      return (data || []) as Record<string, any>[];
    },
  });

  const historyQ = useQuery({
    queryKey: ['labor-rules', 'history', locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_rules_history' as any)
        .select('id, changed_at, changed_by, source, before, after, note')
        .eq('location_id', locationId!)
        .order('changed_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data as any[]) || []) as LaborRulesHistoryRow[];
    },
  });

  const canEditQ = useQuery({
    queryKey: ['labor-rules', 'can-edit', locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data, error } = await supabase.rpc('_can_manage_labor_rules' as any, { _user: user.id, _location_id: locationId });
      if (error) return false;
      return !!data;
    },
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['labor-rules'] });
    await qc.invalidateQueries({ queryKey: ['shift-flags'] });
  };

  /** Save only changed fields. Returns true on success. */
  const save = async (next: LaborRulesForm, source: 'manual' | 'preset', note?: string | null): Promise<boolean> => {
    if (!locationId) return false;
    const current = rulesQ.data ? toForm(rulesQ.data) : null;
    const patch = diffForm(current, next);
    if (Object.keys(patch).length === 0) { toast.info('No changes to save'); return true; }
    const { error } = await supabase.rpc('save_labor_rules' as any, {
      _location_id: locationId, _patch: patch, _source: source, _note: note || null,
    });
    if (error) { console.error('save_labor_rules', error); toast.error(error.message || 'Failed to save labor rules'); return false; }
    toast.success('Labor rules saved');
    await invalidate();
    return true;
  };

  return {
    rules: rulesQ.data ?? null,
    presets: presetsQ.data ?? [],
    history: historyQ.data ?? [],
    canEdit: !!canEditQ.data,
    loading: rulesQ.isLoading,
    save,
    refetchPresets: presetsQ.refetch,
    invalidate,
  };
}
