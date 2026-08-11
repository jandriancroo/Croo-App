import { MobileTimeTrackingCard as _unused } from './MobileTimeTrackingCard';
import { DayByDayView } from './DayByDayView';

/**
 * Mobile "By Day" view — renders the same responsive grouped-card layout as
 * the desktop day view (the shared row handles mobile stacking).
 */
interface MobileDayByDayCardProps {
  filteredCards: any[];
  timezone: string;
  includeApproved: boolean;
  onApproveDay: (dayPunches: any[]) => void;
  onUnapproveDay: (dayPunches: any[]) => void;
  onEditShift: (shiftInfo: { dayPunches: any[], userId: string, locationId: string, shiftDate: string }) => void;
  calculateDayHours: (dayPunches: any[]) => number;
  sortPunches: (punches: any[]) => any[];
  currentLocationId: string;
  approvingPunchIds: Set<string>;
  getDayFlags: (dayPunches: any[]) => { hasAutoClockOut: boolean; hasBreakViolation: boolean; hasOpenShift: boolean; hasAnyFlag: boolean };
}

export function MobileDayByDayCard(props: MobileDayByDayCardProps) {
  return <DayByDayView {...props} />;
}
