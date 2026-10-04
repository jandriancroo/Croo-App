// THE ONE PLACE that decides a person's role for Theo and which Theo actions they get at a store.
// ai-assistant and theo-voice both call this; the voice screen only reads the answer theo-voice returns.
import { APP_ROLE_ORDER } from "./appRoles.ts";

// Highest role by the app's role order (highest -> lowest). Roles not in the app's list rank last.
// No rows -> null.
export function highestRole(roles: (string | null | undefined)[]): string | null {
  const list = roles.filter((r): r is string => typeof r === "string" && r.length > 0);
  if (!list.length) return null;
  const rank = (r: string) => { const i = APP_ROLE_ORDER.indexOf(r); return i === -1 ? APP_ROLE_ORDER.length : i; };
  return [...list].sort((a, b) => rank(a) - rank(b))[0];
}

// Every role row for the user (people can hold more than one), reduced to the highest.
export async function roleForUser(admin: any, userId: string): Promise<{ role: string | null; roles: string[] }> {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data || []).map((r: any) => r.role);
  return { role: highestRole(roles), roles };
}

// Who gets each action = who can already do it by hand at that store.
// create_task: manager and above whose save the database accepts (brand admin and shift managers left out for now).
export const CREATE_TASK_ROLES = ["manager", "admin", "org_admin", "super_admin"];
// COVER SHIFT SWITCH: super admin only until a real Confirm + Undo has been done.
// To open it to everyone who can edit the schedule by hand, change this one line to:
//   export const COVER_SHIFT_ROLES = ["manager", "admin", "org_admin", "brand_admin", "super_admin"];
export const COVER_SHIFT_ROLES = ["super_admin"];
// ADD SHIFT SWITCH: super admin only for now. To open it, change this one line.
export const ADD_SHIFT_ROLES = ["super_admin"];
// DELETE SHIFT SWITCH: super admin only for now. To open it, change this one line.
export const DELETE_SHIFT_ROLES = ["super_admin"];

export type TheoActions = { create_task: boolean; cover_shift: boolean; add_shift: boolean; delete_shift: boolean };
export const NO_ACTIONS: TheoActions = { create_task: false, cover_shift: false, add_shift: false, delete_shift: false };

// Pure decision (tested). hasStoreAccess must come from has_location_access for this user + store.
export function actionsFor(role: string | null, hasStoreAccess: boolean): TheoActions {
  if (!role || !hasStoreAccess) return { ...NO_ACTIONS };
  return {
    create_task: CREATE_TASK_ROLES.includes(role), cover_shift: COVER_SHIFT_ROLES.includes(role),
    add_shift: ADD_SHIFT_ROLES.includes(role), delete_shift: DELETE_SHIFT_ROLES.includes(role),
  };
}

// Store check + decision. No store, no access, or an error -> no actions.
export async function theoActionsAt(admin: any, userId: string, role: string | null, locationId: unknown): Promise<TheoActions> {
  if (typeof locationId !== "string" || !/^[0-9a-f-]{36}$/i.test(locationId)) return { ...NO_ACTIONS };
  const { data, error } = await admin.rpc("has_location_access", { _user_id: userId, _location_id: locationId });
  return actionsFor(role, !error && data === true);
}
