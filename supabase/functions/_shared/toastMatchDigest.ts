// Pure Toast matching digest: who is in this store-local window, and the email body.
// toast-match-digest loads the rows and is the only sender. Nothing to report means no email.

import { escapeEmailHtml } from "./emailHeader.ts";

export const TOAST_MATCH_DIGEST_TO = "jordan@croohq.com";
export const TOAST_MATCH_TEAM_URL = "https://croohq.com/users";

export type DigestSlotName = "overnight" | "midday";

export type DigestSlot = {
  slot: DigestSlotName;
  localDate: string;
  windowStart: Date;
};

export type DigestCandidate = {
  user_id: string;
  full_name: string;
  method: string;
  score: number;
};

export type DigestAttempt = {
  toast_user_id: string;
  toast_name: string | null;
  outcome: string;
  method: string | null;
  score: number | null;
  croo_user_id: string | null;
  candidates: DigestCandidate[] | null;
  created_at: string;
};

export type DigestEmployee = {
  toast_user_id: string;
  toast_name: string | null;
  first_seen_at: string | null;
  is_active?: boolean | null;
};

export type DigestMapping = {
  toast_user_id: string;
  toast_name: string | null;
  croo_user_id: string | null;
  match_method: string | null;
  first_seen_at: string | null;
};

export type DigestProfile = { id: string; full_name: string | null };

export type DigestLink = {
  toastName: string;
  profileName: string;
  method: string | null;
  score: number | null;
  at: Date;
};

export type DigestUnmatched = {
  toastName: string;
  firstSeen: Date;
  note: string;
  candidates: DigestCandidate[];
};

type ZonedParts = {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
  date: string;
};

function zonedParts(instant: Date, timeZone: string): ZonedParts | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const bag: Record<string, string> = {};
    for (const part of fmt.formatToParts(instant)) bag[part.type] = part.value;
    if (!bag.year || !bag.month || !bag.day) return null;
    return {
      year: bag.year,
      month: bag.month,
      day: bag.day,
      hour: Number(bag.hour),
      minute: Number(bag.minute),
      date: `${bag.year}-${bag.month}-${bag.day}`,
    };
  } catch {
    return null;
  }
}

function shiftIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Wall-clock time in a zone → UTC instant. */
export function zonedToUtc(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  let utc = Date.UTC(y, m - 1, d, hh, mm, 0);
  for (let i = 0; i < 4; i++) {
    const parts = zonedParts(new Date(utc), timeZone);
    if (!parts) return new Date(utc);
    const asWall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), parts.hour, parts.minute);
    const want = Date.UTC(y, m - 1, d, hh, mm);
    const delta = want - asWall;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

/**
 * Overnight ≈ 2:00 and midday ≈ 12:00 in the store's zone.
 * The whole local hour qualifies so a 15-minute cron tick cannot miss it.
 * Window is the previous slot boundary through now.
 */
export function storeDigestSlot(now: Date, timeZone: string): DigestSlot | null {
  const parts = zonedParts(now, timeZone);
  if (!parts || (parts.hour !== 2 && parts.hour !== 12)) return null;
  const slot: DigestSlotName = parts.hour === 2 ? "overnight" : "midday";
  const windowStart = slot === "midday"
    ? zonedToUtc(parts.date, "02:00", timeZone)
    : zonedToUtc(shiftIsoDate(parts.date, -1), "12:00", timeZone);
  return { slot, localDate: parts.date, windowStart };
}

export function formatStoreTime(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}

export function matchMethodLabel(method: string | null, score: number | null): string {
  const scoreText = score == null ? "" : ` · score ${score}`;
  switch (method) {
    case "email": return `Email${scoreText}`;
    case "phone": return `Phone${scoreText}`;
    case "exact_name": return `Exact name${scoreText}`;
    case "nickname": return `Nickname${scoreText}`;
    case "levenshtein": return `Typo${scoreText}`;
    default: return "No automatic match";
  }
}

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latestAttempts(attempts: DigestAttempt[]): Map<string, DigestAttempt> {
  const out = new Map<string, DigestAttempt>();
  const ordered = [...attempts].sort((a, b) => a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);
  for (const row of ordered) {
    if (!out.has(row.toast_user_id)) out.set(row.toast_user_id, row);
  }
  return out;
}

function candidateList(value: DigestCandidate[] | null | undefined): DigestCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((c) => c && typeof c.full_name === "string" && typeof c.user_id === "string");
}

