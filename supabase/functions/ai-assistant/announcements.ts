// Theo Team Feed announcement: preview only. The post is the manager's "Post announcement" tap, through
// src/lib/feedPosts.ts createFeedPost (the same save + push as the feed composer).
import { draftGuard, GUARD_LINE } from "../_shared/messagePlan.ts";

export const MAX_SUBJECT = 120;
export const MAX_BODY = 2000;

type Channel = { id: string | null; name: string };

/** Channels this manager can post to at this store. null id = everyone at the store. */
async function resolveChannel(userClient: any, admin: any, userId: string, locationId: string, said: string): Promise<{ one: Channel } | { stop: string }> {
  const want = said.trim().toLowerCase();
  if (!want || /^(everyone|all|the team|team|whole team|everybody|general)$/.test(want)) return { one: { id: null, name: "Everyone" } };
  const { data: loc } = await admin.from("locations").select("brand_id").eq("id", locationId).maybeSingle();
  const { data: rows } = await admin.from("announcement_channels").select("id, name, location_id, brand_id, is_active").eq("is_active", true);
  const mine = (rows || []).filter((c: any) => c.location_id === locationId || (c.location_id == null && loc?.brand_id && c.brand_id === loc.brand_id));
  const hits = mine.filter((c: any) => String(c.name).toLowerCase() === want);
  const list = hits.length ? hits : mine.filter((c: any) => String(c.name).toLowerCase().includes(want));
  if (!list.length) return { stop: `I don't see a Team Feed channel called "${said}".` };
  if (list.length > 1) return { stop: `Which channel: ${list.map((c: any) => c.name).join(" or ")}?` };
  const c = list[0];
  const { data: ok } = await userClient.rpc("user_qualifies_for_channel_audience", { _user_id: userId, _channel_id: c.id, _location_id: locationId });
  if (ok !== true) return { stop: `You can't post in ${c.name}.` };
  return { one: { id: c.id, name: c.name } };
}

async function countRecipients(userClient: any, userId: string, locationId: string, channelId: string | null) {
  const { data } = await userClient.rpc("feed_channel_audience_recipients", { _location_id: locationId, _channel_id: channelId });
  return ((data as any[]) || []).filter((r) => r.user_id && r.user_id !== userId).length;
}

export async function buildAnnouncementProposal(userClient: any, admin: any, userId: string, loc: { id: string; name: string }, args: any) {
  const subject = String(args?.subject || "").trim();
  const body = String(args?.body || "").trim();
  if (!body) return { ask: "What should the announcement say?" };
  if (draftGuard(subject, body)) return { stop: GUARD_LINE };
  if (subject.length > MAX_SUBJECT) return { stop: `The subject is too long (${MAX_SUBJECT} characters max).` };
  if (body.length > MAX_BODY) return { stop: `The announcement is too long (${MAX_BODY} characters max).` };
  const ch = await resolveChannel(userClient, admin, userId, loc.id, String(args?.channel || ""));
  if ("stop" in ch) return ch.stop.endsWith("?") ? { ask: ch.stop } : { stop: ch.stop };
  const recipients = await countRecipients(userClient, userId, loc.id, ch.one.id);
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(), action: "post_announcement",
      subject: subject || null, body, channel: ch.one, recipients, store: loc.name, location_id: loc.id,
    },
  };
}

/** The re-check at the Post tap: same words + channel as the logged preview, channel still there and allowed. */
export async function recheckAnnouncement(userClient: any, admin: any, userId: string, locationId: string, p: any) {
  if (!p?.id || typeof p.body !== "string") return { ok: false, changed: "the preview is incomplete." };
  if (p.location_id !== locationId) return { ok: false, changed: "you switched stores." };
  const { data: logged } = await admin.from("theo_action_log").select("proposal").eq("user_id", userId).eq("action", "post_announcement").eq("proposal->>id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lp = logged?.proposal;
  if (!lp || lp.body !== p.body || (lp.subject ?? null) !== (p.subject ?? null) || (lp.channel?.id ?? null) !== (p.channel?.id ?? null)) return { ok: false, changed: "the announcement isn't the one Theo previewed." };
  if (draftGuard(p.subject, p.body)) return { ok: false, changed: "that one needs to be written by you." };
  if (p.channel?.id) {
    const { data: c } = await admin.from("announcement_channels").select("id, is_active").eq("id", p.channel.id).maybeSingle();
    if (!c || !c.is_active) return { ok: false, changed: "that channel no longer exists." };
    const { data: ok } = await userClient.rpc("user_qualifies_for_channel_audience", { _user_id: userId, _channel_id: p.channel.id, _location_id: locationId });
    if (ok !== true) return { ok: false, changed: "you can't post in that channel anymore." };
  }
  return { ok: true, recipients: await countRecipients(userClient, userId, locationId, p.channel?.id ?? null) };
}

export const PROPOSE_ANNOUNCEMENT_TOOL = {
  type: "function",
  function: {
    name: "propose_announcement",
    description: "Show the manager a PREVIEW of a Team Feed announcement for this store. Posts nothing: only the manager's Post announcement tap posts it (with the normal push). Text only: no pinning, badges, photos or scheduling.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Short headline, up to 120 characters (e.g. 'Walk-in service Friday')" },
        body: { type: "string", description: "The announcement text, in the manager's voice, up to 2000 characters" },
        channel: { type: "string", description: "Team Feed channel name if the manager named one; omit for everyone" },
      },
      required: ["body"],
    },
  },
};
