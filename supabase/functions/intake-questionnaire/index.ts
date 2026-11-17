// Private pre-call questionnaire (/q/:slug). Public endpoint: the slug is the
// only key. Uses the service role to read intake_links and write
// intake_submissions (no client access to either table). One submission per
// organization is enforced by UNIQUE(org) on intake_submissions.
// Never logs secrets or answers.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { corsHeaders } from "../_shared/sdkCors.ts";

const FIELDS: [string, string][] = [
  ["name", "Name"],
  ["role", "Role"],
  ["num_stores", "Number of stores"],
  ["loc_blaze", "Locations: Blaze Pizza"],
  ["loc_daves", "Locations: Dave's Hot Chicken"],
  ["loc_mikes", "Locations: Mike's Red Tacos"],
  ["loc_other", "Locations: Other"],
  ["split", "How stores are split between team members"],
  ["tool_punch", "Tools today: Punch clock and scheduling"],
  ["tool_comms", "Tools today: Communication and manager logbook"],
  ["tool_hr", "Tools today: Write-ups and employee reviews"],
  ["tool_hiring", "Tools today: Hiring"],
  ["tool_inv", "Tools today: Inventory"],
  ["tool_tasks", "Tools today: Task management"],
  ["one_thing", "One thing to see every morning before calling stores"],
  ["headache", "Biggest headache right now"],
  ["pilot", "3-5 stores to start with"],
  ["other", "Anything else we should know"],
];
const MAX_LEN = 3000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanAnswers(raw: unknown): Record<string, string> {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const [key] of FIELDS) {
    const value = source[key];
    out[key] = typeof value === "string" ? value.trim().slice(0, MAX_LEN) : "";
  }
  return out;
}

function buildEmail(orgLabel: string, answers: Record<string, string>, isTest: boolean) {
  const rows = FIELDS.map(([key, label]) => {
    const value = answers[key] || "";
    return `<tr><td style="padding:8px 12px;border:1px solid #e4ddcf;font-weight:700;vertical-align:top;width:40%">${esc(label)}</td>` +
      `<td style="padding:8px 12px;border:1px solid #e4ddcf;white-space:pre-wrap;vertical-align:top">${value ? esc(value) : '<span style="color:#999">—</span>'}</td></tr>`;
  }).join("");
  const banner = isTest
    ? `<div style="background:#b42318;color:#fff;font-weight:800;padding:12px 16px;border-radius:8px;margin-bottom:16px">[TEST] submission. Not from DAMM.</div>`
    : "";
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2a2e;max-width:720px">` +
    banner +
    `<h2 style="margin:0 0 12px;color:#417f8e">CrooHQ intake: ${esc(orgLabel)}</h2>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table></div>`;
  const text = (isTest ? "[TEST] submission. Not from DAMM.\n\n" : "") +
    `CrooHQ intake: ${orgLabel}\n\n` +
    FIELDS.map(([key, label]) => `${label}:\n${answers[key] || "—"}`).join("\n\n");
  return { html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object") return json({ error: "Invalid request" }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const action = body.action;
  const slug = body.slug;
  if (action !== "status" && action !== "submit") return json({ error: "Invalid request" }, 400);
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 100) return json({ error: "Not found" }, 404);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: link, error: linkError } = await admin
    .from("intake_links")
    .select("org, org_label")
    .eq("slug", slug)
    .maybeSingle();
  if (linkError) {
    console.error("intake-questionnaire: link lookup failed", linkError.code);
    return json({ error: "Something went wrong." }, 500);
  }
  if (!link) return json({ error: "Not found" }, 404);

  if (action === "status") {
    const { count, error } = await admin
      .from("intake_submissions")
      .select("id", { count: "exact", head: true })
      .eq("org", link.org);
    if (error) {
      console.error("intake-questionnaire: status failed", error.code);
      return json({ error: "Something went wrong." }, 500);
    }
    return json({ submitted: (count ?? 0) > 0 });
  }

  const answers = cleanAnswers(body.answers);
  const name = answers.name;
  if (!name) return json({ error: "Please add your name so we know who this is from." }, 400);
  const isTest = name.startsWith("[TEST]");

  const { data: inserted, error: insertError } = await admin
    .from("intake_submissions")
    .insert({ org: link.org, name, is_test: isTest, answers })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return json({ error: "Already submitted." }, 409);
    console.error("intake-questionnaire: insert failed", insertError.code);
    return json({ error: "Something went wrong." }, 500);
  }

  let emailStatus = "sent";
  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) throw new Error("missing email key");
    const resend = new Resend(apiKey);
    const { html, text } = buildEmail(link.org_label, answers, isTest);
    const result = await resend.emails.send({
      from: "CrooHQ <hello@croohq.email>",
      to: ["jordan@croohq.com"],
      subject: `${isTest ? "[TEST] " : ""}CrooHQ intake: ${link.org_label} (from ${name})`,
      html,
      text,
    });
    const sendError = (result as { error?: { message?: string } | null }).error;
    if (sendError) throw new Error(sendError.message || "send error");
  } catch (err) {
    const reason = (err instanceof Error ? err.message : "unknown").slice(0, 120);
    emailStatus = `failed: ${reason}`;
    console.error("intake-questionnaire: email failed", reason);
  }

  const { error: updateError } = await admin
    .from("intake_submissions")
    .update({ email_status: emailStatus })
    .eq("id", inserted.id);
  if (updateError) console.error("intake-questionnaire: status update failed", updateError.code);

  return json({ ok: true });
});
