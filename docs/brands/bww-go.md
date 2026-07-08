# Buffalo Wild Wings GO

- **Brand ID:** `164ed861-d3bd-426d-8993-0403aa390634`
- **POS:** NCR Aloha Enterprise (Sierra Food Group portal)
- **Status:** 🟡 Pilot — plumbing shipped, data source pending

---

## 1. POS Integration

| Aspect | Value |
|---|---|
| Portal | https://sierrafoodgroup.alohaenterprise.com/portal/portal.jsp |
| Creds storage | `location_integrations.credentials` (integration_type = `aloha`) |
| Creds/test function | `supabase/functions/aloha-service/index.ts` |
| Sync function | `supabase/functions/aloha-sync/index.ts` |
| Backfill | Nightly queue task `backfill_aloha_sales` (7-day batches, 53 weeks / 371 days) |
| Cadence | `sync_all_yesterday` (via queue) + on-demand from UI |
| `pos_source` slug | `aloha` |
| Raw archive table | `public.aloha_sales_cache` (twin of `clover_sales_cache`) |

### Data source — **decision pending**

The entire plumbing is wired following the [add-a-POS spec](../adding-a-new-pos.md). The **only** stubbed function is `fetchAlohaDay(creds, date, tz)` in `aloha-sync/index.ts`. Once we know how to pull data, everything downstream (`sales_cache`, projections, YOY pacing, dashboards, backfill, labor) works with zero further changes.

Three viable paths, in order of preference:

1. **NCR Aloha Cloud API** — REST + Bearer token. Ask Sierra Food Group IT / NCR account rep for API credentials. Cleanest long-term.
2. **Aloha Insight scheduled export** — Sierra IT enables a nightly CSV/SFTP drop; we poll and parse. Good middle ground.
3. **Headless portal scrape** — Playwright login → export reports → parse. Mirrors our `.github/scripts/pfg-headless-login.mjs` pattern. Works today, brittle if the portal UI changes.

**What to ask Sierra Food Group:** "Does your Aloha environment expose a REST API (Aloha Cloud), or can you configure an Aloha Insight scheduled export to an SFTP endpoint we provide?"

---

## 2. Sales Cache Coverage

Populated by `aloha-sync` once `fetchAlohaDay` is wired:

| Column | Populated? | Notes |
|---|---|---|
| `net_sales` | ✅ | via `AlohaDayPayload.netSales` |
| `guest_count` | ✅ | |
| `avg_ticket` | ✅ | |
| `hourly_data` | ✅ | 24 buckets |
| `product_mix` | ✅ | by item id/name |
| `payments_data` | ✅ | `source: 'aloha'`, tender breakdown + tips |
| `pos_source` | ✅ | always `'aloha'` |
| `yoy_*` | ✅ | seeded from −364d inside `syncOneDay` |
| `living_projection` / `initial_projection` / `pace_adjusted_projection` | ✅ | via shared `_shared/projections.ts` |
| `pizza_count` | ❌ | Blaze-specific, always 0 |

---

## 3. Data Cubes & Widgets

POS-agnostic — every cube that reads `sales_cache` renders automatically once data flows.

| Cube / Widget | Supported once fetchAlohaDay is wired |
|---|---|
| Sales Today | ✅ |
| Pace | ✅ |
| Projection | ✅ |
| Avg Ticket | ✅ |
| Guest Count | ✅ |
| WTD / MTD | ✅ |
| Last Year (YOY) | ✅ (after 53-week backfill completes) |
| Labor % / Cost / Hours | ✅ (Aloha authoritative, punch clock fallback — see §4) |
| Tracker (PMix categories) | ✅ |
| Payment Breakdown | ✅ |
| KDS | ❌ (KDS is QU-webhook-driven; not planned for Aloha) |

---

## 4. Labor Source

**Hybrid: Aloha authoritative, punch clock fallback.**

- `labor_cache` unique key: `(location_id, labor_date, source)` — both coexist per day.
- `aloha-sync` writes `source='aloha'` when the payload includes labor.
- CrooHQ punch clock keeps writing `source='punch_clock'` independently.
- Readers prefer `source='aloha'` when present, fall back to `punch_clock`.

---

## 5. Inventory & Recipes

Not started. Brand Catalog seed required before any deployment. No POS dependency for this — inventory can move forward in parallel.

---

## 6. Known Gaps & Roadmap

- [ ] Confirm Aloha data source with Sierra Food Group (see §1).
- [ ] Implement `fetchAlohaDay()` in `aloha-sync/index.ts`.
- [ ] Wire `AlohaIntegrationCard` credentials form into the location integrations tab.
- [ ] Seed Brand Catalog for BWW GO menu.
- [ ] First smoke test: `sync_today` on one pilot store → verify `sales_cache` row + dashboard tiles render.
- [ ] Kick off 53-week backfill once smoke test passes.

**Last updated:** 2026-07-08
