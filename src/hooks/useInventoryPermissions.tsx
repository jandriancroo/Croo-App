import { useUserRole } from './useUserRole';

/**
 * Hook for inventory-specific permission gates.
 * Controls who can edit brand-level vs location-level inventory settings.
 */
export const useInventoryPermissions = () => {
  const { isSuperAdmin, isBrandAdmin, isOrgAdmin, isAdmin, isManager, loading } = useUserRole();

  const isBrandLevel = isSuperAdmin || isBrandAdmin;
  const isLocationLevel = isOrgAdmin || isAdmin || isManager;

  return {
    loading,

    // Brand-level items — Super/Brand Admin only
    canEditCategories: isBrandLevel,
    canEditRecipes: isBrandLevel,
    canEditProductGroups: isBrandLevel,
    // canEditUsageRates removed — recipes are source of truth
    canEditCommonNames: isBrandLevel,
    canEditVendorSettings: isBrandLevel,
    canEditPanBaselines: isBrandLevel,

    // Location-level items — Org/Loc Admin+
    canTogglePanSizes: isBrandLevel || isLocationLevel,
    canEditStorageLocations: isBrandLevel || isLocationLevel,
    canActivateItems: isBrandLevel || isLocationLevel,
    canEditShortcuts: isBrandLevel || isLocationLevel,
    canTriggerSync: isBrandLevel || isLocationLevel,
    canCount: isBrandLevel || isLocationLevel,

    // Deploy — Brand Admin+ only
    canDeploy: isBrandLevel,

    // Convenience
    isBrandLevel,
    isLocationLevel,
  };
};
