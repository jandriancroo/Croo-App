import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Star, MessageSquare, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import ovationLogo from '@/assets/ovation-logo.png';
import { GoogleGLogo } from '@/components/dashboard/GoogleGLogo';
import {
  googleDisplayReviews,
  googleScore,
  safeMapsUri,
  selectReviewsSource,
  type DisplayReview,
  type GoogleReviewsRow,
  type ReviewsSource,
} from '@/lib/reviewsSource';
import { ExpandableReviewText } from '@/components/dashboard/ExpandableReviewText';

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
    <div className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-yellow-400/15 border border-yellow-400/30">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={cn(
            'h-3.5 w-3.5 sm:h-3 sm:w-3',
            i <= rating ? 'fill-yellow-400 text-yellow-400' : 'fill-yellow-400/25 text-yellow-400'
          )}
        />
      ))}
    </div>
  );
}



// --- localStorage cache for instant hydration on reload ---
const OVATION_CACHE_KEY = 'ovation-last-score';

function getCachedScore(locationId: string | undefined): { wtdAverage: number; wtdCount: number } | null {
  if (!locationId) return null;
  try {
    const raw = localStorage.getItem(OVATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.locationId === locationId && Date.now() - parsed.ts < 24 * 60 * 60 * 1000) {
      return { wtdAverage: parsed.wtdAverage, wtdCount: parsed.wtdCount };
    }
  } catch { /* ignore */ }
  return null;
}

function setCachedScore(locationId: string, wtdAverage: number, wtdCount: number) {
  try {
    localStorage.setItem(OVATION_CACHE_KEY, JSON.stringify({ locationId, wtdAverage, wtdCount, ts: Date.now() }));
  } catch { /* ignore */ }
}

interface TriggerViewportRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}

