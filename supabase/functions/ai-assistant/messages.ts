// THEO HANDS build 6A: read my chats, reply, new DM. READ-ONLY.
// Every chat read uses the SIGNED-IN PERSON'S OWN ACCESS (userClient), so the database's chat rules apply
// (messages only in chats they're a member of; chats only at stores they can access), and on top of that
// scopeChats keeps only chats they're in at THIS store. Nothing here inserts, updates or deletes, and
// nothing marks anything read (read marks are written only by the chat window in the browser).
import { chatKind, canReplyInto, scopeChats, findDm, draftGuard, GUARD_LINE, matchPeople, matchGroups, pickReplyTo, isUnread, REPLY_REFUSAL, MAX_DRAFT, LARGE_GROUP, type ChatRow, type Msg, type Person } from "../_shared/messagePlan.ts";

type MyChat = ChatRow & { kind: ReturnType<typeof chatKind>; last_read_at: string | null; label: string };

const fmtTime = (iso: string, tz: string) => new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const describe = (m: any) => m.attachment_url ? `[${String(m.attachment_type || "").startsWith("image/") ? (m.attachment_type === "image/gif" ? "a GIF" : "a photo") : "a file"}]${m.content && m.content !== "GIF" ? ` ${m.content}` : ""}` : (m.content || "");

async function namesFor(admin: any, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data } = await admin.from("profiles").select("id, full_name, nickname").in("id", [...new Set(ids)]);
  for (const p of data || []) map.set(p.id, (p.full_name || p.nickname || "Someone").trim());
  return map;
}

/** The person's chats at this store (their own access + the one privacy filter). */
export async function myChats(userClient: any, admin: any, userId: string, locationId: string): Promise<MyChat[]> {
  const { data: mem, error } = await userClient.from("chat_members").select("chat_id, last_read_at").eq("user_id", userId);
  if (error || !mem?.length) return [];
  const lastRead = new Map<string, string | null>(mem.map((m: any) => [m.chat_id, m.last_read_at]));
  const { data: chats } = await userClient.from("chats").select("id, title, is_group, is_announcement, location_id, chat_members(user_id)")
    .in("id", [...lastRead.keys()]).eq("location_id", locationId);
  const rows: ChatRow[] = (chats || []).map((c: any) => ({ id: c.id, title: c.title, is_group: c.is_group, is_announcement: c.is_announcement, location_id: c.location_id, members: (c.chat_members || []).map((x: any) => x.user_id) }));
  const scoped = scopeChats(rows, userId, locationId);
  const names = await namesFor(admin, scoped.flatMap((c) => c.members));
  return scoped.map((c) => {
    const kind = chatKind(c);
    const other = c.members.find((u) => u !== userId);
    const label = kind === "dm" ? (other ? names.get(other) || "Someone" : "Just you") : (c.title || (kind === "announcement" ? "Announcements" : "Group chat"));
    return { ...c, kind, last_read_at: lastRead.get(c.id) ?? null, label };
  });
}

async function recentMessages(userClient: any, chatIds: string[], limit: number) {
  if (!chatIds.length) return [];
  const { data } = await userClient.from("messages")
    .select("id, chat_id, sender_id, content, attachment_url, attachment_type, created_at, is_deleted_for_everyone, deleted_at, parent_message_id")
    .in("chat_id", chatIds).order("created_at", { ascending: false }).limit(limit);
  return (data || []).map((m: any) => ({ ...m, deleted: !!(m.is_deleted_for_everyone || m.deleted_at) }));
}

