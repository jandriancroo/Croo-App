# Blaze Pizza

- **Brand ID:** `5f805404-cc7b-454b-a994-fe5901c32e6a`
- **POS:** QU Beyond (V4 REST + webhooks)
- **Status:** 🟢 Live — primary brand, full feature coverage

---

## 1. POS Integration

| Aspect | Value |
|---|---|
| Auth | **Global** env vars (`QU_*`) — never per-location portal creds (prevents 401s) |
| Base URL | QU V4 REST |
| Sync function | `supabase/functions/fetch-qubeyond-sales` + `labor-service` |
| Cadence | Every 15 min during business hours · 3 AM PST `sync_yesterday` · nightly maintenance |
| Rate limits | OK with global auth; PMix search uses single 90-day aggregate call (see POS Search Optimization) |
| Webhooks | ✅ `Closed Check`, `Till`, `EOD` events stream to `qu-data-streaming` → drives KDS + live views without polling |

**Known quirks:**
- All dates use Luxon `yyyy-MM-dd` PST/PDT (`America/Los_Angeles`), 10 AM business-day cutoff.
- Midnight punch-clock crossovers preserve `shift_id` from `lastPunch`.

---

## 2. Sales Cache Coverage (`pos_source = 'qubeyond'`)

| Column | Populated? | Notes |
|---|---|---|
| `net_sales` | ✅ | |
| `gross_sales` | ✅ | |
| `guest_count` | ✅ | |
| `avg_ticket` | ✅ | |
| `hourly_data` | ✅ | |
| `product_mix` | ✅ | Normalized array; feeds inventory depletion |
| `payments_data` | ✅ | Tender + tips, deep-nested merge |
| `pizza_count` | ✅ | Mapped from PMix categories |
| `yoy_*` | ✅ | Full 53-week backfill complete |
| `projected_sales` / `living_projection` | ✅ | Shift-aware pacing with 3 PM reset |

---

## 3. Data Cubes & Widgets

✅ **All cubes supported.** Blaze is the reference implementation — every widget on the dashboard was designed against this dataset.

- Sales Today, Pace, Projection, Avg Ticket, Guest Count
- WTD, MTD, Last Year (YOY)
- Labor %, Labor Cost, Labor Hours
- Tracker (Pizzas Sold, category counts)
- Payment Breakdown (cash / card / 3PD / tips)
- KDS (streaming, hybrid paid-check)

---

## 4. Labor Source

- **Table:** `labor_cache`
- **`source`:** `qubeyond` (primary) + `punch_clock` (overrides where local punch is used)
- **Rules:** unique `(location_id, labor_date, source)`. Punch-clock entries override QU for the same date.

---

## 5. Inventory & Recipes

| Capability | Status | Notes |
|---|---|---|
| Brand Catalog deployment | ✅ | Authoritative source — Brand-Centric Manifesto |
| PFG sync | ✅ | Bid Guide → TRACS fallback, 21-day order fetch |
| Produce Alliance sync | ✅ | Pack-string parsing, dual identifiers |
| Beer/Wine vendor mapping | ✅ | High-Price Primary consolidation |
| Recipe blueprints | ✅ | Brand baseline + location overrides via Merge & Inherit |
| POS → ingredient depletion | ✅ | Global PMix mapping, brand-scoped |
| AvT report | ✅ | Top-down (POS) vs bottom-up (invoices) |
| COGS reconciliation | ✅ | Period hierarchy + monthly close safeguard |

---

## 6. Known Gaps & Roadmap

- No outstanding POS-layer gaps.
- Ongoing: vendor SKU lifecycle monitoring (nightly check, see Vendor Lifecycle).

**Last updated:** 2026-05-27
