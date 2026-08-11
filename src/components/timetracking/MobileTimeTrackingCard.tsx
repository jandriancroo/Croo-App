import { DesktopTimeTrackingTable } from './DesktopTimeTrackingTable';

/**
 * Mobile "By Person" view — renders the same responsive grouped-card layout as
 * the desktop person view (the shared row handles mobile stacking).
 */
interface MobileTimeTrackingCardProps {
  filteredCards: any[];
  timezone: string;
  includeApproved: boolean;
  onApproveDay: (dayPunches: any[]) => void;
  onUnapproveDay: (dayPunches: any[]) => void;
  onEditShift: (shiftInfo: { dayPunches: any[], userId: string, locationId: string, shiftDate: string }) => void;
  calculateDayHours: (dayPunches: any[]) => number;
  hasDayIssues: (dayPunches: any[]) => boolean;
  sortPunches: (punches: any[]) => any[];
  groupPunchesByWeek: (punchesByDay: { [key: string]: any[] }) => [string, { start: Date; end: Date; days: { [day: string]: any[] } }][];
  currentLocationId: string;
  approvingPunchIds: Set<string>;
  getDayFlags: (dayPunches: any[]) => { hasAutoClockOut: boolean; hasBreakViolation: boolean; hasOpenShift: boolean; hasAnyFlag: boolean };
}

export function MobileTimeTrackingCard(props: MobileTimeTrackingCardProps) {
  return <DesktopTimeTrackingTable {...props} />;
}
