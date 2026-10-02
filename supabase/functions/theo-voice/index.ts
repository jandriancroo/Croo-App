// Theo Voice — mints short-lived Grok live-voice passes and serves the
// per-location 4-hour opening update. The xAI key never leaves the server.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireInternalCaller } from "../_shared/callerAuth.ts";

const AI_URL = "https://ai.gateway.lovable.dev/v1/responses";
const MANAGER_ROLES = ["shift_manager", "shift_manager_in_training", "manager", "general_manager", "admin", "org_admin", "fbc", "brand_admin", "super_admin"];
const ALL_ACCESS_ROLES = ["super_admin", "brand_admin", "org_admin", "fbc"];
const VOICES = ["eve", "ara", "leo", "rex", "sal"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function localParts(tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) };
}

const LABELS = ["late-night update", "early morning update", "morning update", "mid-shift update", "dinner rush update", "closing update"];

function windowFor(tz: string) {
  const { date, hour } = localParts(tz);
  const slot = Math.floor(hour / 4);
  return { key: `${date}#${slot}`, label: LABELS[slot], date };
}

async function tzFor(admin: any, locationId: string) {
  const { data } = await admin.from("location_settings").select("timezone").eq("location_id", locationId).maybeSingle();
  return data?.timezone || "America/Los_Angeles";
}

const fmt$ = (n: any) => (typeof n === "number" && n > 0 ? `$${Math.round(n).toLocaleString("en-US")}` : null);

async function buildOpener(admin: any, loc: { id: string; name: string }, tz: string) {
  const w = windowFor(tz);
  const { data: existing } = await admin.from("theo_voice_openers").select("script, window_label, window_key")
    .eq("location_id", loc.id).eq("window_key", w.key).maybeSingle();
  if (existing) return existing;

  const [briefing, sales] = await Promise.all([
    admin.from("croo_ai_briefings").select("content").eq("location_id", loc.id).eq("briefing_date", w.date).maybeSingle(),
    admin.from("sales_cache").select("net_sales, guest_count, projected_sales, yoy_net_sales").eq("location_id", loc.id).eq("sale_date", w.date).maybeSingle(),
  ]);
  const s = sales.data || {};
  const facts = [
    fmt$(s.net_sales) && `Sales so far today: ${fmt$(s.net_sales)}`,
    fmt$(s.projected_sales) && `Today's goal: ${fmt$(s.projected_sales)}`,
    fmt$(s.yoy_net_sales) && `Same day last year finished at: ${fmt$(s.yoy_net_sales)}`,
    s.guest_count > 0 && `Guests so far: ${s.guest_count}`,
  ].filter(Boolean).join("\n");

  const key = Deno.env.get("LOVABLE_API_KEY");
  let script = `Hey, it's Theo with your ${w.label} for ${loc.name}. What do you want to dig into?`;
  if (key) {
    const r = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions: `You write a spoken opening update for Theo, the AI general manager of a restaurant. It is read aloud. Rules: 20-35 seconds, plain conversational sentences, no lists, no markdown, round numbers ("about twelve hundred dollars"). NEVER say individual employee names, labor grades, cash variances or who was late. If a number is missing or zero, leave it out — never say 0% or grade F. Open with "Hey, it's Theo with your ${w.label} for ${loc.name}." End by asking what they want to dig into.`,
        input: `Live numbers:\n${facts || "(none yet)"}\n\nToday's written brief (for context only):\n${(briefing.data?.content || "(none)").slice(0, 4000)}`,
      }),
    });
    if (r.ok) {
      const d = await r.json();
      await admin.from("theo_ai_usage").insert({
        user_id: null, location_id: loc.id, source: "opener", model: "openai/gpt-6-astra",
        prompt_tokens: d?.usage?.input_tokens || 0, completion_tokens: d?.usage?.output_tokens || 0,
      });
      const t = (d?.output_text || (d?.output || []).flatMap((o: any) => o?.content || []).map((c: any) => c?.text || "").join("")).trim();
      if (t) script = t;
    } else console.error("opener AI failed", r.status, await r.text());
  }
  const row = { location_id: loc.id, window_key: w.key, window_label: w.label, script };
  await admin.from("theo_voice_openers").upsert(row, { onConflict: "location_id,window_key", ignoreDuplicates: true });
  return row;
}

