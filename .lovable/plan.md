# Promo tracker rebuild — Step 0 report (nothing built, nothing deleted)

The two PDFs are the visual target: hero V (campaign slide, dish slide, expanded, iPad), the builder, the crop screen, Edit Dashboard, and 19 borders plus the border picker. I'll rebuild them with our own Button, SegmentedControl, Switch and theme colors. I won't copy their inline styles, and the photos in them are placeholders.

## 1. Current hero — what gets replaced (TrackerWidget.tsx)
| Piece today | Lines | New |
|---|---|---|
| Whole-card button with `aspect-[4/2.3]` and glass shadow | 244–250, 260–261 | 220px card, rounded 24px, photo fills it. Only the rank chip opens the list. |
| Single campaign photo or teal fallback | 251–255 | Per-dish photo → campaign photo → teal `bg-primary` |
| Bottom fade | 258 | Top shade (~60% → clear by 50%) plus ~25% at the bottom |
| Black glass LIVE pill, top left | 263–270 | Normal soft-green LIVE chip, top right, `LIVE · DAY 6/21` |
| Glass period pill, top right | 272–283 | Standard SegmentedControl at the bottom, 32px visible, 44px tap area |
| Title, 1 line | 285–287 | 25px / 900 weight / uppercase, 2 lines max, plus a `<item> · N sold` line |
| White item pill with arrows, plus rank and units | 289–341 | Dish dots on the left; rank chip `#9 of 12 ▾` on the right |
| Swipe handlers | 217–225 | Kept (swipe changes slide), and swiping now pauses autoplay |

**Untouched:** the expanded list at 346–411, `get_tracker_ranking` and the query at 105–165, the sorting at 181–189, and the shared item and period state. The list still reads the same `period`, `activeItemRef` and `sortMetric`.

## 2. Widths and height rule
The card spans the full Dash column. I'll measure its exact width at 390, 768, 1024 and 1280 in the first build step and report back. The mockup's iPad page (pg 7) is 250px tall.
**Height rule:** 220px below md, 250px from md up. Fixed heights, not an aspect ratio, so the controls never crowd on wide screens. Photos use `object-cover`.

## 3. Config, storage, migrations
Everything below fits in the existing `config` JSON. It round-trips through `buildWidgetConfigJson` and `mapRow` the same way `tracker_promo_image_url` does:
- `tracker_item_images: { [itemRef]: url }`
- `tracker_start_on_campaign: bool` (default false)
- `tracker_autoplay: bool` (default true)
- `tracker_border: { style, color } | null`, `tracker_border_winner: bool`, `tracker_border_closing: bool`. These are set aside now and used in Phase B.

**Play order** = the order of `tracker_item_refs` (the drag handle reorders that array). Removing an item drops its photo entry. A photo is keyed by the item's exact name, so renaming or remapping the item means re-adding the photo; the builder will show "No photo" so it's obvious.

**Photos:** the existing `brand-assets` bucket, under `promo-trackers/items/<promoId>-<ts>.png`. One upload per dish, cropped to the hero's shape. The dot shows the photo's centre (the crop screen draws a circle there, as in the PDF on pg 9). No separate focal point.

**Migrations are needed only for the scope rules in section 6**, not for the config fields.

## 4. Campaign slide ↔ "All Items"
`itemSwitchOptions` already puts `__ALL__` first when more than one item is tracked (line 171). With "Start on campaign hero" on, the ALL dot is that same `__ALL__` option, so `units` comes from the existing `store.units`. The math doesn't change. With it off, the ALL dot is left out of the dots, and the slide opens on the first dish. With one item, the ALL slide is skipped (no `__ALL__` exists).

## 5. Autoplay
- **Local copy of the cube pattern** (DataCube3D 345, 414–419: `setInterval` 8000, cleared on freeze). A tiny `usePromoAutoplay` hook inside the tracker folder; DataCube3D is not touched.
- Advances every 8s. Pauses on long-press (500ms), dot tap, swipe, or expand. A pause glyph appears under the LIVE chip. A period change does not pause.
- Stops when the app is hidden (`visibilitychange`) and is cleaned up on unmount. Off with one slide or when `tracker_autoplay = false`. With reduced motion: no crossfade, but it still advances.
- **No extra ranking calls:** the query key (line 106) has no slide in it. Slides only change `selectedItemRef`, which reads data already loaded. I'll verify this with a network count over 60s.

## 6. Scope model — one record, one slot
**Today (checked live):** "Spellbound Spread" is **24 rows** (2 per store × 12 stores: one for all roles, one for managers only). The builder fans copies out per location and matches them by title. Hemet's manager copy carries a hide-at-Hemet entry. RLS blocks direct writes, so all writes go through RPCs. `end_promo_tracker_by_title` deletes by title. Who can create today: location = `has_role_or_higher admin`, org = `is_org_admin`, brand = `brand_members.brand_role='admin'`, super admin always (`_validate_widget_authority`).

