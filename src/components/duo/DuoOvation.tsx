import { useState } from 'react';
import { Star } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useOvationData } from '@/components/dashboard/OvationScorePopover';
import ovationLogo from '@/assets/ovation-logo.png';

/** Duo-only Ovation window: liquid-glass popup with the 14-day score and the written reviews (tap to advance). */
export function DuoOvation({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { reviewsData, isLoading, displayScore, displayCount } = useOvationData();
  const [i, setI] = useState(0);
  const reviews = reviewsData?.reviews?.filter(r => r.feedback) ?? [];
  const r = reviews[i % Math.max(reviews.length, 1)];
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
        <div className="duo-ovation-body" onClick={() => reviews.length > 1 && setI(n => (n + 1) % reviews.length)}>
          {r ? (
            <>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="flex">{[1, 2, 3, 4, 5].map(n => <Star key={n} className="h-4 w-4" fill={n <= (r.rating || 0) ? 'currentColor' : 'none'} />)}</span>
                <span className="text-sm font-semibold truncate">{r.customerName}</span>
                {r.hasResponse && <span className="text-xs text-muted-foreground">✓ replied</span>}
              </div>
              <p className="text-base leading-relaxed">{r.feedback}</p>
              {reviews.length > 1 && (
                <div className="flex justify-center gap-1.5 mt-4">
                  {reviews.slice(0, 8).map((_, idx) => <span key={idx} className={`h-1.5 rounded-full ${idx === i % reviews.length ? 'w-4 bg-foreground/70' : 'w-1.5 bg-foreground/25'}`} />)}
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
