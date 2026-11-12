import { renderEmailHeader, resolveEmailLogo } from "../_shared/emailHeader.ts";
import {
  collectDigestItems,
  renderToastMatchDigest,
  storeDigestSlot,
  TOAST_MATCH_DIGEST_TO,
  type DigestAttempt,
  type DigestEmployee,
  type DigestMapping,
  type DigestProfile,
} from "../_shared/toastMatchDigest.ts";

type Row = Record<string, any>;

async function rows(query: any): Promise<Row[]> {
  const result = await query;
  if (result.error) throw new Error(result.error.message || "Digest data unavailable");
  return result.data ?? [];
}

export async function runToastMatchDigest(client: any, now = new Date(), dryRun = false) {
  const counts = { locations_checked: 0, due: 0, queued: 0, skipped_empty: 0 };
  const integrations = await rows(
    client.from("location_integrations").select("location_id").eq("integration_type", "toast").eq("is_active", true),
  );
  const ids = [...new Set(integrations.map((row) => row.location_id).filter(Boolean))];
  if (!ids.length) return counts;
  const [locations, settings] = await Promise.all([
    rows(client.from("locations").select("id, name").in("id", ids)),
    rows(client.from("location_settings").select("location_id, timezone").in("location_id", ids)),
  ]);
  const names = new Map(locations.map((row) => [row.id, row.name || "Store"]));
  const zones = new Map(settings.map((row) => [row.location_id, row.timezone || "America/Los_Angeles"]));

  for (const locationId of ids) {
    counts.locations_checked += 1;
    const timeZone = zones.get(locationId) || "America/Los_Angeles";
    const slot = storeDigestSlot(now, timeZone);
    if (!slot) continue;
    counts.due += 1;
    const [attempts, employees, mappings] = await Promise.all([
      rows(client.from("toast_match_attempts").select("toast_user_id, toast_name, outcome, method, score, croo_user_id, candidates, created_at").eq("location_id", locationId).order("created_at", { ascending: false }).limit(2000)),
      rows(client.from("toast_employees").select("toast_user_id, toast_name, first_seen_at, is_active").eq("location_id", locationId)),
      rows(client.from("toast_employee_mappings").select("toast_user_id, toast_name, croo_user_id, match_method, first_seen_at").eq("location_id", locationId)),
    ]);
    const profileIds = [...new Set(attempts.map((row) => row.croo_user_id).filter(Boolean))];
    const profiles = profileIds.length
      ? await rows(client.from("profiles").select("id, full_name").in("id", profileIds))
      : [];
    const items = collectDigestItems({
      now,
      windowStart: slot.windowStart,
      attempts: attempts as DigestAttempt[],
      employees: employees as DigestEmployee[],
      mappings: mappings as DigestMapping[],
      profiles: profiles as DigestProfile[],
    });
    if (!items.links.length && !items.unmatched.length) {
      counts.skipped_empty += 1;
      continue;
    }
    const storeName = names.get(locationId) || "Store";
    const logo = await resolveEmailLogo(client, { locationId });
    const headerHtml = renderEmailHeader({
      title: "Toast matching",
      logoUrl: logo.logoUrl,
      alt: logo.alt,
      line1: storeName,
      line2: slot.slot === "overnight" ? "Overnight" : "Midday",
    });
    const email = renderToastMatchDigest({
      storeName,
      timeZone,
      slot: slot.slot,
      links: items.links,
      unmatched: items.unmatched,
      headerHtml,
    });
    if (dryRun) continue;
    const dedup = `toast_match_digest:${locationId}:${slot.localDate}:${slot.slot}`;
    const queued = await client.from("email_queue").upsert({
      to_addresses: [TOAST_MATCH_DIGEST_TO],
      subject: email.subject,
      html: email.html,
      source: "toast_match_digest",
      email_type: "toast_match_digest",
      location_id: locationId,
      dedup_key: dedup,
      metadata: { slot: slot.slot, links: items.links.length, unmatched: items.unmatched.length },
    }, { onConflict: "dedup_key", ignoreDuplicates: true }).select("id");
    if (queued.error) throw new Error(queued.error.message || "Digest queue unavailable");
    counts.queued += (queued.data ?? []).length;
  }
  return counts;
}
