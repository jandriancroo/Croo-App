/**
 * Fast local fuzzy matching for inventory voice commands.
 * Supports spoken numbers ("two cases brownies"), multiple items in one
 * transcript ("two cases brownies one case chicken"), and falls back to
 * null only when nothing can be parsed.
 */

interface InventoryItem {
  item_id: string;
  item_name: string;
}

interface VoiceCommand {
  matched_item_id: string;
  item_name: string;
  cases: number;
  units: number;
  confidence: 'high' | 'medium' | 'low';
}

interface FuzzyResult {
  commands: VoiceCommand[];
  usedLocal: boolean;
}

// ── Spoken-number conversion ──────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, oh: 0, o: 0,
  one: 1, a: 1, an: 1,
  two: 2, to: 2, too: 2,
  three: 3, for: 4, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  half: 0.5,
};

/** Convert spoken number words to digits: "twenty three" → "23" */
const spokenToDigits = (text: string): string => {
  // Replace compound spoken numbers (e.g., "twenty three" → "23")
  let result = text;

  // Handle "twenty one" through "ninety nine"
  result = result.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (_, tens, ones) => {
      const t = WORD_NUMBERS[tens.toLowerCase()] || 0;
      const o = WORD_NUMBERS[ones.toLowerCase()] || 0;
      return String(t + o);
    }
  );

  // Handle single number words
  result = result.replace(/\b([a-z]+)\b/gi, (word) => {
    const lower = word.toLowerCase();
    if (lower in WORD_NUMBERS) {
      return String(WORD_NUMBERS[lower]);
    }
    return word;
  });

  return result;
};

// ── Normalization ─────────────────────────────────────────────────

const normalize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9.\s]/g, '').replace(/\s+/g, ' ').trim();

// ── Item matching ─────────────────────────────────────────────────

const matchItem = (
  query: string,
  items: InventoryItem[]
): { item: InventoryItem; score: number } | null => {
  const queryNorm = normalize(query);
  if (!queryNorm) return null;

  const queryWords = queryNorm.split(' ').filter(Boolean);
  let bestItem: InventoryItem | null = null;
  let bestScore = 0;

  for (const item of items) {
    const itemNorm = normalize(item.item_name);
    const itemWords = itemNorm.split(' ');

    // Exact match
    if (itemNorm === queryNorm) return { item, score: 1 };

    // All query words appear in item name (substring containment)
    if (queryWords.every(w => itemNorm.includes(w))) {
      const score = 0.8 + (queryWords.length / Math.max(itemWords.length, 1)) * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
      continue;
    }

    // Item name words appear in query (reverse containment — "brownies" in "two cases brownies")
    const reverseMatches = itemWords.filter(w => queryNorm.includes(w)).length;
    if (reverseMatches > 0) {
      const score = reverseMatches / itemWords.length;
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }
  }

  if (!bestItem || bestScore < 0.4) return null;
  return { item: bestItem, score: bestScore };
};

// ── Multi-item splitter ───────────────────────────────────────────

/**
 * Split a continuous transcript into individual command segments.
 * Splits on boundaries where a new number+unit keyword appears.
 * e.g. "two cases brownies one case chicken" → ["two cases brownies", "one case chicken"]
 */
const splitIntoSegments = (text: string): string[] => {
  // Pattern: a number (digit or word) followed by case/unit keyword
  // We split BEFORE each such occurrence (except the first)
  const numPattern = '(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|half|a|an)';
  const unitKeyword = '(?:cases?|cs|units?|ea|each|pieces?|bags?|boxes?|containers?|packs?|cans?|jars?|bottles?|gallons?|pounds?|lbs?)';
  const segmentBoundary = new RegExp(`(?=\\b${numPattern}\\s+${unitKeyword}\\b)`, 'gi');

  const segments = text.split(segmentBoundary).map(s => s.trim()).filter(Boolean);
  return segments.length > 0 ? segments : [text];
};

