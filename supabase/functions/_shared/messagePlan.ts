// THEO HANDS build 6A: the pure rules for reading, replying and starting a DM (tested in src/lib/messagePlan.test.ts).
// No database here. The server (ai-assistant/messages.ts) loads the person's own chats and runs these.

export type ChatKind = "dm" | "group" | "announcement" | "marketplace";
export type ChatRow = { id: string; title: string | null; is_group: boolean | null; is_announcement: boolean | null; location_id: string | null; members: string[] };

export const MARKETPLACE_TITLE = "Shift Marketplace";
export const MAX_DRAFT = 1000;
export const LARGE_GROUP = 15;

export function chatKind(c: Pick<ChatRow, "title" | "is_group" | "is_announcement">): ChatKind {
  if (c.is_announcement) return "announcement";
  if (c.is_group && (c.title || "").trim() === MARKETPLACE_TITLE) return "marketplace";
  return c.is_group ? "group" : "dm";
}

/** Theo may read any chat the person is in at this store; reply and new DM only into ordinary DMs and groups. */
export const canReplyInto = (k: ChatKind) => k === "dm" || k === "group";
export const REPLY_REFUSAL: Record<"announcement" | "marketplace", string> = {
  announcement: "To post to the whole team, ask me to make an announcement for the Team Feed.",
  marketplace: "Shift offers are handled in the Shift Marketplace itself, so I won't post there.",
};

/** The one privacy filter: only chats this person is a member of, only at this store. */
export const scopeChats = <T extends ChatRow>(rows: T[], userId: string, locationId: string) =>
  rows.filter((c) => c.location_id === locationId && c.members.includes(userId));

/** The one-to-one chat between two people (never a group, announcement or marketplace). */
export function findDm<T extends ChatRow>(chats: T[], userId: string, otherId: string): T | null {
  return chats.find((c) => chatKind(c) === "dm" && c.members.length === 2 && c.members.includes(userId) && c.members.includes(otherId)) ?? null;
}

// Topics Theo never drafts (pay, discipline, firing, someone's performance). Checked on the request AND the draft.
const GUARD = /\b(pay(check|roll|s)?|paid|wages?|salary|raises?|hourly rate|bonus(es)?|written up|write(s|-)? ?(him|her|them|you)? ?up|write-?ups?|disciplin\w*|warnings?|suspen\w*|fire[ds]?|firing|terminat\w*|let (him|her|them|you) go|performance|review(s|ed)? (of|for) (him|her|them|you))\b/i;
export const GUARD_LINE = "I'd rather you write that one yourself.";
export const draftGuard = (...texts: (string | null | undefined)[]) => texts.some((t) => !!t && GUARD.test(t));

export type Person = { id: string; name: string };
/** A spoken name to people at this store: one, several ("Which Alle?") or none. */
export function matchPeople(raw: string, people: Person[]): { one: Person } | { several: Person[] } | { none: true } {
  const q = raw.trim().toLowerCase().replace(/['’]s$/, "");
  if (!q) return { none: true };
  const exact = people.filter((p) => p.name.toLowerCase() === q);
  if (exact.length === 1) return { one: exact[0] };
  const hits = people.filter((p) => { const n = p.name.toLowerCase(); return n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q)); });
  if (hits.length === 1) return { one: hits[0] };
  if (hits.length > 1) return { several: hits };
  return { none: true };
}

const STOP = new Set(["the", "chat", "group", "groupchat", "thread", "channel", "a", "our", "my"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => w.replace(/s$/, ""));
/** A group by its title ("managers chat" -> "Managers"). */
export function matchGroups<T extends { title: string | null }>(raw: string, groups: T[]): { one: T } | { several: T[] } | { none: true } {
  const q = words(raw);
  if (!q.length) return groups.length === 1 ? { one: groups[0] } : { none: true };
  const hits = groups.filter((g) => { const t = words(g.title || ""); return q.every((w) => t.some((x) => x.startsWith(w) || w.startsWith(x))); });
  if (hits.length === 1) return { one: hits[0] };
  if (hits.length > 1) return { several: hits };
  return { none: true };
}

export type Msg = { id: string; sender_id: string; created_at: string; content: string | null; deleted: boolean };
/** Reply-to: the asked-for message, else the latest incoming one. `newer` = an incoming message arrived after it. */
export function pickReplyTo(msgs: Msg[], userId: string, wantedId?: string | null): { message: Msg; newer: boolean } | null {
  const incoming = msgs.filter((m) => m.sender_id !== userId && !m.deleted).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!incoming.length) return null;
  const chosen = wantedId ? incoming.find((m) => m.id === wantedId) : incoming[incoming.length - 1];
  if (!chosen) return null;
  return { message: chosen, newer: incoming.some((m) => m.created_at > chosen.created_at) };
}

/** The preview's notification line: never promise more than the push actually does. */
export function notifyLine(kind: "dm" | "group", firstName: string, recipients: number) {
  const who = kind === "dm" ? firstName : `${recipients} ${recipients === 1 ? "person" : "people"}`;
  return `${who} will get a notification, unless one went out for this chat in the last 3 minutes or ${kind === "dm" ? "they've" : "they've"} turned chat alerts off.`;
}

/** Unread for this person: incoming, not unsent, newer than their last read. */
export const isUnread = (m: Msg, userId: string, lastReadAt: string | null) => m.sender_id !== userId && !m.deleted && (!lastReadAt || m.created_at > lastReadAt);
