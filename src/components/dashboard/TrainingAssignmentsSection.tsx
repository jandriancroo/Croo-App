import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ChevronRight, Check, GraduationCap } from 'lucide-react';
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

  const open = (a: TrainingAssignment) =>
    navigate(`/complete/${a.checklist_id}?assignment=${a.id}`);

  const Row = ({ a, showTrainee }: { a: TrainingAssignment; showTrainee: boolean }) => {
    const badge = statusBadge(a.status);
    const rate = pct(a);
    const isComplete = rate === 100;
    return (
      <div
        onClick={() => open(a)}
        className="overflow-hidden relative cursor-pointer hover:bg-muted/30 transition-colors duration-150"
      >
        <div className="flex items-center gap-3 pl-5 pr-4 py-2.5">
          {/* Progress ring — identical to checklist rows */}
          <div className="relative shrink-0 w-10 h-10">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="20" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
              <circle
                cx="24" cy="24" r="20" fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="3" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 20}
                strokeDashoffset={(2 * Math.PI * 20) - (rate / 100) * (2 * Math.PI * 20)}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              {isComplete ? (
                <Check className="h-5 w-5 text-primary" strokeWidth={3} />
              ) : (
                <span className="text-[11px] font-black text-primary">{rate}%</span>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-sm truncate">
                {showTrainee ? `${a.checklist_title} — ${shortName(a.assignee_name)}` : a.checklist_title}
              </span>
              <Badge className="border-0 bg-primary/10 text-primary text-[9px] tracking-wide shrink-0 px-1.5 py-0 gap-1">
                <GraduationCap className="h-2.5 w-2.5" />
                TRAINING
              </Badge>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${rate}%` }} />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{a.completed}/{a.expected}</span>
              <Badge className={cn('border-0 text-[10px] shrink-0', badge.className)}>{badge.label}</Badge>
            </div>
          </div>

          <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
        </div>
      </div>
    );
  };

  return (
    <>
      {mine.map(a => (
        <Row key={a.id} a={a} showTrainee={false} />
      ))}
      {canApprove &&
        assignments
          .filter(a => a.assignee_id !== userId)
          .map(a => <Row key={a.id} a={a} showTrainee />)}
    </>
  );
}
