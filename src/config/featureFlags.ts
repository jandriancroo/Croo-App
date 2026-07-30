// Feature flags for enabling/disabling features across the app
// Set to false to hide the feature, true to show it

export const FEATURE_FLAGS = {
  // Croo Cash gamification system - set to false to hide from UI
  CROO_CASH_ENABLED: false,
  // KDS (Live KDS Board, Fresh KDS integration, KDS dashboard metrics)
  // Archived — code is kept intact, just not surfaced. Flip to true to restore.
  KDS_ENABLED: false,
  // OPUS LMS integration (settings card, background sync, training tasks)
  // Archived — code kept intact, just not surfaced. Flip to true to restore.
  OPUS_ENABLED: false,
} as const;
