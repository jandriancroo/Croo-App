// LogBook push notification types.
// Each LogBook category maps to a role_notification_settings row so admins can
// control, per role, which LogBook entries trigger a push.

export const LOGBOOK_NOTIFICATION_PREFIX = 'logbook_';

/** Roles that can ever receive LogBook pushes (shift manager and up). */
export const LOGBOOK_NOTIFICATION_ROLES = [
  'shift_manager_in_training',
  'shift_manager',
  'manager',
  'admin',
  'org_admin',
  'brand_admin',
  'super_admin',
] as const;

/** Turns a LogBook category name into a stable notification_type key. */
export const logbookNotificationType = (categoryName: string) =>
  LOGBOOK_NOTIFICATION_PREFIX +
  categoryName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** Human label used in the role settings UI. */
export const logbookNotificationLabel = (categoryName: string) =>
  `LogBook: ${categoryName.trim()}`;

export const isLogbookNotificationType = (type: string) =>
  type.startsWith(LOGBOOK_NOTIFICATION_PREFIX);
