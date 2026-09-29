// Toast robot watchdog. Runs every 5 minutes from pg_cron.
// Never contacts Toast. It only reads CrooHQ's own records, then:
//   • starts the cloud robot (GitHub workflow_dispatch) when data is stale or a
//     run asks for a handoff (15-min cooldown per store)
//   • pushes an alert to super admins when live data stops (stage 1), and
//     escalates when it's still stale 20 minutes later (stage 2)
import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeCaller } from "../_shared/callerAuth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const STALE_MIN = 10;
const ESCALATE_MIN = 20;
const DISPATCH_COOLDOWN_MIN = 15;

function localNow(tz: string, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), min: +p.hour * 60 + +p.minute };
}
const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const fmtTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

async function dispatchRobot(): Promise<string> {
  // Starts the robot through the Lovable GitHub connection (no manual token).
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const ghKey = Deno.env.get("GITHUB_API_KEY");
  const repo = Deno.env.get("GITHUB_REPO"); // owner/name, e.g. jandriancroo/Croo-App
  if (!lovableKey || !ghKey || !repo) return "no_github_key";
  const r = await fetch(`https://connector-gateway.lovable.dev/github/repos/${repo}/actions/workflows/toast-live-scrape.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": ghKey, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: Deno.env.get("GITHUB_REF") || "main" }),
  });
  if (r.status === 204) return "dispatched";
  return `github_${r.status}:${(await r.text()).slice(0, 120)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = await authorizeCaller(req, cors, { minRole: "super_admin" });
  if ("response" in auth) return auth.response;
  if (auth.caller.kind !== "service") return json({ error: "Forbidden" }, 403);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();

  const { data: ints } = await supabase.from("location_integrations")
    .select("location_id, credentials").eq("integration_type", "toast").eq("is_active", true);
  const ids = (ints ?? []).filter((r: any) => r.credentials?.restaurant_guid).map((r: any) => r.location_id);
  if (!ids.length) return json({ ok: true, stores: 0 });

  const [{ data: settings }, { data: hours }, { data: statuses }, { data: locs }, { data: admins }] = await Promise.all([
    supabase.from("location_settings").select("location_id, timezone").in("location_id", ids),
    supabase.from("location_hours").select("location_id, day_of_week, open_time, close_time, is_closed").in("location_id", ids),
    supabase.from("toast_robot_status").select("*").in("location_id", ids),
    supabase.from("locations").select("id, name").in("id", ids),
    supabase.from("user_roles").select("user_id").eq("role", "super_admin"),
  ]);
  const adminIds = [...new Set((admins ?? []).map((a: any) => a.user_id))];

  let dispatchResult: string | null = null; // one dispatch covers every Toast store
  const report: any[] = [];

  for (const id of ids) {
    const tz = (settings ?? []).find((s: any) => s.location_id === id)?.timezone || "America/Los_Angeles";
    const name = (locs ?? []).find((l: any) => l.id === id)?.name || "Toast store";
    const { dow, min } = localNow(tz, now);
    const day = (hours ?? []).find((h: any) => h.location_id === id && h.day_of_week === dow);
    if (!day || day.is_closed) { report.push({ id, skip: "closed today" }); continue; }
    // Same window the robot uses: 30 min before open → 2 h after close.
    const winStart = toMin(String(day.open_time)) - 30;
    const winEnd = toMin(String(day.close_time)) + 120;
    if (min < winStart || min > winEnd) { report.push({ id, skip: "outside hours" }); continue; }
    const minutesIntoWindow = min - winStart;

    const { data: last } = await supabase.from("toast_sales_cache").select("fetched_at")
      .eq("location_id", id).eq("data_source", "live").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
    const lastAt = last?.fetched_at ? new Date(last.fetched_at) : null;
    const staleMin = lastAt ? (now.getTime() - lastAt.getTime()) / 60000 : Infinity;
    const flowedToday = lastAt ? staleMin < minutesIntoWindow : false;

    const st: any = (statuses ?? []).find((s: any) => s.location_id === id) ?? { location_id: id, alert_stage: 0 };
    const sinceDispatch = st.last_dispatch_at ? (now.getTime() - new Date(st.last_dispatch_at).getTime()) / 60000 : Infinity;
    const handoffAsk = st.state === "handoff" && (!st.last_dispatch_at || new Date(st.last_dispatch_at) < new Date(st.heartbeat_at));
    const capped = st.state === "login_capped" && st.full_logins_date === now.toISOString().slice(0, 10);
    const stale = staleMin >= STALE_MIN && minutesIntoWindow >= STALE_MIN;

    const patch: any = { location_id: id, updated_at: now.toISOString() };
    let action = "ok";

    if ((handoffAsk || stale) && !capped && sinceDispatch >= (handoffAsk ? 0 : DISPATCH_COOLDOWN_MIN)) {
      dispatchResult ??= await dispatchRobot();
      patch.last_dispatch_at = now.toISOString();
      action = handoffAsk ? `handoff:${dispatchResult}` : `restart:${dispatchResult}`;
    }

    // Alerts: only when data had been flowing today, or a restart already failed to bring it back.
    if (!stale) {
      if (st.alert_stage) patch.alert_stage = 0;
    } else if (adminIds.length && (flowedToday || sinceDispatch >= STALE_MIN || capped)) {
      const since = lastAt ? fmtTime(lastAt.toISOString(), tz) : "opening";
      const why = st.state && st.state !== "polling" ? ` Robot says: ${st.state.replace("_", " ")}${st.message ? ` — ${st.message}` : ""}.` : "";
      const noKey = dispatchResult === "no_github_key" ? " (Auto-restart isn't set up yet.)" : "";
      let stage = st.alert_stage ?? 0;
      let title = "", body = "";
      if (stage === 0) {
        stage = 1;
        title = `Toast data stopped — ${name}`;
        body = capped
          ? `No Toast update since ${since}. The robot hit its daily sign-in limit and needs a person.${why}`
          : `No Toast update since ${since}. Restarting the robot.${why}${noKey}`;
      } else if (stage === 1 && staleMin >= STALE_MIN + ESCALATE_MIN) {
        stage = 2;
        title = `Toast still down — ${name}`;
        body = `Still no Toast update since ${since}. The restart didn't fix it; a person needs to look.${why}`;
      }
      if (title) {
        await supabase.from("alert_queue").upsert({
          alert_type: "toast_robot_down",
          dedup_key: `toast-robot:${id}:${now.toISOString().slice(0, 10)}:${stage}:${lastAt?.toISOString() ?? "none"}`,
          location_id: id,
          payload: { title, body, user_ids: adminIds, notification_type: "toast_robot_down", data: { location_id: id, stale_minutes: Math.round(staleMin) } },
        }, { onConflict: "dedup_key" });
        patch.alert_stage = stage;
        patch.last_alert_at = now.toISOString();
        action += `|alert${stage}`;
      }
    }

    await supabase.from("toast_robot_status").upsert(patch, { onConflict: "location_id" });
    report.push({ id, staleMin: Number.isFinite(staleMin) ? Math.round(staleMin) : null, state: st.state, action });
  }

  console.log("[toast-watchdog]", JSON.stringify(report));
  return json({ ok: true, report });
});
