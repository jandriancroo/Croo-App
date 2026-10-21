// Where managers nudge from: swipe-up manager dash on phones; header button sheet (NudgeHeaderButton) on iPad/desktop.
// The list comes from the server (same rules as send); sending still goes through QuickNudgeSheet.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NudgeTapIcon } from '@/components/icons/NudgeTapIcon';
import { QuickNudgeSheet } from '@/components/dashboard/QuickNudgeSheet';
import { listNudgeables, type NudgeListItem, type TargetType } from '@/lib/quickNudges';

export const nudgeListKey = (locationId?: string | null) => ['quick-nudge-list', locationId] as const;

export function useNudgeList(locationId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: nudgeListKey(locationId),
    queryFn: () => listNudgeables(locationId!),
    enabled: enabled && !!locationId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

/** Header row shared by Nudge and On the clock: tile, title, chips, round chevron. */
export function DashSectionHeader({
  tile, title, chips, open, onToggle, right,
}: {
  tile: React.ReactNode; title: string; chips: React.ReactNode; open: boolean; onToggle: () => void; right?: React.ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-[44px] flex-1 min-w-0 items-center gap-3 text-left">
        {tile}
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-extrabold leading-tight">{title}</span>
          <span className="mt-1 flex min-w-0 flex-wrap gap-1.5">{chips}</span>
        </span>
      </button>
      {right}
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06]"
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  );
}

export function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'bad'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-bold tabular-nums',
        tone === 'bad' ? 'bg-[hsl(var(--status-overdue)/0.12)] text-[hsl(var(--status-overdue))]' : 'bg-foreground/[0.07] text-foreground/75',
      )}
    >
      {children}
    </span>
  );
}

function Row({ item, onNudge }: { item: NudgeListItem; onNudge: () => void }) {
  const late = item.group === 'overdue';
  const status = item.minutes_since_last_nudge != null ? `Nudged ${item.minutes_since_last_nudge}m ago` : item.status;
  return (
    <div
      className={cn('flex items-center gap-3 rounded-[14px] px-3 py-2 min-h-[52px]', late && 'border')}
      style={late ? { background: 'hsl(var(--status-overdue) / 0.07)', borderColor: 'hsl(var(--status-overdue) / 0.35)' } : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold">{item.title}</p>
        <p className={cn('truncate text-[12px] font-medium tabular-nums', late ? 'text-[hsl(var(--status-overdue))]' : 'opacity-75')}>{status}</p>
      </div>
      <button
        type="button"
        onClick={onNudge}
        className={cn(
          'h-9 shrink-0 rounded-full px-4 text-[13px] font-extrabold',
          late ? 'bg-accent text-accent-foreground' : 'border-[1.5px] border-accent text-accent',
        )}
      >
        {item.type === 'event' ? 'Heads-up' : 'Nudge'}
      </button>
    </div>
  );
}

/** The Nudge list (late first) plus the QuickNudgeSheet wizard. Shared by the Dash section and the header sheet. */
export function NudgeListPanel({ locationId, items, isLoading }: { locationId: string | null | undefined; items: NudgeListItem[]; isLoading: boolean }) {
  const [target, setTarget] = useState<{ type: TargetType; id: string; title: string } | null>(null);
  const queryClient = useQueryClient();
  const overdue = items.filter((i) => i.group === 'overdue');
  const coming = items.filter((i) => i.group === 'coming_up');
  const group = (label: string, list: NudgeListItem[]) =>
    list.length > 0 && (
      <div className="space-y-1.5">
        <p className="px-1 text-[11px] font-extrabold uppercase tracking-[0.08em] opacity-70 tabular-nums">{label} · {list.length}</p>
        {list.map((i) => (
          <Row key={`${i.type}:${i.id}`} item={i} onNudge={() => setTarget({ type: i.type, id: i.id, title: i.title })} />
        ))}
      </div>
    );
  return (
    <>
      <div className="space-y-3">
        {items.length === 0 && !isLoading && <p className="py-3 text-center text-[14px] font-medium opacity-75">Nothing to nudge right now.</p>}
        {group('Overdue', overdue)}
        {group('Coming up', coming)}
      </div>
      <QuickNudgeSheet
        targetType={target?.type ?? null}
        targetId={target?.id ?? null}
        title={target?.title ?? ''}
        preferTemplateName={target?.type === 'event' ? 'Heads-up' : undefined}
        onClose={() => setTarget(null)}
        onSent={() => {
          queryClient.invalidateQueries({ queryKey: ['quick-nudges-recent', locationId] });
          queryClient.invalidateQueries({ queryKey: nudgeListKey(locationId) });
        }}
      />
    </>
  );
}

export function NudgeSection({ locationId, className }: { locationId: string | null | undefined; className?: string }) {
  const [open, setOpen] = useState(false); // collapsed every time the dash opens
  const { data: items = [], isLoading } = useNudgeList(locationId, true);
  const overdue = items.filter((i) => i.group === 'overdue');
  const coming = items.filter((i) => i.group === 'coming_up');

  const chips = isLoading ? null : items.length === 0 ? (
    <Chip>All caught up</Chip>
  ) : (
    <>
      {overdue.length > 0 && <Chip tone="bad">{overdue.length} overdue</Chip>}
      {coming.length > 0 && <Chip>{coming.length} coming up</Chip>}
    </>
  );

  return (
    <div className={className}>
      <DashSectionHeader
        open={open}
        onToggle={() => setOpen((o) => !o)}
        title="Nudge"
        chips={chips}
        tile={
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-accent">
            <NudgeTapIcon size={24} />
          </span>
        }
      />
      <div className={open ? 'mt-2' : 'hidden'}>
        <NudgeListPanel locationId={locationId} items={items} isLoading={isLoading} />
      </div>
    </div>
  );
}
