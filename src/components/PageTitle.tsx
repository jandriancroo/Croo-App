import React from 'react';
import { useDuo } from '@/hooks/useDuo';
import { createPortal } from 'react-dom';
import { DuoTitleSlotsContext } from '@/components/duo/DuoTitleSlots';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useOptionalLocation } from '@/hooks/useLocation';

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
  /** Right side: 40px on phones, 44px from md (size="icon" / Button). */
  action?: React.ReactNode;
  /** Optional line under the title row. */
  subtitle?: React.ReactNode;
  /** Optional left item (e.g. back arrow, 44px size="icon" ghost Button). */
  leading?: React.ReactNode;
  /** Status line above the title. Omit = today's date (store timezone). null = no line (Settings). */
  status?: PageTitleStatus | null;
  /** Approved open-Duo destination; other pages retain their in-page titles. */
  duoSlot?: 'left' | 'right';
}

export interface PageTitleStatus {
  text: string;
  tone?: 'muted' | 'warning';
}

/** Store timezone, same shared cache key as useLocationTimezone; safe outside the store provider. */
function useStoreTimezone(): string {
  const loc = useOptionalLocation();
  const id = loc?.currentLocation?.id;
  const { data } = useQuery({
    queryKey: ['location-timezone', id],
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('location_settings').select('timezone').eq('location_id', id!).maybeSingle();
      return data?.timezone || 'America/Los_Angeles';
    },
  });
  return data || 'America/Los_Angeles';
}

/** Default status text: e.g. "TUESDAY, OCT 20" in the store timezone. */
export function todayStatusText(timezone: string): string {
  return DateTime.now().setZone(timezone).toFormat('EEEE, MMM d').toUpperCase();
}

function StatusLine({ status }: { status?: PageTitleStatus }) {
  const tz = useStoreTimezone();
  const text = status?.text || todayStatusText(tz);
  return (
    <div
      className={cn(
        'duo-pt-status h-4 text-xs leading-4 font-semibold uppercase tracking-[0.06em] truncate',
        status?.tone === 'warning' ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground',
      )}
    >
      {text}
    </div>
  );
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
  status,
  duoSlot,
}: PageTitleProps) {
  const slots = React.useContext(DuoTitleSlotsContext);
  const target = duoSlot ? slots[duoSlot] : null;
  // Duo: the shared top band shows this page's name + status (themed pages hide the in-page title via CSS).
  const duo = useDuo();
  const tz = useStoreTimezone();
  const nameText = typeof children === 'string' ? children : '';
  const statusText = status === null ? '' : (status?.text || todayStatusText(tz));
  React.useEffect(() => {
    if (!duo.isDuo || target) return;
    const root = document.documentElement;
    if (nameText) root.dataset.duoPage = nameText;
    if (statusText) root.dataset.duoStatus = statusText; else delete root.dataset.duoStatus;
    return () => { delete root.dataset.duoPage; delete root.dataset.duoStatus; };
  }, [duo.isDuo, target, nameText, statusText]);
  if (target) {
    return <>
      {createPortal(
        <div className="duo-page-title">
          <div className="duo-page-title-copy">
            {status !== null && <StatusLine status={status} />}
            <Tag className="font-apple-system font-bold min-w-0 my-0">
              <span className="block truncate">{children}</span>
            </Tag>
          </div>
          {action && <div className="page-title-action flex items-center gap-2 shrink-0">{action}</div>}
        </div>, target,
      )}
      {subtitle && <div className="duo-page-subtitle text-sm text-muted-foreground">{subtitle}</div>}
    </>;
  }
  return (
    <div className={cn('duo-pt mt-3.5 mb-3', !leading && !action && 'duo-pt-empty', className)}>
      {status !== null && <StatusLine status={status} />}
      <div className="min-h-10 md:min-h-11 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 min-w-0">
          {leading && <div className="flex items-center shrink-0 -ml-2">{leading}</div>}
          <Tag className="duo-pt-h font-apple-system text-[22px] md:text-[29px] font-bold leading-[1.2] tracking-tight flex items-center gap-0 min-w-0 my-0">
            <span className="truncate">{children}</span>
          </Tag>
        </div>
        {action && (
          <div className="page-title-action flex items-center gap-2 shrink-0 [&_svg:not([class*='size-']):not([class*='h-'])]:size-5">
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
