import { CalendarDays, FileText, GraduationCap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const OPTIONS = [
  {
    key: 'standard', Icon: FileText, name: 'Standard', to: '/create-checklist',
    desc: 'A list your crew works through on a schedule you choose: every day, certain days of the week, monthly, quarterly, or on one date. Same tasks each time.',
  },
  {
    key: 'training', Icon: GraduationCap, name: 'Training', to: '/create-checklist?type=training',
    desc: 'For onboarding a new team member. You assign it to a trainee, each trainee gets their own copy, and it is scored per assignment. Managers can sign off on it.',
  },
  {
    key: 'dynamic', Icon: CalendarDays, name: 'Dynamic Weekly', to: '/dynamic-checklist/new',
    desc: 'Different tasks on different days of the week, set on a weekly calendar. Good for rotating weekly and monthly cleaning.',
  },
] as const;

/** New checklist: the type is chosen once here and never changes. */
export function ChecklistTypeDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="duo-popup max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What kind of checklist?</DialogTitle>
          <DialogDescription className="sr-only">Pick the type of checklist to create.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          {OPTIONS.map(({ key, Icon, name, desc, to }) => (
            <button
              key={key}
              type="button"
              onClick={() => { onOpenChange(false); navigate(to); }}
              className="flex min-h-11 w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block text-base font-semibold">{name}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{desc}</span>
              </span>
            </button>
          ))}
          <p className="px-1 text-sm text-muted-foreground">You can't change the type after you create it.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
