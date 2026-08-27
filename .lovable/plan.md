# Brand-scope the Integrations screen

One change, one screen: a location should only see the integrations that belong to its own brand.

## 1. What's actually happening today

Checked the live code and the live data.

- The integrations screen is one section on the Location profile page. It renders a fixed, hardcoded list of nine cards in a row: Inventory Access, QuBeyond, PFG, Produce Alliance, Fresh KDS, OvationUp, OPUS, Clover, Aloha (BWW GO).
- Every card except two is rendered unconditionally. There is no brand check anywhere in that list. The only gates that exist are the global on/off switches for Fresh KDS and OPUS (both currently off for everyone), which are not brand-aware either.
- OvationUp does look up the location's brand, but only to fetch the right saved credentials. It still shows the card to every location regardless of brand.
- So the cause is simply: the card list is a static list, not a brand-filtered list. Blaze stores see the BWW Aloha card and the Playa Bowls Clover card, and the single BWW store sees PFG, Produce Alliance and QuBeyond, none of which apply to it.

Data confirms the intent is clean and the fix is safe:

- Brands in the system: Blaze Pizza (12 locations), Buffalo Wild Wings GO (1), Playa Bowls (1), Coop's Pizza (1), Primrose Schools (1).
- Every real location already has a brand assigned. Only two throwaway rows have no brand: "Lite QA — Smoke Test" and a duplicate empty "Sandbox".
- Actual saved integrations line up with brand exactly: Blaze stores have QuBeyond / PFG / Produce Alliance only. The BWW store has Aloha only. Playa Bowls has Clover only. So filtering by brand hides nothing anyone is currently using.

## 2. Proposed change (one change)

Add a brand-to-integrations map for this screen, and show a card only if the location's brand is in that integration's allowed list.

The map, based on what each brand actually runs today:

| Integration | Blaze Pizza | BWW GO | Playa Bowls | Coop's | Primrose |
|---|---|---|---|---|---|
| QuBeyond POS | yes | – | – | – | – |
| Clover POS | – | – | yes | – | – |
| Aloha (BWW GO) | – | yes | – | – | – |
| PFG | yes | – | – | – | – |
| Produce Alliance | yes | – | – | – | – |
| OvationUp | yes | yes | – | – | – |
| Fresh KDS | yes | – | – | – | – |
| OPUS LMS | yes | – | – | – | – |

Notes on behaviour:

- Fresh KDS and OPUS stay hidden for everyone because their global switches are off. Brand scoping just becomes the second condition, so if they ever get turned back on they only appear for Blaze.
- A location with no brand assigned (the two QA/sandbox rows) sees no integration cards. That is the safe default and matches the current reality that those rows have no integrations saved.
- The Inventory Access card stays visible for every location. That card is Brand Mode vs Lite Mode, which is a per-location setting and has nothing to do with which brand the location belongs to. It is intentionally left alone.
- Nothing gets deleted, disabled or migrated. Any credentials already saved stay exactly where they are. This is purely which cards the screen offers.

## 3. What gets touched

- `src/components/settings/IntegrationsSection.tsx` — the card list on this screen, plus a small brand lookup for the location (the same lookup the Ovation card already does: read the location's brand, fall back to its organization's brand).
- Nothing else. The card list is the only place that decides what's offered.

Not touched, but worth naming since they sit on the same screen:

- `InventoryAccessCard` — Brand Mode vs Lite Mode toggle, left as-is.
- `AlohaIntegrationCard` and `DeliveryScheduleEditor` — the contents of dialogs, unchanged. They just won't be reachable from a brand that shouldn't see them.

## 4. What NOT to touch

- Punch clock and kiosk
- Inventory pans, LEGS, valuation, pack configs
- GAPS / vendor gap linking and the deploy wizard
- Any pricing or cost logic
- Any Hemet data or the Hemet shelf-source behaviour (that is a separate ticket; this change does not need it)
- Everything in `LOCKED_FEATURES.md`: 3D data cubes, the inventory system, fluid dock and toast animations, the version update system, the support ticket system
- No database changes, no migrations, no edge function changes

## 5. How to verify on iPad

1. Open the app on the iPad, pick a Blaze store (Hemet or Palm Springs), go to that location's profile and scroll to Integrations. Expect to see: Inventory Access, QuBeyond, PFG, Produce Alliance, OvationUp. Expect NOT to see: Clover, Aloha.
2. Switch to the BWW GO store (Virginia St), same screen. Expect: Inventory Access, Aloha, OvationUp. Expect NOT to see: QuBeyond, PFG, Produce Alliance, Clover.
3. Switch to Playa Bowls (Georgetown). Expect: Inventory Access, Clover. Nothing else.
4. Open one card that should still be there on a Blaze store (PFG) and confirm the saved credentials and delivery schedule are exactly as before — nothing lost.
5. Lite vs Brand mode: check one Lite location and one Brand-mode location in the same brand and confirm they show the same integration cards. Mode should make no difference here, only brand should.

## 6. Rollout risk

Low.

- The only visible effect is fewer cards on one screen. No data is written, moved or removed.
- Main risk is over-hiding: if a brand actually needs an integration I didn't map (for example if Coop's Pizza or Primrose is meant to get a POS soon), its card would disappear from that screen until the map is updated. Today none of those brands have any integration saved, so nothing breaks now — it's a one-line map update when it's needed.
- Second small risk is a location with a missing brand assignment showing an empty list. Only the two QA/sandbox rows are in that state today.
- Fully reversible: revert the one file and the old behaviour returns.
