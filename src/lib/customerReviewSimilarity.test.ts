import { describe, expect, it } from "vitest";
import {
  avoidSavedBlock,
  clipSavedReviews,
  draftPrompt,
  isNearMatch,
  MAX_SAVED_REVIEWS,
  MAX_TEXT,
  maxSimilarity,
  NEAR_MATCH_THRESHOLD,
  SAVED_REVIEW_CLIP,
  SYSTEM_PROMPT,
  TOO_CLOSE_NOTE,
  trigrams,
  trigramSimilarity,
  userPrompt,
  clipAnswers,
} from "../../supabase/functions/write-customer-review/combine.ts";

describe("trigram similarity (mirrors pg_trgm)", () => {
  it("builds padded word trigrams like pg_trgm show_trgm", () => {
    // select show_trgm('cat') -> {"  c"," ca","at ",cat}
    expect([...trigrams("cat")].sort()).toEqual(["  c", " ca", "at ", "cat"].sort());
    // Case and punctuation are ignored; repeats count once.
    expect(trigrams("Cat, CAT!")).toEqual(trigrams("cat"));
  });

  it("matches values pg_trgm similarity() returns", () => {
    // Checked against live Postgres similarity() on the same literals.
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(0.363636, 5);
    expect(trigramSimilarity("cat", "cat")).toBe(1);
    expect(trigramSimilarity("Café déjà-vu 2nd_shift", "cafe deja vu 2nd shift")).toBeCloseTo(0.586207, 5);
    expect(trigramSimilarity(
      "Scheduling used to live in a group text and now it lives in CrooHQ.",
      "Scheduling used to live in a group text, and now it all lives in CrooHQ.",
    )).toBeCloseTo(0.95, 5);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
    expect(trigramSimilarity("", "anything")).toBe(0);
  });

  it("scores the highest match across saved reviews", () => {
    const saved = [
      "Scheduling used to live in a group text and now it lives in CrooHQ.",
      "The checklist keeps closing honest.",
    ];
    const near = "Scheduling used to live in a group text, and now it all lives in CrooHQ.";
    const fresh = "My managers stopped calling me at 10 at night about who is closing.";
    expect(maxSimilarity(near, saved)).toBeGreaterThanOrEqual(NEAR_MATCH_THRESHOLD);
    expect(isNearMatch(near, saved)).toBe(true);
    expect(isNearMatch(fresh, saved)).toBe(false);
    expect(maxSimilarity(fresh, [])).toBe(0);
  });
});

describe("saved reviews in the draft prompt", () => {
  const answers = clipAnswers({ name: "Ada", headache: "The schedule lived in a group text.", helped: "One list." });

  it("drops blanks and caps count and length", () => {
    const rows = [null, "", "  ", "x".repeat(2000), ...Array.from({ length: 30 }, (_, i) => `Review ${i}`)];
    const saved = clipSavedReviews(rows);
    expect(saved).toHaveLength(MAX_SAVED_REVIEWS);
    expect(saved[0]).toHaveLength(MAX_TEXT);
  });

  it("adds a do-not-reuse block with clipped reviews, and nothing when none exist", () => {
    expect(avoidSavedBlock([])).toBe("");
    expect(draftPrompt(answers)).toBe(userPrompt(answers));
    const block = avoidSavedBlock(["y".repeat(1000), 'She said "hi"']);
    expect(block).toContain("Do not reuse phrasing, openings, or sentence structure from these existing reviews");
    expect(block).toContain(`1. "${"y".repeat(SAVED_REVIEW_CLIP)}"`);
    expect(block).not.toContain("y".repeat(SAVED_REVIEW_CLIP + 1));
    expect(block).toContain(`2. "She said 'hi'"`);
  });

  it("keeps the customer's answers first and adds the retry note only on retry", () => {
    const first = draftPrompt(answers, ["Saved one."]);
    expect(first.startsWith(userPrompt(answers))).toBe(true);
    expect(first).not.toContain(TOO_CLOSE_NOTE);
    expect(draftPrompt(answers, ["Saved one."], true).endsWith(TOO_CLOSE_NOTE)).toBe(true);
  });

  it("keeps the vary-the-wording rules in the system prompt", () => {
    expect(SYSTEM_PROMPT).toContain("natural, specific wording in the customer's own phrasing");
    expect(SYSTEM_PROMPT).toContain("Vary the wording");
  });
});
