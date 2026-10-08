// @ts-nocheck
// Labor-law check: searches official sites, asks AI for cited values, saves a PENDING proposal only.
// Nothing is applied here — an org admin / super admin approves via approve_labor_rule_proposal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { requireCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MODEL = "google/gemini-2.5-flash";
const PPLX_URL = "https://connector-gateway.lovable.dev/perplexity/search";

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",
  DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
  MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",
  PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

// Fields the AI may suggest (labor_rules columns) with unit descriptions.
const FIELDS: Record<string, any> = {
  meal_rule_basis: { type: "string", enum: ["law", "none"], description: "'law' if state law requires meal breaks for adults, else 'none'" },
  meal_break_hours: { type: "number", description: "Hours worked after which a meal break is required" },
  meal_break_duration: { type: "number", description: "Required meal break length, minutes" },
  meal_deadline_hours: { type: "number", description: "Meal must start by the end of this hour of work" },
  meal_break_paid: { type: "boolean", description: "Whether the required meal break is paid" },
  second_meal_break_hours: { type: "number", description: "Hours worked after which a second meal break is required" },
  rest_break_hours: { type: "number", description: "A rest break is required per this many hours worked" },
  rest_break_duration: { type: "number", description: "Rest break length, minutes" },
  rest_break_paid: { type: "boolean", description: "Whether rest breaks are paid" },
  daily_overtime_threshold: { type: "number", description: "Daily overtime starts after this many hours in a day" },
  daily_double_time_threshold: { type: "number", description: "Daily double time starts after this many hours in a day" },
  weekly_overtime_threshold: { type: "number", description: "Weekly overtime starts after this many hours in a workweek" },
  overtime_multiplier: { type: "number", description: "Overtime pay multiplier, e.g. 1.5" },
  double_time_multiplier: { type: "number", description: "Double time pay multiplier, e.g. 2" },
  seventh_day_rule: { type: "boolean", description: "Seventh consecutive workday overtime rule applies" },
  split_shift_enabled: { type: "boolean", description: "State requires split-shift premium pay" },
  split_shift_gap_minutes: { type: "number", description: "Unpaid gap longer than this many minutes makes a split shift" },
  reporting_time_enabled: { type: "boolean", description: "State requires reporting time (show-up) pay" },
  reporting_time_min_hours: { type: "number", description: "Minimum hours of reporting time pay" },
  reporting_time_max_hours: { type: "number", description: "Maximum hours of reporting time pay" },
  minor_rules: { type: "object", description: "Minor (under 18) limits: {max_daily_hours, max_weekly_hours, latest_end_school_night 'HH:MM', meal_after_hours}" },
};

const isOfficial = (u: string) => {
  try { const x = new URL(u); return x.protocol === "https:" && /\.(gov|us)$/i.test(x.hostname); } catch { return false; }
};

