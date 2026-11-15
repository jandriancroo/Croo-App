import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn(async () => ({ data: { success: true }, error: null })) } } }));
import { supabase } from '@/integrations/supabase/client';
import { ensureFutureWeekLiving, shouldEnsureFutureWeek } from './ensureFutureWeekLiving';

const full = Array.from({ length: 7 }, (_, i) => ({ sale_date: `2026-11-${String(9 + i).padStart(2, '0')}`, initial_projection: 100 }));
describe('future-week Living requests', () => {
  it('never seeds current weeks even if later days are missing', () => {
    expect(shouldEnsureFutureWeek('2026-11-02', '2026-11-04', [])).toBe(false);
  });
  it('never seeds past weeks', () => {
    expect(shouldEnsureFutureWeek('2026-10-26', '2026-11-04', [])).toBe(false);
  });
  it('only seeds a future week with a missing stored goal', () => {
    expect(shouldEnsureFutureWeek('2026-11-09', '2026-11-04', full)).toBe(false);
    expect(shouldEnsureFutureWeek('2026-11-09', '2026-11-04', full.slice(1))).toBe(true);
  });
  it('never treats legacy projected_sales as an engine goal', () => {
    expect(shouldEnsureFutureWeek('2026-11-09', '2026-11-04', full.map(row => ({ sale_date: row.sale_date })))).toBe(true);
  });
  it('shares one ensure request and never sends seed_week', async () => {
    vi.mocked(supabase.functions.invoke).mockClear();
    await Promise.all([ensureFutureWeekLiving('store', '2026-11-09', '2026-11-04', []), ensureFutureWeekLiving('store', '2026-11-09', '2026-11-04', [])]);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(supabase.functions.invoke).toHaveBeenCalledWith('goal-engine', { body: { action: 'ensure_living', locationId: 'store', weekStart: '2026-11-09' } });
  });
});