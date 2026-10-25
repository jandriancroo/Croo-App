# Duo Design Lab (archived Oct 25 2026)

Design-exploration page for the iPhone Duo layouts. Archived at Jordan's request:
the `/duo-lab` route and its Settings → Super Admin link were removed, so nothing
in the app imports these files any more. The code is kept here untouched so the
layout ideas can be picked up again later.

## Files

- `DuoLabPage.tsx` — the page shell: device frames (front 466×678, full 951×669),
  super-admin guard, hidden `SalesSummary` mount that fills the shared sales cache.
- `DuoLabDash.tsx` — the lab Dash: top bar, Tonight gauge, cubes, Quick Tasks,
  promo tracker, checklists.
- `TonightGauge.tsx` — the sales/projection/pace gauge card.
- `useDuoLabData.tsx` — read-only data hook; uses the Dash's own query keys so it
  shares cache instead of making new requests.

## To bring it back

1. Move the folder back to `src/components/duo-lab/` (or leave it here).
2. Re-add the lazy import and `<Route path="/duo-lab" ...>` in `src/App.tsx`.
3. Re-add `'duo-lab'` to `SUPER_ADMIN_SECTIONS`, its `SECTION_TITLES` entry, and
   its `navLinks` entry in `src/pages/Settings.tsx`.

No database, POS, or Duo-shell changes are involved.
