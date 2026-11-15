import { describe, expect, it } from 'vitest';
import { googleDisplayReviews, safeMapsUri, selectReviewsSource, type GoogleReviewsRow } from './reviewsSource';

const row: GoogleReviewsRow = {
  location_id: 'l1',
  rating: '4.6',
  user_rating_count: 212,
  reviews: [
    { id: 'a', author: 'Sam', rating: 5, text: 'Great bowls', publishTime: '2026-11-10T00:00:00Z', relativeTime: '2 days ago', authorUri: 'https://maps.google.com/u/1' },
    { id: 'b', author: '', rating: 4, text: '', authorUri: 'javascript:alert(1)' },
  ],
  google_maps_uri: 'https://maps.google.com/?cid=1',
  fetched_at: '2026-11-12T00:00:00Z',
};

describe('review source selection', () => {
  it('keeps Ovation when Ovation has a score', () => {
    expect(selectReviewsSource({ ovationHasScore: true, google: row })).toBe('ovation');
  });
  it('uses Google when Ovation has nothing and a Google row exists', () => {
    expect(selectReviewsSource({ ovationHasScore: false, google: row })).toBe('google');
  });
  it('stays on Ovation (hidden) with no Google row or no rating', () => {
    expect(selectReviewsSource({ ovationHasScore: false, google: null })).toBe('ovation');
    expect(selectReviewsSource({ ovationHasScore: false, google: { ...row, rating: null } })).toBe('ovation');
  });
});

describe('Google review display', () => {
  it('maps stored reviews into the panel shape', () => {
    const out = googleDisplayReviews(row);
    expect(out[0]).toMatchObject({ id: 'a', customerName: 'Sam', rating: 5, feedback: 'Great bowls', relativeTime: '2 days ago', hasResponse: false });
    expect(out[1]).toMatchObject({ customerName: 'A Google user', feedback: null, authorUri: null });
  });
  it('only renders https map links', () => {
    expect(safeMapsUri('https://maps.google.com/?cid=1')).toBe('https://maps.google.com/?cid=1');
    expect(safeMapsUri('javascript:alert(1)')).toBeNull();
    expect(safeMapsUri(null)).toBeNull();
  });
});
