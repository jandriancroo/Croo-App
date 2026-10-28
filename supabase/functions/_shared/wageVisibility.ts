// @ts-nocheck
// Who may see pay at a store, decided in ONE place for every server function.
//   'full'    = existing manager+ wage access (has_role_or_higher 'manager' + store access)
//   'blended' = scheduling_manager with store access: never individual wages, only
//               totals priced at the store blended rate (store_blended_rate)
//   'none'    = everyone else
// scheduling_manager is never manager-tier: it is checked separately, never added to manager lists.
export type WageVisibility = "full" | "blended" | "none";

export async function getWageVisibility(admin: any, userId: string | null | undefined, locationId: string | null | undefined): Promise<WageVisibility> {
  if (!userId || !locationId) return "none";
  const [{ data: isMgr }, { data: access }, { data: role }] = await Promise.all([
    admin.rpc("has_role_or_higher", { _user_id: userId, _minimum_role: "manager" }),
    admin.rpc("has_location_access", { _user_id: userId, _location_id: locationId }),
    admin.rpc("get_user_role", { _user_id: userId }),
  ]);
  if (access !== true) return "none";
  if (isMgr === true) return "full";
  if (role === "scheduling_manager") return "blended";
  return "none";
}

/** Store blended hourly rate — the single source is the store_blended_rate database function (service role only). */
export async function getBlendedRate(admin: any, locationId: string, date?: string | null): Promise<number> {
  const args: Record<string, unknown> = { _location_id: locationId };
  if (date) args._date = date;
  const { data, error } = await admin.rpc("store_blended_rate", args);
  if (error) console.error("[wageVisibility] store_blended_rate failed");
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? n : 15;
}
