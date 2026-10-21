// Must match has_role_or_higher(uid, 'shift_manager_in_training') used by the
// checklist_responses DELETE/UPDATE policies (same order as the DB function).
export const CHECKLIST_UNDO_ANY_ROLES = [
  'shift_manager_in_training',
  'shift_manager',
  'manager',
  'general_manager',
  'admin',
  'org_admin',
  'fbc',
  'brand_admin',
  'super_admin',
] as const;

/** Owner of the check, or one of the policy roles, may uncheck it. */
export function canUndoChecklistItem(
  role: string | null | undefined,
  userId: string | null | undefined,
  completedByUserId: string | null | undefined,
): boolean {
  if (role && (CHECKLIST_UNDO_ANY_ROLES as readonly string[]).includes(role)) return true;
  return !!userId && !!completedByUserId && userId === completedByUserId;
}
