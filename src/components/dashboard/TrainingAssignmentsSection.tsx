import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DashSectionTitle } from '@/components/dashboard/DashSectionTitle';
import { GraduationCap, ChevronRight, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTrainingAssignments, shortName, type TrainingAssignment } from '@/hooks/useTrainingAssignments';

interface Props {
  locationId?: string | null;
  userId?: string | null;
  timezone?: string;
  /** Managers/admins see every trainee grouped by template */
  canApprove: boolean;
}

const statusBadge = (status: string) => {
  switch (status) {
    case 'submitted':
      return { label: 'Needs approval', className: 'bg-amber-500/15 text-amber-600' };
    case 'approved':
      return { label: 'Approved', className: 'bg-primary/15 text-primary' };
    case 'changes_requested':
      return { label: 'Changes requested', className: 'bg-destructive/15 text-destructive' };
    default:
      return { label: 'In progress', className: 'bg-muted text-muted-foreground' };
  }
};

const pct = (a: TrainingAssignment) =>
  a.expected > 0 ? Math.min(100, Math.round((a.completed / a.expected) * 100)) : 0;

export function TrainingAssignmentsSection({ locationId, userId, timezone, canApprove }: Props) {
  const navigate = useNavigate();
  const { data: assignments = [] } = useTrainingAssignments({ locationId, userId, timezone });

  const mine = useMemo(() => assignments.filter(a => a.assignee_id === userId), [assignments, userId]);
  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; rows: TrainingAssignment[] }>();
    assignments.forEach(a => {
      const g = map.get(a.checklist_id) || { title: a.checklist_title, rows: [] };
      g.rows.push(a);
      map.set(a.checklist_id, g);
    });
    return [...map.values()];
  }, [assignments]);

  if (assignments.length === 0) return null;

  const needsApproval = assignments.filter(a => a.status === 'submitted').length;

  const open = (a: TrainingAssignment) =>
    navigate(`/complete/${a.checklist_id}?assignment=${a.id}`);

  return (
    <div className="flex flex-col gap-1 w-full">
      <DashSectionTitle action={needsApproval > 0 ? `${needsApproval} need approval` : undefined}>
        Training
      </DashSectionTitle>

      <Card className="border-0 overflow-hidden p-0">
        <div className="divide-y divide-border/30">
          {/* My own training assignments always come first */}
          {mine.map(a => {
            const badge = statusBadge(a.status);
            return (
              <button
                key={a.id}
                onClick={() => open(a)}
                className="w-full text-left flex items-center gap-3 px-4 py-3 active:bg-muted/50 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <GraduationCap className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{a.checklist_title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct(a)}%` }} />
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground">{a.completed}/{a.expected}</span>
                  </div>
                </div>
                <Badge className={cn('border-0 text-[10px] shrink-0', badge.className)}>{badge.label}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              </button>
            );
          })}

          {/* Manager roll-up: one row per template, trainees nested beneath */}
          {canApprove &&
            grouped.map(group => {
              const others = group.rows.filter(r => r.assignee_id !== userId);
              if (others.length === 0) return null;
              return (
                <div key={group.title} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
                      {group.title}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {others.map(a => {
                      const badge = statusBadge(a.status);
                      return (
                        <button
                          key={a.id}
                          onClick={() => open(a)}
                          className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 active:bg-muted/50 transition-colors"
                        >
                          <Avatar className="h-6 w-6 shrink-0">
                            {a.assignee_photo && <AvatarImage src={a.assignee_photo} alt={a.assignee_name} />}
                            <AvatarFallback className="text-[10px]">
                              {a.assignee_name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate flex-1 text-left">
                            {shortName(a.assignee_name)}
                          </span>
                          <span className="text-xs font-semibold text-muted-foreground tabular-nums">{pct(a)}%</span>
                          <Badge className={cn('border-0 text-[10px] shrink-0', badge.className)}>{badge.label}</Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </Card>
    </div>
  );
}