/** find_chats: newest first, unread flag, last line. Optional name filter (a person's DM or a group title). */
export async function findChats(userClient: any, admin: any, userId: string, locationId: string, tz: string, args: any) {
  let chats = await myChats(userClient, admin, userId, locationId);
  const q = String(args?.name || "").trim();
  if (q) {
    const ql = q.toLowerCase().replace(/\b(chat|group|the|dm)\b/g, "").trim();
    const byPerson = chats.filter((c) => c.kind === "dm" && c.label.toLowerCase().split(/\s+/).some((w) => ql && w.startsWith(ql.split(/\s+/)[0])));
    const g = matchGroups(q, chats.filter((c) => c.kind !== "dm"));
    chats = [...byPerson, ...("one" in g ? [g.one] : "several" in g ? g.several : [])];
    if (!chats.length) return { chats: [], note: `You don't have a chat matching "${q}" at this store.` };
  }
  const msgs = await recentMessages(userClient, chats.map((c) => c.id), 600);
  const names = await namesFor(admin, msgs.map((m: any) => m.sender_id));
  const out = chats.map((c) => {
    const mine = msgs.filter((m: any) => m.chat_id === c.id && !m.deleted);
    const last = mine[0];
    const unread = mine.filter((m: Msg) => isUnread(m, userId, c.last_read_at)).length;
    return {
      chat_id: c.id, kind: c.kind, name: c.label, people: c.members.length, unread,
      last: last ? { from: last.sender_id === userId ? "You" : names.get(last.sender_id) || "Someone", text: describe(last).slice(0, 160), when: fmtTime(last.created_at, tz) } : null,
      _t: last?.created_at || "",
    };
  }).sort((a, b) => b._t.localeCompare(a._t)).map(({ _t, ...r }) => r);
  const filtered = args?.unread_only ? out.filter((c) => c.unread > 0) : out;
  return { chats: filtered.slice(0, 15), total_unread_chats: out.filter((c) => c.unread > 0).length };
}

/** read_chat: the last N (up to 20) messages of ONE chat the person is in. */
export async function readChat(userClient: any, admin: any, userId: string, locationId: string, tz: string, args: any) {
  const chats = await myChats(userClient, admin, userId, locationId);
  const c = chats.find((x) => x.id === String(args?.chat_id || ""));
  if (!c) return { error: "That chat isn't one of yours at this store. Use find_chats first." };
  const n = Math.min(Math.max(Number(args?.limit) || 8, 1), 20);
  const msgs = (await recentMessages(userClient, [c.id], n * 2)).filter((m: any) => !m.deleted).slice(0, n).reverse();
  const names = await namesFor(admin, msgs.map((m: any) => m.sender_id));
  return {
    chat: { chat_id: c.id, kind: c.kind, name: c.label, people: c.members.length },
    messages: msgs.map((m: any) => ({ message_id: m.id, from: m.sender_id === userId ? "You" : names.get(m.sender_id) || "Someone", when: fmtTime(m.created_at, tz), text: describe(m).slice(0, 600), unread: isUnread(m, userId, c.last_read_at), is_reply: !!m.parent_message_id })),
  };
}

export type MessageArgs = { to_person?: string; employee_id?: string; to_group?: string; chat_id?: string; text?: string; reply?: boolean; reply_to_message_id?: string };

