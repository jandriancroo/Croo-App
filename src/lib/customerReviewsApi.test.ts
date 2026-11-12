import { afterEach, describe, expect, it, vi } from "vitest";
import { draftReview, fetchPublicReviews, submitReview, type ReviewInsert } from "./customerReviewsApi";

// Browsers throw "Illegal invocation" when native fetch is called with a `this`
// other than the window (for example obj.fetch()). Node does not, so simulate it.
function browserLikeFetch(response: unknown) {
  return vi.fn(function (this: unknown) {
    if (this !== undefined && this !== globalThis) {
      return Promise.reject(new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"));
    }
    return Promise.resolve(new Response(JSON.stringify(response), { status: 201 }));
  });
}

const deps = { url: "https://example.supabase.co", key: "anon" };
const row: ReviewInsert = {
  name: "A", role: "Owner", restaurant: "R", anonymous: false, display_attribution: "A, Owner, R",
  raw_answers: {}, final_text: "Text.", consent: true,
};

describe("customerReviewsApi uses the global fetch safely", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });

  it("saves a review through the global fetch", async () => {
    const stub = browserLikeFetch(null);
    globalThis.fetch = stub as unknown as typeof fetch;
    await expect(submitReview(row, deps)).resolves.toBeUndefined();
    expect(stub).toHaveBeenCalledTimes(1);
    expect(String((stub.mock.calls[0] as unknown[])[0])).toBe("https://example.supabase.co/rest/v1/customer_reviews");
  });

  it("drafts through the global fetch", async () => {
    const text = "Schedules used to live in a group text. Now swaps get approved from my phone.";
    globalThis.fetch = browserLikeFetch({ ok: true, text }) as unknown as typeof fetch;
    const result = await draftReview({
      name: "A", role: "Owner", restaurant: "R", locationCount: "1",
      headache: "Schedules used to live in a group text.", multiLocationSurprise: "", feature: "Scheduling",
      featureNote: "Swaps get approved from my phone.", helped: "", theo: "", advice: "", anythingElse: "",
    }, deps);
    expect(result).toEqual({ text, drafted: true });
  });

  it("lists reviews through the global fetch", async () => {
    globalThis.fetch = browserLikeFetch([]) as unknown as typeof fetch;
    await expect(fetchPublicReviews(deps)).resolves.toEqual([]);
  });
});
