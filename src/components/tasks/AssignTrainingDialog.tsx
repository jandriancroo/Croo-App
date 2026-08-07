import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AssigneePicker } from '@/components/shared/AssigneePicker';
import { toast } from 'sonner';
import { Loader2, Lock } from 'lucide-react';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface SessionRow {
  id: string;
  session_id: string;
  assignee_id: string;
  assigned_date: string;
  status: string;
  approver_roles: string[];
  approver_user_ids: string[];
}

interface Session {
  session_id: string;
  assigned_date: string;
  rows: SessionRow[];
  approver_roles: string[];
  approver_user_ids: string[];
}

interface AssignTrainingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklistId: string | null;
  checklistTitle?: string;
  locationId?: string | null;
}

const NEW_SESSION = '__new__';

export function AssignTrainingDialog({
  open,
  onOpenChange,
  checklistId,
  checklistTitle,
  locationId,
}: AssignTrainingDialogProps) {
  const queryClient = useQueryClient();
  const { timezone } = useLocationTimezone();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [traineeIds, setTraineeIds] = useState<string[]>([]);
  const [approverRoles, setApproverRoles] = useState<string[]>([]);
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(NEW_SESSION);

  const today = useMemo(
    () => DateTime.now().setZone(timezone || 'America/Los_Angeles').toFormat('yyyy-MM-dd'),
    [timezone]
  );

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name || 'Team member';

  const activeSession = sessions.find((s) => s.session_id === selectedSessionId) || null;
  const lockedTraineeIds = activeSession ? activeSession.rows.map((r) => r.assignee_id) : [];

  useEffect(() => {
    if (!open) return;
    setSelectedSessionId(NEW_SESSION);
    setTraineeIds([]);
    setApproverRoles([]);
    setApproverUserIds([]);
    setDate(today);
  }, [open, today]);

  useEffect(() => {
    if (!open || !locationId) return;
    let cancelled = false;
    (async () => {
      const { data: userLocs } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', locationId);
      const ids = (userLocs || []).map((u: any) => u.user_id);
      if (!ids.length) {
        if (!cancelled) setProfiles([]);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', ids)
        .order('full_name');
      if (!cancelled) setProfiles((data as Profile[]) || []);
    })();
    return () => { cancelled = true; };
  }, [open, locationId]);

  // Active (not yet approved / cancelled) sessions for this training template
  const loadSessions = async () => {
    if (!checklistId) return;
    const { data } = await supabase
      .from('checklist_assignments')
      .select('id, session_id, assignee_id, assigned_date, status, approver_roles, approver_user_ids')
      .eq('checklist_id', checklistId)
      .not('status', 'in', '("approved","cancelled")')
      .order('assigned_date', { ascending: false });

    const map = new Map<string, Session>();
    (data || []).forEach((r: any) => {
      const existing = map.get(r.session_id);
      if (existing) {
        existing.rows.push(r);
        if (r.assigned_date < existing.assigned_date) existing.assigned_date = r.assigned_date;
      } else {
        map.set(r.session_id, {
          session_id: r.session_id,
          assigned_date: r.assigned_date,
          rows: [r],
          approver_roles: r.approver_roles || [],
          approver_user_ids: r.approver_user_ids || [],
        });
      }
    });
    setSessions([...map.values()]);
  };

  useEffect(() => {
    if (!open || !checklistId) return;
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checklistId]);

  // Hydrate the form when a session is picked
  useEffect(() => {
    if (selectedSessionId === NEW_SESSION) {
      setTraineeIds([]);
      setApproverRoles([]);
      setApproverUserIds([]);
      setDate(today);
      return;
    }
    const s = sessions.find((x) => x.session_id === selectedSessionId);
    if (!s) return;
    setTraineeIds(s.rows.map((r) => r.assignee_id));
    setApproverRoles(s.approver_roles);
    setApproverUserIds(s.approver_user_ids);
    setDate(s.assigned_date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, sessions]);

  const toggleTrainee = (id: string) => {
    if (lockedTraineeIds.includes(id)) return;
    setTraineeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const sessionLabel = (s: Session) => {
    const d = DateTime.fromFormat(s.assigned_date, 'yyyy-MM-dd').toFormat('MMM d');
    const names = s.rows.map((r) => nameOf(r.assignee_id).split(' ')[0]).join(', ');
    return `${d} · ${names || `${s.rows.length} trainees`}`;
  };

  const handleSave = async () => {
    if (!checklistId || !traineeIds.length || !date) {
      toast.error('Pick at least one trainee and a date');
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id ?? null;

      if (activeSession) {
        // Update session-wide settings on every existing row (approvers apply to everyone)
        const { error: upErr } = await supabase
          .from('checklist_assignments')
          .update({
            assigned_date: date,
            approver_roles: approverRoles as any,
            approver_user_ids: approverUserIds,
          })
          .eq('session_id', activeSession.session_id);
        if (upErr) throw upErr;

        const added = traineeIds.filter((id) => !lockedTraineeIds.includes(id));
        if (added.length) {
          const { error: insErr } = await supabase.from('checklist_assignments').insert(
            added.map((assignee_id) => ({
              checklist_id: checklistId,
              assignee_id,
              assigned_date: date,
              assigned_by: uid,
              location_id: locationId ?? null,
              session_id: activeSession.session_id,
              approver_roles: approverRoles as any,
              approver_user_ids: approverUserIds,
            }))
          );
          if (insErr) throw insErr;
        }
        toast.success(added.length ? `Session updated · ${added.length} trainee(s) added` : 'Session updated');
      } else {
        const sessionId = crypto.randomUUID();
        const rows = traineeIds.map((assignee_id) => ({
          checklist_id: checklistId,
          assignee_id,
          assigned_date: date,
          assigned_by: uid,
          location_id: locationId ?? null,
          session_id: sessionId,
          approver_roles: approverRoles as any,
          approver_user_ids: approverUserIds,
        }));
        const { error } = await supabase.from('checklist_assignments').insert(rows);
        if (error) throw error;
        toast.success(`Assigned to ${traineeIds.length} team member${traineeIds.length > 1 ? 's' : ''}`);
      }

      queryClient.invalidateQueries({ queryKey: ['checklist-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['training-template-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save training session');
    } finally {
      setSaving(false);
    }
  };

  const handleEndSession = async () => {
    if (!activeSession) return;
    setEnding(true);
    try {
      const { error } = await supabase
        .from('checklist_assignments')
        .update({ status: 'cancelled' })
        .eq('session_id', activeSession.session_id)
        .neq('status', 'approved');
      if (error) throw error;
      toast.success('Training session ended');
      queryClient.invalidateQueries({ queryKey: ['checklist-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['training-template-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
      setConfirmEnd(false);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to end session');
    } finally {
      setEnding(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{activeSession ? 'Edit Training Session' : 'Assign Training'}</DialogTitle>
            <DialogDescription>{checklistTitle}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {sessions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Session</Label>
                <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_SESSION}>+ New session</SelectItem>
                    {sessions.map((s) => (
                      <SelectItem key={s.session_id} value={s.session_id}>
                        {sessionLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">{activeSession ? 'Start date' : 'Date'}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <p className="text-[10px] text-muted-foreground">
                Stays on the trainee's list every day until it's completed or the session is ended.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Trainees</Label>
              <ScrollArea className="h-44 rounded-md border">
                <div className="p-2 space-y-1">
                  {profiles.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">No team members found</p>
                  ) : (
                    profiles.map((p) => {
                      const locked = lockedTraineeIds.includes(p.id);
                      const inOtherSession =
                        !locked &&
                        sessions.some(
                          (s) =>
                            s.session_id !== selectedSessionId &&
                            s.rows.some((r) => r.assignee_id === p.id)
                        );
                      const disabled = locked || inOtherSession;
                      return (
                        <label
                          key={p.id}
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                            disabled ? 'cursor-not-allowed' : 'hover:bg-muted/50 cursor-pointer'
                          } ${inOtherSession ? 'opacity-50' : ''}`}
                        >
                          <Checkbox
                            checked={traineeIds.includes(p.id)}
                            disabled={disabled}
                            onCheckedChange={() => toggleTrainee(p.id)}
                          />
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={p.profile_photo_url || undefined} />
                            <AvatarFallback className="text-[10px]">
                              {(p.full_name || '?').charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm truncate flex-1">{p.full_name}</span>
                          {locked && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                          {inOtherSession && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              In another session
                            </span>
                          )}
                        </label>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
              <p className="text-[10px] text-muted-foreground">
                {activeSession
                  ? 'Existing trainees are locked in — you can add more to this session.'
                  : 'Each trainee gets their own copy — they complete and get approved separately.'}
              </p>
            </div>

            <AssigneePicker
              locationId={locationId}
              selectedRoles={approverRoles}
              onRolesChange={setApproverRoles}
              selectedUserIds={approverUserIds}
              onUserIdsChange={setApproverUserIds}
              label="Approved by"
              helperText="Pick any mix of roles and specific people who can sign off."
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {activeSession ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmEnd(true)}
              >
                End session
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {activeSession ? 'Save changes' : 'Assign'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this training session?</AlertDialogTitle>
            <AlertDialogDescription>
              Unfinished trainees will have it removed from their task list. Anything already
              approved is kept in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleEndSession(); }}
              disabled={ending}
            >
              {ending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              End session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
