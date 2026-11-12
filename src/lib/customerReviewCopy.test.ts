import { describe, expect, it } from "vitest";
import {
  acceptDraft,
  inventedNumbers,
  normalizeBrand,
  scrubPublicText,
  stitchFallback,
  SYSTEM_PROMPT,
  type ReviewAnswers,
} from "../../supabase/functions/write-customer-review/combine.ts";
import { HEADACHE, HELPED, interviewSteps, reviewRateLimited, reviewSubmitTimes } from "./customerReviewFlow";
import { reviewRow, submitReview, type ReviewInsert } from "./customerReviewsApi";
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
});