// ── Single-segment parser ─────────────────────────────────────────

const NUM = '(\\d+(?:\\.\\d+)?)';
const CASE_KW = '(?:cases?|cs|boxes?|bags?|packs?)';
const UNIT_KW = '(?:units?|ea|each|pieces?|cans?|jars?|bottles?|containers?|gallons?|pounds?|lbs?)';

const parseSegment = (
  segment: string,
  items: InventoryItem[]
): VoiceCommand | null => {
  // First convert spoken numbers to digits
  let text = normalize(spokenToDigits(segment));

  let cases = 0;
  let units = 0;
  let itemQuery = '';

  // Pattern: "<num> cases [and] <num> units [of] <item>"
  const fullRe = new RegExp(`${NUM}\\s*${CASE_KW}\\s*(?:and\\s*)?${NUM}\\s*${UNIT_KW}\\s*(?:of\\s*)?(.+)`);
  // Pattern: "<num> units [and] <num> cases [of] <item>"
  const fullRevRe = new RegExp(`${NUM}\\s*${UNIT_KW}\\s*(?:and\\s*)?${NUM}\\s*${CASE_KW}\\s*(?:of\\s*)?(.+)`);
  // Pattern: "<num> cases [of] <item>"
  const casesRe = new RegExp(`${NUM}\\s*${CASE_KW}\\s*(?:of\\s*)?(.+)`);
  // Pattern: "<num> units [of] <item>"
  const unitsRe = new RegExp(`${NUM}\\s*${UNIT_KW}\\s*(?:of\\s*)?(.+)`);
  // Pattern: "<num> <item>" (default to cases)
  const simpleRe = new RegExp(`^${NUM}\\s+(.+)`);

  let match = text.match(fullRe);
  if (match) {
    cases = parseFloat(match[1]);
    units = parseFloat(match[2]);
    itemQuery = match[3].trim();
  } else {
    match = text.match(fullRevRe);
    if (match) {
      units = parseFloat(match[1]);
      cases = parseFloat(match[2]);
      itemQuery = match[3].trim();
    } else {
      match = text.match(casesRe);
      if (match) {
        cases = parseFloat(match[1]);
        itemQuery = match[2].trim();
      } else {
        match = text.match(unitsRe);
        if (match) {
          units = parseFloat(match[1]);
          itemQuery = match[2].trim();
        } else {
          match = text.match(simpleRe);
          if (match) {
            cases = parseFloat(match[1]);
            itemQuery = match[2].trim();
          }
        }
      }
    }
  }

  if (!itemQuery || (cases === 0 && units === 0)) return null;

  // Strip trailing filler words that speech recognition adds
  itemQuery = itemQuery.replace(/\s+(and|then|next|also|uh|um)$/g, '').trim();

  const result = matchItem(itemQuery, items);
  if (!result) return null;

  return {
    matched_item_id: result.item.item_id,
    item_name: result.item.item_name,
    cases,
    units,
    confidence: result.score >= 0.7 ? 'high' : 'medium',
  };
};

// ── Main export ───────────────────────────────────────────────────

/**
 * Attempt to parse a voice transcript locally using pattern matching.
 * Handles spoken numbers and multiple items in one continuous utterance.
 * Returns null if nothing could be parsed (triggers AI fallback).
 */
export function fuzzyMatchVoiceCommand(
  transcript: string,
  items: InventoryItem[]
): FuzzyResult | null {
  if (!transcript || items.length === 0) return null;

  const text = normalize(transcript);
  const segments = splitIntoSegments(text);
  const commands: VoiceCommand[] = [];

  for (const seg of segments) {
    const cmd = parseSegment(seg, items);
    if (cmd) {
      commands.push(cmd);
    }
  }

  // If we parsed at least one command, return the local result
  if (commands.length > 0) {
    return { commands, usedLocal: true };
  }

  // Nothing matched — fall back to AI
  return null;
}
