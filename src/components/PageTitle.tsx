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
  action?: React.ReactNode;
}

/**
 * Standardized page title: bold text with a short vertical accent bar
 * matching the title's cap height, plus an optional right-aligned action
 * icon that is vertically centered and sized to match the title.
 */
export const PageTitle = React.memo(function PageTitle({
  children,
  color,
  className,
  as: Tag = 'h1',
  action,
}: PageTitleProps) {
  const barColor = (COLOR_MAP as Record<string, string>)[color] ?? color;
  return (
    <div className={cn('mt-6 md:mt-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <Tag className="font-apple-system text-[29px] font-bold leading-none tracking-tight flex items-center gap-3">
          <span
            aria-hidden
            className="inline-block shrink-0 rounded-[2px]"
            style={{
              width: '4px',
              height: '0.72em',
              backgroundColor: barColor,
            }}
          />
          <span>{children}</span>
        </Tag>
        {action && (
          <div className="flex items-center shrink-0 [&_svg]:size-[23px]">
            {action}
          </div>
        )}
      </div>
    </div>
  );
});