export function collectDigestItems(args: {
  now: Date;
  windowStart: Date;
  attempts: DigestAttempt[];
  employees: DigestEmployee[];
  mappings: DigestMapping[];
  profiles: DigestProfile[];
}): { links: DigestLink[]; unmatched: DigestUnmatched[] } {
  const names = new Map(args.profiles.map((p) => [p.id, (p.full_name || "").trim() || "CrooHQ profile"]));
  const links = args.attempts
    .filter((row) => row.outcome === "linked" && row.croo_user_id)
    .map((row) => ({ row, at: asDate(row.created_at) }))
    .filter((item): item is { row: DigestAttempt; at: Date } => !!item.at && item.at >= args.windowStart && item.at <= args.now)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ row, at }) => ({
      toastName: (row.toast_name || row.toast_user_id).trim(),
      profileName: names.get(row.croo_user_id as string) || "CrooHQ profile",
      method: row.method,
      score: row.score,
      at,
    }));

  const cutoff = args.now.getTime() - 24 * 60 * 60 * 1000;
  const inactive = new Set(args.employees.filter((row) => row.is_active === false).map((row) => row.toast_user_id));
  const byToast = new Map<string, {
    toastName: string;
    firstSeen: Date | null;
    crooUserId: string | null;
    matchMethod: string | null;
  }>();
  for (const employee of args.employees) {
    if (inactive.has(employee.toast_user_id)) continue;
    byToast.set(employee.toast_user_id, {
      toastName: (employee.toast_name || employee.toast_user_id).trim(),
      firstSeen: asDate(employee.first_seen_at),
      crooUserId: null,
      matchMethod: null,
    });
  }
  for (const mapping of args.mappings) {
    if (inactive.has(mapping.toast_user_id)) continue;
    const current = byToast.get(mapping.toast_user_id);
    const seen = earliest(current?.firstSeen ?? null, asDate(mapping.first_seen_at));
    byToast.set(mapping.toast_user_id, {
      toastName: (mapping.toast_name || current?.toastName || mapping.toast_user_id).trim(),
      firstSeen: seen,
      crooUserId: mapping.croo_user_id,
      matchMethod: mapping.match_method,
    });
  }

  const latest = latestAttempts(args.attempts);
  const unmatched: DigestUnmatched[] = [];
  for (const [toastUserId, row] of byToast) {
    if (row.crooUserId || !row.firstSeen || row.firstSeen.getTime() > cutoff) continue;
    const attempt = latest.get(toastUserId);
    let note = "No CrooHQ match at this store";
    if (row.matchMethod === "manual") note = "Left unlinked by hand. Auto-match will not relink this person.";
    else if (attempt?.outcome === "ambiguous") note = "More than one CrooHQ profile matches. Not linked.";
    else if (attempt?.outcome === "skipped_taken") note = "The only match is already linked to another Toast id at this store.";
    else if (attempt?.outcome === "none") note = "No CrooHQ match at this store.";
    unmatched.push({
      toastName: row.toastName,
      firstSeen: row.firstSeen,
      note,
      candidates: candidateList(attempt?.candidates),
    });
  }
  unmatched.sort((a, b) => a.toastName.localeCompare(b.toastName));
  return { links, unmatched };
}

function candidateLine(candidate: DigestCandidate): string {
  return `${candidate.full_name} (${matchMethodLabel(candidate.method, candidate.score)})`;
}

export function renderToastMatchDigest(args: {
  storeName: string;
  timeZone: string;
  slot: DigestSlotName;
  links: DigestLink[];
  unmatched: DigestUnmatched[];
  headerHtml: string;
}): { subject: string; html: string } {
  const e = escapeEmailHtml;
  const slotLabel = args.slot === "overnight" ? "Overnight" : "Midday";
  const subject = `${args.storeName}: Toast matching`;
  const linkRows = args.links.map((link) =>
    `<tr>
      <td style="padding:8px 0;border-top:1px solid #ece7df;vertical-align:top"><strong>${e(link.toastName)}</strong><br><span style="color:#666">Toast</span></td>
      <td style="padding:8px 0;border-top:1px solid #ece7df;vertical-align:top">${e(link.profileName)}<br><span style="color:#666">${e(args.storeName)}</span></td>
      <td style="padding:8px 0;border-top:1px solid #ece7df;vertical-align:top">${e(formatStoreTime(link.at, args.timeZone))}<br><span style="color:#666">${e(matchMethodLabel(link.method, link.score))}</span></td>
    </tr>`,
  ).join("");
  const unmatchedRows = args.unmatched.map((row) => {
    const who = row.candidates.length
      ? row.candidates.map((c) => e(candidateLine(c))).join("<br>")
      : "No candidate";
    return `<tr>
      <td style="padding:8px 0;border-top:1px solid #ece7df;vertical-align:top"><strong>${e(row.toastName)}</strong><br><span style="color:#666">First seen ${e(formatStoreTime(row.firstSeen, args.timeZone))}</span></td>
      <td style="padding:8px 0;border-top:1px solid #ece7df;vertical-align:top">${e(row.note)}<br><span style="color:#666">${who}</span></td>
    </tr>`;
  }).join("");
  const linksBlock = args.links.length
    ? `<h2 style="font-size:16px;margin:0 0 8px">Auto-linked</h2>
      <p style="margin:0 0 8px;color:#444">Linked since the last send. Score 0 is an exact contact, name, or nickname hit. A typo score is the number of edits.</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:0 8px 6px 0;color:#888">Toast</td><td style="padding:0 8px 6px 0;color:#888">CrooHQ</td><td style="padding:0 0 6px;color:#888">When</td></tr>${linkRows}</table>`
    : "";
  const unmatchedBlock = args.unmatched.length
    ? `<h2 style="font-size:16px;margin:24px 0 8px">Unlinked for 24 hours or more</h2>
      <p style="margin:0 0 8px;color:#444">These Toast employees were first seen at least a day ago and still have no CrooHQ link, including ambiguous names.</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${unmatchedRows}</table>`
    : "";
  const html = `<html><body style="background:#f4f5f6;margin:0;padding:24px 12px;font-family:Arial,sans-serif">
    <table role="presentation" style="max-width:640px;width:100%;margin:auto;background:#fff;border-radius:12px;overflow:hidden">
      ${args.headerHtml}
      <tr><td style="padding:28px 32px;color:#1c1c1c;font-size:15px;line-height:1.45">
        <p style="margin:0 0 16px">${e(slotLabel)} digest for ${e(args.storeName)}. One email for the store.</p>
        ${linksBlock}
        ${unmatchedBlock}
        <p style="margin:24px 0 0"><a href="${TOAST_MATCH_TEAM_URL}" style="display:inline-block;background:#0a7a8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px">Open the team page</a></p>
        <p style="margin:16px 0 0;font-size:12px;color:#666">Link someone from their row, or open their profile to undo a link. ${e(TOAST_MATCH_TEAM_URL)}</p>
      </td></tr>
    </table>
  </body></html>`;
  return { subject, html };
}
