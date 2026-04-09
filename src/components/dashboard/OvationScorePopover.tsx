import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Star, MessageSquare, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import ovationLogo from '@/assets/ovation-logo.png';

interface OvationReview {
  id: string;
  customerName: string;
  rating: number;
  feedback: string | null;
  source: string;
  createdAt: string;
  hasResponse: boolean;
}

interface OvationReviewsData {
  reviews: OvationReview[];
  wtdAverage: number | null;
  wtdCount: number;
  totalCount: number;
  error?: string;
  expired?: boolean;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={cn(
            'h-3.5 w-3.5 sm:h-3 sm:w-3',
            i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );
}

/** Shared hook so tab + panel use the same data without duplicate fetches */
export function useOvationData() {
  const { currentLocation, organizationId } = useAppLocation();

  const { data: brandId } = useQuery({
    queryKey: ['org-brand-id', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data } = await supabase
        .from('organizations')
        .select('brand_id')
        .eq('id', organizationId)
        .single();
      return data?.brand_id || null;
    },
    enabled: !!organizationId,
    staleTime: 60 * 60 * 1000,
  });

  const { data: reviewsData } = useQuery<OvationReviewsData>({
    queryKey: ['ovation-reviews', currentLocation?.id, brandId],
    queryFn: async () => {
      if (!currentLocation?.id) return { reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 };
      const session = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ovation-service?action=fetch_reviews`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.data.session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ locationId: currentLocation.id, days: 14, pageSize: 500 }),
        }
      );
      return (await response.json()) as OvationReviewsData;
    },
    enabled: !!currentLocation?.id && !!brandId,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  return { reviewsData, hasData: !!reviewsData && !reviewsData.error && !!reviewsData.wtdAverage };
}

/** The small fixed tab trigger */
export function OvationScoreTab({ expanded, onToggle, desktop }: { expanded: boolean; onToggle: () => void; desktop?: boolean }) {
  const { reviewsData, hasData } = useOvationData();

  if (!hasData || !reviewsData?.wtdAverage) return null;

  const scoreColor = reviewsData.wtdAverage >= 4.5 ? 'text-green-500' :
    reviewsData.wtdAverage >= 3.5 ? 'text-yellow-500' :
    reviewsData.wtdAverage >= 2.5 ? 'text-orange-500' : 'text-red-500';

  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 px-3.5 py-1.5 transition-all',
        desktop
          ? 'rounded-lg bg-white/15 hover:bg-white/25 border-0'
          : 'min-h-10 bg-muted/85 shadow-sm hover:bg-muted border border-t-0 border-border/30 rounded-b-xl'
      )}
    >
      <img src={ovationLogo} alt="OvationUp" className="h-4 w-4 sm:h-4 sm:w-4 object-contain" />
      <span className={cn('text-base sm:text-sm font-bold', desktop ? 'text-white' : scoreColor)}>
        {reviewsData.wtdAverage.toFixed(1)}
      </span>
      <span className={cn('text-[11px] sm:text-[9px] font-medium', desktop ? 'text-white/60' : 'text-muted-foreground')}>14d</span>
      <ChevronDown className={cn(
        'h-3.5 w-3.5 transition-transform duration-300',
        desktop ? 'text-white/60' : 'text-muted-foreground/60',
        expanded ? 'rotate-180' : 'rotate-0'
      )} />
    </button>
  );
}

/** The expandable panel that goes in document flow */
export function OvationExpandedPanel({ expanded }: { expanded: boolean }) {
  const { reviewsData, hasData } = useOvationData();
  const [reviewIndex, setReviewIndex] = useState(0);

  const reviewsWithFeedback = reviewsData?.reviews?.filter(r => r.feedback) || [];

  const advanceReview = useCallback(() => {
    if (reviewsWithFeedback.length > 1) {
      setReviewIndex(prev => (prev + 1) % reviewsWithFeedback.length);
    }
  }, [reviewsWithFeedback.length]);

  if (!hasData || !reviewsData?.wtdAverage) return null;

  return (
    <AnimatePresence>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className="overflow-hidden"
        >
          <div className="w-[min(22rem,calc(100vw-1.5rem))] sm:w-72 bg-white dark:bg-card border border-border/30 rounded-2xl shadow-lg mt-1">
            {/* Header */}
            <div className="px-4 sm:px-3 pt-3 sm:pt-2.5 pb-3 sm:pb-2 flex items-center justify-between gap-3 border-b border-border/20">
              <div className="flex items-center gap-2.5 min-w-0">
                <img src={ovationLogo} alt="OvationUp" className="h-7 w-7 sm:h-6 sm:w-6 object-contain shrink-0" />
                <div>
                  <p className="text-base sm:text-xs font-semibold leading-tight">OvationUp</p>
                  <p className="text-xs sm:text-[10px] text-muted-foreground leading-tight">
                    Last 14 days · {reviewsData.wtdCount} reviews
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <div className={cn(
                  'flex items-center justify-center min-w-12 px-3 py-1 rounded-xl font-bold text-lg sm:text-sm',
                  reviewsData.wtdAverage >= 4.5 ? 'bg-green-500/10 text-green-600' :
                  reviewsData.wtdAverage >= 3.5 ? 'bg-yellow-500/10 text-yellow-600' :
                  reviewsData.wtdAverage >= 2.5 ? 'bg-orange-500/10 text-orange-600' : 'bg-red-500/10 text-red-600'
                )}>
                  {reviewsData.wtdAverage.toFixed(1)}
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <MessageSquare className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span className="text-xs sm:text-[10px] font-medium">{reviewsData.wtdCount}</span>
                </div>
              </div>
            </div>

            {/* Reviews carousel */}
            {reviewsWithFeedback.length > 0 ? (
              <div
                className="px-4 sm:px-3 py-4 sm:py-3 min-h-[112px] sm:min-h-[60px] cursor-pointer"
                onClick={advanceReview}
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={reviewsWithFeedback[reviewIndex]?.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex items-center gap-2.5 mb-2 sm:mb-1 flex-wrap">
                      <StarRating rating={reviewsWithFeedback[reviewIndex]?.rating || 0} />
                      <span className="text-sm sm:text-[10px] text-muted-foreground truncate max-w-[11rem] sm:max-w-none">
                        {reviewsWithFeedback[reviewIndex]?.customerName}
                      </span>
                      {reviewsWithFeedback[reviewIndex]?.hasResponse && (
                        <span className="text-xs sm:text-[9px] text-green-500 font-medium">✓ replied</span>
                      )}
                    </div>
                    <p className="text-base sm:text-[11px] text-muted-foreground leading-relaxed sm:leading-snug line-clamp-4 sm:line-clamp-3">
                      {reviewsWithFeedback[reviewIndex]?.feedback}
                    </p>
                  </motion.div>
                </AnimatePresence>

                {reviewsWithFeedback.length > 1 && (
                  <div className="flex justify-center gap-1.5 mt-3 sm:mt-2">
                    {reviewsWithFeedback.slice(0, 8).map((_, idx) => (
                      <button
                        key={idx}
                        className={cn(
                          'h-2 w-2 sm:h-1 sm:w-1 rounded-full transition-all',
                          idx === reviewIndex ? 'bg-primary w-4 sm:w-2' : 'bg-muted-foreground/30'
                        )}
                        onClick={(e) => { e.stopPropagation(); setReviewIndex(idx); }}
                        aria-label={`Show review ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="px-4 sm:px-3 py-4 sm:py-3">
                <p className="text-base sm:text-[11px] text-muted-foreground italic">
                  {reviewsData.reviews.length} ratings (no written feedback)
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Desktop export — inline in header bar */
export function OvationScorePopover() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="relative">
      <OvationScoreTab desktop expanded={expanded} onToggle={() => setExpanded(prev => !prev)} />
      <div className="absolute top-full right-0 mt-1">
        <OvationExpandedPanel expanded={expanded} />
      </div>
    </div>
  );
}
