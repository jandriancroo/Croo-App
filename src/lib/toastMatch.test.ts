import { describe, expect, it } from "vitest";
import {
  levenshtein,
  matchToastEmployee,
  nicknameEquivalent,
  normEmail,
  normPhone,
  normalizeMatchName,
  type RosterPerson,
} from "../../supabase/functions/_shared/toastMatch";

const person = (id: string, fullName: string, extra: Partial<RosterPerson> = {}): RosterPerson => ({
  id,
  fullName,
  ...extra,
});

describe("normalizeMatchName", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeMatchName("  Dolly   Rusk ")).toBe("dolly rusk");
  });

  it("strips punctuation", () => {
    expect(normalizeMatchName("Mary-Jane O'Brien")).toBe("mary jane o brien");
  });

  it("drops Jr, Sr, II, III, and IV", () => {
    expect(normalizeMatchName("Dolly Rusk Jr.")).toBe("dolly rusk");
    expect(normalizeMatchName("Dolly Rusk, Jr")).toBe("dolly rusk");
    expect(normalizeMatchName("Dolly Rusk Sr")).toBe("dolly rusk");
    expect(normalizeMatchName("John Smith II")).toBe("john smith");
    expect(normalizeMatchName("John Smith III")).toBe("john smith");
    expect(normalizeMatchName("John Smith IV")).toBe("john smith");
  });

  it("flips Last, First to First Last", () => {
    expect(normalizeMatchName("Rusk, Dolly")).toBe("dolly rusk");
    expect(normalizeMatchName("RUSK,  DOLLY")).toBe("dolly rusk");
    expect(normalizeMatchName("Rusk, Dolly Jr.")).toBe("dolly rusk");
    expect(normalizeMatchName("Smith, John IV")).toBe("john smith");
  });
});

describe("contact normalization", () => {
  it("keeps a real email and the last 10 phone digits", () => {
    expect(normEmail(" Jordan@CrooHQ.com ")).toBe("jordan@croohq.com");
    expect(normEmail("not an email")).toBe("");
    expect(normPhone("+1 (608) 555-0101")).toBe("6085550101");
    expect(normPhone("555-0101")).toBe("");
  });
});

