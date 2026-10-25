import { useState } from 'react';
import { Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useOvationData } from '@/components/dashboard/OvationScorePopover';
import ovationLogo from '@/assets/ovation-logo.png';

/** Duo-only Ovation window: liquid-glass popup with the 14-day score and the written reviews (tap to advance). */
export function DuoOvation({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { reviewsData, isLoading, displayScore, displayCount } = useOvationData();
  const [i, setI] = useState(0);
  const reviews = reviewsData?.reviews?.filter(r => r.feedback) ?? [];
  const n = Math.max(reviews.length, 1);
  const r = reviews[i % n];
  const step = (d: number) => setI(x => (x + d + n) % n);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="duo-popup duo-glass-pop max-w-md p-0">
        <DialogHeader className="px-5 pt-5 pb-3 flex-row items-center justify-between gap-3 space-y-0">
          <div className="flex items-center gap-3 min-w-0">
            <img src={ovationLogo} alt="" className="h-8 w-8 object-contain shrink-0" />
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold leading-tight">OvationUp</DialogTitle>
              <DialogDescription className="text-xs leading-tight">Last 14 days · {displayCount ?? 0} reviews</DialogDescription>
            </div>
          </div>
          <div className="duo-ovation-score">{displayScore ? displayScore.toFixed(1) : isLoading ? '…' : '–'}</div>
        </DialogHeader>
        <div className="duo-ovation-body" onClick={() => reviews.length > 1 && step(1)}>
          {r ? (
            <>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="flex">{[1, 2, 3, 4, 5].map(n => <Star key={n} className="h-4 w-4" fill={n <= (r.rating || 0) ? 'currentColor' : 'none'} />)}</span>
                <span className="text-sm font-semibold truncate">{r.customerName}</span>
                {r.hasResponse && <span className="text-xs text-muted-foreground">✓ replied</span>}
              </div>
              <p className="text-base leading-relaxed">{r.feedback}</p>
              {reviews.length > 1 && (
                <div className="flex items-center justify-center gap-4 mt-4" onClick={e => e.stopPropagation()}>
                  <button type="button" aria-label="Previous review" className="duo-ovation-arrow" onClick={() => step(-1)}><ChevronLeft size={20} /></button>
                  <div className="flex gap-1.5">
                    {reviews.slice(0, 8).map((_, idx) => <span key={idx} className={`h-1.5 rounded-full ${idx === i % reviews.length ? 'w-4 bg-foreground/70' : 'w-1.5 bg-foreground/25'}`} />)}
                  </div>
                  <button type="button" aria-label="Next review" className="duo-ovation-arrow" onClick={() => step(1)}><ChevronRight size={20} /></button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic">{isLoading ? 'Loading reviews…' : `${reviewsData?.reviews?.length ?? 0} ratings (no written feedback)`}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
