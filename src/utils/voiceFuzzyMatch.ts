/**
 * Fast local fuzzy matching for inventory voice commands.
 * Handles simple patterns like "3 cases mozzarella" or "5 units tomatoes"
 * instantly without a network round-trip. Falls back to null for ambiguous input.
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

// Normalize a string for matching: lowercase, strip punctuation, collapse whitespace
const normalize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

// Simple word-overlap similarity score (0-1)
const similarity = (a: string, b: string): number => {
  const wordsA = new Set(normalize(a).split(' '));
  const wordsB = normalize(b).split(' ');
  if (wordsB.length === 0) return 0;
  let matches = 0;
  for (const w of wordsB) {
    if (wordsA.has(w)) matches++;
  }
  // Weight by how much of the item name was matched
  return matches / Math.max(wordsA.size, wordsB.length);
};

// Check if query words are a substring match of item name
const substringMatch = (itemNorm: string, queryWords: string[]): boolean => {
  return queryWords.every(w => itemNorm.includes(w));
};

/**
 * Attempt to parse a voice transcript locally using pattern matching.
 * Returns null if the transcript is too ambiguous for local parsing.
 * 
 * Supported patterns:
 *   "<number> case(s) <item>"
 *   "<number> unit(s) <item>"
 *   "<number> case(s) <number> unit(s) <item>"
 *   "<number> <item>" (defaults to cases)
 *   "<item> <number>" (defaults to cases)
 */
export function fuzzyMatchVoiceCommand(
  transcript: string,
  items: InventoryItem[]
): FuzzyResult | null {
  if (!transcript || items.length === 0) return null;

  const text = normalize(transcript);
  
  // Try to parse structured patterns
  // Pattern: "<number> case(s) [and] <number> unit(s) [of] <item>"
  const fullPattern = /(\d+(?:\.\d+)?)\s*(?:cases?|cs)\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*(?:units?|ea|each|pieces?)\s*(?:of\s*)?(.+)/;
  // Pattern: "<number> case(s) [of] <item>"
  const casesPattern = /(\d+(?:\.\d+)?)\s*(?:cases?|cs)\s*(?:of\s*)?(.+)/;
  // Pattern: "<number> unit(s) [of] <item>"
  const unitsPattern = /(\d+(?:\.\d+)?)\s*(?:units?|ea|each|pieces?)\s*(?:of\s*)?(.+)/;
  // Pattern: "<number> <item>" (default to cases)
  const simplePattern = /^(\d+(?:\.\d+)?)\s+(.+)/;
  // Pattern: "<item> <number>" (default to cases)
  const reversePattern = /^(.+?)\s+(\d+(?:\.\d+)?)$/;

  let cases = 0;
  let units = 0;
  let itemQuery = '';

  let match = text.match(fullPattern);
  if (match) {
    cases = parseFloat(match[1]);
    units = parseFloat(match[2]);
    itemQuery = match[3].trim();
  } else {
    match = text.match(casesPattern);
    if (match) {
      cases = parseFloat(match[1]);
      itemQuery = match[2].trim();
    } else {
      match = text.match(unitsPattern);
      if (match) {
        units = parseFloat(match[1]);
        itemQuery = match[2].trim();
      } else {
        match = text.match(simplePattern);
        if (match) {
          cases = parseFloat(match[1]);
          itemQuery = match[2].trim();
        } else {
          match = text.match(reversePattern);
          if (match) {
            itemQuery = match[1].trim();
            cases = parseFloat(match[2]);
          }
        }
      }
    }
  }

  // If we couldn't extract a number + item query, bail to AI
  if (!itemQuery || (cases === 0 && units === 0)) return null;

  // Find best matching item
  const queryWords = itemQuery.split(' ').filter(Boolean);
  
  let bestItem: InventoryItem | null = null;
  let bestScore = 0;

  for (const item of items) {
    const itemNorm = normalize(item.item_name);
    
    // Exact match after normalization
    if (itemNorm === itemQuery) {
      bestItem = item;
      bestScore = 1;
      break;
    }

    // Substring containment (all query words appear in item name)
    if (substringMatch(itemNorm, queryWords)) {
      const score = 0.8 + (queryWords.length / itemNorm.split(' ').length) * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
      continue;
    }

    // Word overlap similarity
    const score = similarity(item.item_name, itemQuery);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  // Require a minimum confidence threshold
  if (!bestItem || bestScore < 0.4) return null;

  const confidence: 'high' | 'medium' = bestScore >= 0.7 ? 'high' : 'medium';

  return {
    commands: [{
      matched_item_id: bestItem.item_id,
      item_name: bestItem.item_name,
      cases,
      units,
      confidence,
    }],
    usedLocal: true,
  };
}
