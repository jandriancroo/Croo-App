import {
  acceptDraft,
  clipAnswers,
  scrubPublicText,
  stitchFallback,
  type ReviewAnswers,
} from "../../supabase/functions/write-customer-review/combine.ts";
import { attributionLine, displayRole, type ReviewForm } from "./customerReviewFlow";

export type PublicReview = {
  id: string;
  createdAt: string;
  text: string;
  attribution: string;
};

export type ReviewInsert = {
  name: string;
  role: string;
  restaurant: string;
  anonymous: boolean;
  display_attribution: string;
  raw_answers: Record<string, string>;
  final_text: string;
  consent: true;
};

type Deps = { fetch?: typeof fetch; url: string; key: string };
type LiveDeps = { fetch: typeof fetch; url: string; key: string };

function liveDeps(deps?: Deps): LiveDeps | null {
  const url = deps?.url ?? import.meta.env.VITE_SUPABASE_URL;
  const key = deps?.key ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  // Never store the bare global fetch on an object: calling it as obj.fetch()
  // throws "Illegal invocation" in browsers (Node does not care).
  const doFetch: typeof fetch = deps?.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return { fetch: doFetch, url, key };
}

function headers(key: string, prefer?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

export function reviewRow(form: ReviewForm): ReviewInsert {
  const role = displayRole(form);
  return {
    name: form.name.trim(),
    role,
    restaurant: form.restaurant.trim(),
    anonymous: form.anonymous,
    display_attribution: attributionLine({ ...form, role }),
    raw_answers: {
      locationCount: form.locationCount,
      headache: form.headache.trim(),
      multiLocationSurprise: form.locationCount === "1" ? "" : form.multi.trim(),
      feature: form.feature,
      featureNote: form.featureNote.trim(),
      helped: form.helped.trim(),
      theo: form.theo.trim(),
      advice: form.advice.trim(),
      anythingElse: form.elseNote.trim(),
      restaurantType: form.restaurantType.trim(),
      state: form.state.trim(),
    },
    final_text: scrubPublicText(form.finalText),
    consent: true,
  };
}

/** Draft a paragraph. A failed or missing AI call returns their own words, or an empty string. */
export async function draftReview(answers: ReviewAnswers, deps?: Deps, companyWebsite = ""): Promise<{ text: string; drafted: boolean }> {
  const clipped = clipAnswers(answers);
  const fallback = { text: stitchFallback(clipped), drafted: false };
  if (!deps && import.meta.env.MODE === "test") return fallback;
  const live = liveDeps(deps);
  if (!live) return fallback;
  try {
    const response = await live.fetch(`${live.url}/functions/v1/write-customer-review`, {
      method: "POST",
      headers: headers(live.key),
      body: JSON.stringify({ answers: clipped, company_website: companyWebsite }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => null) as { text?: string } | null;
    return acceptDraft(String(data?.text ?? ""), clipped);
  } catch {
    return fallback;
  }
}

/**
 * Save a consented review. The trigger stores it as pending. The /demo form emails Jordan from a function that
 * lives on a different Supabase project and is not in this repo, so this
 * insert does not send mail.
 */
export async function submitReview(row: ReviewInsert, deps?: Deps): Promise<void> {
  if (!deps && import.meta.env.MODE === "test") throw new Error("submitReview is disabled in tests");
  const live = liveDeps(deps);
  if (!live) throw new Error("Reviews aren't available right now.");
  const response = await live.fetch(`${live.url}/rest/v1/customer_reviews`, {
    method: "POST",
    headers: headers(live.key, "return=minimal"),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error("save failed");
}

export async function fetchPublicReviews(deps?: Deps): Promise<PublicReview[]> {
  if (!deps && import.meta.env.MODE === "test") return [];
  const live = liveDeps(deps);
  if (!live) return [];
  const response = await live.fetch(`${live.url}/rest/v1/rpc/list_public_customer_reviews`, {
    method: "POST",
    headers: headers(live.key),
    body: "{}",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("reviews unavailable");
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.flatMap(row => {
    const id = String(row?.id ?? "");
    const text = String(row?.quote ?? "").trim();
    const attribution = String(row?.attribution ?? "").trim();
    if (!id || !text || !attribution) return [];
    return [{ id, createdAt: String(row?.created_at ?? ""), text, attribution }];
  });
}
