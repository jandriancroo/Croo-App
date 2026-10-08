import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { diffForm, toForm, type LaborRulesForm } from '@/lib/laborRules/schema';
import { requestLaborLawCheck, type LawCheckKind, type LawCheckResult, type ProposalDiffRow } from '@/lib/laborRules/lawCheck';

export interface LaborRulesHistoryRow {
  id: string;
  changed_at: string;
  changed_by: string | null;
  source: 'manual' | 'preset' | 'migration' | 'ai';
  proposal_id?: string | null;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  note: string | null;
}

export interface LaborRulesAccess { can_view: boolean; can_check: boolean; can_edit: boolean; can_approve: boolean }

export interface LaborRuleProposal {
  id: string;
  location_id: string;
  kind: 'build' | 'recheck';
  status: 'pending' | 'applied' | 'declined' | 'expired' | 'no_changes' | 'failed';
  state_code: string | null;
  diff: ProposalDiffRow[];
  sources: { url: string; title?: string }[];
  notes: string | null;
  error: string | null;
  created_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  applied_fields: string[] | null;
  decision_note: string | null;
}

const NO_ACCESS: LaborRulesAccess = { can_view: false, can_check: false, can_edit: false, can_approve: false };

/** One rules record per store; the only rules write is rpc('save_labor_rules') (directly or via approve). */
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
        .select('id, changed_at, changed_by, source, proposal_id, before, after, note')
        .eq('location_id', locationId!)
        .order('changed_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data as any[]) || []) as LaborRulesHistoryRow[];
    },
  });

  const accessQ = useQuery({
    queryKey: ['labor-rules', 'access', locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_labor_rules_access', { _location_id: locationId! });
      if (error) return NO_ACCESS;
      return { ...NO_ACCESS, ...((data as any) || {}) } as LaborRulesAccess;
    },
  });

  const proposalsQ = useQuery({
    queryKey: ['labor-rule-proposals', locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_rule_proposals')
        .select('*')
        .eq('location_id', locationId!)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return ((data as any[]) || []) as LaborRuleProposal[];
    },
  });

  const checkAllowedQ = useQuery({
    queryKey: ['labor-rule-proposals', locationId, 'allowed'],
    enabled: !!locationId && !!accessQ.data?.can_check,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labor_rule_check_allowed', { _location_id: locationId!, _kind: 'recheck' });
      if (error) throw error;
      return data as { allowed: boolean; reason: string | null; next_at: string | null };
    },
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['labor-rules'] }),
      qc.invalidateQueries({ queryKey: ['labor-rule-proposals'] }),
      qc.invalidateQueries({ queryKey: ['shift-flags'] }),
    ]);
  };

  /** Save only changed fields. Returns true on success. */
  const save = async (next: LaborRulesForm, source: 'manual' | 'preset', note?: string | null): Promise<boolean> => {
    if (!locationId) return false;
    const current = rulesQ.data ? toForm(rulesQ.data) : null;
    const patch = diffForm(current, next);
    if (Object.keys(patch).length === 0) { toast.info('No changes to save'); return true; }
    const { error } = await supabase.rpc('save_labor_rules', {
      _location_id: locationId, _patch: patch as any, _source: source, _note: note || null,
    });
    if (error) { console.error('save_labor_rules', error); toast.error(error.message || 'Failed to save labor rules'); return false; }
    toast.success('Labor rules saved');
    await invalidate();
    return true;
  };

  const runCheck = async (kind: LawCheckKind): Promise<LawCheckResult> => {
    const res = await requestLaborLawCheck(locationId!, kind);
    await invalidate();
    return res;
  };

  /** Throws with the server's message (e.g. "Rules changed since this check"). */
  const approve = async (proposalId: string, fields: string[], note?: string | null) => {
    const { error } = await supabase.rpc('approve_labor_rule_proposal', { _proposal_id: proposalId, _fields: fields, _note: note || null });
    if (error) throw new Error(error.message);
    await invalidate();
  };

  const decline = async (proposalId: string, note?: string | null) => {
    const { error } = await supabase.rpc('decline_labor_rule_proposal', { _proposal_id: proposalId, _note: note || null });
    if (error) throw new Error(error.message);
    await invalidate();
  };

  const proposals = proposalsQ.data ?? [];
  const now = Date.now();
  const pendingProposal = proposals.find((p) => p.status === 'pending' && new Date(p.expires_at).getTime() > now) ?? null;
  const lastChecked = proposals.find((p) => p.status !== 'failed')?.created_at ?? rulesQ.data?.laws_checked_at ?? null;
  const access = accessQ.data ?? NO_ACCESS;

  return {
    rules: rulesQ.data ?? null,
    presets: presetsQ.data ?? [],
    history: historyQ.data ?? [],
    access,
    canEdit: access.can_edit,
    proposals,
    pendingProposal,
    lastChecked: lastChecked as string | null,
    checkAllowed: checkAllowedQ.data ?? null,
    loading: rulesQ.isLoading,
    save,
    runCheck,
    approve,
    decline,
    refetchPresets: presetsQ.refetch,
    invalidate,
  };
}
