import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ASSIGNABLE_ROLE_OPTIONS } from '@/hooks/useUserRole';
import { shortName } from '@/hooks/useTrainingAssignments';

interface Props {
  checklistId: string;
}

/**
 * Compact "Assigned to X • Approved by Y" subtitle for a training template.
 * Shows only assignments that are not yet approved (i.e. still in flight).
 */
export function TrainingAssignmentSummary({ checklistId }: Props) {
  const { data } = useQuery({
    queryKey: ['training-template-assignments', checklistId],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from('checklist_assignments')
        .select('assignee_id, assigned_date, status, approver_roles, approver_user_ids')
        .eq('checklist_id', checklistId)
        .neq('status', 'approved')
        .order('assigned_date', { ascending: true });

      if (!rows || rows.length === 0) return { trainees: [], approvers: [] };

      const userIds = [
        ...new Set([
          ...rows.map((r: any) => r.assignee_id),
          ...rows.flatMap((r: any) => r.approver_user_ids || []),
        ]),
      ];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));

      const trainees = [
        ...new Set(rows.map((r: any) => shortName(nameMap.get(r.assignee_id) || ''))),
      ];
      const approverNames = rows.flatMap((r: any) =>
        (r.approver_user_ids || []).map((id: string) => shortName(nameMap.get(id) || ''))
      );
      const approverRoles = rows.flatMap((r: any) =>
        (r.approver_roles || []).map(
          (role: string) =>
            ASSIGNABLE_ROLE_OPTIONS.find((o) => o.value === role)?.label || role
        )
      );
      return { trainees, approvers: [...new Set([...approverNames, ...approverRoles])] };
    },
  });

  if (!data || data.trainees.length === 0) return null;

  return (
    <p className="text-[11px] text-muted-foreground truncate">
      Assigned to {data.trainees.join(', ')}
      {data.approvers.length > 0 && <> • Approved by {data.approvers.join(', ')}</>}
    </p>
  );
}
