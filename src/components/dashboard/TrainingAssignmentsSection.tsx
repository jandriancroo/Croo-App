import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, GraduationCap } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';
import { ChecklistStat } from '@/components/dashboard/ChecklistStat';
import { useTrainingAssignments, type TrainingAssignment } from '@/hooks/useTrainingAssignments';

interface Props {
  locationId?: string | null;
  userId?: string | null;
  timezone?: string;
  /** Managers/admins see every trainee grouped by template */
  canApprove: boolean;
}

/** Groups training assignments into one header per checklist, one row per trainee. */
export function groupTrainingAssignments(
  assignments: TrainingAssignment[],
  userId?: string | null,
  canApprove?: boolean
) {
  const visible = assignments.filter(a => canApprove || a.assignee_id === userId);
  const map = new Map<string, { checklistId: string; title: string; expected: number; trainees: TrainingAssignment[] }>();
  visible.forEach(a => {
    const group = map.get(a.checklist_id) || {
      checklistId: a.checklist_id,
      title: a.checklist_title,
      expected: a.expected,
      trainees: [],
    };
    group.trainees.push(a);
    map.set(a.checklist_id, group);
  });
  return [...map.values()].map(g => ({
    ...g,
    trainees: [...g.trainees].sort((x, y) => x.assignee_name.localeCompare(y.assignee_name)),
  }));
}

export function TrainingAssignmentsSection({ locationId, userId, timezone, canApprove }: Props) {
  const navigate = useNavigate();
  const { data: assignments = [] } = useTrainingAssignments({ locationId, userId, timezone });

  const groups = useMemo(
    () => groupTrainingAssignments(assignments, userId, canApprove),
    [assignments, userId, canApprove]
  );

  if (groups.length === 0) return null;

  return (
    <>
      {/* Training break — labels the section */}
      <div className="flex items-center gap-2.5 px-[14px] pt-2.5 pb-0.5">
        <span className="text-[11px] uppercase tracking-[0.09em] text-primary">Training</span>
        <div className="flex-1 border-t border-dashed border-border" />
      </div>

      {groups.map(group => (
        <div key={group.checklistId}>
          {/* Group header — same title treatment as a regular checklist */}
          <div className="flex items-center gap-2 px-[14px] pt-1.5 pb-1">
            <span className="text-[15px] font-medium tracking-[-0.01em] text-foreground truncate">
              {group.title}
            </span>
            <GraduationCap className="h-4 w-4 text-primary shrink-0" aria-label="Training checklist" />
            <div className="flex-1" />
            <span className="text-[12px] text-muted-foreground shrink-0">
              {group.trainees.length} {group.trainees.length === 1 ? 'trainee' : 'trainees'} · {group.expected} items
            </span>
          </div>

          {/* Trainee rows */}
          <div className="px-[14px] pb-1.5 space-y-1">
            {group.trainees.map((a) => (
              <div
                key={a.id}
                onClick={() => navigate(`/complete/${a.checklist_id}?assignment=${a.id}`)}
                className="flex items-center gap-2.5 rounded-[14px] bg-primary/10 px-2.5 py-1.5 min-h-[40px] cursor-pointer transition-colors duration-150 hover:bg-primary/15"
              >
                <Avatar className="h-[26px] w-[26px] shrink-0">
                  <AvatarImage src={a.assignee_photo || undefined} alt="" />
                  <AvatarFallback className="bg-card text-primary text-[10px] font-medium">
                    {getInitials(a.assignee_name)}
                  </AvatarFallback>
                </Avatar>

                <span className="flex-1 text-[13px] text-foreground truncate">{a.assignee_name}</span>
                <ChecklistStat completed={a.completed} total={a.expected} />
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
