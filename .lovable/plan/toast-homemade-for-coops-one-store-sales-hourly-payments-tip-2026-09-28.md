# Toast (homemade) for Coops — one store, sales + hourly + payments/tips

## Goal
Get Coops' one Toast store into CrooHQ the same way QU / Clover / Aloha plug in, without paying for Toast's API. Built so the official API can replace the "fetcher" later with nothing else changing.

## How we get the data (no paid API)
Two free routes. Recommend doing both, in this order:

1. **Nightly Toast data export (official, free).** Toast Web lets the owner turn on "Data exports" — every night Toast drops CSV files (orders, checks, payments, items, time entries) on an SFTP server. A small scheduled GitHub job (same style as our PFG / PA / Ovation robots) downloads last night's files and hands them to CrooHQ. Rock-solid, allowed by Toast, but a day behind.
2. **Live robot login (homemade, for pacing).** Same trick as PFG: a headless browser logs into Toast Web with a Coops manager login every ~15 min during open hours, reads the Sales Summary numbers (net sales, hourly, tenders, tips) and posts them in. Gives the dashboard live pacing. Fragile if Toast changes its site or forces a phone code; the nightly export corrects any drift the next morning.

If Toast's login requires a phone/text code every time, route 2 is off and Coops runs day-behind until the paid API.

## What Coops needs to do
- In Toast Web: turn on Data Exports and send us the SFTP username + key.
- A read-only Toast Web login (manager, reports access only) for the live robot.
- Their Toast restaurant ID (shown in Toast Web URL).

## Technical details
- `pos_source = 'toast'`, `integration_type = 'toast'`.
- New archive table `toast_sales_cache` (mirrors `aloha_sales_cache`: location, sale_date, raw payload, source `export` | `live`), GRANTs + RLS by location membership.
- New edge functions `toast-sync` (ingest + normalize) and `toast-service` (connect/test/status), cloned from the Aloha pair. Ingest authenticated by a generated shared secret held by the GitHub jobs.
- Normalize into `sales_cache` on `(location_id, sale_date)` with conditional spread (never wipes projected / labor / payments_data); projections + pace via `_shared/projections.ts`; SDLY backfill from export history.
- Payments/tips into `payments_data`. No labor (not requested) — `labor_cache` untouched; register-labor switch hidden for Toast.
- Export rows win over live rows for the same day.
- Add `toast` to `POS_OPTIONS` and `liveSales.ts`; brand policy enabled only for the Coops brand; `ToastIntegrationCard` in store settings (same look as Aloha card).
- GitHub workflows `toast-export-pull.yml` (nightly, 4 AM PT) and `toast-live-scrape.yml` (every 15 min, store hours only).
- Update `docs/adding-a-new-pos.md` and `AGENTS.md`. No locked features touched. Times in America/Los_Angeles business dates with 10 AM cutoff.
- Swap-later: official API = replace the two GitHub jobs with one API fetcher posting the same payload to `toast-sync`.

## Order
1. Table + edge functions + settings card (can ship now, sits idle).
2. Nightly export job once Coops sends SFTP access.
3. Live robot once we test the login.
