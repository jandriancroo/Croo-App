# {Brand Name}

- **Brand ID:** `{uuid}`
- **POS:** {POS name + version}
- **Locations:** {count} ({list or link})
- **Status:** 🟢 Live / 🟡 Pilot / 🔴 Setup

---

## 1. POS Integration

| Aspect | Value |
|---|---|
| Auth | _e.g. Bearer token from `location_integrations.credentials`_ |
| Base URL | |
| Sync function | `supabase/functions/{name}/index.ts` |
| Cadence | _e.g. every 15 min business hours + 3 AM PST yesterday + nightly backfill_ |
| Rate limits | |
| Webhooks | _streaming events, if any_ |

**Known quirks:** _date windows, timezone handling, pagination caps, etc._

---

## 2. Sales Cache Coverage

Which `sales_cache` columns this POS populates today.

| Column | Populated? | Notes |
|---|---|---|
| `net_sales` | ✅ / ❌ | |
| `gross_sales` | | |
| `guest_count` | | |
| `avg_ticket` | | |
| `hourly_data` | | |
| `product_mix` | | |
| `payments_data` | | |
| `pizza_count` | | |
| `yoy_*` | | |
| `projected_sales` / `living_projection` | | |

---

## 3. Data Cubes & Widgets

Cubes are POS-agnostic — they read from `sales_cache`. A cube renders for this brand if its source column is populated.

| Cube / Widget | Supported | Blocker if not |
|---|---|---|
| Sales Today | | |
| Pace | | |
| Projection | | |
| Avg Ticket | | |
| Guest Count | | |
| WTD / MTD | | |
| Last Year (YOY) | | |
| Labor % / Cost / Hours | | |
| Tracker (PMix categories) | | |
| Payment Breakdown | | |
| KDS | | |

---

## 4. Labor Source

- **Table:** `labor_cache`
- **`source` value:** `qubeyond` / `punch_clock` / `clover` / _none_
- **How it's written:** _sync function or punch clock_
- **Notes:** _overrides, manual edits, etc._

---

## 5. Inventory & Recipes

| Capability | Status | Notes |
|---|---|---|
| Brand Catalog deployment | | |
| PFG sync | | |
| Produce Alliance sync | | |
| Beer/Wine vendor mapping | | |
| Recipe blueprints | | |
| POS → ingredient depletion | | |
| AvT report | | |
| COGS reconciliation | | |

---

## 6. Known Gaps & Roadmap

- [ ] _Gap 1_
- [ ] _Gap 2_

**Last updated:** YYYY-MM-DD
