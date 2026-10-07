// Theo Quick Nudge: preview only. The send is the manager's "Send nudge" tap, through checklist-nudge.
// Theo never picks people: a nudge always goes to everyone on the clock (same audience as checklist-nudge).
import { canNudgeChecklist, matchChecklist, renderNudgeText, DEFAULT_NUDGE_TEMPLATES, MAX_MESSAGE } from "../_shared/nudgePlan.ts";
import { nudgeStatus, nudgeAudience, senderFirstName } from "../_shared/nudgeData.ts";
import { draftGuard, GUARD_LINE } from "../_shared/messagePlan.ts";

export async function buildNudgeProposal(admin: any, managerId: string, loc: { id: string; name: string }, args: any) {
  const said = String(args?.checklist || "").trim();
  const rows = await nudgeStatus(admin, loc.id);
  const m = matchChecklist(said, rows);
  if ("several" in m) return { ask: `Which checklist: ${m.several.map((r) => r.title).join(" or ")}?` };
  if (!("one" in m)) return { stop: `I don't see a checklist called "${said}" on today's list.` };
  const row = m.one;
  const can = canNudgeChecklist(row);
  if ("code" in can) return { stop: can.reason };

  const aud = await nudgeAudience(admin, loc.id, row.family_id, managerId);
  const warnings: string[] = [];
  const named = String(args?.named_person || "").trim();
  if (named) {
    const q = named.toLowerCase();
    const hit = (p: { name: string }) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q);
    const nm = named.split(/\s+/)[0];
    const rec = aud.recently.find(hit);
    if (rec) warnings.push(`${nm} was nudged about this ${rec.minutes_ago}m ago.`);
    else if (!aud.onClock.some(hit)) warnings.push(`${nm} isn't clocked in, so they won't get it.`);
    if (aud.going.length) warnings.push("Nudges go to everyone on the clock.");
  }
  if (!aud.onClock.length) return { stop: `No one is clocked in at ${loc.name} right now, so there's no one to nudge.` };
  if (!aud.going.length) return { stop: "Everyone on the clock was nudged about this in the last hour." };

  let template_id: string | null = null;
  let message = "";
  const { data: tpls } = await admin.from("location_nudge_templates").select("id, name, body, is_default, sort_order").eq("location_id", loc.id).order("sort_order");
  const list = (tpls && tpls.length ? tpls : DEFAULT_NUDGE_TEMPLATES) as any[];
  const text = String(args?.text || "").trim();
  if (text) {
    if (draftGuard(text)) return { stop: GUARD_LINE };
    message = text.slice(0, MAX_MESSAGE);
  } else {
    const wanted = String(args?.template || "").trim().toLowerCase();
    const t = (wanted && list.find((x) => x.name.toLowerCase() === wanted || x.name.toLowerCase().includes(wanted))) || list.find((x) => x.is_default) || list[0];
    template_id = t?.id ?? null;
    message = String(t?.body || "").slice(0, MAX_MESSAGE);
  }
  const senderFirst = await senderFirstName(admin, managerId);
  const first = aud.going[0];
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(), action: "nudge_checklist",
      checklist: { id: row.checklist_id, title: row.title, done: row.completed_items, total: row.total_items },
      recipients: aud.going.map((p) => ({ id: p.id, name: p.name })),
      recently: aud.recently.map((p) => ({ name: p.name, minutes_ago: p.minutes_ago })),
      template_id, message,
      preview_for: { name: first.first_name || first.name, text: renderNudgeText(message, { sender_first_name: senderFirst, recipient_first_name: first.first_name, checklist: row.title, done: row.completed_items, total: row.total_items }) },
      store: loc.name, location_id: loc.id, warnings,
    },
  };
}

export const PROPOSE_NUDGE_TOOL = {
  type: "function",
  function: {
    name: "propose_nudge",
    description: "Show the manager a PREVIEW of a checklist nudge (a push in the manager's name asking the crew to finish a checklist). Sends nothing: only the manager's Send nudge tap sends it. A nudge always goes to everyone on the clock at this store; Theo never picks who gets it.",
    parameters: {
      type: "object",
      properties: {
        checklist: { type: "string", description: "The checklist as the manager said it ('AM line check')" },
        named_person: { type: "string", description: "A person the manager named, if any (the nudge still goes to everyone on the clock)" },
        template: { type: "string", description: "A nudge template name the manager asked for" },
        text: { type: "string", description: "The manager's own words for the message, written in the manager's first person" },
      },
      required: ["checklist"],
    },
  },
};
