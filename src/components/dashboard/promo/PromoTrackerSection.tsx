import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useActivePromoTracker } from '@/hooks/useActivePromoTracker';
import { DashSectionTitle } from '../DashSectionTitle';
import { TrackerWidget } from '../TrackerWidget';

/** Dash "Promo" section: the one promo this store shows right now, or nothing. */
export function PromoTrackerSection() {
  const { currentLocation } = useAppLocation();
  const { data: promo } = useActivePromoTracker(currentLocation?.id);
  if (!promo) return null;
  return (
    <div className="flex flex-col gap-2" data-tour="dashboard-promo">
      <DashSectionTitle>Promo</DashSectionTitle>
      <TrackerWidget key={promo.id} promo={promo} />
    </div>
  );
}
