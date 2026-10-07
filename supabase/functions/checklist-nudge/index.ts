// Quick Nudge v1 (checklists). THE only send path for nudges: dashboard sheet and Theo's Send nudge tap both call this.
// Recipients are computed here at send time (everyone on the clock at the store, minus the sender, minus cooldown).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { authenticateCaller } from "../_shared/callerAuth.ts";
import { roleForUser, NUDGE_ROLES } from "../_shared/theoActions.ts";
import { canNudgeChecklist, renderNudgeText, DEFAULT_NUDGE_TEMPLATES, MAX_MESSAGE, NUDGE_COOLDOWN_MIN } from "../_shared/nudgePlan.ts";
import { nudgeStatus, nudgeAudience, senderFirstName } from "../_shared/nudgeData.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await authenticateCaller(req);
    if (!caller || caller.kind !== "user") return json({ error: "Sign in required." }, 401);
    const userId = caller.userId;
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const checklistId = body?.checklist_id;
    if (action !== "options" && action !== "send") return json({ error: "Unknown action." }, 400);
    if (typeof checklistId !== "string" || !UUID.test(checklistId)) return json({ error: "checklist_id is required." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // c) the checklist decides the store; a client location is never trusted.
    const { data: cl } = await admin.from("checklists").select("id, title, location_id, is_active, superseded_at, template_type, frequency, family_id").eq("id", checklistId).maybeSingle();
    if (!cl || !cl.is_active || cl.superseded_at || cl.template_type === "training" || cl.frequency === "training" || !cl.location_id) return json({ error: "This checklist can't be nudged." }, 400);
    if (body?.location_id && body.location_id !== cl.location_id) return json({ error: "This checklist belongs to another store." }, 400);
    const storeId: string = cl.location_id;

    // d) role, e) store access
    const { role } = await roleForUser(admin, userId);
    if (!role || !NUDGE_ROLES.includes(role)) return json({ error: "Only managers can send nudges." }, 403);
    const { data: access, error: accErr } = await admin.rpc("has_location_access", { _user_id: userId, _location_id: storeId });
    if (accErr || access !== true) return json({ error: "You don't have access to this store." }, 403);

    // f) today's list + rules
    const [row] = await nudgeStatus(admin, storeId, checklistId);
    const can = canNudgeChecklist(row);
    const { data: loc } = await admin.from("locations").select("id, name, organization_id").eq("id", storeId).maybeSingle();
    const senderFirst = await senderFirstName(admin, userId);
    if ("code" in can) {
      if (action === "send") return json({ error: can.reason, code: can.code }, 409);
      return json({ allowed: false, reason: can.reason, checklist: { id: cl.id, title: cl.title, done: row?.completed_items ?? 0, total: row?.total_items ?? 0 }, store: { id: storeId, name: loc?.name ?? "" }, sender_first_name: senderFirst, going: [], recently: [], templates: [], default_template_id: null });
    }

    // g) + h) on the clock, cooldown
    const aud = await nudgeAudience(admin, storeId, row.family_id, userId);
    const noOneReason = aud.onClock.length === 0 ? "No one is clocked in right now." : "Everyone on the clock was nudged about this in the last hour.";
    const recently = aud.recently.map((p) => ({ id: p.id, name: p.name, minutes_ago: p.minutes_ago }));

    if (action === "options") {
      const { data: tpls } = await admin.from("location_nudge_templates").select("id, name, body, is_default, sort_order").eq("location_id", storeId).order("sort_order");
      const templates = (tpls && tpls.length ? tpls.map((t: any) => ({ id: t.id, name: t.name, body: t.body, is_default: t.is_default })) : DEFAULT_NUDGE_TEMPLATES);
      const def = templates.find((t: any) => t.is_default) || templates[0];
      return json({
        allowed: aud.going.length > 0, reason: aud.going.length > 0 ? null : noOneReason,
        checklist: { id: cl.id, title: row.title, done: row.completed_items, total: row.total_items },
        store: { id: storeId, name: loc?.name ?? "" }, sender_first_name: senderFirst,
        going: aud.going.map((p) => ({ id: p.id, name: p.name, first_name: p.first_name })), recently,
        templates, default_template_id: def?.id ?? null,
      });
    }

    // SEND
    const message = String(body?.message ?? "").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim();
    if (message.length < 1 || message.length > MAX_MESSAGE) return json({ error: `The message must be 1 to ${MAX_MESSAGE} characters.` }, 400);
    const source = ["dashboard", "theo_chat", "theo_voice"].includes(body?.source) ? body.source : "dashboard";
    let templateId: string | null = null;
    if (typeof body?.template_id === "string" && UUID.test(body.template_id)) {
      const { data: t } = await admin.from("location_nudge_templates").select("id").eq("id", body.template_id).eq("location_id", storeId).maybeSingle();
      templateId = t?.id ?? null;
    }
    if (aud.going.length === 0) return json({ error: noOneReason }, 409);

    const batchId = crypto.randomUUID();
    const fields = { sender_first_name: senderFirst, checklist: row.title, done: row.completed_items, total: row.total_items };
    const texts = new Map(aud.going.map((p) => [p.id, renderNudgeText(message, { ...fields, recipient_first_name: p.first_name })]));
    const { data: bd } = await admin.rpc("business_date", { _location_id: storeId });
    const { data: rec, error: recErr } = await admin.rpc("record_checklist_nudges", {
      _batch: batchId, _sender: userId, _location: storeId, _org: loc?.organization_id ?? null, _checklist: cl.id, _family: row.family_id,
      _title: row.title, _template_id: templateId, _message_raw: message,
      _recipients: aud.going.map((p) => ({ id: p.id, message_sent: texts.get(p.id) })), _source: source, _business_date: bd, _cooldown_min: NUDGE_COOLDOWN_MIN,
    });
    if (recErr) throw new Error(recErr.message);
    const queued = (rec || []).filter((r: any) => r.status === "queued");
    const lateCooldown = (rec || []).filter((r: any) => r.status === "cooldown");
    const byId = new Map(aud.going.map((p) => [p.id, p]));
    const allRecently = [...recently, ...lateCooldown.map((r: any) => ({ id: r.recipient_id, name: byId.get(r.recipient_id)?.name ?? "", minutes_ago: Math.max(0, Math.floor((Date.now() - new Date(r.last_sent_at).getTime()) / 60000)) }))];
    if (!queued.length) return json({ error: "Everyone on the clock was nudged about this in the last hour.", recently: allRecently }, 429);

    const ids: string[] = queued.map((r: any) => r.recipient_id);
    const notificationId = `nudge:${batchId}`;
    const { data: win } = await admin.rpc("business_day_window", { _location_id: storeId, _date: bd });
    const expires = (Array.isArray(win) ? win[0] : win)?.end_at ?? new Date(Date.now() + 12 * 3600_000).toISOString();
    await admin.from("visual_alert_queue").upsert(ids.map((id) => ({
      user_id: id, alert_type: "checklist_nudge", ref_id: cl.id, notification_id: notificationId, title: senderFirst,
      body: texts.get(id), location_id: storeId, expires_at: expires,
    })), { onConflict: "user_id,notification_id" });

    // Push: one call when every text is the same, else one per person.
    const groups = new Map<string, string[]>();
    for (const id of ids) { const t = texts.get(id)!; groups.set(t, [...(groups.get(t) || []), id]); }
    const { data: tokens } = await admin.from("push_notification_tokens").select("user_id").in("user_id", ids);
    const hasDevice = new Set((tokens || []).map((t: any) => t.user_id));
    const status = new Map<string, string>();
    await Promise.all([...groups.entries()].map(async ([text, uids]) => {
      let ok = false;
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            user_ids: uids, title: senderFirst, body: text, notification_type: "checklist_nudge", location_id: storeId, sender_id: userId,
            data: { type: "checklist_nudge", checklist_id: cl.id, location_id: storeId, nudge_batch_id: batchId, notification_id: notificationId, url: `/complete/${cl.id}` },
          }),
        });
        ok = r.ok; await r.text();
      } catch (e) { console.error("nudge push failed", e); }
      for (const u of uids) status.set(u, !hasDevice.has(u) ? "no_device" : ok ? "sent" : "failed");
    }));
    await Promise.all(["sent", "no_device", "failed"].map((s) => {
      const logIds = queued.filter((r: any) => status.get(r.recipient_id) === s).map((r: any) => r.log_id);
      return logIds.length ? admin.from("checklist_nudge_log").update({ push_status: s }).in("id", logIds) : null;
    }));

    return json({ ok: true, batch_id: batchId, sent: ids.map((id) => ({ id, name: byId.get(id)?.name ?? "" })), recently: allRecently });
  } catch (e) {
    console.error("checklist-nudge error", e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, 500);
  }
});
