// Theo Quick Nudge (checklists, tasks, events): preview only. The send is the manager's "Send nudge" tap, through quick-nudge.
// Theo never picks people: a nudge always goes to everyone on the clock (same audience as quick-nudge).
import { matchTarget, renderNudgeText, fieldsFor, missingFields, DEFAULT_NUDGE_TEMPLATES, MAX_MESSAGE } from "../_shared/nudgePlan.ts";
import { nudgeableTargets, nudgeAudience, senderFirstName } from "../_shared/nudgeData.ts";
import { draftGuard, GUARD_LINE } from "../_shared/messagePlan.ts";

export async function buildNudgeProposal(admin: any, managerId: string, loc: { id: string; name: string }, args: any) {
  const said = String(args?.target || args?.checklist || "").trim();
  const all = await nudgeableTargets(admin, loc.id);
  // Checklists not on today's list are already filtered; tasks/events that can't be nudged are left out of the match.
  const rows = all.filter((t) => t.type === "checklist" || !("code" in t.verdict));
  const m = matchTarget(said, rows);
  if ("several" in m) return { ask: `Which one: ${m.several.map((r) => `${r.title} (${r.type})`).join(" or ")}?` };
  if (!("one" in m)) return { stop: `I don't see a checklist, task or event called "${said}" for today.` };
  const target = m.one;
  if ("code" in target.verdict) return { stop: target.verdict.reason };

  const aud = await nudgeAudience(admin, loc.id, target.type, target.family_id, managerId);
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

  const available = fieldsFor(target.type, target.has_subtasks);
  const { data: tpls } = await admin.from("location_nudge_templates").select("id, name, body, is_default, sort_order").eq("location_id", loc.id).order("sort_order");
  const list = (tpls && tpls.length ? tpls : DEFAULT_NUDGE_TEMPLATES) as any[];
  const fits = (t: any) => missingFields(t.body, available).length === 0;
  let template_id: string | null = null;
  let message = "";
  const text = String(args?.text || "").trim();
  if (text) {
    if (draftGuard(text)) return { stop: GUARD_LINE };
    if (missingFields(text, available).length) return { stop: `That message uses a field this ${target.type} doesn't have.` };
    message = text.slice(0, MAX_MESSAGE);
  } else {
    const wanted = String(args?.template || "").trim().toLowerCase();
    let t: any = null;
    if (wanted) {
      t = list.find((x) => x.name.toLowerCase() === wanted || x.name.toLowerCase().includes(wanted));
      if (!t) return { stop: `I don't see a nudge template called "${args.template}".` };
      if (!fits(t)) return { stop: `The ${t.name} template doesn't fit a ${target.type}.` };
    } else {
      t = list.find((x) => x.is_default && fits(x)) || list.find(fits);
      if (!t) return { stop: `None of this store's nudge templates fit a ${target.type}. Tell me what to say.` };
    }
    template_id = t.id ?? null;
    message = String(t.body || "").slice(0, MAX_MESSAGE);
  }
  const senderFirst = await senderFirstName(admin, managerId);
  const first = aud.going[0];
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(), action: "quick_nudge",
      target: { type: target.type, id: target.id, title: target.title, done: target.done, total: target.total, event_time: target.event_time },
      recipients: aud.going.map((p) => ({ id: p.id, name: p.name })),
      recently: aud.recently.map((p) => ({ name: p.name, minutes_ago: p.minutes_ago })),
      template_id, message,
      preview_for: {
        name: first.first_name || first.name,
        text: renderNudgeText(message, { sender_first_name: senderFirst, recipient_first_name: first.first_name, item: target.title, item_type: target.type, event_time: target.event_time, done: target.done, total: target.total }),
      },
      store: loc.name, location_id: loc.id, warnings,
    },
  };
}

export const PROPOSE_NUDGE_TOOL = {
  type: "function",
  function: {
    name: "propose_nudge",
    description: "Show the manager a PREVIEW of a nudge (a push in the manager's name asking the crew to finish a checklist or task, or a heads-up about today's event). Sends nothing: only the manager's Send nudge tap sends it. A nudge always goes to everyone on the clock at this store; Theo never picks who gets it.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "The checklist, task or event name as the manager said it ('AM line check', 'catering order')" },
        named_person: { type: "string", description: "A person the manager named, if any (the nudge still goes to everyone on the clock)" },
        template: { type: "string", description: "A nudge template name the manager asked for" },
        text: { type: "string", description: "The manager's own words for the message, written in the manager's first person" },
      },
      required: ["target"],
    },
  },
};
