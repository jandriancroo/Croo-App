import React from 'react';
import { BookOpen, ClipboardList, User, Shield } from 'lucide-react';
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
  role: 'border-border bg-muted text-muted-foreground',
};

/** Roles are informational only — never a tappable target. */
const isClickable = (ref: ChecklistLinkRef) => ref.type !== 'role';

interface Props {
  /** Raw item text, still containing the author's `@Label` mentions */
  text: string;
  refs: ChecklistLinkRef[];
  /** Opens the reference popover (recipes, logs, teammates) */
  onOpen?: (ref: ChecklistLinkRef) => void;
  className?: string;
}

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; ref: ChecklistLinkRef };

/**
 * Splits the item text at each `@Label` that matches a stored link ref so the
 * tag renders as an inline badge inside the sentence instead of a chip row.
 * Unmatched mentions are left as plain text.
 */
function buildSegments(text: string, refs: ChecklistLinkRef[]): Segment[] {
  if (!text) return [];
  // Longest labels first so "@Pizza Fries Deluxe" wins over "@Pizza Fries"
  const sorted = [...refs].sort((a, b) => b.label.length - a.label.length);

  const matches: { start: number; end: number; ref: ChecklistLinkRef }[] = [];
  const taken = (start: number, end: number) =>
    matches.some((m) => start < m.end && end > m.start);

  for (const ref of sorted) {
    const needle = `@${ref.label}`;
    let from = 0;
    while (from <= text.length) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      const end = at + needle.length;
      if (!taken(at, end)) {
        matches.push({ start: at, end, ref });
        break; // one inline badge per ref
      }
      from = at + 1;
    }
  }

  matches.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, m.start) });
    segments.push({ kind: 'ref', ref: m.ref });
    cursor = m.end;
  }
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });

  // Any ref whose mention text was edited away still shows up at the end
  const rendered = new Set(matches.map((m) => `${m.ref.type}:${m.ref.id}`));
  for (const ref of refs) {
    if (!rendered.has(`${ref.type}:${ref.id}`)) {
      segments.push({ kind: 'text', value: ' ' });
      segments.push({ kind: 'ref', ref });
    }
  }

  return segments;
}

export function ChecklistQuestionText({ text, refs, onOpen, className }: Props) {
  const segments = React.useMemo(() => buildSegments(text, refs), [text, refs]);

  return (
    <span className={cn('inline', className)}>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') return <React.Fragment key={i}>{seg.value}</React.Fragment>;
        const { ref } = seg;
        const Icon = ICONS[ref.type];
        const clickable = isClickable(ref) && !!onOpen;
        return (
          <span
            key={i}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onOpen!(ref) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen!(ref);
                    }
                  }
                : undefined
            }
            className={cn(
              'inline-flex items-center align-baseline gap-1 mx-0.5 px-1.5 py-0 rounded-full border text-[0.95em] font-normal leading-[1.5]',
              TONE[ref.type],
              clickable && 'cursor-pointer active:scale-95 transition-transform'
            )}
          >
            <Icon className="h-3 w-3 shrink-0" />
            {ref.label}
          </span>
        );
      })}
    </span>
  );
}
