// Store-scoped Toast → CrooHQ auto-match.
// One pure decision. toast-sync is the only writer. Manual rows are never rewritten.
//
// Tiers, in order, only among people on that location's roster:
//   1. An existing manual row wins, linked or unlinked. Auto does not touch it.
//   2. Email or phone, only when the Toast payload actually has one.
//   3. Normalized exact full name. Two people with the same name is ambiguous.
//   4. Fuzzy: Levenshtein distance <= 2 on the normalized full name, or the same
//      last name plus a nickname-equivalent first name.
// A tier links only when exactly one roster person qualifies and that person is
// not already linked to a different Toast id at the store. Two or more is
// ambiguous and later tiers do not run. Zero moves to the next tier. Never guess.

export type MatchMethod = "email" | "phone" | "exact_name" | "levenshtein" | "nickname";

export type MatchOutcome =
  | "linked"
  | "ambiguous"
  | "none"
  | "skipped_manual"
  | "skipped_linked"
  | "skipped_taken";

export type RosterPerson = {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
};

export type MatchCandidate = {
  userId: string;
  fullName: string;
  method: MatchMethod;
  score: number;
};

export type MatchDecision = {
  outcome: MatchOutcome;
  method: MatchMethod | null;
  score: number | null;
  crooUserId: string | null;
  candidates: MatchCandidate[];
};

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** Groups of equivalent given names. Matching is symmetric inside a group. */
const NICKNAME_GROUPS: string[][] = [
  ["mike", "michael"],
  ["bill", "william", "will", "billy"],
  ["liz", "elizabeth", "beth", "betty", "eliza"],
  ["kate", "katherine", "kathryn", "kathy", "katie", "catherine"],
  ["bob", "robert", "rob", "bobby"],
  ["jim", "james", "jimmy"],
  ["joe", "joseph", "joey"],
  ["tom", "thomas", "tommy"],
  ["dave", "david"],
  ["dan", "daniel", "danny"],
  ["chris", "christopher"],
  ["matt", "matthew"],
  ["alex", "alexander", "alexandra"],
  ["sam", "samuel", "samantha"],
  ["nick", "nicholas"],
  ["steve", "steven", "stephen"],
  ["tony", "anthony"],
  ["andy", "andrew"],
  ["ben", "benjamin"],
  ["jen", "jennifer", "jenny"],
  ["jess", "jessica"],
  ["meg", "megan"],
  ["maggie", "margaret"],
  ["pat", "patrick", "patricia"],
  ["sue", "susan"],
  ["tim", "timothy"],
  ["rick", "richard"],
  ["john", "jon", "johnny"],
  ["nate", "nathan", "nathaniel"],
  ["abby", "abigail"],
  ["becky", "rebecca"],
  ["chuck", "charles", "charlie"],
  ["ed", "edward", "eddie"],
  ["ted", "theodore"],
  ["greg", "gregory"],
  ["jeff", "jeffrey"],
  ["ken", "kenneth"],
  ["larry", "lawrence"],
  ["ron", "ronald"],
  ["josh", "joshua"],
  ["zach", "zachary"],
  ["vicky", "victoria"],
  ["mandy", "amanda"],
  ["cindy", "cynthia"],
  ["debbie", "deborah", "deb"],
  ["angie", "angela"],
];

const NICKNAME_OF = new Map<string, Set<string>>();
for (const group of NICKNAME_GROUPS) {
  const set = new Set(group);
  for (const name of group) NICKNAME_OF.set(name, set);
}

export function normEmail(value: unknown): string {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s.includes("@") || s.length > 200 || /\s/.test(s)) return "";
  return s;
}

/** Last 10 digits when the number is long enough to be a phone. Shorter values do not match. */
export function normPhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function suffixToken(token: string): string {
  return token.replace(/\./g, "");
}

/**
 * Lowercase, trim, collapse whitespace, strip punctuation, drop Jr/Sr/II/III/IV,
 * and flip "Last, First" to "First Last". A trailing ", Jr" stays a suffix, not a flip.
 */