describe("matchToastEmployee", () => {
  const dolly = person("dolly-1", "Dolly Rusk");

  it("links an exact normalized name", () => {
    const decision = matchToastEmployee({
      toastName: "  Rusk, Dolly Jr. ",
      roster: [dolly, person("other", "Kayla Krogh")],
    });
    expect(decision).toMatchObject({ outcome: "linked", method: "exact_name", score: 0, crooUserId: "dolly-1" });
  });

  it("does not link two identical normalized names", () => {
    const decision = matchToastEmployee({
      toastName: "Dolly Rusk",
      roster: [dolly, person("dolly-2", "Rusk, Dolly")],
    });
    expect(decision.outcome).toBe("ambiguous");
    expect(decision.crooUserId).toBeNull();
    expect(decision.candidates.map((c) => c.userId).sort()).toEqual(["dolly-1", "dolly-2"]);
  });

  it("links a one-edit and a two-edit typo, and stops at three", () => {
    expect(levenshtein(normalizeMatchName("Dolly Rusk"), normalizeMatchName("Dolly Ruskk"))).toBe(1);
    expect(levenshtein(normalizeMatchName("Dolly Rusk"), normalizeMatchName("Dolly Rxxk"))).toBe(2);
    const one = matchToastEmployee({ toastName: "Dolly Ruskk", roster: [dolly] });
    const two = matchToastEmployee({ toastName: "Dolly Rxxk", roster: [dolly] });
    const three = matchToastEmployee({ toastName: "Dolly Rxxx", roster: [dolly] });
    expect(one).toMatchObject({ outcome: "linked", method: "levenshtein", score: 1, crooUserId: "dolly-1" });
    expect(two).toMatchObject({ outcome: "linked", method: "levenshtein", score: 2, crooUserId: "dolly-1" });
    expect(three.outcome).toBe("none");
  });

  it("treats two close names as ambiguous", () => {
    const decision = matchToastEmployee({
      toastName: "Dolly Rusk",
      roster: [person("a", "Dolly Ruskk"), person("b", "Dolly Rxxk")],
    });
    expect(decision.outcome).toBe("ambiguous");
    expect(decision.crooUserId).toBeNull();
  });

  it("links nickname pairs with the same last name", () => {
    expect(nicknameEquivalent("mike", "michael")).toBe(true);
    const cases: Array<[string, string]> = [
      ["Mike Smith", "Michael Smith"],
      ["Bill Johnson", "William Johnson"],
      ["Liz Brown", "Elizabeth Brown"],
      ["Kate Adams", "Katherine Adams"],
    ];
    for (const [toastName, fullName] of cases) {
      const decision = matchToastEmployee({ toastName, roster: [person("p", fullName)] });
      expect(decision).toMatchObject({ outcome: "linked", method: "nickname", score: 0, crooUserId: "p" });
    }
  });

  it("does not nickname-match a different last name", () => {
    const decision = matchToastEmployee({
      toastName: "Mike Smith",
      roster: [person("p", "Michael Jones")],
    });
    expect(decision.outcome).toBe("none");
  });

  it("prefers the exact name over a nickname twin", () => {
    const decision = matchToastEmployee({
      toastName: "Mike Smith",
      roster: [person("exact", "Mike Smith"), person("nick", "Michael Smith")],
    });
    expect(decision).toMatchObject({ outcome: "linked", method: "exact_name", crooUserId: "exact" });
  });

  it("uses email or phone when Toast sends them, and skips the tier when it does not", () => {
    const roster = [
      person("mail", "Someone Else", { email: "kayla@coops.example" }),
      person("name", "Kayla Krogh", { email: "other@coops.example", phone: "6085550199" }),
    ];
    const byEmail = matchToastEmployee({
      toastName: "Totally Different",
      email: "Kayla@Coops.example",
      roster,
    });
    expect(byEmail).toMatchObject({ outcome: "linked", method: "email", score: 0, crooUserId: "mail" });
    const byPhone = matchToastEmployee({
      toastName: "Totally Different",
      phone: "+1 608-555-0199",
      roster,
    });
    expect(byPhone).toMatchObject({ outcome: "linked", method: "phone", score: 0, crooUserId: "name" });
    const noContact = matchToastEmployee({ toastName: "Kayla Krogh", roster });
    expect(noContact).toMatchObject({ outcome: "linked", method: "exact_name", crooUserId: "name" });
  });

  it("leaves a manual row alone, including a manual unlink", () => {
    const linked = matchToastEmployee({
      toastName: "Dolly Rusk",
      roster: [dolly],
      existing: { matchMethod: "manual", crooUserId: "kept" },
    });
    expect(linked).toMatchObject({ outcome: "skipped_manual", crooUserId: "kept" });
    const unlinked = matchToastEmployee({
      toastName: "Dolly Rusk",
      roster: [dolly],
      existing: { matchMethod: "manual", crooUserId: null },
    });
    expect(unlinked).toMatchObject({ outcome: "skipped_manual", crooUserId: null });
  });

  it("does not relink someone who already has an auto link", () => {
    const decision = matchToastEmployee({
      toastName: "Dolly Rusk",
      roster: [dolly, person("better", "Dolly Rusk")],
      existing: { matchMethod: "auto", crooUserId: "already" },
    });
    expect(decision).toMatchObject({ outcome: "skipped_linked", crooUserId: "already" });
  });

  it("does not auto-link a CrooHQ user already linked to another Toast id", () => {
    const decision = matchToastEmployee({
      toastName: "Dolly Rusk",
      roster: [dolly],
      linkedUserIds: ["dolly-1"],
    });
    expect(decision).toMatchObject({ outcome: "skipped_taken", crooUserId: null, method: "exact_name" });
  });

  it("stays ambiguous when one of two identical names is already linked", () => {
    const decision = matchToastEmployee({
      toastName: "Dolly Rusk",
      roster: [dolly, person("dolly-2", "Dolly Rusk")],
      linkedUserIds: ["dolly-1"],
    });
    expect(decision.outcome).toBe("ambiguous");
    expect(decision.crooUserId).toBeNull();
  });
});
