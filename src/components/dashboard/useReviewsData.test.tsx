import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1' }, session: {} }) }));
vi.mock('@/hooks/useLocation', () => ({ useLocation: () => ({ currentLocation: { id: 'loc-1' } }) }));

import { useReviewsData } from './OvationScorePopover';

const googleRow = {
  location_id: 'loc-1',
  rating: 4.4,
  user_rating_count: 87,
  reviews: [{ id: 'g1', author: 'Kim', rating: 5, text: 'Fast and friendly', relativeTime: 'a week ago' }],
  google_maps_uri: 'https://maps.google.com/?cid=9',
  fetched_at: '2026-11-12T00:00:00Z',
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mockOvation(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
}

describe('useReviewsData source selection', () => {
  beforeEach(() => { localStorage.clear(); rpc.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows Google for a store with a Google row and no Ovation data', async () => {
    mockOvation({ reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 });
    rpc.mockResolvedValue({ data: [googleRow], error: null });
    const { result } = renderHook(() => useReviewsData(), { wrapper });
    await waitFor(() => expect(result.current.source).toBe('google'));
    expect(rpc).toHaveBeenCalledWith('get_location_google_reviews', { _location_id: 'loc-1' });
    expect(result.current.displayScore).toBe(4.4);
    expect(result.current.displayCount).toBe(87);
    expect(result.current.brandName).toBe('Google');
    expect(result.current.mapsUri).toBe('https://maps.google.com/?cid=9');
    expect(result.current.reviews[0]).toMatchObject({ customerName: 'Kim', feedback: 'Fast and friendly' });
  });

  it('keeps Ovation when Ovation has a score', async () => {
    mockOvation({ reviews: [{ id: 'o1', customerName: 'Lee', rating: 5, feedback: 'Yum', source: 'x', createdAt: '', hasResponse: false }], wtdAverage: 4.8, wtdCount: 12, totalCount: 12 });
    rpc.mockResolvedValue({ data: [googleRow], error: null });
    const { result } = renderHook(() => useReviewsData(), { wrapper });
    await waitFor(() => expect(result.current.displayScore).toBe(4.8));
    expect(result.current.source).toBe('ovation');
    expect(result.current.brandName).toBe('OvationUp');
  });

  it('shows nothing when neither feed has data', async () => {
    mockOvation({ reviews: [], wtdAverage: null, wtdCount: 0, totalCount: 0 });
    rpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useReviewsData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.source).toBe('ovation');
    expect(result.current.displayScore).toBeFalsy();
  });
});
