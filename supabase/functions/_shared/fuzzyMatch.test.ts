import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bestMatches, closest, matchTier, normalize } from "./fuzzyMatch.ts";

const titles = ["Opening Checklist", "AM Line Check", "De-Ice Machine", "Shift Change Line Check", "Check Lobby"];

Deno.test("normalize strips punctuation and filler", () => {
  assertEquals(normalize("The Opening Checklist, please!"), "opening");
});
Deno.test("tiers", () => {
  assertEquals(matchTier("opening checklist", "Opening Checklist"), 1);
  assertEquals(matchTier("line", "AM Line Check"), 2);
  assertEquals(matchTier("icing", "De-Ice Machine"), 3);
  assertEquals(matchTier("lobyy", "Check Lobby"), 4);
  assertEquals(matchTier("pizza", "Check Lobby"), 0);
});
Deno.test("best tier wins", () => {
  assertEquals(bestMatches("am line", titles), ["AM Line Check"]);
  assertEquals(bestMatches("icing", titles), ["De-Ice Machine"]);
  assertEquals(bestMatches("zzz", titles), []);
});
Deno.test("did you mean", () => {
  assertEquals(closest("shift chnge", titles, 2)[0], "Shift Change Line Check");
  assertEquals(closest("x", titles).length, 5);
});
