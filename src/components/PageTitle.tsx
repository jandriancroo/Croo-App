import React from 'react';
import { cn } from '@/lib/utils';

export type PageTitleColor =
  | 'teal'
  | 'orange'
  | 'purple'
  | 'blue'
  | 'red'
  | 'slate'
  | 'emerald'
  | 'indigo'
  | 'amber'
  | 'cyan'
  | 'green'
  | 'yellow'
  | 'rose'
  | 'violet'
  | 'fuchsia'
  | 'sky'
  | 'pink';

const COLOR_MAP: Record<PageTitleColor, string> = {
  teal: '#14b8a6',
  orange: '#f97316',
  purple: '#a855f7',
  blue: '#3b82f6',
  red: '#ef4444',
  slate: '#64748b',
  emerald: '#10b981',
  indigo: '#6366f1',
  amber: '#f59e0b',
  cyan: '#06b6d4',
  green: '#22c55e',
  yellow: '#eab308',
  rose: '#f43f5e',
  violet: '#8b5cf6',
  fuchsia: '#d946ef',
  sky: '#0ea5e9',
  pink: '#ec4899',
};

interface PageTitleProps {
  children: React.ReactNode;
  color: PageTitleColor | string;
  className?: string;
  as?: 'h1' | 'h2';
}

/**
 * Standardized page title with a colored accent bar.
 * Used across every top-level page that has an existing title.
 * Do NOT add this to pages that don't already have a title.
 */
export const PageTitle = React.memo(function PageTitle({
  children,
  color,
  className,
  as: Tag = 'h1',
}: PageTitleProps) {
  const barColor = (COLOR_MAP as Record<string, string>)[color] ?? color;
  return (
    <div className={cn('flex items-center gap-3 mt-4 md:mt-0', className)}>
      <span
        aria-hidden="true"
        className="shrink-0 self-center rounded-[2px] h-[0.7em]"
        style={{ width: 4, backgroundColor: barColor }}
      />
      <Tag className="font-apple-system text-[28px] font-bold leading-[1.05] tracking-tight">
        {children}
      </Tag>
    </div>
  );
});
