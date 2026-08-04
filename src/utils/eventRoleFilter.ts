import type { AppRole } from '@/hooks/useUserRole';

/**
 * Checks if a user with a given role can see an event based on its tagged_roles.
 * 
 * Rules:
 * - If tagged_roles is null/empty, everyone can see the event
 * - If tagged_roles has values, only users with matching roles can see it
 * - Role hierarchy is considered: admins/managers can see events tagged for lower roles
 */
export function canUserSeeEvent(
  userRole: AppRole | null,
  eventTaggedRoles: string[] | null
): boolean {
  // If no roles are tagged, everyone can see it
  if (!eventTaggedRoles || eventTaggedRoles.length === 0) {
    return true;
  }

  // If user has no role, they can't see role-restricted events
  if (!userRole) {
    return false;
  }

  // Role hierarchy (higher index = higher privilege)
  const roleHierarchy: Record<string, number> = {
    team_member: 0,
    shift_manager_in_training: 1,
    shift_manager: 1,
    manager: 2,
    admin: 3,
    org_admin: 4,
    brand_admin: 5,
    super_admin: 6,
  };

  const userRoleLevel = roleHierarchy[userRole] ?? 0;

  // Check if user's role is in the tagged roles OR if user has a higher role than any tagged role
  // For visibility: if you're admin/manager and the event is tagged for admin/manager, you should see it
  // But if you're team_member and it's only tagged for admin, you shouldn't see it
  
  // Direct match
  if (eventTaggedRoles.includes(userRole)) {
    return true;
  }

  // Check if user has higher privilege than any tagged role
  // This allows admins to see events tagged for managers, etc.
  const highestTaggedRoleLevel = Math.max(
    ...eventTaggedRoles.map(role => roleHierarchy[role] ?? 0)
  );

  // User can see if their role level is >= the highest tagged role level
  return userRoleLevel >= highestTaggedRoleLevel;
}

/**
 * Filters an array of events based on user role visibility
 */
export function filterEventsByRole<T extends { tagged_roles?: string[] | null }>(
  events: T[],
  userRole: AppRole | null
): T[] {
  return events.filter(event => canUserSeeEvent(userRole, event.tagged_roles));
}
