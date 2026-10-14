import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CollapsibleSection } from './CollapsibleSection';
import { EVENT_KIND_ICON, EVENT_KIND_TONE, eventKindFromTitle } from '@/lib/eventCategoryIcon';

export interface SectionEvent {
  id: string;
  event_name: string;
  event_time: string;
}

export function formatEventTime(time: string): string {
  const [h, m] = (time || '00:00').split(':');
  const hour = parseInt(h, 10) || 0;
  return `${hour % 12 || 12}:${m ?? '00'} ${hour >= 12 ? 'PM' : 'AM'}`;
}

/** "4 today · next 3:00 PM" (next = first event at/after now, local HH:MM). */
export function eventsSummary(events: SectionEvent[], nowHHMM: string | null, dayWord = 'today'): string {
  const base = `${events.length} ${dayWord}`;
  if (!nowHHMM) return base;
  const next = [...events].map((e) => e.event_time.slice(0, 5)).sort().find((t) => t >= nowHHMM);
  return next ? `${base} · next ${formatEventTime(next)}` : base;
}

export function EventRow({ event, onSelect }: { event: SectionEvent; onSelect: () => void }) {
  const kind = eventKindFromTitle(event.event_name);
  const Icon = EVENT_KIND_ICON[kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex h-[33px] w-full items-center gap-2 bg-card px-2.5 text-left active:bg-muted/60"
    >
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md', EVENT_KIND_TONE[kind])}>
        <Icon className="h-3 w-3" />
      </span>
      <span className="flex-1 truncate text-[13px] font-medium text-foreground">{event.event_name}</span>
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{formatEventTime(event.event_time)}</span>
    </button>
  );
}

interface EventsSectionProps<E extends SectionEvent> {
  events: E[];
  storageKey: string;
  onSelect: (e: E) => void;
  /** Local HH:MM now — only for "next" in the collapsed summary; null for other days. */
  nowHHMM: string | null;
  dayWord?: string;
}

export function EventsSection<E extends SectionEvent>({ events, storageKey, onSelect, nowHHMM, dayWord }: EventsSectionProps<E>) {
  if (events.length === 0) return null;
  return (
    <CollapsibleSection
      storageKey={storageKey}
      title="Events"
      icon={CalendarDays}
      tone="teal"
      count={events.length}
      collapsedSummary={eventsSummary(events, nowHHMM, dayWord)}
    >
      {events.map((e) => <EventRow key={e.id} event={e} onSelect={() => onSelect(e)} />)}
    </CollapsibleSection>
  );
}
