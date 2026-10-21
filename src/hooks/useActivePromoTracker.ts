import { useQuery } from '@tanstack/react-query';
import { fetchActivePromoTracker } from '@/lib/promoTrackers';

/** The one promo this store shows right now (brand promo wins over an org contest). */
export function useActivePromoTracker(locationId: string | null | undefined) {
  return useQuery({
    queryKey: ['active-promo-tracker', locationId],
    queryFn: () => fetchActivePromoTracker(locationId!),
    enabled: !!locationId,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