const INSTRUCTIONS = (locName: string, role: string) => `You are Theo, the AI general manager for ${locName} in CrooHQ — think Jarvis for a restaurant. You're talking out loud with a ${role.replace(/_/g, " ")}. Be friendly but serious, short and direct: one to three sentences per turn, round numbers, no lists.
For ANY question about this store's data (sales, labor, schedule, checklists, inventory, tips, reviews, punches, crew, catering, logbook), call the ask_theo tool with the question and speak its answer in your own words. Never invent numbers.
Out loud, never say individual employee names, labor grades, cash variances or who was late — say "the details are on screen" instead. If data is missing, say so briefly instead of saying zero.
Stay on restaurant operations.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }

  try {
    if (body?.action === "opener_cron") {
      const denied = requireInternalCaller(req, corsHeaders);
      if (denied) return denied;
      const { data: locs } = await admin.from("locations").select("id, name").eq("is_active", true);
      const out: any[] = [];
      for (const loc of locs || []) {
        try { const o = await buildOpener(admin, loc, await tzFor(admin, loc.id)); out.push({ loc: loc.name, w: o.window_key }); }
        catch (e) { out.push({ loc: loc.name, error: String(e) }); }
      }
      return json({ ok: true, out });
    }

    if (body?.action !== "session") return json({ error: "Unknown action" }, 400);
    const locationId = typeof body.location_id === "string" && /^[0-9a-f-]{36}$/i.test(body.location_id) ? body.location_id : null;
    if (!locationId) return json({ error: "location_id required" }, 400);

    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const roleList = (roles || []).map((r: any) => r.role);
    const role = MANAGER_ROLES.find((r) => roleList.includes(r)) ? roleList.find((r: string) => MANAGER_ROLES.includes(r)) : null;
    if (!role) return json({ error: "Theo voice is for shift managers and above" }, 403);
    if (!roleList.some((r: string) => ALL_ACCESS_ROLES.includes(r))) {
      const { data: m } = await admin.from("user_locations").select("id").eq("user_id", user.id).eq("location_id", locationId).maybeSingle();
      if (!m) return json({ error: "No access to this store" }, 403);
    }
    const { data: loc } = await admin.from("locations").select("id, name").eq("id", locationId).maybeSingle();
    if (!loc) return json({ error: "Store not found" }, 404);

    const xaiKey = Deno.env.get("XAI_API_KEY");
    if (!xaiKey) return json({ error: "Voice is not set up yet" }, 503);

    const [opener, tokenRes] = await Promise.all([
      buildOpener(admin, loc, await tzFor(admin, loc.id)),
      fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${xaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expires_after: { seconds: 300 } }),
      }),
    ]);
    if (!tokenRes.ok) {
      console.error("xai token failed", tokenRes.status, await tokenRes.text());
      return json({ error: "Voice service unavailable" }, 502);
    }
    const tok = await tokenRes.json();
    const token = tok?.value || tok?.client_secret?.value || tok?.token;
    if (!token) return json({ error: "Voice service unavailable" }, 502);

    const { data: pref } = await admin.from("theo_voice_prefs").select("voice").eq("user_id", user.id).maybeSingle();
    const voice = VOICES.includes(pref?.voice) ? pref.voice : "eve";
    return json({
      token,
      model: "grok-voice-latest",
      voice,
      instructions: INSTRUCTIONS(loc.name, role),
      opener: { key: opener.window_key, label: opener.window_label, script: opener.script },
      location_name: loc.name,
    });
  } catch (e) {
    console.error("theo-voice error", e);
    return json({ error: "Something went wrong" }, 500);
  }
});
