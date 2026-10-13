// Theo Quick Nudge (checklists, tasks, events): preview only. The send is the manager's "Send nudge" tap, through quick-nudge.
// Theo never picks people: a nudge always goes to everyone on the clock (same audience as quick-nudge).
import { matchTarget, matchTargetSmart, renderNudgeText, fieldsFor, missingFields, DEFAULT_NUDGE_TEMPLATES, MAX_MESSAGE, splitNames, fuzzyPeople } from "../_shared/nudgePlan.ts";
import { nudgeableTargets, nudgeAudience, senderFirstName, storeTimezone } from "../_shared/nudgeData.ts";
import { draftGuard, GUARD_LINE } from "../_shared/messagePlan.ts";

const fmtPT = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const didYouMean = (rows: { title: string; type: string }[]) => `Did you mean ${rows.map((r) => `${r.title} (${r.type})`).join(", or ")}?`;

/** A completed/inactive best match: say it's done (when + who, if known) instead of "I don't see it". */
async function doneLine(admin: any, locId: string, t: { type: string; id: string; title: string; verdict: any }): Promise<string> {
  if (t.type === "task") {
    const { data } = await admin.from("temporary_tasks").select("completed_at, completed_by").eq("id", t.id).maybeSingle();
    if (data?.completed_at) {
      const tz = await storeTimezone(admin, locId);
      let who = "";
      if (data.completed_by) { const { data: p } = await admin.from("profiles").select("full_name, nickname").eq("id", data.completed_by).maybeSingle(); who = (p?.nickname || p?.full_name || "").trim(); }
      return `${t.title} is already done${who ? ` — ${who} finished it` : ""} at ${fmtPT(data.completed_at, tz)}.`;
    }
  }
  return "reason" in (t.verdict || {}) ? `${t.title}: ${t.verdict.reason}` : `${t.title} is already done.`;
}

export async function buildNudgeProposal(admin: any, managerId: string, loc: { id: string; name: string }, args: any) {
  const said = String(args?.target || args?.checklist || "").trim();
  const all = await nudgeableTargets(admin, loc.id);
  // Checklists not on today's list are already filtered; tasks/events that can't be nudged are left out of the match.
  const rows = all.filter((t) => t.type === "checklist" || !("code" in t.verdict));
  const wantedId = String(args?.target_id || "").trim();
  const byId = wantedId ? all.find((t) => t.id === wantedId) : undefined;
  let target: (typeof all)[number];
  if (byId) target = byId;
  else {
    const m = matchTarget(said, rows);
    if ("several" in m) return { ask: `Which one: ${m.several.map((r) => `${r.title} (${r.type})`).join(" or ")}?`, candidates: m.several.map((r) => ({ id: r.id, title: r.title, type: r.type })) };
    if ("one" in m) target = m.one;
    else {
      // Fallback (new): forgiving match against ALL of today's targets, including done ones.
      const s = matchTargetSmart(said, all);
      if ("one" in s) target = s.one;
      else if ("several" in s) return { ask: didYouMean(s.several.slice(0, 3)), candidates: s.several.slice(0, 3).map((r) => ({ id: r.id, title: r.title, type: r.type })) };
      else if ("suggest" in s) return { ask: didYouMean(s.suggest), candidates: s.suggest.map((r) => ({ id: r.id, title: r.title, type: r.type })) };
      else {
        // Done tasks may be off today's status list: check recently completed ones too.
        const { data: doneTasks } = await admin.from("temporary_tasks").select("id, title").eq("location_id", loc.id).not("completed_at", "is", null)
          .gte("completed_at", new Date(Date.now() - 24 * 3600_000).toISOString()).limit(200);
        const d = matchTargetSmart(said, (doneTasks || []).map((r: any) => ({ id: String(r.id), title: String(r.title || "") })));
        if ("one" in d) return { stop: await doneLine(admin, loc.id, { type: "task", id: d.one.id, title: d.one.title, verdict: {} }) };
        return { stop: `I don't see a checklist, task or event called "${said}" for today.` };
      }
    }
  }
  if ("code" in target.verdict) {
    if (target.verdict.code === "complete" || target.verdict.code === "not_on_dashboard") return { stop: await doneLine(admin, loc.id, target) };
    return { stop: target.verdict.reason };
  }

  const aud = await nudgeAudience(admin, loc.id, target.type, target.family_id, managerId);
  const warnings: string[] = [];
  const hit = (q: string) => (p: { name: string }) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q);
  const named = String(args?.named_person || "").trim();
  if (named) {
    const q = named.toLowerCase();
    const nm = named.split(/\s+/)[0];
    const rec = aud.recently.find(hit(q));
    if (rec) warnings.push(`${nm} was nudged about this ${rec.minutes_ago}m ago.`);
    else if (!aud.onClock.some(hit(q))) warnings.push(`${nm} isn't clocked in, so they won't get it.`);
    if (aud.going.length) warnings.push("Nudges go to everyone on the clock.");
  }
  // Optional (new): several named people. Resolved like find_crew (prefix first, spelling-tolerant fallback).
  // The audience is unchanged: the send still goes to everyone on the clock.
  const namedList: string[] = Array.isArray(args?.named_people) ? args.named_people.map((x: any) => String(x || "")).flatMap(splitNames) : [];
  if (namedList.length) {
    const asPerson = (p: any) => ({ ...p, full_name: p.name, nickname: null });
    for (const raw of namedList.slice(0, 10)) {
      const q = raw.toLowerCase();
      let on = aud.onClock.find(hit(q));
      if (!on) { const f = fuzzyPeople(raw, aud.onClock.map(asPerson))[0]; if (f) { on = f; warnings.push(`I took "${raw}" to mean ${f.name}.`); } }
      if (!on) { warnings.push(`${raw} isn't on shift right now, so they won't get it.`); continue; }
      const rec = aud.recently.find((p) => p.id === (on as any).id);
      if (rec) warnings.push(`${on.name.split(" ")[0]} was nudged about this ${rec.minutes_ago}m ago.`);
    }
    if (aud.going.length && !warnings.includes("Nudges go to everyone on the clock.")) warnings.push("Nudges go to everyone on the clock.");
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
        target_id: { type: "string", description: "Optional: the exact id of the checklist, task or event, when it is known from earlier in the conversation (e.g. [ids: ...]) or from a 'Did you mean' list. Used instead of matching the name." },
        named_person: { type: "string", description: "A person the manager named, if any (the nudge still goes to everyone on the clock)" },
        named_people: { type: "array", items: { type: "string" }, description: "Optional: several people the manager named ('Maria and Jo'). Checked against who's on shift; the nudge still goes to everyone on the clock." },
        template: { type: "string", description: "A nudge template name the manager asked for" },
        text: { type: "string", description: "The manager's own words for the message, written in the manager's first person" },
      },
      required: ["target"],
    },
  },
};
