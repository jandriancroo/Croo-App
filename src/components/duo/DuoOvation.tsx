import { useState } from 'react';
import { Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { useOvationData } from '@/components/dashboard/OvationScorePopover';
import ovationLogo from '@/assets/ovation-logo.png';

/** Duo-only Ovation bubble: pops out of the Ovation row in the menu (tail points at the row). Tap a review to advance; tap outside to close. */
export function DuoOvation({ open, onOpenChange, anchorTop }: { open: boolean; onOpenChange: (o: boolean) => void; anchorTop?: number }) {
  const { reviewsData, isLoading, displayScore, displayCount } = useOvationData();
  const [i, setI] = useState(0);
  const reviews = reviewsData?.reviews?.filter(r => r.feedback) ?? [];
  const n = Math.max(reviews.length, 1);
  const r = reviews[i % n];
  const step = (d: number) => setI(x => (x + d + n) % n);
  if (!open) return null;
  return (
    <>
      <div className="duo-ovb-scrim" onClick={() => onOpenChange(false)} />
      <div className="duo-ovb duo-glass" style={{ top: (anchorTop ?? 120) + 8 }} role="dialog" aria-label="Ovation reviews">
        <i className="duo-ovb-tail" aria-hidden />
        <div className="duo-ovb-head">
          <img src={ovationLogo} alt="" />
          <div><b>OvationUp</b><small>Last 14 days · {displayCount ?? 0} reviews</small></div>
          <span className="duo-ovation-score">{displayScore ? displayScore.toFixed(1) : isLoading ? '…' : '–'}</span>
        </div>
        <div className="duo-ovb-body" onClick={() => reviews.length > 1 && step(1)}>
          {r ? (
            <>
              <div className="duo-ovb-who">
                <span className="flex">{[1, 2, 3, 4, 5].map(k => <Star key={k} className="h-3.5 w-3.5" fill={k <= (r.rating || 0) ? 'currentColor' : 'none'} />)}</span>
                <span className="truncate">{r.customerName}</span>
                {r.hasResponse && <small>✓ replied</small>}
              </div>
              <p>{r.feedback}</p>
            </>
          ) : (
            <p className="duo-ovb-empty">{isLoading ? 'Loading reviews…' : `${reviewsData?.reviews?.length ?? 0} ratings (no written feedback)`}</p>
          )}
        </div>
        {reviews.length > 1 && (
          <div className="duo-ovb-nav">
            <button type="button" aria-label="Previous review" className="duo-ovation-arrow" onClick={() => step(-1)}><ChevronLeft size={20} /></button>
            <span>{(i % reviews.length) + 1} / {reviews.length}</span>
            <button type="button" aria-label="Next review" className="duo-ovation-arrow" onClick={() => step(1)}><ChevronRight size={20} /></button>
          </div>
        )}
      </div>
    </>
  );
}
