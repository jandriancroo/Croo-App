import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  acceptDraft,
  hasAnyReviewAnswers,
  hasSetBAnswers,
  inventedNumbers,
  normalizeBrand,
  scrubPublicText,
  stitchFallback,
  SYSTEM_PROMPT,
  userPrompt,
  type ReviewAnswers,
} from "../../supabase/functions/write-customer-review/combine.ts";
import { HEADACHE, HELPED, RECOMMEND_TO, SAVED_MOMENT, SHIFT_BEFORE_AFTER, TEAM_NOTICED, interviewSteps, reviewRateLimited, reviewSubmitTimes } from "./customerReviewFlow";
import { draftReview, reviewRow, submitReview, type ReviewInsert } from "./customerReviewsApi";
import { EMPTY_REVIEW_FORM } from "./customerReviewFlow";

const answers: ReviewAnswers = {
  name: "Ada Owner",
  role: "Owner",
  restaurant: "Pine Street Pizza",
  locationCount: "2-5",
  headache: "The schedule lived in a group text.",
  multiLocationSurprise: "The Tuesday problem was never the same in both stores.",
  feature: "Scheduling",
  featureNote: "",
  helped: "Crew HQ keeps Saturday on one list.",
  theo: "I ask who can close.",
  advice: "I would tell another operator to start with the schedule.",
  anythingElse: "",
  shiftBeforeAfter: "",
  savedMoment: "",
  teamNoticed: "",
  recommendTo: "",
};

const setBAnswers: ReviewAnswers = {
  name: "Bo Manager",
  role: "GM",
  restaurant: "Riverside Bowls",
  locationCount: "1",
  headache: "",
  multiLocationSurprise: "",
  feature: "",
  featureNote: "",
  helped: "",
  theo: "",
  advice: "",
  anythingElse: "The close is quieter now.",
  shiftBeforeAfter: "Before CrooHQ the close lived on sticky notes. Now the list is on my phone.",
  savedMoment: "It saved me when two closers called out on the same Saturday.",
  teamNoticed: "My managers noticed the openers actually finish the list.",
  recommendTo: "I would recommend it to a first-time owner who is still running the shop from a group text.",
};

