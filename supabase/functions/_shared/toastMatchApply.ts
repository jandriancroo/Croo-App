// Writes Toast auto-match decisions for one store.
// Roster names come from profiles looked up by user_locations.user_id.
// user_locations has no foreign key to profiles, so an embed select comes back empty.
// Manual mapping rows are never updated. An already-linked auto row is not relinked.

import { matchToastEmployee, type MatchDecision, type RosterPerson } from "./toastMatch.ts";

export type ToastMatchPerson = {
  toastUserId: string;
  toastName: string;
  restaurantUserId?: string | null;
  email?: string | null;
  phone?: string | null;
};

type MappingRow = {
  toast_user_id: string;
  toast_name: string | null;
  toast_restaurant_user_id: string | null;
  croo_user_id: string | null;
  match_method: string | null;
  first_seen_at: string | null;
};

const CHUNK = 100;

async function rowsOf(query: PromiseLike<{ data: any; error: any }>): Promise<any[]> {
  const result = await query;
  if (result.error) throw new Error(result.error.message || "toast match read failed");
  return result.data ?? [];
}

async function loadRoster(supabase: any, locationId: string): Promise<RosterPerson[]> {
  const members = await rowsOf(
    supabase.from("user_locations").select("user_id").eq("location_id", locationId),
  );
  const ids = [...new Set(members.map((row) => row.user_id).filter(Boolean))];
  const people: RosterPerson[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const profiles = await rowsOf(
      supabase.from("profiles").select("id, full_name, email, phone_number").in("id", slice),
    );
    for (const profile of profiles) {
      people.push({
        id: profile.id,
        fullName: profile.full_name || "",
        email: profile.email,
        phone: profile.phone_number,
      });
    }
  }
  return people;
}

function attemptSignature(decision: MatchDecision): string {
  const candidates = [...decision.candidates]
    .map((c) => `${c.userId}|${c.method}|${c.score}`)
    .sort();
  return JSON.stringify({
    outcome: decision.outcome,
    method: decision.method,
    score: decision.score,
    crooUserId: decision.crooUserId,
    candidates,
  });
}

function storedSignature(row: any): string {
  const candidates = Array.isArray(row?.candidates)
    ? [...row.candidates].map((c) => `${c.user_id}|${c.method}|${c.score}`).sort()
    : [];
  return JSON.stringify({
    outcome: row?.outcome ?? null,
    method: row?.method ?? null,
    score: row?.score ?? null,
    crooUserId: row?.croo_user_id ?? null,
    candidates,
  });
}

/**
 * Match every Toast person in the batch. Failures are logged and swallowed so a
 * match problem cannot drop a labor ingest.
 */
export async function applyToastMatches(
  supabase: any,
  locationId: string,
  people: ToastMatchPerson[],
): Promise<{ linked: number; ambiguous: number; none: number }> {
  const counts = { linked: 0, ambiguous: 0, none: 0 };
  const batch = new Map<string, ToastMatchPerson>();
  for (const person of people) {
    if (person.toastUserId && person.toastName) batch.set(person.toastUserId, person);
  }
  if (batch.size === 0) return counts;
  try {
    const [mappings, roster, employees] = await Promise.all([
      rowsOf(supabase.from("toast_employee_mappings").select("toast_user_id, toast_name, toast_restaurant_user_id, croo_user_id, match_method, first_seen_at").eq("location_id", locationId)),
      loadRoster(supabase, locationId),
      rowsOf(supabase.from("toast_employees").select("toast_user_id, first_seen_at").eq("location_id", locationId)),
    ]);
    const byToast = new Map<string, MappingRow>(mappings.map((row) => [row.toast_user_id, row]));
    const seenAt = new Map<string, string>(employees.filter((row) => row.first_seen_at).map((row) => [row.toast_user_id, row.first_seen_at]));
    const linkedUserIds = new Set(mappings.map((row) => row.croo_user_id).filter(Boolean));
    const ids = [...batch.keys()];
    const prior = new Map<string, any>();
    if (ids.length) {
      const history = await rowsOf(
        supabase.from("toast_match_attempts")
          .select("toast_user_id, outcome, method, score, croo_user_id, candidates, created_at")
          .eq("location_id", locationId)
          .in("toast_user_id", ids)
          .order("created_at", { ascending: false })
          .limit(1000),
      );
      for (const row of history) {
        if (!prior.has(row.toast_user_id)) prior.set(row.toast_user_id, row);
      }
    }

    for (const person of batch.values()) {
      const existing = byToast.get(person.toastUserId) ?? null;
      const decision = matchToastEmployee({
        toastName: person.toastName,
        email: person.email,
        phone: person.phone,
        roster,
        existing: existing ? { matchMethod: existing.match_method, crooUserId: existing.croo_user_id } : null,
        linkedUserIds,
      });
      if (decision.outcome === "skipped_manual" || decision.outcome === "skipped_linked") {
        if (decision.outcome === "skipped_linked" && existing && existing.toast_name !== person.toastName) {
          await supabase.from("toast_employee_mappings").update({ toast_name: person.toastName }).eq("location_id", locationId).eq("toast_user_id", person.toastUserId);
        }
        continue;
      }

      const now = new Date().toISOString();
      const firstSeen = existing?.first_seen_at || seenAt.get(person.toastUserId) || now;
      const crooUserId = decision.outcome === "linked" ? decision.crooUserId : null;
      const matchMethod = decision.outcome === "linked" ? "auto" : "unmatched";
      const restaurantUserId = person.restaurantUserId || existing?.toast_restaurant_user_id || null;
      const unchanged = !!existing
        && existing.match_method === matchMethod
        && (existing.croo_user_id ?? null) === crooUserId
        && (existing.toast_name ?? "") === person.toastName
        && (existing.toast_restaurant_user_id ?? null) === restaurantUserId;
      if (!unchanged) {
        const { error } = await supabase.from("toast_employee_mappings").upsert({
          location_id: locationId,
          toast_user_id: person.toastUserId,
          toast_restaurant_user_id: restaurantUserId,
          toast_name: person.toastName,
          croo_user_id: crooUserId,
          match_method: matchMethod,
          first_seen_at: firstSeen,
        }, { onConflict: "location_id,toast_user_id" });
        if (error) throw new Error(error.message || "toast mapping write failed");
      }
      if (crooUserId) linkedUserIds.add(crooUserId);
      if (decision.outcome === "linked") counts.linked += 1;
      else if (decision.outcome === "ambiguous") counts.ambiguous += 1;
      else counts.none += 1;

      const signature = attemptSignature(decision);
      if (prior.has(person.toastUserId) && storedSignature(prior.get(person.toastUserId)) === signature) continue;
      const { error: logError } = await supabase.from("toast_match_attempts").insert({
        location_id: locationId,
        toast_user_id: person.toastUserId,
        toast_name: person.toastName,
        outcome: decision.outcome,
        method: decision.method,
        score: decision.score,
        croo_user_id: crooUserId,
        candidates: decision.candidates.map((c) => ({
          user_id: c.userId,
          full_name: c.fullName,
          method: c.method,
          score: c.score,
        })),
      });
      if (logError) throw new Error(logError.message || "toast match log failed");
    }
  } catch (error) {
    console.warn("[toast-match] skipped:", error instanceof Error ? error.message : String(error));
  }
  return counts;
}