export function normalizeMatchName(raw: unknown): string {
  let s = String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  const comma = s.indexOf(",");
  if (comma !== -1) {
    const left = s.slice(0, comma).trim();
    const right = s.slice(comma + 1).trim();
    const rightTokens = right.split(/\s+/).filter(Boolean);
    const suffixOnly = rightTokens.length > 0 && rightTokens.every((token) => SUFFIXES.has(suffixToken(token)));
    if (!suffixOnly && left && right) s = `${right} ${left}`;
    else s = left;
  }
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const bits = s.split(" ").filter(Boolean);
  const withoutSuffix = bits.filter((token) => !SUFFIXES.has(token));
  return (withoutSuffix.length ? withoutSuffix : bits).join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function nameParts(normalized: string): { first: string; last: string } | null {
  const bits = normalized.split(" ").filter(Boolean);
  if (bits.length < 2) return null;
  return { first: bits[0], last: bits[bits.length - 1] };
}

export function nicknameEquivalent(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const group = NICKNAME_OF.get(a);
  return !!group && group.has(b);
}

function finish(candidates: MatchCandidate[], linkedUserIds: Set<string>): MatchDecision {
  if (candidates.length >= 2) {
    const methods = new Set(candidates.map((c) => c.method));
    return {
      outcome: "ambiguous",
      method: methods.size === 1 ? candidates[0].method : null,
      score: null,
      crooUserId: null,
      candidates,
    };
  }
  const only = candidates[0];
  if (linkedUserIds.has(only.userId)) {
    return {
      outcome: "skipped_taken",
      method: only.method,
      score: only.score,
      crooUserId: null,
      candidates,
    };
  }
  return {
    outcome: "linked",
    method: only.method,
    score: only.score,
    crooUserId: only.userId,
    candidates,
  };
}

function contactCandidates(toastEmail: string, toastPhone: string, roster: RosterPerson[]): MatchCandidate[] {
  const hits: MatchCandidate[] = [];
  for (const person of roster) {
    const email = normEmail(person.email);
    const phone = normPhone(person.phone);
    if (toastEmail && email && email === toastEmail) {
      hits.push({ userId: person.id, fullName: person.fullName, method: "email", score: 0 });
    } else if (toastPhone && phone && phone === toastPhone) {
      hits.push({ userId: person.id, fullName: person.fullName, method: "phone", score: 0 });
    }
  }
  return hits;
}

function exactCandidates(target: string, roster: RosterPerson[]): MatchCandidate[] {
  const hits: MatchCandidate[] = [];
  for (const person of roster) {
    const name = normalizeMatchName(person.fullName);
    if (name && name === target) hits.push({ userId: person.id, fullName: person.fullName, method: "exact_name", score: 0 });
  }
  return hits;
}

function fuzzyCandidates(target: string, roster: RosterPerson[]): MatchCandidate[] {
  const targetParts = nameParts(target);
  const hits: MatchCandidate[] = [];
  for (const person of roster) {
    const name = normalizeMatchName(person.fullName);
    if (!name || name === target) continue;
    const distance = levenshtein(target, name);
    if (distance <= 2) {
      hits.push({ userId: person.id, fullName: person.fullName, method: "levenshtein", score: distance });
      continue;
    }
    const parts = nameParts(name);
    if (targetParts && parts && parts.last === targetParts.last && nicknameEquivalent(targetParts.first, parts.first)) {
      hits.push({ userId: person.id, fullName: person.fullName, method: "nickname", score: 0 });
    }
  }
  return hits;
}

export function matchToastEmployee(args: {
  toastName: string;
  email?: string | null;
  phone?: string | null;
  roster: RosterPerson[];
  existing?: { matchMethod: string | null; crooUserId: string | null } | null;
  linkedUserIds?: Iterable<string>;
}): MatchDecision {
  const existing = args.existing ?? null;
  if (existing?.matchMethod === "manual") {
    return {
      outcome: "skipped_manual",
      method: null,
      score: null,
      crooUserId: existing.crooUserId,
      candidates: [],
    };
  }
  if (existing?.crooUserId) {
    return {
      outcome: "skipped_linked",
      method: null,
      score: null,
      crooUserId: existing.crooUserId,
      candidates: [],
    };
  }

  const linkedUserIds = new Set(args.linkedUserIds ?? []);
  const toastEmail = normEmail(args.email);
  const toastPhone = normPhone(args.phone);
  if (toastEmail || toastPhone) {
    const hits = contactCandidates(toastEmail, toastPhone, args.roster);
    if (hits.length > 0) return finish(hits, linkedUserIds);
  }

  const target = normalizeMatchName(args.toastName);
  if (!target) {
    return { outcome: "none", method: null, score: null, crooUserId: null, candidates: [] };
  }
  const exact = exactCandidates(target, args.roster);
  if (exact.length > 0) return finish(exact, linkedUserIds);
  const fuzzy = fuzzyCandidates(target, args.roster);
  if (fuzzy.length > 0) return finish(fuzzy, linkedUserIds);
  return { outcome: "none", method: null, score: null, crooUserId: null, candidates: [] };
}
