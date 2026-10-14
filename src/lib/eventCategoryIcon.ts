import { CalendarDays, Cake, Pizza, Truck, type LucideIcon } from 'lucide-react';

export type EventKind = 'birthday' | 'order' | 'delivery' | 'default';

/** Events have no category field, so guess a kind from the title (display only). */
export function eventKindFromTitle(title: string | null | undefined): EventKind {
  const t = (title || '').toLowerCase();
  if (/\b(birthday|bday|b-day)\b/.test(t)) return 'birthday';
  if (/put\s*away|deliver(y|ies)?\b|truck/.test(t)) return 'delivery';
  if (/pizza|\border\b/.test(t)) return 'order';
  return 'default';
}

export const EVENT_KIND_ICON: Record<EventKind, LucideIcon> = {
  birthday: Cake,
  order: Pizza,
  delivery: Truck,
  default: CalendarDays,
};

/** Soft square + icon colors per kind, all from theme tokens. */
export const EVENT_KIND_TONE: Record<EventKind, string> = {
  birthday: 'bg-secondary text-secondary-foreground',
  order: 'bg-accent/15 text-accent',
  delivery: 'bg-primary/15 text-primary',
  default: 'bg-muted text-muted-foreground',
};