async function search(query: string) {
  const r = await fetch(PPLX_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "X-Connection-Api-Key": Deno.env.get("PERPLEXITY_API_KEY") || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, max_results: 6, search_domain_filter: [".gov"] }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`search failed [${r.status}]: ${t.slice(0, 200)}`); }
  const d = await r.json();
  return (d.results || [])
    .filter((x: any) => x?.url && isOfficial(x.url))
    .slice(0, 5)
    .map((x: any) => ({ url: x.url, title: x.title || "", snippet: String(x.snippet || "").slice(0, 1500), date: x.date || null }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireCaller(req, corsHeaders);
  if ("response" in auth) return auth.response;
  const caller = auth.caller;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { action, location_id, kind } = body || {};
  if (action !== "propose" || typeof location_id !== "string" || !/^[0-9a-f-]{36}$/i.test(location_id)
      || (kind !== "build" && kind !== "recheck")) {
    return json({ error: "Expected { action: 'propose', location_id, kind: 'build' | 'recheck' }" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const createdBy = caller.kind === "user" ? caller.userId : null;

  // Gate with the caller's own session.
  const gateClient = caller.kind === "user"
    ? createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
      })
    : admin;
  if (caller.kind === "user") {
    const { data: acc, error } = await gateClient.rpc("my_labor_rules_access", { _location_id: location_id });
    if (error) return json({ error: "Access check failed" }, 500);
    if (!(kind === "recheck" ? acc?.can_check : acc?.can_edit)) return json({ error: "Not allowed" }, 403);
  }
  const { data: allowed, error: aErr } = await gateClient.rpc("labor_rule_check_allowed", { _location_id: location_id, _kind: kind });
  if (aErr) return json({ error: "Check limit lookup failed" }, 500);
  if (!allowed?.allowed) return json({ status: "rate_limited", reason: allowed?.reason, next_at: allowed?.next_at });

  const fail = async (error: string, publicError = error) => {
    await admin.rpc("record_labor_rule_check_failure", { _location_id: location_id, _kind: kind, _error: error, _created_by: createdBy });
    console.log("labor-rules-ai failed", { location_id, kind });
    return json({ status: "failed", error: publicError });
  };

  try {
    const { data: loc } = await admin.from("locations").select("id, name, address, organization_id").eq("id", location_id).maybeSingle();
    if (!loc) return json({ error: "Unknown store" }, 404);
    const { data: reg } = await admin.rpc("derive_store_region", { address: loc.address });
    const stateCode = (Array.isArray(reg) ? reg[0]?.state_code : reg?.state_code) || null;
    if (!stateCode) return await fail("no_state", "Add the store address first");
    const stateName = STATE_NAMES[stateCode] || stateCode;
    const parts = String(loc.address || "").split(",").map((s) => s.trim()).filter(Boolean);
    const city = parts.length >= 3 ? parts[parts.length - 2] : null;

    const { data: current } = await admin.from("labor_rules").select("*").eq("location_id", location_id).maybeSingle();
    const currentVals: Record<string, unknown> = {};
    for (const f of Object.keys(FIELDS)) currentVals[f] = current ? current[f] ?? null : null;

    const queries = [
      `${stateName} labor law meal break and rest break requirements adult employees`,
      `${stateName} daily overtime weekly overtime double time seventh day rule`,
      `${stateName} split shift premium and reporting time pay requirements`,
      `${stateName} minor child labor work hours limits and breaks for 14 15 16 17 year olds`,
      ...(city ? [`${city} ${stateName} local ordinance minimum wage scheduling breaks restaurant workers`] : []),
    ];
    const results: any[] = [];
    for (const q of queries) {
      const rs = await search(q);
      for (const r of rs) if (!results.some((x) => x.url === r.url)) results.push(r);
    }
    const urls = new Set(results.map((r) => r.url));
    if (results.length === 0) return await fail("no_official_results", "No official sources found. Try again later.");

    const props: Record<string, any> = {};
    for (const [f, schema] of Object.entries(FIELDS)) {
      props[f] = {
        type: "object",
        properties: {
          value: schema,
          citation_url: { type: "string", description: "Must be one of the search result URLs" },
          quote: { type: "string", description: "Exact text from that search result supporting the value" },
          confidence: { type: "number", description: "0 to 1" },
        },
        required: ["value", "citation_url", "quote", "confidence"],
      };
    }
    const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content:
            "You map employment law to restaurant labor rule settings. Use ONLY the provided search results. " +
            "For each field you can support, give value, citation_url (must be one of the result URLs), an exact quote from that result, and confidence 0..1. " +
            "If no result supports a field, omit it. Never guess. meal_rule_basis may only be 'law' or 'none'. " +
            "City or county ordinances go in notes only, never in fields. Keep notes short." },
          { role: "user", content: JSON.stringify({ state: stateCode, state_name: stateName, city, current_values: currentVals, search_results: results }) },
        ],
        tools: [{ type: "function", function: {
          name: "labor_rules_from_law",
          description: "Cited labor rule values for this state",
          parameters: { type: "object", properties: { fields: { type: "object", properties: props }, notes: { type: "string" } }, required: ["fields"] },
        } }],
        tool_choice: { type: "function", function: { name: "labor_rules_from_law" } },
      }),
    });
    if (!ai.ok) { const t = await ai.text(); return await fail(`ai failed [${ai.status}]: ${t.slice(0, 200)}`, ai.status === 402 ? "Out of AI credits" : "AI check failed"); }
    const aj = await ai.json();
    const args = aj?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: any;
    try { parsed = typeof args === "string" ? JSON.parse(args) : args; } catch { parsed = null; }
    if (!parsed || typeof parsed !== "object") return await fail("ai returned no result", "AI check failed");

    const suggested: Record<string, any> = {};
    for (const [f, v] of Object.entries(parsed.fields || {}) as any) {
      if (!(f in FIELDS) || !v || typeof v !== "object" || !("value" in v)) continue;
      if (!urls.has(v.citation_url)) continue;
      if (f === "meal_rule_basis" && !["law", "none"].includes(v.value)) continue;
      suggested[f] = {
        value: v.value,
        citation: { url: v.citation_url, quote: String(v.quote || "").slice(0, 500), state: stateCode },
        confidence: typeof v.confidence === "number" ? Math.max(0, Math.min(1, v.confidence)) : null,
      };
    }

    const { data: prop, error: pErr } = await admin.rpc("create_labor_rule_proposal", {
      _location_id: location_id, _kind: kind, _state_code: stateCode, _suggested: suggested,
      _sources: results.map((r) => ({ url: r.url, title: r.title })),
      _notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 2000) : null,
      _model: MODEL, _created_by: createdBy,
    });
    if (pErr || !prop) return await fail("proposal save failed", "Could not save the check");
    const changes = Array.isArray(prop.diff) ? prop.diff.length : 0;

    if (prop.status === "pending") {
      const { data: admins } = await admin.from("organization_members").select("user_id")
        .eq("organization_id", loc.organization_id).eq("org_role", "admin");
      const ids = [...new Set((admins || []).map((a: any) => a.user_id))];
      if (ids.length) {
        const notificationId = `labor-rules:${prop.id}`;
        const title = `Labor law update: ${loc.name}`;
        const text = `${changes} suggested change${changes === 1 ? "" : "s"} for ${stateName}. Review and approve.`;
        await admin.from("visual_alert_queue").upsert(ids.map((id) => ({
          user_id: id, alert_type: "labor_rules_proposal", ref_id: prop.id, notification_id: notificationId,
          title, body: text, location_id, expires_at: prop.expires_at,
        })), { onConflict: "user_id,notification_id" });
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({
              user_ids: ids, title, body: text, notification_type: "labor_rules_proposal", location_id,
              data: { url: `/location/${location_id}?proposal=${prop.id}` },
            }),
          });
          await r.text();
        } catch { console.log("labor-rules-ai push failed", { proposal_id: prop.id }); }
      }
    }
    console.log("labor-rules-ai done", { location_id, kind, proposal_id: prop.id, status: prop.status, changes, sources: results.length });
    return json({ status: prop.status, proposal_id: prop.id, state: stateCode, changes });
  } catch (e) {
    return await fail(String((e as Error)?.message || e).slice(0, 300), "Law check failed. Try again later.");
  }
});
