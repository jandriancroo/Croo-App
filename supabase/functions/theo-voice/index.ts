// Theo Voice — mints short-lived Grok live-voice passes and serves the
// per-location 4-hour opening update. The xAI key never leaves the server.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { roleForUser, theoActionsAt, type TheoActions } from "../_shared/theoActions.ts";

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
        model: "openai/gpt-6-luna",
        store: false,
        instructions: `You write a spoken opening update for Theo, the AI general manager of a restaurant. It is read aloud. Rules: 20-35 seconds, plain conversational sentences, no lists, no markdown, round numbers ("about twelve hundred dollars"). If a number is missing or zero, leave it out — never say 0% or grade F. Open with "Hey, it's Theo with your ${w.label} for ${loc.name}." End by asking what they want to dig into.`,
        input: `Live numbers:\n${facts || "(none yet)"}\n\nToday's written brief (for context only):\n${(briefing.data?.content || "(none)").slice(0, 4000)}`,
      }),
    });
    if (r.ok) {
      const d = await r.json();
      await admin.from("theo_ai_usage").insert({
        user_id: null, location_id: loc.id, source: "opener", model: "openai/gpt-6-luna",
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

const HANDS = (a: TheoActions) => a.cover_shift ? `
Quick tasks and shift cover: ask_theo also takes requests to create a quick task ("have Alle wipe the patio tables") and to cover a shift ("who can cover Ryan tonight?", "cover Ryan's shift with Deborah", "someone called out"). Pass the whole request through, word for word.
When an ask_theo result has "preview": true or "screen": true, say only its answer line. Never say a task was created or a shift was changed, moved or covered.
If the manager says yes, do it, confirm or looks good while a preview is showing, pass it to ask_theo and say what it returns ("Tap Create task to save it." or "Tap Confirm change to save it.").` : a.create_task ? `
Quick tasks: ask_theo also takes requests to create a quick task ("have Alle wipe the patio tables"). Pass the whole request through, word for word. Shift cover requests also go to ask_theo; say what it returns.
When an ask_theo result has "preview": true, say only its answer line. Never say a task was created or a shift was changed, moved or covered.
If the manager says yes, do it, confirm or looks good while a preview is showing, pass it to ask_theo and say what it returns ("Tap Create task to save it.").` : "";

const INSTRUCTIONS = (locName: string, role: string, hands = "") => `You are Theo, the AI general manager for ${locName} in CrooHQ — think Jarvis for a restaurant. You're talking out loud with a ${role.replace(/_/g, " ")}. Be friendly but serious. Answer the whole question, briefly and naturally, with round numbers.
For ANY question about this store's data (sales, labor, schedule, checklists, tips, reviews, punches, crew, catering, logbook), call the ask_theo tool with the question and speak its answer in your own words. Never invent numbers.
Every ask_theo result has "long": true or false — follow it exactly. When long is false, say the whole answer (short lists in full, e.g. "Seven on tomorrow. Ally and Marcus open at 9, Dee and Sam come in at 11, Jo at 2, and Chris and Priya close from 4.") and never mention the chat. Never drop part of a short answer to save time. When long is true, give the headline and the top few, then say "the rest is in your Theo chat — tap the button on screen." A one-number question gets one short sentence.
You are only ever talking to a manager who already has access to this data, so say employee names, grades and details plainly when asked. If data is missing, say so briefly instead of saying zero.
Earlier answers are there so you understand what the manager means (who 'he' is, which day, which store). They may be out of date.
For any number or fact about the store, call ask_theo again, even if an earlier answer seems to cover it. Sales, labor and pace change by the minute.
The only thing you may answer from the earlier conversation without calling ask_theo is a request to repeat or rephrase what you just said.
ask_theo has no memory. Always send it a complete standalone question: include the person, the date and the subject from the conversation.
Stay on restaurant operations.${hands}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }

  try {
    // Updates are written only on demand ("update" action). The every-hour writer was removed.
    if (body?.action !== "session" && body?.action !== "update") return json({ error: "Unknown action" }, 400);
    const locationId = typeof body.location_id === "string" && /^[0-9a-f-]{36}$/i.test(body.location_id) ? body.location_id : null;
    if (!locationId) return json({ error: "location_id required" }, 400);

    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { role: highest, roles: roleList } = await roleForUser(admin, user.id);
    const role = highest && MANAGER_ROLES.includes(highest) ? highest : null;
    if (!role) return json({ error: "Theo voice is for shift managers and above" }, 403);
    if (!roleList.some((r: string) => ALL_ACCESS_ROLES.includes(r))) {
      const { data: m } = await admin.from("user_locations").select("id").eq("user_id", user.id).eq("location_id", locationId).maybeSingle();
      if (!m) return json({ error: "No access to this store" }, 403);
    }
    const { data: loc } = await admin.from("locations").select("id, name").eq("id", locationId).maybeSingle();
    if (!loc) return json({ error: "Store not found" }, 404);

    const xaiKey = Deno.env.get("XAI_API_KEY");
    if (!xaiKey) return json({ error: "Voice is not set up yet" }, 503);
    const { data: pref } = await admin.from("theo_voice_prefs").select("voice").eq("user_id", user.id).maybeSingle();
    const voice = VOICES.includes(pref?.voice) ? pref.voice : "eve";

    if (body.action === "update") {
      // Cheap path: write the update if needed, read it with text-to-speech. No live connection.
      const opener = await buildOpener(admin, loc, await tzFor(admin, loc.id));
      const out = { key: opener.window_key, label: opener.window_label, script: opener.script };
      try {
        const r = await fetch("https://api.x.ai/v1/tts", {
          method: "POST",
          headers: { Authorization: `Bearer ${xaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: opener.script, voice_id: voice, language: "en" }),
        });
        if (!r.ok) { console.error("xai tts failed", r.status, await r.text()); return json({ opener: out, audio: null }); }
        const audio = encodeBase64(new Uint8Array(await r.arrayBuffer()));
        return json({ opener: out, audio, mime: "audio/mpeg", tts_chars: opener.script.length });
      } catch (e) {
        console.error("xai tts error", e);
        return json({ opener: out, audio: null });
      }
    }

    const tokenRes = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${xaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { seconds: 300 } }),
    });
    if (!tokenRes.ok) {
      console.error("xai token failed", tokenRes.status, await tokenRes.text());
      return json({ error: "Voice service unavailable" }, 502);
    }
    const tok = await tokenRes.json();
    const token = tok?.value || tok?.client_secret?.value || tok?.token;
    if (!token) return json({ error: "Voice service unavailable" }, 502);

    // Which Theo actions this person has at this store (store access checked inside). The screen uses only this.
    const actions = await theoActionsAt(admin, user.id, role, loc.id);
    return json({
      actions,
      token,
      model: "grok-voice-latest",
      voice,
      instructions: INSTRUCTIONS(loc.name, role, HANDS(actions)),
      location_name: loc.name,
    });
  } catch (e) {
    console.error("theo-voice error", e);
    return json({ error: "Something went wrong" }, 500);
  }
});