/** Build the Send message preview (or a question / a stop). Never sends. */
export async function buildMessageProposal(userClient: any, admin: any, userId: string, locationId: string, args: MessageArgs, crew: Person[], lastUserText: string) {
  const text = String(args.text || "").trim();
  if (draftGuard(lastUserText, text)) return { stop: GUARD_LINE };
  if (!text) return { ask: "What should the message say?" };
  if (text.length > MAX_DRAFT) return { ask: "That's long for a chat message. Can you say it shorter?" };
  const chats = await myChats(userClient, admin, userId, locationId);
  let chat: MyChat | null = null;
  let to: Person | null = null;
  if (args.chat_id) chat = chats.find((c) => c.id === args.chat_id) ?? null;
  if (!chat && args.to_group) {
    const g = matchGroups(args.to_group, chats.filter((c) => c.kind !== "dm"));
    if ("several" in g) return { ask: `Which chat: ${g.several.map((x) => x.label).join(" or ")}?` };
    if ("none" in g) return { stop: `You don't have a group chat called "${args.to_group}" at this store.` };
    chat = g.one;
  }
  if (!chat) {
    const others = crew.filter((p) => p.id !== userId);
    const byId = args.employee_id ? others.find((p) => p.id === args.employee_id) : null;
    const m = byId ? { one: byId } : matchPeople(String(args.to_person || ""), others);
    if ("several" in m) return { ask: `Which ${String(args.to_person || "").trim().split(/\s+/)[0] || "one"}: ${m.several.map((p) => p.name).join(" or ")}?` };
    if ("none" in m) return { stop: args.to_person ? `I can't find ${args.to_person} at this store.` : "Who should I send it to?" };
    to = m.one;
    chat = findDm(chats, userId, to.id);
  }
  if (chat && !canReplyInto(chat.kind)) return { stop: REPLY_REFUSAL[chat.kind as "announcement" | "marketplace"] };
  if (chat?.kind === "dm" && !to) {
    const other = chat.members.find((u) => u !== userId);
    to = crew.find((p) => p.id === other) ?? null;
    if (!to) return { stop: "That person isn't active at this store anymore, so I won't message them." };
  }
  const warnings: string[] = [];
  let reply_to: { id: string; sender: string; text: string } | null = null;
  if (chat && (args.reply || args.reply_to_message_id)) {
    const msgs = await recentMessages(userClient, [chat.id], 50);
    const r = pickReplyTo(msgs as Msg[], userId, args.reply_to_message_id || null);
    if (r) {
      const nm = (await namesFor(admin, [r.message.sender_id])).get(r.message.sender_id) || "Someone";
      reply_to = { id: r.message.id, sender: nm, text: describe(r.message).slice(0, 140) };
      if (r.newer) warnings.push(`${nm.split(" ")[0]} sent a newer message after this one.`);
    }
  }
  const members = chat ? chat.members.length : 2;
  if (chat?.kind === "group" && members > LARGE_GROUP) warnings.push(`This group has ${members} people.`);
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(), action: "send_message", kind: chat?.kind === "group" ? "group" : "dm",
      chat_id: chat?.id ?? null, new_dm: !chat, to: to ? { id: to.id, name: to.name } : null,
      group_title: chat?.kind === "group" ? chat.label : null, member_count: members, recipients: Math.max(members - 1, 1),
      text, reply_to, warnings,
    },
  };
}

/** The re-check at the Send tap. Anything different: nothing is sent. */
export async function recheckMessage(userClient: any, admin: any, userId: string, locationId: string, p: any, crew: Person[]) {
  if (!p?.id || typeof p.text !== "string") return { ok: false, changed: "the preview is incomplete." };
  // Draft unchanged: the words being sent are exactly the words Theo previewed (the action log keeps the preview).
  const { data: logged } = await admin.from("theo_action_log").select("proposal").eq("user_id", userId).eq("action", "send_message").eq("proposal->>id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!logged || logged.proposal?.text !== p.text || (logged.proposal?.chat_id ?? null) !== (p.chat_id ?? null) || (logged.proposal?.to?.id ?? null) !== (p.to?.id ?? null) || (logged.proposal?.reply_to?.id ?? null) !== (p.reply_to?.id ?? null)) return { ok: false, changed: "the message isn't the one Theo previewed." };
  if (draftGuard(p.text)) return { ok: false, changed: "that message needs to be written by you." };
  const chats = await myChats(userClient, admin, userId, locationId);
  let chatId: string | null = p.chat_id ?? null;
  if (chatId) {
    const c = chats.find((x) => x.id === chatId);
    if (!c) return { ok: false, changed: "you're no longer in that chat." };
    if (!canReplyInto(c.kind)) return { ok: false, changed: "that chat can't take messages from Theo." };
  }
  if (p.to?.id) {
    if (!crew.some((x) => x.id === p.to.id)) return { ok: false, changed: `${p.to.name} isn't active at this store anymore.` };
    if (!chatId) chatId = findDm(chats, userId, p.to.id)?.id ?? null; // a DM started meanwhile is reused
  }
  if (p.reply_to?.id) {
    const { data: m } = await userClient.from("messages").select("id, chat_id, is_deleted_for_everyone, deleted_at").eq("id", p.reply_to.id).maybeSingle();
    if (!m || m.is_deleted_for_everyone || m.deleted_at || m.chat_id !== p.chat_id) return { ok: false, changed: "the message you're replying to was removed." };
  }
  return { ok: true, chat_id: chatId };
}
