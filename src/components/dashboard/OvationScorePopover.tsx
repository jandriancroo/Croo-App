import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Star, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
            'h-3 w-3',
            i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );
}

export function OvationScorePopover() {
  const { currentLocation, organizationId } = useAppLocation();
  const [reviewIndex, setReviewIndex] = useState(0);

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
          body: JSON.stringify({ locationId: currentLocation.id, days: 7, pageSize: 50 }),
        }
      );
      return (await response.json()) as OvationReviewsData;
    },
    enabled: !!currentLocation?.id && !!brandId,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  if (!reviewsData || reviewsData.error || !reviewsData.wtdAverage) {
    return null;
  }

  const reviewsWithFeedback = reviewsData.reviews?.filter(r => r.feedback) || [];
  const scoreColor = reviewsData.wtdAverage >= 4.5 ? 'text-green-500' :
    reviewsData.wtdAverage >= 3.5 ? 'text-yellow-500' :
    reviewsData.wtdAverage >= 2.5 ? 'text-orange-500' : 'text-red-500';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/60 hover:bg-muted transition-colors">
          <img src={ovationLogo} alt="OvationUp" className="h-4 w-4 object-contain" />
          <span className={cn('text-sm font-bold', scoreColor)}>
            {reviewsData.wtdAverage.toFixed(1)}
          </span>
          <span className="text-[9px] text-muted-foreground">7d</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={12}
        className="w-72 p-0 bg-white text-gray-900 border border-gray-200 rounded-2xl shadow-lg relative"
      >
        {/* Chat bubble arrow */}
        <div className="absolute -top-2 left-6 w-4 h-4 bg-white border-l border-t border-gray-200 rotate-45" />
        
        {/* Header */}
        <div className="relative z-10 px-3 pt-3 pb-2 flex items-center justify-between border-b border-gray-100 rounded-t-2xl bg-white">
          <div className="flex items-center gap-2">
            <img src={ovationLogo} alt="OvationUp" className="h-7 w-7 object-contain" />
            <div>
              <p className="text-xs font-semibold leading-tight text-gray-900">OvationUp</p>
              <p className="text-[10px] text-gray-500 leading-tight">
                Last 7 days · {reviewsData.wtdCount} reviews
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn(
              'flex items-center justify-center px-2 py-0.5 rounded-md font-bold text-sm',
              reviewsData.wtdAverage >= 4.5 ? 'bg-green-50 text-green-600' :
              reviewsData.wtdAverage >= 3.5 ? 'bg-yellow-50 text-yellow-600' :
              reviewsData.wtdAverage >= 2.5 ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600'
            )}>
              {reviewsData.wtdAverage.toFixed(1)}
            </div>
            <div className="flex items-center gap-1 text-gray-400">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="text-[10px]">{reviewsData.totalCount}</span>
            </div>
          </div>
        </div>

        {/* Reviews carousel */}
        {reviewsWithFeedback.length > 0 ? (
          <div className="relative z-10 px-3 py-3 min-h-[60px] bg-white rounded-b-2xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={reviewsWithFeedback[reviewIndex]?.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <StarRating rating={reviewsWithFeedback[reviewIndex]?.rating || 0} />
                  <span className="text-[10px] text-gray-500 truncate">
                    {reviewsWithFeedback[reviewIndex]?.customerName}
                  </span>
                  {reviewsWithFeedback[reviewIndex]?.hasResponse && (
                    <span className="text-[9px] text-green-500 font-medium">✓ replied</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-600 leading-snug line-clamp-3">
                  {reviewsWithFeedback[reviewIndex]?.feedback}
                </p>
              </motion.div>
            </AnimatePresence>

            {reviewsWithFeedback.length > 1 && (
              <div className="flex justify-center gap-1 mt-2">
                {reviewsWithFeedback.slice(0, 8).map((_, idx) => (
                  <button
                    key={idx}
                    className={cn(
                      'w-1 h-1 rounded-full transition-all',
                      idx === reviewIndex ? 'bg-blue-500 w-2' : 'bg-gray-300'
                    )}
                    onClick={() => setReviewIndex(idx)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="relative z-10 px-3 py-3 bg-white rounded-b-2xl">
            <p className="text-[11px] text-gray-500 italic">
              {reviewsData.reviews.length} ratings (no written feedback)
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
