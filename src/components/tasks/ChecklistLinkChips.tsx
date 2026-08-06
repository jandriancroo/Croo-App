import { Badge } from '@/components/ui/badge';
import { X, BookOpen, ClipboardList, User, Shield } from 'lucide-react';
import type { ChecklistLinkRef, ChecklistLinkType } from '@/lib/checklistLinks';
import { cn } from '@/lib/utils';

const ICONS: Record<ChecklistLinkType, typeof BookOpen> = {
  recipe: BookOpen,
  log: ClipboardList,
  user: User,
  role: Shield,
};

const TONE: Record<ChecklistLinkType, string> = {
  recipe: 'border-primary/40 bg-primary/10 text-primary',
  log: 'border-primary/40 bg-primary/10 text-primary',
  user: 'border-border bg-muted text-foreground',
  role: 'border-border bg-muted text-foreground',
};

interface Props {
  refs: ChecklistLinkRef[];
  /** Author mode: show a remove button on each chip */
  onRemove?: (ref: ChecklistLinkRef) => void;
  /** Completion mode: tapping a chip opens its popover */
  onOpen?: (ref: ChecklistLinkRef) => void;
  className?: string;
}

export function ChecklistLinkChips({ refs, onRemove, onOpen, className }: Props) {
  if (refs.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {refs.map((ref) => {
        const Icon = ICONS[ref.type];
        const interactive = !!onOpen;
        return (
          <Badge
            key={`${ref.type}:${ref.id}`}
            variant="outline"
            onClick={interactive ? () => onOpen!(ref) : undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen!(ref);
                    }
                  }
                : undefined
            }
            className={cn(
              'gap-1 h-6 max-w-full font-normal',
              TONE[ref.type],
              interactive && 'cursor-pointer active:scale-95 transition-transform'
            )}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{ref.label}</span>
            {onRemove && (
              <button
                type="button"
                aria-label={`Remove ${ref.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(ref);
                }}
                className="ml-0.5 opacity-60 hover:opacity-100 shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        );
      })}
    </div>
  );
}
