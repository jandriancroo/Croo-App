// Feature flags for enabling/disabling features across the app
// Set to false to hide the feature, true to show it

export const FEATURE_FLAGS = {
  // Croo Cash gamification system - set to false to hide from UI
  CROO_CASH_ENABLED: true,
  
  // Arcade games & chat - set to false to hide from navigation and messages
  ARCADE_ENABLED: false,
} as const;
