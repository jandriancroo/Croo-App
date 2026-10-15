// Pure fuzzy matcher for Theo lookups (titles, names). No imports.
// Tiers, best first: exact → contains / all tokens → token prefix or stem → Levenshtein ≤ 2.

export const FILLER_WORDS = new Set(["the", "a", "an", "checklist", "checklists", "task", "tasks", "event", "events", "please"]);

export function tokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !FILLER_WORDS.has(t));
}

export function normalize(s: string): string {
  return tokens(s).join(" ");
}

/** Light stem: icing → ic, ice → ic, temps → temp, checked → check. */
export function stem(w: string): string {
  let s = w;
  for (const suf of ["ing", "ed", "es", "s", "e"]) {
    if (s.length - suf.length >= 2 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const sharedPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

const prefixHit = (q: string, c: string) =>
  stem(q) === stem(c) || sharedPrefix(q, c) >= 3;

const levHit = (q: string, c: string) => {
  const max = Math.min(q.length, c.length) <= 3 ? 1 : 2;
  return levenshtein(q, c) <= max;
};

/** 1 exact, 2 contains/all-tokens, 3 prefix/stem, 4 levenshtein, 0 no match. */
export function matchTier(query: string, candidate: string): number {
  const q = tokens(query), c = tokens(candidate);
  if (q.length === 0 || c.length === 0) return 0;
  const qn = q.join(" "), cn = c.join(" ");
  if (qn === cn) return 1;
  if (cn.includes(qn) || q.every((t) => c.includes(t))) return 2;
  if (q.every((t) => c.some((ct) => prefixHit(t, ct)))) return 3;
  if (q.every((t) => c.some((ct) => levHit(t, ct) || prefixHit(t, ct)))) return 4;
  return 0;
}

/** Candidates at the single best tier found (empty when nothing matches). */
export function bestMatches(query: string, candidates: string[]): string[] {
  const uniq = Array.from(new Set(candidates.filter(Boolean)));
  let best = 0;
  const tiers = uniq.map((c) => {
    const t = matchTier(query, c);
    if (t && (!best || t < best)) best = t;
    return t;
  });
  return best ? uniq.filter((_, i) => tiers[i] === best) : [];
}

/** Up to `limit` closest candidates by word distance, for "Did you mean …?". */
export function closest(query: string, candidates: string[], limit = 5): string[] {
  const q = tokens(query);
  const uniq = Array.from(new Set(candidates.filter(Boolean)));
  const score = (c: string) => {
    const ct = tokens(c);
    if (!ct.length || !q.length) return Infinity;
    return q.reduce((sum, t) => sum + Math.min(...ct.map((w) => (prefixHit(t, w) ? 0 : levenshtein(t, w) / Math.max(t.length, w.length)))), 0);
  };
  return uniq.map((c) => ({ c, s: score(c) })).sort((a, b) => a.s - b.s || a.c.localeCompare(b.c)).slice(0, limit).map((x) => x.c);
}
