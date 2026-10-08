import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Info } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLaborRules, type LaborRuleProposal } from '@/hooks/useLaborRules';
import { FIELD_META, type LaborRulesField } from '@/lib/laborRules/schema';
import { defaultTicked, formatPT } from '@/lib/laborRules/lawCheck';
import { LaborRulesDiff, type LaborRulesDiffRow } from './LaborRulesDiff';

interface Props {
  locationId: string;
  proposal: LaborRuleProposal | null;
  onOpenChange: (open: boolean) => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for approval', applied: 'Applied', declined: 'Declined', expired: 'Expired', no_changes: 'No changes', failed: 'Failed',
};

export function LaborRuleProposalDialog({ locationId, proposal, onOpenChange }: Props) {
  const { rules, access, approve, decline } = useLaborRules(locationId);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [confirmFields, setConfirmFields] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const storeQ = useQuery({
    queryKey: ['location-name', locationId],
    queryFn: async () => (await supabase.from('locations').select('name').eq('id', locationId).maybeSingle()).data?.name as string | undefined,
  });
  const deciderQ = useQuery({
    queryKey: ['profile-name', proposal?.decided_by],
    enabled: !!proposal?.decided_by,
    queryFn: async () => (await supabase.from('profiles').select('full_name').eq('id', proposal!.decided_by!).maybeSingle()).data?.full_name as string | undefined,
  });

  const isOpen = !!proposal && proposal.status === 'pending' && new Date(proposal.expires_at).getTime() > Date.now();
  const canAct = isOpen && access.can_approve;
  const state = proposal?.state_code || 'state';
  const fs = (rules?.field_sources || {}) as Record<string, { source?: string; at?: string }>;

  useEffect(() => {
    setChecked(new Set((proposal?.diff || []).filter((d) => defaultTicked(d)).map((d) => d.field)));
    setNote(''); setErr(null);
  }, [proposal?.id]);

  const rows: LaborRulesDiffRow[] = useMemo(() => (proposal?.diff || []).map((d) => ({
    field: d.field,
    current: d.current,
    next: d.suggested,
    currentSource: d.current_source,
    citation: d.citation,
    confidence: d.confidence,
    hint: isOpen && d.current_source === 'manual'
      ? `You edited this${fs[d.field]?.at ? ` on ${formatPT(fs[d.field].at, 'MMM d, yyyy')}` : ''} (keep yours?)`
      : null,
  })), [proposal, isOpen, fs]);

  const label = (f: string) => FIELD_META[f as LaborRulesField]?.label ?? f;
  const toggle = (f: string) => setChecked((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });

  const doApprove = async () => {
    if (!proposal || !confirmFields) return;
    setBusy(true); setErr(null);
    try {
      await approve(proposal.id, confirmFields, note || null);
      toast.success(`Applied ${confirmFields.length} change${confirmFields.length === 1 ? '' : 's'}`);
      setConfirmFields(null);
      onOpenChange(false);
    } catch (e: any) {
      setErr(e.message); setConfirmFields(null);
    } finally { setBusy(false); }
  };

  const doDecline = async () => {
    if (!proposal) return;
    setBusy(true); setErr(null);
    try { await decline(proposal.id, note || null); toast.success('Declined'); onOpenChange(false); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Dialog open={!!proposal} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {proposal && (
            <>
              <DialogHeader>
                <DialogTitle>Labor law update for {storeQ.data || 'this store'} ({state})</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{proposal.kind === 'build' ? 'New store' : 'Re-check'}</Badge>
                  <Badge variant="secondary">{STATUS_LABEL[proposal.status] || proposal.status}</Badge>
                  <span>Checked {formatPT(proposal.created_at)}</span>
                  <span>· {proposal.sources?.length || 0} sources</span>
                </DialogDescription>
              </DialogHeader>

              {proposal.diff.length === 0
                ? <p className="text-sm text-muted-foreground">{proposal.status === 'failed' ? proposal.error || 'This check failed.' : 'No changes suggested.'}</p>
                : <LaborRulesDiff rows={rows} checked={canAct ? checked : undefined} onToggle={canAct ? toggle : undefined} />}

              {proposal.notes && (
                <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <p className="whitespace-pre-wrap">{proposal.notes}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Not legal advice. Confirm with the {state} labor agency.</p>

              {(proposal.status === 'applied' || proposal.status === 'declined') && (
                <p className="text-sm">
                  {proposal.status === 'applied' ? 'Applied' : 'Declined'}
                  {deciderQ.data ? ` by ${deciderQ.data}` : ''}{proposal.decided_at ? ` on ${formatPT(proposal.decided_at)}` : ''}.
                  {proposal.status === 'applied' && proposal.applied_fields?.length
                    ? ` Applied: ${proposal.applied_fields.map(label).join(', ')}.` : ''}
                  {proposal.decision_note ? ` Note: ${proposal.decision_note}` : ''}
                </p>
              )}
              {proposal.status === 'expired' && <p className="text-sm text-muted-foreground">This check expired without a decision.</p>}
              {isOpen && !access.can_approve && <p className="text-sm text-muted-foreground">Waiting for an org admin to approve.</p>}

              {canAct && (
                <div className="space-y-2">
                  <Label>Note (optional)</Label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why approve or decline" />
                </div>
              )}
              {err && <p className="text-sm text-destructive">{err}</p>}

              {canAct && (
                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <Button variant="outline" onClick={doDecline} disabled={busy}>Decline</Button>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="secondary" disabled={busy || checked.size === 0} onClick={() => setConfirmFields([...checked])}>
                      Approve selected ({checked.size})
                    </Button>
                    <Button disabled={busy} onClick={() => setConfirmFields(proposal.diff.map((d) => d.field))}>Approve all</Button>
                  </div>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmFields} onOpenChange={(o) => !o && setConfirmFields(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply {confirmFields?.length} change{confirmFields?.length === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>These labor rules will change for {storeQ.data || 'this store'}:</p>
                <ul className="list-disc pl-5 text-sm">{confirmFields?.map((f) => <li key={f}>{label(f)}</li>)}</ul>
                <p className="text-xs">You can revert from History anytime.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); doApprove(); }}>
              {busy ? 'Applying…' : 'Apply'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
