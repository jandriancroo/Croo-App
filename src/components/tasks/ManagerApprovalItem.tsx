import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ShieldCheck, Clock, CheckCircle2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  question: string;
  assignmentId: string | null;
  /** % of the trainee's non-approval items that are done */
  completionPercent: number;
  currentUserId?: string | null;
  isApproverByRole: boolean;
}

const statusMeta: Record<string, { label: string; className: string }> = {
  pending: { label: 'In progress', className: 'bg-muted text-muted-foreground' },
  submitted: { label: 'Awaiting approval', className: 'bg-amber-500/15 text-amber-600' },
  changes_requested: { label: 'Changes requested', className: 'bg-destructive/15 text-destructive' },
  approved: { label: 'Approved', className: 'bg-primary/15 text-primary' },
};

/**
 * "Manager Approval" checklist item. For the trainee it renders a
 * Submit for Approval button; for an approver it renders Approve & Sign
 * or Request Changes.
 */
export function ManagerApprovalItem({
  question,
  assignmentId,
  completionPercent,
  currentUserId,
  isApproverByRole,
}: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: assignment } = useQuery({
    queryKey: ['checklist-assignment', assignmentId],
    enabled: !!assignmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_assignments')
        .select('*')
        .eq('id', assignmentId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!assignmentId) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 flex items-start gap-3">
          <ShieldCheck className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm font-medium">{question || 'Manager approval'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Approval is tracked per trainee — open this checklist from your training assignment.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const status: string = assignment?.status || 'pending';
  const meta = statusMeta[status] || statusMeta.pending;
  const isTrainee = !!currentUserId && assignment?.assignee_id === currentUserId;
  const isApprover =
    isApproverByRole ||
    (!!currentUserId && (assignment?.approver_user_ids || []).includes(currentUserId));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['checklist-assignment', assignmentId] });
    queryClient.invalidateQueries({ queryKey: ['checklist-assignments'] });
  };

  const submitForApproval = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from('checklist_assignments')
        .update({ status: 'submitted', submitted_at: new Date().toISOString(), manager_note: null })
        .eq('id', assignmentId);
      if (error) throw error;

      // Fire-and-forget push to the approvers
      supabase.functions
        .invoke('notify-training-approval', { body: { assignment_id: assignmentId } })
        .catch(() => {});

      toast.success('Sent to your manager for approval');
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Could not submit for approval');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from('checklist_assignments')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: currentUserId,
          manager_note: note.trim() || null,
        })
        .eq('id', assignmentId);
      if (error) throw error;
      toast.success('Training approved and signed');
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Could not approve');
    } finally {
      setBusy(false);
    }
  };

  const requestChanges = async () => {
    if (!note.trim()) {
      setShowNote(true);
      toast.error('Add a short note so the trainee knows what to fix');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from('checklist_assignments')
        .update({ status: 'changes_requested', manager_note: note.trim(), submitted_at: null })
        .eq('id', assignmentId);
      if (error) throw error;
      toast.success('Changes requested');
      refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Could not request changes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cn(status === 'approved' && 'border-primary/40')}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <ShieldCheck className="h-4 w-4 mt-0.5 text-primary shrink-0" />
            <p className="text-sm font-medium">{question || 'Manager approval'}</p>
          </div>
          <Badge className={cn('shrink-0 border-0 text-[11px]', meta.className)}>{meta.label}</Badge>
        </div>

        {assignment?.manager_note && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
            Manager note: {assignment.manager_note}
          </p>
        )}

        {status === 'approved' ? (
          <div className="flex items-center gap-2 text-xs text-primary font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Signed off{assignment?.approved_at ? ` on ${new Date(assignment.approved_at).toLocaleDateString()}` : ''}
          </div>
        ) : isApprover && status === 'submitted' ? (
          <div className="space-y-2">
            {showNote && (
              <Textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Optional note for the trainee"
                className="text-sm"
              />
            )}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={busy} onClick={approve}>
                Approve &amp; Sign
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={showNote ? requestChanges : () => setShowNote(true)}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Request Changes
              </Button>
            </div>
          </div>
        ) : isTrainee ? (
          <Button
            size="sm"
            className="w-full"
            disabled={busy || completionPercent < 100 || status === 'submitted'}
            onClick={submitForApproval}
          >
            {status === 'submitted' ? (
              <>
                <Clock className="h-3.5 w-3.5 mr-1" />
                Waiting on your manager
              </>
            ) : completionPercent < 100 ? (
              'Finish every task to submit'
            ) : (
              'Submit for Approval'
            )}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            {status === 'submitted' ? 'Waiting on an approver.' : 'Trainee is still working through this checklist.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
