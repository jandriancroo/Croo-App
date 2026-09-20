import { describe, it, expect } from 'vitest';
import { normalizePackSize, categoryFamily, scoreCandidate, rankCandidates } from './vendorCandidateMatch';

describe('normalizePackSize', () => {
  it('makes whitespace and case irrelevant', () => {
    expect(normalizePackSize('1/1 CT')).toBe(normalizePackSize('1/1CT'));
    expect(normalizePackSize('6 / 5 lb')).toBe('6/5LB');
    expect(normalizePackSize('48 ct.')).toBe('48CT');
  });
  it('handles blanks', () => {
    expect(normalizePackSize(null)).toBe('');
    expect(normalizePackSize('')).toBe('');
  });
});

describe('categoryFamily', () => {
  it('reduces to the first word', () => {
    expect(categoryFamily('Paper Goods')).toBe('paper');
    expect(categoryFamily('PAPER/DISPOSABLES')).toBe('paper');
  });
});

describe('scoreCandidate', () => {
  it('scores a pack match highest', () => {
    const r = scoreCandidate({
      gap: { packSize: '6/5 LB', categoryName: 'Produce' },
      candidate: { packSize: '6/5LB', category: 'Produce' },
    });
    expect(r.packMatch).toBe(true);
    expect(r.score).toBeGreaterThan(0.6);
  });

  it('gives no credit when a blank pack size sits on both sides', () => {
    const r = scoreCandidate({ gap: { packSize: '' }, candidate: { packSize: '' } });
    expect(r.packMatch).toBe(false);
    expect(r.score).toBe(0);
  });

  it('credits price proximity only inside the 30% window', () => {
    const near = scoreCandidate({
      gap: { price: 11 }, candidate: { siblingPrice: 10 },
    });
    const far = scoreCandidate({
      gap: { price: 40 }, candidate: { siblingPrice: 10 },
    });
    expect(near.score).toBeGreaterThan(far.score);
    expect(far.score).toBe(0);
  });
});

describe('rankCandidates', () => {
  it('drops zero-evidence candidates and keeps order', () => {
    const ranked = rankCandidates(
      { packSize: '1/1 CT', categoryName: 'Smallwares' },
      [
        { packSize: '2/5 LB', category: 'Produce' },
        { packSize: '1/1CT', category: 'Smallwares' },
      ],
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].packMatch).toBe(true);
  });
});
