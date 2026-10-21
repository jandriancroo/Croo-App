import { describe, expect, it } from 'vitest';
import { promoBorderReactions, borderTitleOffset } from './promoBorders';

const ranks = (gap: number) => [
  { locationId: 'leader', rank: 1, units: 100 },
  { locationId: 'above', rank: 2, units: 12 },
  { locationId: 'ours', rank: 3, units: 12 - gap },
];
describe('promo border rules', () => {
  it('winner glow only for rank 1', () => {
    expect(promoBorderReactions(ranks(2), 'leader', '__ALL__', false).winner).toBe(true);
    expect(promoBorderReactions(ranks(2), 'ours', '__ALL__', false).winner).toBe(false);
  });
  it('closing in uses the store immediately above and includes exactly 2 units', () => {
    expect(promoBorderReactions(ranks(2), 'ours', '__ALL__', false).closing).toBe(true);
    expect(promoBorderReactions(ranks(2.01), 'ours', '__ALL__', false).closing).toBe(false);
  });
  it('does not pulse for the leader or a negative units gap', () => {
    expect(promoBorderReactions(ranks(0), 'leader', '__ALL__', false).closing).toBe(false);
    expect(promoBorderReactions(ranks(-1), 'ours', '__ALL__', false).closing).toBe(false);
  });
  it('uses the selected item units, not combined totals', () => {
    const rows = ranks(20).map(r => ({ ...r, itemStats: { Pizza: { units: r.rank === 3 ? 5 : 7 } } }));
    expect(promoBorderReactions(rows, 'ours', 'Pizza', false).closing).toBe(true);
    expect(promoBorderReactions(rows, 'ours', '__ALL__', false).closing).toBe(false);
  });
  it('no reaction for pending, missing store or missing item data', () => {
    expect(promoBorderReactions(ranks(2), 'ours', '__ALL__', true)).toEqual({ winner: false, closing: false });
    expect(promoBorderReactions(ranks(2), 'missing', '__ALL__', false)).toEqual({ winner: false, closing: false });
    expect(promoBorderReactions(ranks(2), 'ours', 'Pizza', false).closing).toBe(false);
  });
  it('approved title shifts are 24px for both buntings and 8px for gingham', () => {
    expect(borderTitleOffset({ style: 'spring-bunting' })).toBe(24);
    expect(borderTitleOffset({ style: 'fourth-july' })).toBe(24);
    expect(borderTitleOffset({ style: 'gingham' })).toBe(8);
    expect(borderTitleOffset(null)).toBe(0);
  });
});