import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AssigneePicker } from '@/components/shared/AssigneePicker';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useQueryClient } from '@tanstack/react-query';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface AssignTrainingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklistId: string | null;
  checklistTitle?: string;
  locationId?: string | null;
}

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

  const today = useMemo(
    () => DateTime.now().setZone(timezone || 'America/Los_Angeles').toFormat('yyyy-MM-dd'),
    [timezone]
  );

  useEffect(() => {
    if (!open) return;
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

  const toggleTrainee = (id: string) => {
    setTraineeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAssign = async () => {
    if (!checklistId || !traineeIds.length || !date) {
      toast.error('Pick at least one trainee and a date');
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const rows = traineeIds.map((assignee_id) => ({
        checklist_id: checklistId,
        assignee_id,
        assigned_date: date,
        assigned_by: userData?.user?.id ?? null,
        location_id: locationId ?? null,
        approver_roles: approverRoles as any,
        approver_user_ids: approverUserIds,
      }));
      const { error } = await supabase.from('checklist_assignments').insert(rows);
      if (error) throw error;
      toast.success(`Assigned to ${traineeIds.length} team member${traineeIds.length > 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['checklist-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to assign training');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Training</DialogTitle>
          <DialogDescription>{checklistTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Trainees</Label>
            <ScrollArea className="h-44 rounded-md border">
              <div className="p-2 space-y-1">
                {profiles.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">No team members found</p>
                ) : (
                  profiles.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={traineeIds.includes(p.id)}
                        onCheckedChange={() => toggleTrainee(p.id)}
                      />
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={p.profile_photo_url || undefined} />
                        <AvatarFallback className="text-[10px]">
                          {(p.full_name || '?').charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm truncate">{p.full_name}</span>
                    </label>
                  ))
                )}
              </div>
            </ScrollArea>
            <p className="text-[10px] text-muted-foreground">
              Each trainee gets their own copy — they complete and get approved separately.
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAssign} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