function useTriggerViewportRect(expanded: boolean, triggerRef: RefObject<HTMLElement>) {
  const [rect, setRect] = useState<TriggerViewportRect | null>(null);

  useEffect(() => {
    if (!expanded) {
      setRect(null);
      return;
    }

    const updateRect = () => {
      const nextRect = triggerRef.current?.getBoundingClientRect();
      setRect(nextRect ? {
        top: nextRect.top,
        left: nextRect.left,
        width: nextRect.width,
        height: nextRect.height,
        bottom: nextRect.bottom,
      } : null);
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [expanded, triggerRef]);

  return rect;
}

/** Shared hook so tab + panel use the same data without duplicate fetches */
export function useOvationData() {
  const { currentLocation } = useAppLocation();
  const { user, session } = useAuth();
  const locationId = currentLocation?.id;
  const authReady = !!user && !!session;

  const { data: reviewsData, isLoading } = useQuery<OvationReviewsData>({
    queryKey: ['ovation-reviews', locationId, user?.id],
    queryFn: async () => {
      if (!locationId) return { reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 };
      const sess = await supabase.auth.getSession();
      const token = sess.data.session?.access_token;
      if (!token) {
        console.warn('[Ovation] No auth token available, skipping fetch');
        return { reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 };
      }
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ovation-service?action=fetch_reviews`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ locationId, days: 14, pageSize: 500 }),
        }
      );
      if (!response.ok) {
        console.warn('[Ovation] Edge function returned', response.status);
        return { reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 };
      }
      return (await response.json()) as OvationReviewsData;
    },
    enabled: !!locationId && authReady,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  // Cache the last good score for instant hydration on reload
  useEffect(() => {
    if (reviewsData?.wtdAverage && locationId) {
      setCachedScore(locationId, reviewsData.wtdAverage, reviewsData.wtdCount);
    }
  }, [reviewsData?.wtdAverage, reviewsData?.wtdCount, locationId]);

  const hasData = !!reviewsData && !reviewsData.error && !!reviewsData.wtdAverage;
  const cachedScore = !hasData ? getCachedScore(locationId) : null;
  const locationReady = !!locationId;
  // Only treat as "loading" for the initial fetch, NOT background refetches
  const isActuallyLoading = !locationReady || !authReady || isLoading;

  return {
    reviewsData,
    hasData,
    isLoading: isActuallyLoading,
    cachedScore,
    authReady,
    displayScore: hasData ? reviewsData?.wtdAverage : cachedScore?.wtdAverage,
    displayCount: hasData ? reviewsData?.wtdCount : cachedScore?.wtdCount,
  };
}

/** Google reviews for this store, or null. The RPC hides the row for Ovation stores. */
export function useGoogleReviewsRow() {
  const { currentLocation } = useAppLocation();
  const { user, session } = useAuth();
  const locationId = currentLocation?.id;
  const authReady = !!user && !!session;
  const query = useQuery<GoogleReviewsRow | null>({
    queryKey: ['google-reviews', locationId, user?.id],
    queryFn: async () => {
      if (!locationId) return null;
      // Not in the generated types yet; keep the client as `this` for rpc().
      const client = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
      const { data, error } = await client.rpc('get_location_google_reviews', { _location_id: locationId });
      if (error) {
        console.warn('[GoogleReviews] read failed', error.message);
        return null;
      }
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as GoogleReviewsRow | null;
    },
    enabled: !!locationId && authReady,
    staleTime: 30 * 60 * 1000,
  });
  return { row: query.data ?? null, isLoading: !locationId || !authReady || query.isLoading };
}

export interface ReviewsView {
  source: ReviewsSource;
  reviews: DisplayReview[];
  isLoading: boolean;
  displayScore: number | null | undefined;
  displayCount: number | null | undefined;
  /** Ovation: 14-day window. Google: all-time rating and total review count. */
  periodLabel: string;
  brandName: string;
  mapsUri: string | null;
}

/**
 * One hook for the review pill: Ovation where the store uses Ovation, else
 * Google when the store has an active Google row. Nothing shows when neither
 * has data, so stores without a Google row look exactly as before.
 */
export function useReviewsData(): ReviewsView {
  const ovation = useOvationData();
  const google = useGoogleReviewsRow();
  const source = selectReviewsSource({ ovationHasScore: !!ovation.displayScore, google: google.row });
  if (source === 'google') {
    const count = google.row?.user_rating_count ?? 0;
    return {
      source,
      reviews: googleDisplayReviews(google.row),
      isLoading: false,
      displayScore: googleScore(google.row),
      displayCount: count,
      periodLabel: `${count.toLocaleString()} Google reviews`,
      brandName: 'Google',
      mapsUri: safeMapsUri(google.row?.google_maps_uri),
    };
  }
  return {
    source,
    reviews: ovation.reviewsData?.reviews ?? [],
    // Keep the skeleton until both feeds have answered, so a Google store doesn't flash empty.
    isLoading: ovation.isLoading || (!ovation.displayScore && google.isLoading),
    displayScore: ovation.displayScore,
    displayCount: ovation.displayCount,
    periodLabel: `Last 14 days · ${ovation.displayCount ?? 0} reviews`,
    brandName: 'OvationUp',
    mapsUri: null,
  };
}

/** Logo for the active review feed. */
export function ReviewsLogo({ source, className }: { source: ReviewsSource; className?: string }) {
  return source === 'google'
    ? <GoogleGLogo className={cn('object-contain', className)} />
    : <img src={ovationLogo} alt="OvationUp" className={cn('object-contain', className)} />;
}

/** The small fixed tab trigger */
export function OvationScoreTab({ expanded, onToggle, desktop, bare, className }: { expanded: boolean; onToggle: () => void; desktop?: boolean; bare?: boolean; className?: string }) {
  const { isLoading, displayScore, source } = useReviewsData();

  // Nothing to show and not loading — hide completely
  if (!displayScore && !isLoading) return null;

  // Skeleton placeholder while loading with no cached data at all
  if (!displayScore && isLoading) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3.5 py-1.5',
          bare
            ? 'border-0'
            : desktop
              ? 'rounded-lg bg-white/15 border-0'
              : 'min-h-10 bg-muted/85 shadow-sm border border-t-0 border-border/30 rounded-b-xl',
          className
        )}
      >
        <div className="h-4 w-4 rounded bg-muted-foreground/20 animate-pulse" />
        <div className="h-4 w-8 rounded bg-muted-foreground/20 animate-pulse" />
        <div className="h-3 w-5 rounded bg-muted-foreground/20 animate-pulse" />
      </div>
    );
  }

  const scoreColor = displayScore! >= 4.5 ? 'text-green-500' :
    displayScore! >= 3.5 ? 'text-yellow-500' :
    displayScore! >= 2.5 ? 'text-orange-500' : 'text-red-500';

  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 px-3.5 py-1.5 transition-all',
        bare
          ? 'hover:bg-white/10 border-0'
          : desktop
            ? 'rounded-lg bg-white/15 hover:bg-white/25 border-0'
            : 'min-h-10 bg-muted/85 shadow-sm hover:bg-muted border border-t-0 border-border/30 rounded-b-xl',
        className
      )}
    >
      <ReviewsLogo source={source} className="h-4 w-4 sm:h-4 sm:w-4" />
      <span className={cn('text-base sm:text-sm font-bold', (desktop || bare) ? 'text-white' : scoreColor)}>
        {displayScore!.toFixed(1)}
      </span>
      {source === 'ovation' && (
        <span className={cn('hidden md:inline text-[11px] sm:text-[9px] font-medium', (desktop || bare) ? 'text-white/60' : 'text-muted-foreground')}>14d</span>
      )}
      <ChevronDown className={cn(
        'h-3.5 w-3.5 transition-transform duration-300',
        (desktop || bare) ? 'text-white/60' : 'text-muted-foreground/60',
        expanded ? 'rotate-180' : 'rotate-0'
      )} />
    </button>
  );
}

/** The expandable panel that goes in document flow */
export function OvationExpandedPanel({ expanded, triggerRef }: { expanded: boolean; triggerRef?: RefObject<HTMLElement> }) {
  const { reviews, isLoading, displayScore, displayCount, source, brandName, periodLabel, mapsUri } = useReviewsData();
  const [reviewIndex, setReviewIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [tailLeftPct, setTailLeftPct] = useState<number | null>(null);

  const reviewsWithFeedback = reviews.filter(r => r.feedback);
  const currentFeedbackReview = reviewsWithFeedback[reviewIndex];

  const advanceReview = useCallback(() => {
    if (reviewsWithFeedback.length > 1) {
      setReviewIndex(prev => (prev + 1) % reviewsWithFeedback.length);
    }
  }, [reviewsWithFeedback.length]);

  // Measure tail offset so it points at the trigger (Ovation pill).
  useEffect(() => {
    if (!expanded || !triggerRef?.current || !panelRef.current) {
      setTailLeftPct(null);
      return;
    }
    const compute = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const p = panelRef.current?.getBoundingClientRect();
      if (!t || !p || p.width === 0) return;
      const triggerCenter = t.left + t.width / 2;
      const offset = ((triggerCenter - p.left) / p.width) * 100;
      setTailLeftPct(Math.max(8, Math.min(92, offset)));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [expanded, triggerRef]);

  // Show panel if we have fresh data OR cached score (so it doesn't return null while loading)
  if (!displayScore && !isLoading) return null;

  const scoreValue = displayScore ?? 0;
  const countValue = displayCount ?? 0;

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
            <div ref={panelRef} className="ovation-readable-panel relative w-[min(22rem,calc(100vw-1.5rem))] sm:w-72 ovation-panel-bg ovation-panel-ink border ovation-panel-border rounded-2xl shadow-lg mt-2">
            {/* Tail pointing up to the Ovation pill in the header */}
            {tailLeftPct !== null && (
              <div
                aria-hidden
                className="absolute -top-1.5 w-3 h-3 rotate-45 ovation-panel-bg border-l border-t ovation-panel-border"
                style={{ left: `${tailLeftPct}%`, transform: 'translateX(-50%) rotate(45deg)' }}
              />
            )}

            {/* Header */}
            <div className="px-4 sm:px-3 pt-3 sm:pt-2.5 pb-3 sm:pb-2 flex items-center justify-between gap-3 border-b ovation-panel-border">
              <div className="flex items-center gap-2.5 min-w-0">
                <ReviewsLogo source={source} className="h-7 w-7 sm:h-6 sm:w-6 shrink-0" />
                <div>
                  <p className="text-base sm:text-xs font-semibold ovation-panel-ink leading-tight">{brandName}</p>
                  {source === 'google' && <div className="mt-0.5"><StarRating rating={Math.round(scoreValue)} /></div>}
                  <p className="text-xs sm:text-[10px] ovation-panel-muted leading-tight">
                    {periodLabel}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <div
                  style={{ color: '#fff', backgroundColor: 'hsl(var(--primary))' }}
                  className="flex items-center justify-center min-w-12 px-3 py-1 rounded-xl font-bold text-lg sm:text-sm"
                >
                  {scoreValue.toFixed(1)}
                </div>



                <div className="flex items-center gap-1.5">
                  <MessageSquare
                    className="h-4 w-4 sm:h-3.5 sm:w-3.5"
                    style={{ color: 'hsl(var(--primary))', stroke: 'hsl(var(--primary))' }}
                  />
                  <span
                    className="text-xs sm:text-[10px] font-semibold"
                    style={{ color: 'hsl(var(--primary))' }}
                  >
                    {countValue}
                  </span>
                </div>

              </div>
            </div>

            {/* Reviews carousel */}
            {reviewsWithFeedback.length > 0 ? (
              <div
                className="px-4 sm:px-3 py-4 sm:py-3 min-h-[112px] sm:min-h-[60px] cursor-pointer overflow-y-auto max-h-[min(20rem,calc(100dvh-env(safe-area-inset-top)-10rem))]"
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
                      <span className="text-sm sm:text-[10px] font-semibold ovation-panel-ink truncate max-w-[11rem] sm:max-w-none">
                        {reviewsWithFeedback[reviewIndex]?.customerName}
                      </span>
                      {reviewsWithFeedback[reviewIndex]?.hasResponse && (
                        <span className="text-xs sm:text-[9px] ovation-status-good font-medium">✓ replied</span>
                      )}
                      {reviewsWithFeedback[reviewIndex]?.relativeTime && (
                        <span className="text-xs sm:text-[9px] ovation-panel-muted">{reviewsWithFeedback[reviewIndex]?.relativeTime}</span>
                      )}
                    </div>
                    {currentFeedbackReview?.feedback && (
                      <ExpandableReviewText
                        text={currentFeedbackReview.feedback}
                        reviewId={currentFeedbackReview.id}
                        className="text-base sm:text-[11px] font-medium ovation-panel-ink leading-relaxed sm:leading-snug"
                        clampClassName="line-clamp-4 sm:line-clamp-3"
                      />
                    )}
                  </motion.div>
                </AnimatePresence>

                {reviewsWithFeedback.length > 1 && (
                  <div className="flex justify-center gap-1.5 mt-3 sm:mt-2">
                    {reviewsWithFeedback.slice(0, 8).map((_, idx) => (
                      <button
                        key={idx}
                        className={cn(
                          'h-2 w-2 sm:h-1 sm:w-1 rounded-full transition-all',
                           idx === reviewIndex ? 'bg-primary w-4 sm:w-2' : 'bg-muted-foreground/35'
                        )}
                        onClick={(e) => { e.stopPropagation(); setReviewIndex(idx); }}
                        aria-label={`Show review ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : isLoading ? (
              <div className="px-4 sm:px-3 py-4 sm:py-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-3.5 w-20 rounded bg-muted-foreground/15 animate-pulse" />
                  <div className="h-3 w-16 rounded bg-muted-foreground/10 animate-pulse" />
                </div>
                <div className="h-3 w-full rounded bg-muted-foreground/10 animate-pulse mb-1.5" />
                <div className="h-3 w-3/4 rounded bg-muted-foreground/10 animate-pulse" />
              </div>
            ) : (
              <div className="px-4 sm:px-3 py-4 sm:py-3">
                 <p className="text-base sm:text-[11px] ovation-panel-muted italic">
                  {reviews.length} ratings (no written feedback)
                </p>
              </div>
            )}
            {source === 'google' && (
              <div className="px-4 sm:px-3 pb-3 sm:pb-2 flex items-center gap-1.5 text-xs sm:text-[10px] ovation-panel-muted">
                <GoogleGLogo className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                {mapsUri ? (
                  <a href={mapsUri} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                    Reviews from Google
                  </a>
                ) : (
                  <span>Reviews from Google</span>
                )}
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
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRect = useTriggerViewportRect(expanded, triggerRef);
  const closePanel = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      closePanel();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded, closePanel]);

  return (
    <div className="relative">
      {createPortal(
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="ovation-desktop-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-x-0 bottom-0 z-40 bg-black/60"
              style={{ top: triggerRect?.bottom ?? 0 }}
              onClick={closePanel}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
      <div ref={triggerRef} className={cn('relative', expanded && 'z-50')}>
        <OvationScoreTab desktop expanded={expanded} onToggle={() => setExpanded(prev => !prev)} />
      </div>
      <div ref={panelRef} className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50">
        <OvationExpandedPanel expanded={expanded} triggerRef={triggerRef} />
      </div>
    </div>
  );
}

/**
 * Mobile/header pill trigger + viewport-centered review panel with backdrop fade.
 * The panel tail points up at the trigger.
 */
export function OvationTriggerWithPanel({
  expanded,
  onToggle,
  onClose,
  bare,
  desktop,
  className,
}: {
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
  bare?: boolean;
  desktop?: boolean;
  className?: string;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRect = useTriggerViewportRect(expanded, triggerRef);

  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded, onClose]);

  return (
    <>
      {/* Backdrop fade — portaled to body so it escapes the header's stacking context */}
      {createPortal(
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="ovation-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-x-0 bottom-0 z-40 bg-black/60"
              style={{ top: triggerRect?.bottom ?? 0 }}
              onClick={onClose}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
      <div ref={triggerRef} className={cn('relative', expanded && 'z-[70]')}>
        <OvationScoreTab
          bare={bare}
          desktop={desktop}
          className={className}
          expanded={expanded}
          onToggle={onToggle}
        />
      </div>
      {/* Centered review panel */}
      <div
        ref={panelRef}
        className="fixed left-1/2 -translate-x-1/2 z-[70]"
        style={{ top: 'calc(env(safe-area-inset-top) + 3.5rem)' }}
      >
        <OvationExpandedPanel expanded={expanded} triggerRef={triggerRef} />
      </div>
    </>
  );
}
