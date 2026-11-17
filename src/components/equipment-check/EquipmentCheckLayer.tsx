import { useMemo } from 'react';
import { useLocation as useRouterLocation } from 'react-router-dom';
import { useOptionalLocation } from '@/hooks/useLocation';
import { openAlert, recentlyAcknowledged, useEquipmentChecks } from '@/hooks/useEquipmentChecks';
import { EquipmentCheckBadge, EquipmentCheckBanner } from './EquipmentCheckBadge';

const SUPPRESS_PREFIXES = ['/auth', '/reset-password', '/forgot-password', '/welcome', '/punch', '/kiosk', '/applicant', '/jobs'];

/**
 * Store-wide equipment-check alert. Rows only reach manager-and-up with access
 * to the store (enforced in the database), so crew never see the badge or banner.
 */
export function EquipmentCheckLayer() {
  const ctx = useOptionalLocation();
  const route = useRouterLocation();
  const { alerts, acknowledge } = useEquipmentChecks(ctx?.currentLocation?.id);
  const suppress = useMemo(() => SUPPRESS_PREFIXES.some((p) => route.pathname.startsWith(p)), [route.pathname]);
  if (suppress) return null;
  const open = openAlert(alerts);
  if (open) return <EquipmentCheckBadge alert={open} onAcknowledge={acknowledge} />;
  return null;
}

/** Banner for the checklist page after a manager acknowledged. */
export function EquipmentCheckBanners({ locationId }: { locationId: string | null | undefined }) {
  const { alerts } = useEquipmentChecks(locationId);
  const acked = recentlyAcknowledged(alerts);
  if (!acked.length) return null;
  return <div className="space-y-2 px-4 pt-3">{acked.map((a) => <EquipmentCheckBanner key={a.id} alert={a} />)}</div>;
}
