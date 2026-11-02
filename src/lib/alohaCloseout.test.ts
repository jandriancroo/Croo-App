import { describe, expect, it } from 'vitest';
import { resolveAlohaCloseout } from '../../supabase/functions/aloha-sync/closeout';

const livePartial = { net_sales: 3215.81, guest_count: 108, validation_status: 'pending' };

describe('Aloha finished-day close-out', () => {
  it('yesterday replaces the $3,215.81 / 108-guest live partial with positive finished totals', () => {
    expect(resolveAlohaCloseout('yesterday', 4000, 130, livePartial))
      .toEqual({ net_sales: 4000, guest_count: 130 });
  });
  it('manual date mode keeps existing positive sales and guests', () => {
    expect(resolveAlohaCloseout('date', 4000, 130, livePartial))
      .toEqual({ net_sales: 3215.81, guest_count: 108 });
  });
  it('valid email-verified sales are kept in every non-live mode', () => {
    const verified = { ...livePartial, validation_status: 'valid' };
    expect(resolveAlohaCloseout('yesterday', 4000, 130, verified))
      .toEqual({ net_sales: 3215.81, guest_count: 130 });
    expect(resolveAlohaCloseout('date', 4000, 130, verified))
      .toEqual({ net_sales: 3215.81, guest_count: 108 });
    expect(resolveAlohaCloseout('yesterday', 4000, 130, { ...verified, net_sales: 0 }).net_sales).toBe(0);
  });
  it('yesterday falls back to existing totals when the finished payload is zero or empty', () => {
    expect(resolveAlohaCloseout('yesterday', 0, 0, livePartial))
      .toEqual({ net_sales: 3215.81, guest_count: 108 });
    expect(resolveAlohaCloseout('yesterday', NaN, NaN, livePartial))
      .toEqual({ net_sales: 3215.81, guest_count: 108 });
  });
  it('live mode retains its existing positive-payload behavior even for valid rows', () => {
    expect(resolveAlohaCloseout('live', 4000, 130, { ...livePartial, validation_status: 'valid' }))
      .toEqual({ net_sales: 4000, guest_count: 130 });
  });
});