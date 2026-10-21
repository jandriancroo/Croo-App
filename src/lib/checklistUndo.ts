// Must match the checklist_responses DELETE/UPDATE policy role list.
export const CHECKLIST_UNDO_ANY_ROLES = [
  'shift_manager',
  'manager',
  'general_manager',
  'admin',
  'org_admin',
  'brand_admin',
  'fbc',
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
