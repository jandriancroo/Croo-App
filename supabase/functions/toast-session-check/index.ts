// Hayward 5:15 AM PT Toast session check.
// The mini runner does a session-only previous-day sales probe at 5:00 AM PT
// (LaunchAgent com.croo.toast-session-check). This function, invoked by
// pg_cron between 5:15 and 5:59 AM PT, reads CrooHQ records only (never
// Toast). If the probe failed (SESSION_EXPIRED, no data) or the mini did not
// report, it queues one email to jordan@croohq.com via email_queue — the same
// path as new-review notices. Success queues nothing. Normal 9 AM–11 PM CT
// polling is unchanged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { requireInternalCaller } from "../_shared/callerAuth.ts";
import {
  HAYWARD_LOCATION_ID,
  FROM_ADDRESS,
  TO_ADDRESS,
  SUBJECT,
  TEST_SUBJECT,
  SOURCE,
  chicagoYesterday,
  evaluateProbe,
  failDedupKey,
  failEmailHtml,
  shouldRunCheck,
} from "./check.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Body = { action?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function queueFailEmail(
  supabase: Db,
  reason: string,
  now: Date,
  test: boolean,
) {
  const { error } = await supabase.from("email_queue").insert({
    from_address: FROM_ADDRESS,
    to_addresses: [TO_ADDRESS],
    subject: test ? TEST_SUBJECT : SUBJECT,
    html: failEmailHtml(reason, test),
    source: SOURCE,
    dedup_key: failDedupKey(now, test),
    metadata: { location_id: HAYWARD_LOCATION_ID, test, reason },
  });
  if (error) {
    // Unique dedup_key means we already queued today's notice (or today's TEST).
    if (String(error.message || "").includes("dedup") || error.code === "23505") {
      return { queued: false, deduped: true };
    }
    throw error;
  }
  return { queued: true, deduped: false };
}

async function loadProbe(supabase: Db, now: Date) {
  const yesterday = chicagoYesterday(now);
  const [{ data: status }, { data: sales }] = await Promise.all([
    supabase.from("toast_robot_status").select("heartbeat_at, state, message").eq("location_id", HAYWARD_LOCATION_ID).maybeSingle(),
    supabase
      .from("toast_sales_cache")
      .select("fetched_at")
      .eq("location_id", HAYWARD_LOCATION_ID)
      .eq("sale_date", yesterday)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    yesterday,
    heartbeatAt: status?.heartbeat_at ? new Date(status.heartbeat_at) : null,
    state: (status?.state as string) ?? null,
    message: (status?.message as string) ?? null,
    yesterdaySalesFetchedAt: sales?.fetched_at ? new Date(sales.fetched_at) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const denied = requireInternalCaller(req, cors);
  if (denied) return denied;

  let body: Body = {};
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const now = new Date();
  const action = body.action || "check";

  try {
    if (action === "test_fail") {
      const reason = "TEST simulated failure (SESSION_EXPIRED / no data / runner did not report).";
      const q = await queueFailEmail(supabase, reason, now, true);
      return json({ ok: true, test: true, emailed: q.queued, deduped: q.deduped, subject: TEST_SUBJECT });
    }

    if (action !== "check") return json({ error: "Unknown action" }, 400);

    if (!shouldRunCheck(now)) {
      return json({ ok: true, skipped: "outside_window" });
    }

    const loaded = await loadProbe(supabase, now);
    const verdict = evaluateProbe({ now, ...loaded });
    if (verdict.ok) return json({ ok: true, passed: true, emailed: false, yesterday: loaded.yesterday });

    const q = await queueFailEmail(supabase, verdict.reason, now, false);
    return json({
      ok: true,
      passed: false,
      emailed: q.queued,
      deduped: q.deduped,
      reason: verdict.reason,
      yesterday: loaded.yesterday,
    });
  } catch (e) {
    console.error("[toast-session-check] internal_error");
    return json({ error: "internal_error" }, 500);
  }
});
