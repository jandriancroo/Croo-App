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
  /** Right side, everything 44px tall (size="icon" / default Button / 44px pill). */
  action?: React.ReactNode;
  /** Optional line under the title row. */
  subtitle?: React.ReactNode;
  /** Optional left item (e.g. back arrow, 44px size="icon" ghost Button). */
  leading?: React.ReactNode;
}

/**
 * Standardized page title. One shape app-wide: 44px row, fixed gap above
 * (mt-3.5) and below (mb-3). Pages must not add/remove margin around it.
 */
export const PageTitle = React.memo(function PageTitle({
  children,
  color,
  className,
  as: Tag = 'h1',
  action,
  subtitle,
  leading,
}: PageTitleProps) {
  const barColor = (COLOR_MAP as Record<string, string>)[color] ?? color;
  return (
    <div className={cn('mt-3.5 mb-3', className)}>
      <div className="min-h-11 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 min-w-0">
          {leading && <div className="flex items-center shrink-0 -ml-2">{leading}</div>}
          <Tag className="font-apple-system text-[29px] font-bold leading-none tracking-tight flex items-center gap-3 min-w-0 my-0">
            <span
              aria-hidden
              className="inline-block shrink-0 rounded-[2px]"
              style={{
                width: '4px',
                height: '0.72em',
                backgroundColor: barColor,
              }}
            />
            <span className="truncate">{children}</span>
          </Tag>
        </div>
        {action && (
          <div className="flex items-center gap-2 shrink-0 [&_svg:not([class*='size-']):not([class*='h-'])]:size-5">
            {action}
          </div>
        )}
      </div>
      {subtitle && (
        <div className="text-sm text-muted-foreground -mt-1.5">{subtitle}</div>
      )}
    </div>
  );
});
