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

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
    <div className={cn('mt-4 md:mt-0', className)}>
      <Tag className="font-apple-system text-[32px] font-extrabold leading-[1.05] tracking-tight">
        <span
          className="inline-flex items-center gap-2 rounded-xl px-4 py-1"
          style={{ backgroundColor: hexToRgba(barColor, 0.12) }}
        >
          <span
            aria-hidden="true"
            className="shrink-0 text-[32px] h-[0.7em] rounded-[2px]"
            style={{ width: 4, backgroundColor: barColor }}
          />
          {children}
        </span>
      </Tag>
    </div>
  );
});
