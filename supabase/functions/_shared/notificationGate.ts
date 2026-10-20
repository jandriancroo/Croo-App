// The ONE "should this push go to this person" rule (enabled + "From home").
// Pure: send-push-notification feeds it rows it already read; tests cover it in src/lib/notificationGate.test.ts.
// "From home" = deliver while NOT clocked in at the alert's store (who's clocked in comes only from _shared/onClock.ts).

/** Sent types that share one settings row with another key. */
export const SETTINGS_ALIAS: Record<string, string> = {
  late_arrival: 'late_arrivals',
  toast_late_clock_in: 'late_arrivals',
  overdue_checklist: 'overdue_checklists',
  monthly_checklist: 'overdue_checklists',
  certificate_expiry: 'certification_expiring',
  shift_reminders: 'schedule_updates',
  schedule_published: 'schedule_updates',
  shift_offer: 'shift_approvals',
  safe_count: 'cash_safe_count',
  drawer_count: 'cash_drawer_count',
};

export const settingsKey = (type: string) => SETTINGS_ALIAS[type] ?? type;

/** About-you types: always on, always from home; nobody can turn them off. */
export const LOCKED_KEYS = new Set([
  'announcements',
  'schedule_updates',
  'shift_approvals',
  'certification_expiring',
  'employee_write_up',
  'read_and_sign',
  'training_approval',
  'personal',
]);

/** Store-status types. Shift managers and team members default to NOT getting these from home. */
export const STORE_STATUS_KEYS = new Set([
  'day_part_pulse',
  'hourly_sales_pulse',
  'overdue_checklists',
  'late_arrivals',
  'shift_overstay',
  'toast_no_clock_out',
  'toast_robot_down',
  'vendor_sku_health',
  'alarm_task',
]);

export const PULSE_KEYS = new Set(['day_part_pulse', 'hourly_sales_pulse']);

const FLOOR_ROLES = new Set(['team_member', 'shift_manager', 'shift_manager_in_training']);

export const isLocked = (type: string) => LOCKED_KEYS.has(settingsKey(type));

/** Role default for "From home" when no saved role row exists. */
export function defaultFromHome(role: string | null | undefined, type: string): boolean {
  return !(STORE_STATUS_KEYS.has(settingsKey(type)) && FLOOR_ROLES.has(role || ''));
}

/** Same rule as the app's useTeamSalesVisibility: shift manager and up always; team members only with view_sales. */
export function roleCanSeeSales(role: string | null | undefined, teamMemberViewSales: boolean): boolean {
  if (!role) return false;
  if (role === 'team_member') return teamMemberViewSales;
  return true;
}

export type GateInput = {
  type: string;
  role: string | null;
  roleEnabled?: boolean | null;
  roleFromHome?: boolean | null;
  userPush?: boolean | null;
  userFromHome?: boolean | null;
  /** false only when a legacy notification_preferences column is explicitly false. */
  legacyEnabled?: boolean | null;
  teamMemberViewSales?: boolean;
  /** null = unknown (no store on the alert, or the lookup failed): the clock check is skipped. */
  clockedIn: boolean | null;
};

export type GateResult = { send: boolean; reason: string };

export function gateRecipient(i: GateInput): GateResult {
  const key = settingsKey(i.type);
  if (LOCKED_KEYS.has(key)) return { send: true, reason: 'locked' };
  if (PULSE_KEYS.has(key) && !roleCanSeeSales(i.role, !!i.teamMemberViewSales)) return { send: false, reason: 'no_view_sales' };
  const enabled = i.userPush ?? i.roleEnabled ?? true;
  if (!enabled || i.legacyEnabled === false) return { send: false, reason: 'disabled' };
  const fromHome = i.userFromHome ?? i.roleFromHome ?? defaultFromHome(i.role, key);
  if (!fromHome && i.clockedIn === false) return { send: false, reason: 'not_clocked_in' };
  return { send: true, reason: fromHome ? 'ok' : (i.clockedIn === null ? 'clock_unknown' : 'clocked_in') };
}