**Recommendation: a small dedicated `promo_trackers` table.** It's lower risk than bending `dashboard_widgets`, whose read policy, ordering, per-user hide and cube code all assume per-location rows. Shape:
- `id, owner_type ('brand'|'org'), brand_id, organization_id, title, starts_on, ends_on (date), config jsonb, ended_at, created_by`
- `promo_tracker_locations(promo_id, location_id)`, only for org contests with a subset; empty = all of the org's stores
- No hide columns and no audience roles; everyone in scope sees it.
- Writes only via RPCs: `save_promo_tracker` (brand admin or super admin for brand; org admin or super admin for its own org), `end_promo_tracker(id)` (sets `ended_at`), and a read `get_active_promo_tracker(location_id)`.
- **Overlap guard** inside `save_promo_tracker`: refuse when another non-ended promo from the same owner has `daterange(starts_on, ends_on, '[]')` overlapping. The message gives the other promo's name and dates. Scheduling ahead works because only dates decide what's live.
- **"Which promo does location X show":** in the store's own timezone today, take the brand promo for X's brand with `starts_on ≤ today ≤ ends_on` and `ended_at IS NULL`. If there is none, take the org contest for X's org, with the same date test, where X is in the contest list (or the list is empty). At most one is returned.
- **Ranking pool:** brand promo → `_scope 'brand'`, no refs. Org contest → `_scope 'org'` plus the contest's location list as `_location_refs`. This uses the existing parameters, so the RPC doesn't change. `trackerScope`, `audience_roles` and `tracker_excluded_location_ids` become unnecessary; `trackerLocationScope` is replaced by `owner_type`.
- **Hide controls removed** for trackers: `toggleTrackerHiddenForLocation` (client 148–169), the tracker eye and `hiddenForLocation` (EditDashboardDialog 103, 171, 206, 218–226, 295–303), `useDashboardWidgets` 48/68/84/97, the WidgetsSection 317 filter, Dashboard 277 and 611, and useWatchSync 23/141 (watch filter only; no watch files touched). The per-user hide stays for real cubes.
- The Dash reads the new function, and the tracker stops coming from `dashboard_widgets`.

## 7. Wipe plan (nothing deleted)
- **Rows to delete:** all 24 `widget_type='tracker'` rows, all titled "Spellbound Spread", `authority_scope='location'`, no org or brand id, dates 2026-08-19 → 2026-10-27. Stores: [TEST] Sandbox, Akers Mill, Anaheim, Hemet, IUPUI, Niles, Palm Desert, Palm Springs, Rowlett, South Meadows, Sparks, Tuscaloosa. The full id list will go in the wipe migration.
- **Hide records:** 0 per-user hides. 1 per-location exclusion (Hemet, on row `f76e9baa…`). Nothing else references these rows.
- **Spellbound config:** expandable display; brand scope; rank metrics units/sales/pmix; items: Margherita Pizza, Margherita Pizza (Large), Lemon Bar, Kids 3 Top Pizza Meal, Kids Pepperoni Pizza, Kids 3 Top Pizza. Campaign image: `brand-assets/promo-trackers/promo-1787252769427.png`. The 3 config versions differ only in audience and the Hemet exclusion. The full JSON gets saved to Files before any delete.
- No sales or ranking data lives on these rows; rankings come from live sales. The image file stays in storage.
- **Safeguard:** the wipe migration first copies the rows into a `promo_tracker_wipe_backup_2026_10` table and then deletes them. To reverse it, re-insert from the backup. It ships in the same release, after its own "go".
- Note: the current end date is **Oct 27**, not Nov 4 as in the mockup. Please confirm the dates to use for the rebuild.

## 8. Edit Dashboard
- `SectionKey` (line 50) gains `'promo-tracker'`. `DEFAULT_SECTION_ORDER` becomes `['data-cubes','promo-tracker','checklists','sales-chart']`. `getSectionOrder` (54–67) puts the key right after data-cubes for saved orders that lack it. Section order is stored on the device, so no data migration is needed.
- `dataCubes` (line 452) stops including trackers, so "Data Cubes" counts only cubes. The new row reads "Spellbound Spread · Expandable" with a drag handle and no eye or trash. Brand and org admins get Edit and End Promo.
- **The Dash today** draws the tracker inside WidgetsSection (106–117) under PROMO. It moves into its own section in Dashboard.tsx, ordered by the same key.
- The only locked file touched is EditDashboardDialog, tracker parts only (rows, tracker editor 1151–1180, crop 1312–1314, the fan-out sync 346–425 and 670–676 removed). Cube logic, Add3DCubeDialog and cube counts stay as they are.
- AddWidgetDialog's tracker option (556–559, 735–737) moves to the new builder; PromoBannerPreview is redrawn as the new hero preview (it's also used by the crop overlay and the PromoWidgetPreview page).

## 9. Riskiest parts and tests
1. **Scope switch (new table, brand beats org, overlap).** Tests: brand and org overlapping at one store (brand shows); an org contest in a one-store org (ranks "#1 of 1"); overlapping saves refused; future promos auto-start; End Promo by id hides it everywhere; a non-admin save is refused.
2. **Autoplay and gestures together** (long-press vs. swipe vs. tap, and no extra calls). Tests: 12 items (dots scroll, active dot in view), one item (no autoplay), the network count, hidden tab, reduced motion.
3. **Layout edge cases at 220px.** Tests: a long item name (truncates), a 2-line title, no dates (no "DAY" part), no photos (teal), the 390 and iPad sizes, light and dark themes.

## 10. Confirmations
- No change to `get_tracker_ranking`, the ranking math, periods or rank metrics.
- The expanded list is not restyled.
- No change to cubes, dock, Nudge, toasts or labor functions.
- Permissions only change in how promos are made: brand admins make brand promos, org admins make org contests, and the super admin can do both.

## Decisions needed with "go"
- "unlock please" for EditDashboardDialog (tracker parts only).
- The dedicated table (recommended) vs. keeping it in `dashboard_widgets`.
- Spellbound's real end date (Oct 27 today vs. Nov 4 in the mockup).
- A separate "go" for the wipe migration.
