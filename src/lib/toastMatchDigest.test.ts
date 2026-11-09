import { describe, expect, it } from "vitest";
import { renderEmailHeader } from "../../supabase/functions/_shared/emailHeader";
import {
  collectDigestItems,
  renderToastMatchDigest,
  storeDigestSlot,
  TOAST_MATCH_DIGEST_TO,
  TOAST_MATCH_TEAM_URL,
} from "../../supabase/functions/_shared/toastMatchDigest";

const CHICAGO = "America/Chicago";

describe("storeDigestSlot", () => {
  it("opens an overnight window at 2 AM store time and a midday window at noon", () => {
    const overnight = storeDigestSlot(new Date("2026-11-09T08:00:00.000Z"), CHICAGO);
    expect(overnight).toMatchObject({ slot: "overnight", localDate: "2026-11-09" });
    expect(overnight?.windowStart.toISOString()).toBe("2026-11-08T18:00:00.000Z");

    const midday = storeDigestSlot(new Date("2026-11-09T18:00:00.000Z"), CHICAGO);
    expect(midday).toMatchObject({ slot: "midday", localDate: "2026-11-09" });
    expect(midday?.windowStart.toISOString()).toBe("2026-11-09T08:00:00.000Z");

    expect(storeDigestSlot(new Date("2026-11-09T17:30:00.000Z"), CHICAGO)).toBeNull();
    expect(storeDigestSlot(new Date("2026-11-09T10:00:00.000Z"), "America/Los_Angeles")?.slot).toBe("overnight");
  });

  it("keeps the whole local hour so a 15-minute tick still sends", () => {
    expect(storeDigestSlot(new Date("2026-11-09T08:45:00.000Z"), CHICAGO)?.slot).toBe("overnight");
    expect(storeDigestSlot(new Date("2026-11-09T18:50:00.000Z"), CHICAGO)?.slot).toBe("midday");
  });
});

describe("collectDigestItems", () => {
  const now = new Date("2026-11-09T18:00:00.000Z");
  const windowStart = new Date("2026-11-09T08:00:00.000Z");

  it("returns auto-links from this window and people unseen-linked for 24 hours", () => {
    const items = collectDigestItems({
      now,
      windowStart,
      profiles: [{ id: "kayla", full_name: "Kayla Krogh" }],
      attempts: [
        {
          toast_user_id: "name:Krogh, Kayla",
          toast_name: "Kayla Krogh",
          outcome: "linked",
          method: "exact_name",
          score: 0,
          croo_user_id: "kayla",
          candidates: [{ user_id: "kayla", full_name: "Kayla Krogh", method: "exact_name", score: 0 }],
          created_at: "2026-11-09T14:00:00.000Z",
        },
        {
          toast_user_id: "name:Old, Link",
          toast_name: "Old Link",
          outcome: "linked",
          method: "nickname",
          score: 0,
          croo_user_id: "old",
          candidates: [],
          created_at: "2026-11-09T07:00:00.000Z",
        },
        {
          toast_user_id: "name:Rusk, Dolly",
          toast_name: "Dolly Rusk",
          outcome: "ambiguous",
          method: "exact_name",
          score: null,
          croo_user_id: null,
          candidates: [
            { user_id: "d1", full_name: "Dolly Rusk", method: "exact_name", score: 0 },
            { user_id: "d2", full_name: "Dolly Rusk", method: "exact_name", score: 0 },
          ],
          created_at: "2026-11-01T12:00:00.000Z",
        },
      ],
      employees: [
        { toast_user_id: "name:Rusk, Dolly", toast_name: "Dolly Rusk", first_seen_at: "2026-11-07T18:00:00.000Z", is_active: true },
        { toast_user_id: "name:New, Person", toast_name: "New Person", first_seen_at: "2026-11-09T16:00:00.000Z", is_active: true },
        { toast_user_id: "name:Gone, Person", toast_name: "Gone Person", first_seen_at: "2026-11-01T12:00:00.000Z", is_active: false },
      ],
      mappings: [
        { toast_user_id: "name:Krogh, Kayla", toast_name: "Kayla Krogh", croo_user_id: "kayla", match_method: "auto", first_seen_at: "2026-11-01T12:00:00.000Z" },
        { toast_user_id: "name:Rusk, Dolly", toast_name: "Dolly Rusk", croo_user_id: null, match_method: "unmatched", first_seen_at: "2026-11-07T18:00:00.000Z" },
      ],
    });
    expect(items.links).toHaveLength(1);
    expect(items.links[0]).toMatchObject({ toastName: "Kayla Krogh", profileName: "Kayla Krogh", method: "exact_name", score: 0 });
    expect(items.unmatched.map((row) => row.toastName)).toEqual(["Dolly Rusk"]);
    expect(items.unmatched[0].candidates).toHaveLength(2);
    expect(items.unmatched[0].note).toMatch(/More than one/);
  });

  it("renders one store email and skips the body pieces that are empty", () => {
    expect(TOAST_MATCH_DIGEST_TO).toBe("jordan@croohq.com");
    const header = renderEmailHeader({ title: "Toast matching", line1: "Coop's Hayward", line2: "Midday" });
    const email = renderToastMatchDigest({
      storeName: "Coop's Hayward",
      timeZone: CHICAGO,
      slot: "midday",
      headerHtml: header,
      links: [{
        toastName: "Mike Smith",
        profileName: "Michael Smith",
        method: "nickname",
        score: 0,
        at: new Date("2026-11-09T15:00:00.000Z"),
      }],
      unmatched: [{
        toastName: "Dolly <Rusk>",
        firstSeen: new Date("2026-11-07T18:00:00.000Z"),
        note: "More than one CrooHQ profile matches. Not linked.",
        candidates: [
          { user_id: "d1", full_name: "Dolly Rusk", method: "exact_name", score: 0 },
          { user_id: "d2", full_name: "Dolly Rusk", method: "exact_name", score: 0 },
        ],
      }],
    });
    expect(email.subject).toBe("Coop's Hayward: Toast matching");
    expect(email.html).toContain("Toast matching");
    expect(email.html).toContain("Mike Smith");
    expect(email.html).toContain("Michael Smith");
    expect(email.html).toContain("Nickname · score 0");
    expect(email.html).toContain("Dolly &lt;Rusk&gt;");
    expect(email.html).toContain(TOAST_MATCH_TEAM_URL);
    expect(email.html).not.toContain("<script");
  });
});
