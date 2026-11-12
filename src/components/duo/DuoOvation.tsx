import { useState } from 'react';
import { Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { ReviewsLogo, useReviewsData } from '@/components/dashboard/OvationScorePopover';
import { GoogleGLogo } from '@/components/dashboard/GoogleGLogo';

/** Duo-only reviews bubble (Ovation, or Google for non-Ovation stores): pops out of the reviews row in the menu (tail points at the row). Tap a review to advance; tap outside to close. */
export function DuoOvation({ open, onOpenChange, anchorTop }: { open: boolean; onOpenChange: (o: boolean) => void; anchorTop?: number }) {
  const { reviews: all, isLoading, displayScore, source, brandName, periodLabel, mapsUri } = useReviewsData();
  const [i, setI] = useState(0);
  const reviews = all.filter(r => r.feedback);
  const n = Math.max(reviews.length, 1);
  const r = reviews[i % n];
  const step = (d: number) => setI(x => (x + d + n) % n);
  if (!open) return null;
  return (
    <>
      <div className="duo-ovb-scrim" onClick={() => onOpenChange(false)} />
      <div className="duo-ovb duo-glass" style={{ top: (anchorTop ?? 120) + 8 }} role="dialog" aria-label={`${brandName} reviews`}>
        <i className="duo-ovb-tail" aria-hidden />
        <div className="duo-ovb-head">
          <ReviewsLogo source={source} className="h-[26px] w-[26px] shrink-0" />
          <div><b>{brandName}</b><small>{periodLabel}</small></div>
          <span className="duo-ovation-score">{displayScore ? displayScore.toFixed(1) : isLoading ? '…' : '–'}</span>
        </div>
        <div className="duo-ovb-body" onClick={() => reviews.length > 1 && step(1)}>
          {r ? (
            <>
              <div className="duo-ovb-who">
                <span className="flex">{[1, 2, 3, 4, 5].map(k => <Star key={k} className="h-3.5 w-3.5" fill={k <= (r.rating || 0) ? 'currentColor' : 'none'} />)}</span>
                <span className="truncate">{r.customerName}</span>
                {r.hasResponse && <small>✓ replied</small>}
                {r.relativeTime && <small>{r.relativeTime}</small>}
              </div>
              <p>{r.feedback}</p>
            </>
          ) : (
            <p className="duo-ovb-empty">{isLoading ? 'Loading reviews…' : `${all.length} ratings (no written feedback)`}</p>
          )}
        </div>
        {reviews.length > 1 && (
          <div className="duo-ovb-nav">
            <button type="button" aria-label="Previous review" className="duo-ovation-arrow" onClick={() => step(-1)}><ChevronLeft size={20} /></button>
            <span>{(i % reviews.length) + 1} / {reviews.length}</span>
            <button type="button" aria-label="Next review" className="duo-ovation-arrow" onClick={() => step(1)}><ChevronRight size={20} /></button>
          </div>
        )}
        {source === 'google' && (
          <div className="duo-ovb-nav">
            <GoogleGLogo className="h-3.5 w-3.5" />
            {mapsUri ? <a href={mapsUri} target="_blank" rel="noopener noreferrer">Reviews from Google</a> : <span>Reviews from Google</span>}
          </div>
        )}
      </div>
    </>
  );
}
