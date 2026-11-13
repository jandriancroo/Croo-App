// Drafts a short testimonial from answers the customer already wrote.
// Uses the same Lovable AI gateway as Theo. No new provider.
// The /demo form notifies Jordan from a different Supabase project
// (request-demo on hqadffricxfsbggqdqak). That function is not in this repo,
// so this function does not send email.
import { acceptDraft, clipAnswers, hasAnyReviewAnswers, SYSTEM_PROMPT, userPrompt } from "./combine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_BODY = 8000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, fallback: true, text: "" }, 405);

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return json({ ok: false, fallback: true, text: "" }, 400);
  }
  if (raw.length > MAX_BODY) return json({ ok: false, fallback: true, text: "" }, 413);

  let body: { company_website?: string; answers?: Record<string, unknown> } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ ok: false, fallback: true, text: "" }, 400);
  }
  if (String(body.company_website ?? "").trim()) {
    return json({ ok: false, fallback: true, text: "" }, 200);
  }

  const answers = clipAnswers(body.answers ?? {});
  const fallback = acceptDraft("", answers);
  if (!hasAnyReviewAnswers(answers)) {
    return json({ ok: false, fallback: true, text: fallback.text }, 200);
  }

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return json({ ok: false, fallback: true, text: fallback.text }, 200);

  try {
    const response = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        // gemini-2.5-flash counts its thinking tokens against this cap, so a
        // small cap leaves an empty or cut-off paragraph. The output is still
        // trimmed to 4 sentences and 1200 characters by acceptDraft.
        max_tokens: 2048,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(answers) },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(`[write-customer-review] gateway status ${response.status}`);
      return json({ ok: false, fallback: true, text: fallback.text }, 200);
    }
    const data = await response.json();
    const content = String(data?.choices?.[0]?.message?.content ?? "");
    const draft = acceptDraft(content, answers);
    if (!draft.drafted) {
      // Reason only, never customer text.
      console.warn(`[write-customer-review] draft rejected: finish=${data?.choices?.[0]?.finish_reason ?? "?"} chars=${content.length}`);
    }
    return json({ ok: draft.drafted, fallback: !draft.drafted, text: draft.text }, 200);
  } catch {
    return json({ ok: false, fallback: true, text: fallback.text }, 200);
  }
});
