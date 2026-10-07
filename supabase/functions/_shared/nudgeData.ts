// Reads for Quick Nudge, shared by checklist-nudge and Theo's preview (service-role client).
// Rules stay in nudgePlan.ts; this only gathers the facts they need.
import { onClockIds, splitCooldown, firstName, NUDGE_COOLDOWN_MIN, type NudgeStatusRow } from "./nudgePlan.ts";

export type CrewPerson = { id: string; name: string; first_name: string };

export async function nudgeStatus(admin: any, locationId: string, checklistId?: string | null): Promise<NudgeStatusRow[]> {
  const { data, error } = await admin.rpc("checklist_nudge_status", { _location_id: locationId, _checklist_id: checklistId ?? null });
  if (error) throw new Error(error.message);
  return (data || []) as NudgeStatusRow[];
}

/** Everyone on the clock at the store right now (active crew), minus the sender, split by cooldown for this checklist family. */
export async function nudgeAudience(admin: any, locationId: string, familyId: string, senderId: string) {
  const now = Date.now();
  const since = new Date(now - 24 * 3600_000).toISOString();
  const [{ data: punches }, { data: links }] = await Promise.all([
    admin.from("time_punches").select("user_id, id, punch_type, punch_time, location_id").eq("location_id", locationId).gte("punch_time", since).order("punch_time"),
    admin.from("user_locations").select("user_id").eq("location_id", locationId),
  ]);
  const byUser: Record<string, any[]> = {};
  for (const p of punches || []) (byUser[p.user_id] ||= []).push(p);
  const crewIds = new Set((links || []).map((l: any) => l.user_id));
  const onIds = onClockIds(byUser, now).filter((id) => id !== senderId && crewIds.has(id));
  let people: CrewPerson[] = [];
  if (onIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, nickname, is_active").in("id", onIds);
    people = (profs || []).filter((p: any) => p.is_active !== false)
      .map((p: any) => ({ id: p.id, name: (p.full_name || "").trim() || firstName(p) || "Crew member", first_name: firstName(p) }))
      .sort((a: CrewPerson, b: CrewPerson) => a.name.localeCompare(b.name));
  }
  const lastSent: Record<string, string> = {};
  if (people.length) {
    const { data: logs } = await admin.from("checklist_nudge_log").select("recipient_id, created_at").eq("checklist_family_id", familyId)
      .in("recipient_id", people.map((p) => p.id)).gte("created_at", new Date(now - NUDGE_COOLDOWN_MIN * 60000).toISOString());
    for (const l of logs || []) if (!lastSent[l.recipient_id] || l.created_at > lastSent[l.recipient_id]) lastSent[l.recipient_id] = l.created_at;
  }
  return { onClock: people, ...splitCooldown(people, lastSent, now) };
}

export async function senderFirstName(admin: any, userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("full_name, nickname").eq("id", userId).maybeSingle();
  return firstName(data) || "Your manager";
}
