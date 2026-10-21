import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { buildPromoSlides, campaignDay, pruneItemImages, ALL_ITEMS_REF } from './promoTrackers';

describe('promo slides', () => {
  const base = { tracker_item_refs: ['Pizza', 'Salad'], tracker_promo_image_url: 'camp.png', tracker_item_images: { Pizza: 'pizza.png' } };

  it('campaign slide is off by default and opens on the first dish', () => {
    expect(buildPromoSlides(base).map(s => s.ref)).toEqual(['Pizza', 'Salad']);
  });

  it('"Start on campaign hero" puts the All Items slide first', () => {
    const s = buildPromoSlides({ ...base, tracker_start_on_campaign: true });
    expect(s[0].ref).toBe(ALL_ITEMS_REF);
    expect(s[0].imageUrl).toBe('camp.png');
  });

  it('a dish with no photo uses the campaign hero', () => {
    expect(buildPromoSlides(base)[1].imageUrl).toBe('camp.png');
  });

  it('one item only: no campaign slide even when switched on', () => {
    expect(buildPromoSlides({ tracker_item_refs: ['Pizza'], tracker_start_on_campaign: true }).length).toBe(1);
  });

  it('removing an item drops its photo', () => {
    expect(pruneItemImages({ Pizza: 'a', Salad: 'b' }, ['Salad'])).toEqual({ Salad: 'b' });
  });
});

describe('campaign day', () => {
  const tz = 'America/Los_Angeles';
  it('counts day 6 of 21 in the store timezone', () => {
    const now = DateTime.fromISO('2026-10-20T23:30:00', { zone: tz });
    expect(campaignDay('2026-10-15', '2026-11-04', tz, now)).toEqual({ day: 6, total: 21 });
  });
  it('no dates means no day', () => {
    expect(campaignDay(null, null, tz)).toBeNull();
  });
});
