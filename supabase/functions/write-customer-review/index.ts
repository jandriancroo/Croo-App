// Drafts a short testimonial from answers the customer already wrote.
// Uses the same Lovable AI gateway as Theo. No new provider.
// The /demo form notifies Jordan from a different Supabase project
// (request-demo on hqadffricxfsbggqdqak). That function is not in this repo,
// so this function does not send email.
import {
  acceptDraft,
  clipAnswers,
  clipSavedReviews,
  draftPrompt,
  hasAnyReviewAnswers,
  MAX_SAVED_REVIEWS,
  maxSimilarity,
  NEAR_MATCH_THRESHOLD,
  type ReviewAnswers,
  SYSTEM_PROMPT,
} from "./combine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_BODY = 8000;
// The /review page gives up after 20s, so the first draft, a possible retry,
// and the saved-review read all share one budget under that.
const BUDGET_MS = 18000;
const FIRST_DRAFT_MS = 12000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadSavedReviews(): Promise<string[]> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return [];
  try {
    const query = `select=final_text&final_text=not.is.null&order=created_at.desc&limit=${MAX_SAVED_REVIEWS}`;
    const response = await fetch(`${url}/rest/v1/customer_reviews?${query}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      console.warn(`[write-customer-review] saved reviews status ${response.status}`);
      return [];
    }
    const rows = await response.json();
    return clipSavedReviews(Array.isArray(rows) ? rows.map((row) => row?.final_text) : []);
  } catch {
    console.warn("[write-customer-review] saved reviews unavailable");
    return [];
  }
}

/** One gateway call. Returns the accepted draft text, or "" when it should fall back. */
async function draftOnce(
  key: string,
  answers: ReviewAnswers,
  saved: string[],
  temperature: number,
  retry: boolean,
  timeoutMs: number,
): Promise<string> {
  if (timeoutMs < 1500) return "";
  try {
    const response = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        // gemini-2.5-flash counts its thinking tokens against this cap, so a
        // small cap leaves an empty or cut-off paragraph. The output is still
        // trimmed to 4 sentences and 1200 characters by acceptDraft.
        max_tokens: 2048,
        temperature,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: draftPrompt(answers, saved, retry) },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(`[write-customer-review] gateway status ${response.status}`);
      return "";
    }
    const data = await response.json();
    const content = String(data?.choices?.[0]?.message?.content ?? "");
    const draft = acceptDraft(content, answers);
    if (!draft.drafted) {
      // Reason only, never customer text.
      console.warn(`[write-customer-review] draft rejected: finish=${data?.choices?.[0]?.finish_reason ?? "?"} chars=${content.length}`);
      return "";
    }
    return draft.text;
  } catch {
    return "";
  }
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

  // Saved reviews stay server-side: used for the prompt and the score only,
  // never returned to the client and never logged.
  const deadline = Date.now() + BUDGET_MS;
  const saved = await loadSavedReviews();

  const first = await draftOnce(key, answers, saved, 0.3, false, Math.min(FIRST_DRAFT_MS, deadline - Date.now()));
  if (!first) return json({ ok: false, fallback: true, text: fallback.text }, 200);
  const firstScore = maxSimilarity(first, saved);
  if (firstScore < NEAR_MATCH_THRESHOLD) return json({ ok: true, fallback: false, text: first }, 200);

  console.warn(`[write-customer-review] near-match retry: score=${firstScore.toFixed(2)}`);
  const second = await draftOnce(key, answers, saved, 0.7, true, deadline - Date.now());
  if (second) {
    const secondScore = maxSimilarity(second, saved);
    if (secondScore < NEAR_MATCH_THRESHOLD) return json({ ok: true, fallback: false, text: second }, 200);
    console.warn(`[write-customer-review] near-match after retry: score=${secondScore.toFixed(2)}; using answers`);
  }
  // The customer's own words. If these still read close to a saved review,
  // the insert trigger flags it for Jordan; nothing is blocked here.
  return json({ ok: false, fallback: true, text: fallback.text }, 200);
});
