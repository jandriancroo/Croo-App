import { useState } from 'react';
import { ArrowLeftRight, ChevronDown } from 'lucide-react';
import { ShiftOfferMessage } from '@/components/messages/ShiftOfferMessage';
import type { OpenShiftOffer } from '@/hooks/useOpenShiftOffers';
import { cn } from '@/lib/utils';

/** Collapsible "Shift Swaps" bar at the top of the activity feed. */
export function ShiftSwapBar({ offers }: { offers: OpenShiftOffer[] }) {
  const [open, setOpen] = useState(false);
  if (!offers.length) return null;
  const openCount = offers.filter((o) => o.status === 'available').length;
  const pending = offers.filter((o) => o.status === 'claimed').length;
  const covered = offers.filter((o) => o.status === 'approved').length;
  const summary = [openCount && `${openCount} open`, pending && `${pending} awaiting approval`, covered && `${covered} covered`]
    .filter(Boolean).join(' · ');
  const sorted = [...offers].sort((a, b) => (a.shift_date || '').localeCompare(b.shift_date || ''));

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15">
          <ArrowLeftRight className="h-4 w-4 text-accent" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Shift Swaps</span>
          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {sorted.map((o) => (
            <ShiftOfferMessage key={o.id} offerId={o.id} messageId="" compact />
          ))}
        </div>
      )}
    </div>
  );
}
