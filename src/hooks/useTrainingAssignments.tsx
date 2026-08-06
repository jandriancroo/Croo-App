import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DateTime } from 'luxon';

export interface TrainingAssignment {
  id: string;
  checklist_id: string;
  checklist_title: string;
  assignee_id: string;
  assignee_name: string;
  assignee_photo: string | null;
  assigned_date: string;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  approver_roles: string[];
  approver_user_ids: string[];
  expected: number;
  completed: number;
}

interface Params {
  locationId?: string | null;
  userId?: string | null;
  timezone?: string;
  enabled?: boolean;
}

/**
 * Training checklist assignments for the current business date at a location.
 * Each trainee gets their own assignment row, tracked and approved separately.
 */
export function useTrainingAssignments({ locationId, userId, timezone, enabled = true }: Params) {
  const today = useMemo(
    () => DateTime.now().setZone(timezone || 'America/Los_Angeles').toFormat('yyyy-MM-dd'),
    [timezone]
  );

  const query = useQuery({
    queryKey: ['checklist-assignments', locationId, today],
    staleTime: 60 * 1000,
    enabled: enabled && !!locationId && !!userId,
    queryFn: async (): Promise<TrainingAssignment[]> => {
      const { data: rows, error } = await supabase
        .from('checklist_assignments')
        .select('*, checklists(title)')
        .eq('location_id', locationId!)
        .eq('assigned_date', today);

      if (error) throw error;
      if (!rows || rows.length === 0) return [];

      const assigneeIds = [...new Set(rows.map((r: any) => r.assignee_id))];
      const checklistIds = [...new Set(rows.map((r: any) => r.checklist_id))];

      const [{ data: profiles }, { data: items }, { data: responses }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, profile_photo_url').in('id', assigneeIds),
        supabase.from('checklist_items').select('id, checklist_id, item_type').in('checklist_id', checklistIds),
        supabase
          .from('checklist_responses')
          .select('id, assignment_id')
          .in('assignment_id', rows.map((r: any) => r.id)),
      ]);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      const expectedMap = new Map<string, number>();
      (items || []).forEach((it: any) => {
        if (it.item_type === 'section_header' || it.item_type === 'manager_approval') return;
        expectedMap.set(it.checklist_id, (expectedMap.get(it.checklist_id) || 0) + 1);
      });
      const completedMap = new Map<string, number>();
      (responses || []).forEach((r: any) => {
        if (!r.assignment_id) return;
        completedMap.set(r.assignment_id, (completedMap.get(r.assignment_id) || 0) + 1);
      });

      return rows.map((r: any) => ({
        id: r.id,
        checklist_id: r.checklist_id,
        checklist_title: r.checklists?.title || 'Training',
        assignee_id: r.assignee_id,
        assignee_name: profileMap.get(r.assignee_id)?.full_name || 'Team member',
        assignee_photo: profileMap.get(r.assignee_id)?.profile_photo_url || null,
        assigned_date: r.assigned_date,
        status: r.status,
        submitted_at: r.submitted_at,
        approved_at: r.approved_at,
        approver_roles: r.approver_roles || [],
        approver_user_ids: r.approver_user_ids || [],
        expected: expectedMap.get(r.checklist_id) || 0,
        completed: completedMap.get(r.id) || 0,
      }));
    },
  });

  return { ...query, today };
}

/** Shortens "Jordan Andrian" to "Jordan A." for compact manager rows. */
export function shortName(fullName: string) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || 'Team member';
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}
