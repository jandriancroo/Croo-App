/**
 * Centralized React Query key factory.
 * All query keys should be created through this module to ensure
 * consistent cache sharing across components.
 * 
 * Rules:
 * - Same data entity → same key → shared cache
 * - Keys are arrays: [entity, ...identifiers]
 * - Location-scoped keys include locationId for proper cache purging
 */

export const queryKeys = {
  // ── Sales & Revenue ──
  sales: {
    cacheToday: (locationId: string, dateStr: string) =>
      ['sales-cache-today', locationId, dateStr] as const,
    cacheWtd: (locationId: string, weekStartStr: string, todayStr: string) =>
      ['sales-cache-wtd', locationId, weekStartStr, todayStr] as const,
    live: (locationId: string, dateStr: string) =>
      ['qubeyond-sales', locationId, dateStr] as const,
    orgLive: (locationIds: string[], dateStr: string) =>
      ['org-live-sales-shared-cache', locationIds, dateStr] as const,
    orgCache: (locationIds: string[], todayStr: string, weekStartStr: string, monthEndStr: string) =>
      ['org-sales-data', locationIds, todayStr, weekStartStr, monthEndStr] as const,
  },

  // ── Labor ──
  labor: {
    today: (locationId: string, dateStr: string) =>
      ['labor-cache-today', locationId, dateStr] as const,
  },

  // ── Location ──
  location: {
    hoursToday: (locationId: string, timezone: string) =>
      ['location-hours-today', locationId, timezone] as const,
    timezone: (locationId: string) =>
      ['location-timezone', locationId] as const,
    integration: (locationId: string, type: string) =>
      [`${type}-integration-check`, locationId] as const,
    orgLogo: (locationId: string) =>
      ['org-logo', locationId] as const,
    all: (orgId: string) =>
      ['org-locations', orgId] as const,
  },

  // ── Checklists & Tasks ──
  checklists: {
    /** User-visible checklists for a location (role-filtered) */
    list: (userId: string, isAdmin: boolean, locationId: string) =>
      ['user-checklists', userId, isAdmin, locationId] as const,
    /** Dashboard checklist data (completion stats) */
    dashboard: (locationId: string, timezone: string) =>
      ['dashboard-checklists', locationId, timezone] as const,
    details: (checklistId: string, date: string) =>
      ['checklist-details', checklistId, date] as const,
    completionAlerts: (today: string, locationId: string, timezone: string) =>
      ['checklist-completion-alerts', today, locationId, timezone] as const,
    submissions: (checklistId: string, locationId: string) =>
      ['checklist-submissions', checklistId, locationId] as const,
  },

  // ── Dashboard Cubes & Widgets ──
  dashboard: {
    cubes: (userId: string, locationId: string) =>
      ['user-data-cubes', userId, locationId] as const,
    kds: (locationId: string) =>
      ['kds-cache', locationId] as const,
    cateringOrders: (locationId: string, dateStr: string) =>
      ['todays-catering-orders', locationId, dateStr] as const,
  },

  // ── Users & Roles ──
  users: {
    role: (userId: string) =>
      ['user-role', userId] as const,
    permissions: (role: string) =>
      ['role-permissions', role] as const,
    management: (locationId: string) =>
      ['user-management-users', locationId] as const,
    managementLocations: (userId: string, isSuperAdmin: boolean) =>
      ['user-management-locations', userId, isSuperAdmin] as const,
    /** Lightweight team roster (subset of management profile columns) */
    team: (locationId: string) =>
      ['my-team', locationId] as const,
    /** Current authenticated user's own profile */
    selfProfile: (userId: string) =>
      ['my-profile', userId] as const,
  },

  // ── Schedule ──
  schedule: {
    stable: (locationId: string) =>
      ['schedule-stable', locationId] as const,
  },

  // ── Temporary Tasks ──
  tasks: {
    temporary: (locationId: string) =>
      ['temporary-tasks', locationId] as const,
  },
} as const;
