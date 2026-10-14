import { useCallback, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function readCollapsed(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
}

interface CollapsibleSectionProps {
  /** localStorage key for the collapsed state (default expanded). */
  storageKey: string;
  title: string;
  icon: LucideIcon;
  tone: 'teal' | 'orange';
  count: number;
  /** Shown on the header bar when collapsed, e.g. "4 today · next 3:00 PM". */
  collapsedSummary: string;
  children: ReactNode;
}

/** Solid header bar (icon, title, count, chevron) over compact white rows. Mobile Today sections. */
export function CollapsibleSection({ storageKey, title, icon: Icon, tone, count, collapsedSummary, children }: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }, [storageKey]);

  const bar = tone === 'teal' ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground';
  return (
    <section className={cn('w-full overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm', collapsed && 'border-0')}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className={cn('flex h-9 w-full items-center gap-2 px-3 text-left', bar, collapsed && 'rounded-xl')}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-sm font-bold">{title}</span>
        <span className="ml-auto truncate text-xs font-semibold opacity-95">{collapsed ? collapsedSummary : count}</span>
        {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>
      {!collapsed && <div className="divide-y divide-border/60">{children}</div>}
    </section>
  );
}
