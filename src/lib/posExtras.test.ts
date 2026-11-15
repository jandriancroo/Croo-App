import { describe, expect, it } from 'vitest';
import { knownNumber, posExtrasPatch, quHourlyExtras, toastRawExtras, hasHourlyAndGuests, isPortalAccessError } from '../../supabase/functions/_shared/posExtras';
import { parseAlohaGridCsv } from '../../supabase/functions/_shared/aloha-portal';

describe('POS details preserve known values', () => {
  it('unknown and invalid values stay absent, while measured zero is known', () => {
    expect(knownNumber('')).toBeNull();
    expect(knownNumber('unknown')).toBeNull();
    expect(posExtrasPatch({ comp_amount: null, void_count: 0 })).toEqual({ void_count: 0 });
  });
  it('does not replace real extras with ticker zero or empty fields', () => {
    expect(posExtrasPatch({ comp_amount: 0, comp_count: null, promo_amount: 20 }, { comp_amount: 110.79, comp_count: 6 })).toEqual({ promo_amount: 20 });
  });
  it('sums QU checks/discounts only when discounts are provided', () => {
    expect(quHourlyExtras([{ checksCount: 5, discountAmount: 2.5 },{ checksCount: 3, discountAmount: 0 }])).toEqual({ check_count: 8, discount_amount: 2.5 });
    expect(quHourlyExtras([{ checksCount: 5 }])).toEqual({check_count:5});
    expect(quHourlyExtras([])).toEqual({});
  });
  it('uses Toast provided discount amounts without treating discounts as comps/promos', () => {
    expect(toastRawExtras({discounts:[{discountAmount:5},{discountAmount:330},{discountAmount:22.87}]})).toEqual({discount_amount:357.87});
    expect(toastRawExtras({})).toEqual({});
  });
  it('distinguishes blank grid metrics from real comps/voids/promos/LY', () => {
    const row = parseAlohaGridCsv('StoreName,CompCount,CompDollars,PromoCount,PromoDollars,VoidCount,VoidDollars,NetSalesLastYear\nVirginia St,6,110.79,40,436.15,5,23.49,2500').stores[0];
    expect(row.availableMetrics).toEqual({CompCount:6,CompDollars:110.79,PromoCount:40,PromoDollars:436.15,VoidCount:5,VoidDollars:23.49,NetSalesLastYear:2500});
    expect(parseAlohaGridCsv('StoreName,CompDollars,VoidCount\nVirginia St,,0').stores[0].availableMetrics).toEqual({VoidCount:0});
  });
  it('skips only complete history and stops on login/lock errors', () => {
    expect(hasHourlyAndGuests({hourly_data:[{sales:100}],guest_count:5})).toBe(true);
    expect(hasHourlyAndGuests({hourly_data:[],guest_count:5})).toBe(false);
    expect(isPortalAccessError(new Error('Aloha login failed: account locked'))).toBe(true);
    expect(isPortalAccessError(new Error('HTTP 500'))).toBe(false);
  });
});