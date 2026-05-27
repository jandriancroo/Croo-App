# Playa Bowls

- **Brand ID:** `5fb4ef79-b0e4-4f06-9e88-1f88510dc4ab`
- **POS:** Clover (V3 REST, polling — no streaming yet)
- **Pilot location:** Georgetown (`79456db0-c817-464e-a849-bca44f8d6f34`, merchant `R431RMGKNFC41`)
- **Status:** 🟡 Pilot — sales pipeline live, labor + depletion not yet wired

---

## 1. POS Integration

| Aspect | Value |
|---|---|
| Auth | Per-location `api_token` + `merchant_id` in `location_integrations.credentials` (env: `production` / `sandbox`) |
| Base URL | `https://api.clover.com/v3/merchants/{mid}` |
| Sync function | `supabase/functions/clover-sync` |
| Cadence | Every 15 min `sync_all_today` · 3 AM PST `sync_all_yesterday` · `backfill_clover_sales` queue (7 days/batch, 371-day target) |
| Rate limits | **~16 req/sec** — function uses exponential backoff on 429/5xx (`Retry-After` honored), serializes orders → payments per day, 200ms pace between days. **Do not parallelize** orders + payments. |
| Webhooks | ❌ Polling only |

**Architecture pattern:**
- Writes to **`clover_sales_cache`** (raw archive) AND **dual-writes** normalized rows to `sales_cache` with `pos_source = 'clover'` (POS Mailroom pattern).
- Brand guard at top of every action: refuses any non-Playa location.
- Conditional spread (`...existing`) preserves projections/overrides during background syncs.

**Known quirks:**
- `businessDayWindowMs` uses a custom UTC offset math (works, but watch DST edges).
- `guestCount` falls back to `1` per order (Clover rarely populates it).

---

## 2. Sales Cache Coverage (`pos_source = 'clover'`)

| Column | Populated? | Notes |
|---|---|---|
| `net_sales` | ✅ | `order.total / 100` (cents → dollars), excludes voided/open/deleted |
| `gross_sales` | ❌ | Not parsed yet |
| `guest_count` | ⚠️ | Mostly 1/order fallback — Clover doesn't push true guest counts |
| `avg_ticket` | ✅ | net_sales / check_count |
| `hourly_data` | ✅ | 24-bucket array, indexed off business-day start |
| `product_mix` | ✅ | Raw Clover item names — **not yet category-mapped** (pizza_count stays 0) |
| `payments_data` | ✅ | Tender breakdown + total tips |
| `pizza_count` | ❌ | Needs Clover item → category mapping in brand catalog |
| `yoy_*` | ✅ | Seeded from `−364d` inside `syncOneDay` (full 365-day backfill complete for Georgetown 2026-05-27) |
| `projected_sales` / `living_projection` | ✅ | YOY-seeded; uses shared projection hierarchy |

---

## 3. Data Cubes & Widgets

| Cube / Widget | Supported | Blocker if not |
|---|---|---|
| Sales Today | ✅ | |
| Pace | ✅ | |
| Projection | ✅ | YOY-seeded |
| Avg Ticket | ✅ | |
| Guest Count | ⚠️ | Inflated by 1/order fallback |
| WTD / MTD | ✅ | |
| Last Year (YOY) | ✅ | Backfilled |
| **Labor % / Cost / Hours** | ❌ | No `labor_cache` rows — Clover doesn't push labor, no punch clock setup at Georgetown |
| Tracker (Pizza/Category counts) | ❌ | No Clover item → brand category mapping yet |
| Payment Breakdown | ✅ | |
| KDS | ❌ | KDS is QU-streaming only |

---

## 4. Labor Source

- **Table:** `labor_cache`
- **`source`:** _none populated_
- **Path forward:** either (a) wire Playa locations to CrooHQ punch clock (`source='punch_clock'`), or (b) build Clover Employees/Shifts sync (`source='clover'`).

---

## 5. Inventory & Recipes

| Capability | Status | Notes |
|---|---|---|
| Brand Catalog deployment | ❌ | Not started |
| PFG sync | ❌ | Different distributor footprint |
| Produce Alliance sync | ❌ | TBD |
| Beer/Wine vendor mapping | ❌ | TBD |
| Recipe blueprints | ❌ | |
| POS → ingredient depletion | ❌ | Needs Clover item name → brand recipe mapping |
| AvT report | ❌ | Blocked on the above |
| COGS reconciliation | ❌ | Blocked on the above |

---

## 6. Known Gaps & Roadmap

- [ ] **Clover item → brand catalog mapping** — unlocks pizza/category tracker + ingredient depletion.
- [ ] **Labor source** — decide punch-clock vs Clover employees sync.
- [ ] **True guest count** — investigate Clover modifier/seat metadata.
- [ ] **gross_sales parsing** — pull pre-tax/pre-discount totals.
- [ ] **Inventory pipeline** — Brand Catalog seed + vendor mappings for Playa SKUs.
- [ ] **Voids / discounts / comps breakdown** — currently not extracted from order payload.
- [ ] **Webhooks** — eventually replace 15-min polling with Clover webhooks for live views.

**Last updated:** 2026-05-27 (after 429 retry fix + 365-day Georgetown backfill)
