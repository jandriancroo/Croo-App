// Vitest mirror of supabase/functions/_shared/fuzzyMatch.test.ts
import { describe, it, expect } from 'vitest';
import { bestMatches, closest, matchTier, normalize } from '../../supabase/functions/_shared/fuzzyMatch';

const titles = ['Opening Checklist', 'AM Line Check', 'De-Ice Machine', 'Shift Change Line Check', 'Check Lobby'];

describe('fuzzyMatch', () => {
  it('normalizes', () => expect(normalize('The Opening Checklist, please!')).toBe('opening'));
  it('tiers', () => {
    expect(matchTier('opening checklist', 'Opening Checklist')).toBe(1);
    expect(matchTier('line', 'AM Line Check')).toBe(2);
    expect(matchTier('icing', 'De-Ice Machine')).toBe(3);
    expect(matchTier('lbby', 'Check Lobby')).toBe(4);
    expect(matchTier('pizza', 'Check Lobby')).toBe(0);
  });
  it('best tier + did you mean', () => {
    expect(bestMatches('icing', titles)).toEqual(['De-Ice Machine']);
    expect(bestMatches('zzz', titles)).toEqual([]);
    expect(closest('shift chnge', titles, 2)[0]).toBe('Shift Change Line Check');
  });
});
