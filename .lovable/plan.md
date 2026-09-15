# Stage D — Count sheet UI

## First: the review / close-out verification you asked for

**Good news — no bug. Review and every closing total already include items that went inactive mid-count.**

What I checked, and what each one does:

- **Review screen** — reads the saved count lines first, then pulls each item's details by ID. There is no "only active items" filter anywhere in it, so a line stays visible and stays in the Total Value figure even after the item is switched off.
- **Closing the count** — the "submit count" action only flips the count's status and timestamps. It does not recalculate or freeze a total, so there is nothing there that could drop a line.
- **Period panel / COGS totals** — deliberately collects every item ID referenced by the beginning and ending counts and looks those up by ID, with an existing comment saying this exists precisely so deactivating an item after counting doesn't drop its value.
- **Reports data and the variance report** — same shape: count lines first, item lookup by ID, no active-only filter.
- **Count session** — as previously confirmed, it loads active items plus any item already present in this count even if now inactive.

So the behaviour Stage D depends on is real and already covered. Nothing to fix first.

## What gets built

### 1. NO COST in the price badge

The orange corner badge on each count card is the price display. Today, when an item has no price, the price line simply renders as a currency figure with nothing to explain it, and the cost detail line under the item name disappears entirely.

Change: when the item's cost is missing or zero, the badge shows **NO COST** in place of the money figure (units line unchanged), and the item's detail line says the price is missing rather than silently omitting it. This is driven purely by the item's own cost — independent of notes, discontinued state, or anything else.

### 2. Two distinct "no cost" states underneath

Both display as NO COST, but the system treats them differently:

- **Never priced** (no value at all) — the nightly price sync keeps chasing it. This already works today.
- **Deliberately set to zero** — someone chose zero on purpose. The sync must not quietly overwrite it.

Today an item deliberately zeroed can still be overwritten by the sync. Fix: record when a zero was set on purpose (who and when), and have the price sync leave the price alone on those items while still updating everything else about them (order dates, discontinued flags, availability). Setting a price above zero clears the deliberate-zero marker.

### 3. Notes row on the count card

A new compact row under the item header, rendered **only** when the item has at least one note. No note, no row.

Note types, in this fixed order:
1. **Discontinued** — item has a discontinued date.
2. **Unpriced** — cost missing or zero (with how long it's been that way, when known).
3. **Last ordered** — the date it last appeared on an order.

The first note shows inline with no tap. Any others collapse behind a down arrow labelled with a live count ("2 more"), expanding in place.

### 4. One-tap "mark inactive" on the discontinued note

The discontinued note carries a small action. Tapping it:
- switches the item off, recorded as a manager action (same pattern as the archive-cascade work earlier tonight),
- shows an undo toast that puts it straight back if tapped,
- leaves the item fully countable for the rest of this session — quantities already entered stay, and the total stays correct (verified above).

Confirmation wording, exactly: **"Marked inactive. It'll stay in this count and drop off after you close."** No warnings about lost value.

Nothing is ever auto-deactivated; this only happens when someone taps it.

## Technical notes

- Verified paths (no active-only filter, all count-line driven): `InventoryCountView.tsx` count-items query, `InventoryCount.tsx` submit mutation, `PeriodDetailPanel.tsx` (explicit referenced-ID union), `useReportData.ts` `sumCount`, `varianceReport.ts` `fetchCountItems` / `fetchAllInventoryItems`.
- Price badge + `headerBits` live in `InventoryCountSession.tsx` (item header block). The `else if (item.cost_per_unit)` guard is what currently swallows zero/null. Data cubes on the dashboard are untouched — this is the count card badge only.
- New columns on `inventory_items`: `cost_zeroed_at timestamptz`, `cost_zeroed_by uuid`. Migration only adds columns; no drops, no data rewrite.
- `_shared/vendorPriceChase.ts`: skip the `cost_per_unit` assignment when `cost_zeroed_at` is set (add to `CHASE_SELECT`), keep all other patch fields; add the field to the item type. Fail-soft skip machinery from Stage B stays as-is.
- Notes row: new `src/components/inventory/CountItemNotes.tsx`, fed from fields already available on the item (`discontinued_at`, `unpriced_since`, `last_ordered_at`, `cost_per_unit`) — these need adding to the count session's item select.
- Mark-inactive writes `is_active = false`, `deactivated_by = 'manager'`, `deactivated_reason = 'discontinued'`; the session's item list is not refetched during the session, so the row persists naturally. Undo restores the prior values.
- Mobile-first sizing, tap targets consistent with the existing lane buttons; no new dependencies.
