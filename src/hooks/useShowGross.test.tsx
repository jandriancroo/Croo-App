import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

let savedPrefs: Record<string, unknown> = {};
const update = vi.fn(async (_row: unknown) => ({ error: null }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ui_prefs: savedPrefs } }) }) }),
      update: (row: unknown) => ({ eq: async () => update(row) }),
    }),
  },
}));

import { useShowGross } from './useShowGross';

describe('useShowGross', () => {
  beforeEach(() => { localStorage.clear(); savedPrefs = {}; update.mockClear(); });

  it('defaults OFF (net only) for a user with no saved choice', async () => {
    const { result } = renderHook(() => useShowGross());
    expect(result.current[0]).toBe(false);
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it('saves the choice per user (profile + this device) and reloads it', async () => {
    const { result } = renderHook(() => useShowGross());
    await waitFor(() => expect(update).not.toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ui_prefs: { show_gross_sales: true } }));
    expect(localStorage.getItem('croo_show_gross_sales_u1')).toBe('1');

    savedPrefs = { show_gross_sales: true };
    const again = renderHook(() => useShowGross());
    await waitFor(() => expect(again.result.current[0]).toBe(true));
  });
});
