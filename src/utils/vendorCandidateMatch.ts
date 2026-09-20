// Candidate ranking for vendor gap resolution.
//
// PURPOSE: a store's order-guide line carries a description written in the
// vendor's vocabulary ("BROOM HEAD 9\" BLUE"), while our catalog uses the
// operator's vocabulary ("Broom Head Replacement"). Name similarity alone was
// measured and FAILED badly (best score 0.46, with nonsense top hits). So this
// module ranks by physical/commercial attributes instead:
//
//   normalized pack size  →  category family  →  price proximity  →  brand name
//
// RANKING ONLY. Nothing here creates, links, or merges anything. Every result
// is a suggestion a human confirms in the gap screen.

/**
 * Normalize a vendor pack string so "1/1 CT", "1/1CT" and "1 / 1 ct." compare equal.
 * Our inventory rows and PFG's guide rows disagree on whitespace and case only;
 * before this, every pack comparison silently scored zero.
 */
export function normalizePackSize(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw)
    .toUpperCase()
    .replace(/\s+/g, '')      // "1/1 CT" -> "1/1CT"
    .replace(/\.+$/, '')      // "48 CT." -> "48CT"
    .trim();
}

/** Coarse category family: first alphabetic token, lowercased. "Paper Goods" -> "paper" */
export function categoryFamily(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = String(raw).toLowerCase().match(/[a-z]+/);
  return m ? m[0] : '';
}

export interface CandidateInput {
  /** The vendor order-guide line we are trying to place. */
  gap: {
    packSize?: string | null;
    categoryName?: string | null;
    brand?: string | null;
    /** Guide unit price, when known. */
    price?: number | null;
  };
  /** One of the store's unpriced items, a possible owner of that number. */
  candidate: {
    packSize?: string | null;
    category?: string | null;
    /** Price the same brand item carries at a sibling store that is already solved. */
    siblingPrice?: number | null;
  };
}

export interface CandidateScore {
  score: number;          // 0..1
  reasons: string[];      // plain-language, shown in the UI
  packMatch: boolean;
}

const PRICE_WINDOW = 0.3;  // ±30%

/**
 * Score one candidate against one gap line. Weights reflect how discriminating
 * each signal proved on real data: pack size is the strongest, price proximity
 * against a solved sibling store next, category family and brand name are tie-breakers.
 */
export function scoreCandidate({ gap, candidate }: CandidateInput): CandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const gapPack = normalizePackSize(gap.packSize);
  const candPack = normalizePackSize(candidate.packSize);
  const packMatch = !!gapPack && gapPack === candPack;
  if (packMatch) {
    score += 0.5;
    reasons.push(`Same pack size (${candidate.packSize})`);
  }

  const gapFam = categoryFamily(gap.categoryName);
  const candFam = categoryFamily(candidate.category);
  if (gapFam && gapFam === candFam) {
    score += 0.2;
    reasons.push('Same category');
  }

  const sibling = candidate.siblingPrice;
  const guide = gap.price;
  if (sibling != null && sibling > 0 && guide != null && guide > 0) {
    const ratio = guide / sibling;
    if (ratio >= 1 - PRICE_WINDOW && ratio <= 1 + PRICE_WINDOW) {
      score += 0.2;
      reasons.push(`Price within 30% of another store ($${sibling.toFixed(2)})`);
    }
  }

  const gapBrand = (gap.brand || '').toLowerCase().trim();
  if (gapBrand.length >= 3) {
    const candText = `${candidate.packSize || ''} ${candidate.category || ''}`.toLowerCase();
    if (candText.includes(gapBrand)) {
      score += 0.1;
      reasons.push('Same vendor brand');
    }
  }

  return { score: Math.min(score, 1), reasons, packMatch };
}

/**
 * Rank candidates, strongest first. Returns only candidates with some evidence —
 * an empty list is a meaningful answer ("this line probably isn't one of ours").
 */
export function rankCandidates<T extends CandidateInput['candidate']>(
  gap: CandidateInput['gap'],
  candidates: T[],
  limit = 3,
): Array<{ candidate: T } & CandidateScore> {
  return candidates
    .map(candidate => ({ candidate, ...scoreCandidate({ gap, candidate }) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