describe("customer review copy", () => {
  it("spells the product CrooHQ and leaves ordinary words alone", () => {
    expect(normalizeBrand("QHQ, Crew HQ, Croo HQ, and CrewHQ")).toBe("CrooHQ, CrooHQ, CrooHQ, and CrooHQ");
    expect(normalizeBrand("croohq")).toBe("CrooHQ");
    expect(normalizeBrand("the crew stayed late")).toBe("the crew stayed late");
  });

  it("drops POS vendor names, hype punctuation, and rip and replace", () => {
    const text = scrubPublicText("Toast was a rip and replace and Crew HQ is calmer!");
    expect(text).not.toMatch(/toast/i);
    expect(text).not.toMatch(/rip and replace/i);
    expect(text).toContain("CrooHQ");
    expect(text).not.toContain("!");
    const kept = scrubPublicText("We gained square footage after leaving Touch Bistro.");
    expect(kept).toContain("square footage");
    expect(kept).not.toMatch(/touch bistro/i);
  });

  it("keeps the draft only when every number came from the customer", () => {
    expect(inventedNumbers("We run 2 stores.", "Locations: 2-5")).toBe(false);
    expect(inventedNumbers("It saved 40 hours.", "It saved the close.")).toBe(true);
    const rejected = acceptDraft("CrooHQ cut my labor by 40 percent and replaced the whole stack.", answers);
    expect(rejected.drafted).toBe(false);
    expect(rejected.text).not.toMatch(/40/);
    const kept = acceptDraft(
      "The schedule lived in a group text. CrooHQ keeps Saturday on one list. I would tell another operator to start with the schedule.",
      answers,
    );
    expect(kept.drafted).toBe(true);
    expect(kept.text).toContain("CrooHQ");
  });

  it("builds a fallback from their words only", () => {
    const text = stitchFallback(answers);
    expect(text).toContain("group text");
    expect(text).toContain("CrooHQ");
    expect(text).not.toMatch(/\$|saved you time, money or stress/i);
  });

  it("asks the multi-location question only for two or more stores", () => {
    expect(interviewSteps("1")).not.toContain("multi");
    expect(interviewSteps("2-5")).toEqual(["intro", "who", "headache", "multi", "feature", "helped", "theo", "advice", "else"]);
    expect(interviewSteps("6+")).toContain("multi");
    expect(HEADACHE).toBe("What was the biggest headache in running your store before CrooHQ?");
    expect(HELPED).toBe("How has CrooHQ helped?");
    expect(SYSTEM_PROMPT).toContain("Always spell the product CrooHQ");
    expect(SYSTEM_PROMPT).toContain("rip and replace");
  });

  it("rate-limits three submits an hour and posts consent with a minimal return", async () => {
    const now = 1_700_000_000_000;
    const storage = { value: "", getItem: () => storage.value, setItem: (key: string, next: string) => { storage.value = next; void key; } };
    storage.setItem("croohq-review-submits", JSON.stringify([now - 1000, now - 2000, now - 3000]));
    expect(reviewSubmitTimes(storage, now)).toHaveLength(3);
    expect(reviewRateLimited(storage, now)).toBe(true);

    const fetchMock = async (url: string, init: RequestInit) => {
      expect(url).toBe("https://example.test/rest/v1/customer_reviews");
      expect(new Headers(init.headers).get("Prefer")).toBe("return=minimal");
      const body = JSON.parse(String(init.body)) as ReviewInsert;
      expect(body.consent).toBe(true);
      expect(body.final_text).toContain("CrooHQ");
      expect(body.final_text).not.toMatch(/toast/i);
      return new Response(null, { status: 201 });
    };
    const row = reviewRow({
      ...EMPTY_REVIEW_FORM,
      name: "Ada Owner",
      role: "Owner",
      restaurant: "Pine Street Pizza",
      locationCount: "1",
      finalText: "Crew HQ replaced Toast for the close.",
      consent: true,
    });
    await submitReview(row, { fetch: fetchMock as typeof fetch, url: "https://example.test", key: "anon" });
  });

  it("sends the honeypot and the anon bearer to the draft function", async () => {
    let seen: { url: string; authorization: string | null; company: string } | undefined;
    const fetchMock = async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen = { url, authorization: new Headers(init.headers).get("Authorization"), company: body.company_website };
      return new Response(JSON.stringify({ ok: false, text: "" }), { status: 200 });
    };
    await draftReview(answers, { fetch: fetchMock as typeof fetch, url: "https://example.test", key: "anon-key" }, "https://spam.example");
    expect(seen?.url).toBe("https://example.test/functions/v1/write-customer-review");
    expect(seen?.authorization).toBe("Bearer anon-key");
    expect(seen?.company).toBe("https://spam.example");
  });

  it("stores new reviews as pending and lists at most 12 approved quotes", () => {
    const sql = readFileSync("supabase/migrations/20261112120000_customer_reviews.sql", "utf8");
    expect(sql).toContain("default 'pending'");
    expect(sql).toContain("status in ('pending', 'approved', 'hidden')");
    expect(sql).toContain("new.status := 'pending'");
    expect(sql).toContain("new.id := gen_random_uuid()");
    expect(sql).toContain("new.created_at := now()");
    expect(sql).toContain("limit 12");
    expect(sql).toContain("interval '1 hour'");
    expect(sql).toContain("set status = 'approved'");
    expect(sql).toContain("touch\\s+bistro");
    expect(sql).not.toContain("|square)");
  });

  it("drafts Set B from those answers and stitches a fallback from them", () => {
    expect(SHIFT_BEFORE_AFTER).toBe("What did a normal shift look like before CrooHQ, and what's different now?");
    expect(SAVED_MOMENT).toBe("Tell us about one moment CrooHQ saved you.");
    expect(TEAM_NOTICED).toBe("What have your team or managers noticed since you started using it?");
    expect(RECOMMEND_TO).toBe("Who would you recommend CrooHQ to, and why?");
    expect(interviewSteps("1", "B")).toEqual(["intro", "who", "shift", "moment", "team", "recommend", "else"]);
    expect(interviewSteps("6+", "B")).not.toContain("multi");
    expect(hasSetBAnswers(setBAnswers)).toBe(true);
    expect(hasAnyReviewAnswers(setBAnswers)).toBe(true);
    expect(hasAnyReviewAnswers({ ...setBAnswers, shiftBeforeAfter: "", savedMoment: "", teamNoticed: "", recommendTo: "", anythingElse: "" })).toBe(false);

    const prompt = userPrompt(setBAnswers);
    expect(prompt).toContain("What a normal shift looked like before vs now");
    expect(prompt).toContain("sticky notes");
    expect(prompt).not.toContain("Biggest headache before CrooHQ");
    expect(SYSTEM_PROMPT).toContain("natural, specific wording in the customer's own phrasing");

    const text = stitchFallback(setBAnswers);
    expect(text).toContain("sticky notes");
    expect(text).toContain("two closers");
    expect(text).toContain("CrooHQ");
    expect(text).not.toContain("!");

    const rejected = acceptDraft("CrooHQ cut my labor by 40 percent and replaced the whole stack.", setBAnswers);
    expect(rejected.drafted).toBe(false);
    expect(rejected.text).not.toMatch(/40/);
    const kept = acceptDraft(
      "Before CrooHQ the close lived on sticky notes. Now the list is on my phone. It saved me when two closers called out on the same Saturday.",
      setBAnswers,
    );
    expect(kept.drafted).toBe(true);
    expect(kept.text).toContain("sticky notes");
  });

  it("flags near-matches at 0.6 trigram similarity and keeps reviews pending", () => {
    const sql = readFileSync("supabase/migrations/20261113210000_customer_review_question_sets.sql", "utf8");
    expect(sql).toContain("question_set");
    expect(sql).toContain("near_match");
    expect(sql).toContain("_match_score >= 0.6");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("next_customer_review_question_set");
    expect(sql).toContain("Heads up: this reads very close to");
    expect(sql).toContain("new.status := 'pending'");
    expect(sql).toContain("revoke all on function public.next_customer_review_question_set()");
    expect(sql).toContain("grant execute on function public.next_customer_review_question_set() to anon, authenticated, service_role");
    expect(sql).not.toContain("dangerouslySetInnerHTML");
    const claims = readFileSync("supabase/migrations/20261113210100_shift_offer_claims_store_scope.sql", "utf8");
    expect(claims).toContain('drop policy "Anyone can view shift claims"');
    expect(claims).toContain('create policy "Users can view shift claims at their locations"');
    expect(claims).toContain("has_location_access(auth.uid(), s.location_id)");
  });
});
