import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Card } from '@/components/ui/card';
import { Star, MessageSquare, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

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

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const starSize = size === 'lg' ? 'h-4 w-4' : 'h-3 w-3';
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={cn(
            starSize,
            i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );
}

function getScoreColor(score: number): string {
  if (score >= 4.5) return 'text-green-500';
  if (score >= 3.5) return 'text-yellow-500';
  if (score >= 2.5) return 'text-orange-500';
  return 'text-red-500';
}

function getScoreBg(score: number): string {
  if (score >= 4.5) return 'bg-green-500/10';
  if (score >= 3.5) return 'bg-yellow-500/10';
  if (score >= 2.5) return 'bg-orange-500/10';
  return 'bg-red-500/10';
}

export function OvationReviewsCube() {
  const { currentLocation, organizationId } = useAppLocation();
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const scrollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Get brand_id — prefer locations.brand_id, fall back to org
  const { data: brandId } = useQuery({
    queryKey: ['location-brand-id', currentLocation?.id, organizationId],
    queryFn: async () => {
      if (currentLocation?.id) {
        const { data: loc } = await supabase
          .from('locations')
          .select('brand_id')
          .eq('id', currentLocation.id)
          .maybeSingle();
        if ((loc as any)?.brand_id) return (loc as any).brand_id as string;
      }
      if (!organizationId) return null;
      const { data } = await supabase
        .from('organizations')
        .select('brand_id')
        .eq('id', organizationId)
        .single();
      return data?.brand_id || null;
    },
    enabled: !!organizationId || !!currentLocation?.id,
    staleTime: 60 * 60 * 1000,
  });



  // Fetch reviews for the current location
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
           body: JSON.stringify({
             locationId: currentLocation.id,
             days: 14,
             pageSize: 500,
           }),
        }
      );

      const data = await response.json();
       if (!response.ok) {
         console.warn('[Ovation] Edge function returned', response.status);
         return { reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 };
       }
      return data as OvationReviewsData;
    },
    enabled: !!currentLocation?.id,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000, // Refresh every 10 minutes
  });

  // Reset review index when location changes
  useEffect(() => {
    setCurrentReviewIndex(0);
  }, [currentLocation?.id]);

  // Auto-scroll through reviews with feedback
  const reviewsWithFeedback = reviewsData?.reviews?.filter(r => r.feedback) || [];

  useEffect(() => {
    if (reviewsWithFeedback.length <= 1) return;

    scrollTimerRef.current = setInterval(() => {
      setCurrentReviewIndex(prev => (prev + 1) % reviewsWithFeedback.length);
    }, 8000);

    return () => {
      if (scrollTimerRef.current) clearInterval(scrollTimerRef.current);
    };
  }, [reviewsWithFeedback.length]);

  // Don't render if no data or not configured
  if (!reviewsData || (reviewsData.reviews?.length === 0 && !reviewsData.error)) {
    return null;
  }

  if (reviewsData.error) {
    // Only show if there's an integration but it's expired
    if (reviewsData.expired) {
      return (
        <Card className="p-3 border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center gap-2 text-yellow-500 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>OvationUp token expired — update in Settings</span>
          </div>
        </Card>
      );
    }
    return null;
  }

  const currentReview = reviewsWithFeedback[currentReviewIndex];
  const wtdAvg = reviewsData.wtdAverage;

  return (
    <Card className="overflow-hidden">
      {/* Header with WTD Score */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm',
            wtdAvg ? getScoreBg(wtdAvg) : 'bg-muted'
          )}>
            <span className={wtdAvg ? getScoreColor(wtdAvg) : 'text-muted-foreground'}>
              {wtdAvg ? wtdAvg.toFixed(1) : '--'}
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold leading-tight">OvationUp</p>
            <p className="text-[10px] text-muted-foreground leading-tight">
              WTD avg · {reviewsData.wtdCount} reviews
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="text-[10px]">{reviewsData.totalCount}</span>
        </div>
      </div>

      {/* Scrolling Review */}
      {currentReview && (
        <div className="px-3 pb-3 min-h-[60px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentReview.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex items-center gap-2 mb-1">
                <StarRating rating={currentReview.rating} />
                <span className="text-[10px] text-muted-foreground truncate">
                  {currentReview.customerName}
                </span>
                {currentReview.hasResponse && (
                  <span className="text-[9px] text-green-500 font-medium">✓ replied</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3">
                {currentReview.feedback}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Dot indicators */}
          {reviewsWithFeedback.length > 1 && (
            <div className="flex justify-center gap-1 mt-2">
              {reviewsWithFeedback.slice(0, 8).map((_, idx) => (
                <button
                  key={idx}
                  className={cn(
                    'w-1 h-1 rounded-full transition-all',
                    idx === currentReviewIndex ? 'bg-primary w-2' : 'bg-muted-foreground/30'
                  )}
                  onClick={() => setCurrentReviewIndex(idx)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* No reviews with feedback fallback */}
      {!currentReview && reviewsData.reviews.length > 0 && (
        <div className="px-3 pb-3">
          <p className="text-[11px] text-muted-foreground italic">
            {reviewsData.reviews.length} ratings this week (no written feedback)
          </p>
        </div>
      )}
    </Card>
  );
}
