// Shift reminder dispatcher — runs every minute via pg_cron.
// Sends a push notification ~30 minutes before each user's scheduled shift start.
// Idempotent via shift_reminder_log (PK on shift_id).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REMINDER_MINUTES = 30;
const WINDOW_MINUTES = 2; // tolerance window to catch cron drift

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Ack the cron tick immediately and dispatch in the background. Doing the
  // scan + per-user push sends inline could exceed the wall-clock limit, which
  // the edge surfaced as a 502 on every scheduled invocation.
  const work = dispatchReminders();
  // @ts-ignore — EdgeRuntime.waitUntil is available in the Supabase edge runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  }

  return new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function dispatchReminders() {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Pull a small window of upcoming shifts (±1 day around today) and filter to the ~30-min mark in JS.
    let rows: any[] = [];
    {
      const { data: shifts, error: sErr } = await supabase
        .from("scheduled_shifts")
        .select("id, user_id, shift_date, start_time, is_time_off, schedule_id, schedules!inner(location_id, is_published, locations!inner(name, id))")
        .not("user_id", "is", null)
        .eq("is_time_off", false)
        .eq("schedules.is_published", true)
        .gte("shift_date", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
        .lte("shift_date", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10));


      if (sErr) throw sErr;

      // Pull tz per location
      const locationIds = [...new Set(((shifts || []) as any[]).map((s: any) => s.schedules.location_id))];
      const { data: settings } = await supabase
        .from("location_settings")
        .select("location_id, timezone")
        .in("location_id", locationIds);
      const tzMap = new Map<string, string>(
        (settings || []).map((s: any) => [s.location_id, s.timezone || "America/Los_Angeles"])
      );

      const now = Date.now();
      const targetMsMin = now + (REMINDER_MINUTES - WINDOW_MINUTES) * 60 * 1000;
      const targetMsMax = now + (REMINDER_MINUTES + WINDOW_MINUTES) * 60 * 1000;

      for (const s of ((shifts || []) as any[])) {
        const tz = tzMap.get(s.schedules.location_id) || "America/Los_Angeles";
        // Compute the UTC instant of `shift_date T start_time` interpreted in `tz`.
        const localIso = `${s.shift_date}T${s.start_time}`;
        const startUtcMs = zonedDateTimeToUtcMs(localIso, tz);
        if (startUtcMs >= targetMsMin && startUtcMs <= targetMsMax) {
          rows.push({
            shift_id: s.id,
            user_id: s.user_id,
            shift_date: s.shift_date,
            start_time: s.start_time,
            location_name: s.schedules.locations.name,
            tz,
            start_utc_ms: startUtcMs,
          });
        }
      }
    }

    if (rows.length === 0) {
      return;
    }

    // Filter out shifts already logged
    const shiftIds = rows.map((r) => r.shift_id);
    const { data: logged } = await supabase
      .from("shift_reminder_log")
      .select("shift_id")
      .in("shift_id", shiftIds);
    const loggedSet = new Set((logged || []).map((l: any) => l.shift_id));
    rows = rows.filter((r) => !loggedSet.has(r.shift_id));

    // Respect per-user opt-out (default true if no row)
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("user_id, shift_reminders")
      .in("user_id", userIds);
    const optedOut = new Set(
      (prefs || []).filter((p: any) => p.shift_reminders === false).map((p: any) => p.user_id)
    );
    rows = rows.filter((r) => !optedOut.has(r.user_id));

    let sent = 0;
    for (const r of rows) {
      const startLocal = new Date(r.start_utc_ms).toLocaleTimeString("en-US", {
        timeZone: r.tz,
        hour: "numeric",
        minute: "2-digit",
      });
      try {
        await supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: [r.user_id],
            title: "Shift starting soon",
            body: `Your shift at ${r.location_name} starts at ${startLocal}.`,
            notification_type: "shift_reminders",
            data: { type: "shift_reminder", shift_id: r.shift_id },
          },
        });
        await supabase.from("shift_reminder_log").insert({
          shift_id: r.shift_id,
          user_id: r.user_id,
        });
        sent++;
      } catch (e) {
        console.error(`[shift-reminder] failed for shift ${r.shift_id}:`, e);
      }
    }

    console.log(`[shift-reminder] sent ${sent}/${rows.length}`);
  } catch (e: any) {
    console.error("[shift-reminder] error:", e);
  }
}

// Convert "YYYY-MM-DDTHH:MM:SS" interpreted in `tz` into a UTC ms timestamp.
function zonedDateTimeToUtcMs(localIso: string, tz: string): number {
  // Parse the local components
  const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  const [_, y, mo, d, h, mi, s] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || "0"));
  // Find the actual offset of that wall time in `tz` using Intl.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(asUtc));
  const get = (t: string) => +parts.find((p) => p.type === t)!.value;
  const tzAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offset = tzAsUtc - asUtc; // positive when tz is east of UTC
  return asUtc - offset;
}
