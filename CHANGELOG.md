# CrooHQ Changelog

Plain-language notes for meaningful changes. SupaCRM ingests this file via the GitHub PAT and surfaces per-page notes by filtering on `[tag]`.

**Format:** `YYYY-MM-DD [page-tag] — One-line human summary.`

**Tags in use:** `[dashboard]`, `[inventory]`, `[sales]`, `[labor]`, `[schedule]`, `[tasks]`, `[logbook]`, `[messages]`, `[users]`, `[brand]`, `[org-dashboard]`, `[kds]`, `[punchclock]`, `[hiring]`, `[theo-ai]`, `[auth]`, `[settings]`, `[infra]`, `[crm-pattern]`. Add new tags as needed — keep them lowercase, hyphenated, and tied to a page or system.

---

2026-04-24 [crm-pattern] — Established CHANGELOG convention so SupaCRM can show plain-language notes alongside per-page commit feeds.
2026-04-24 [inventory] — Wired inventory-availability-sweep into queue_nightly_maintenance; runs nightly at 3am PST after vendor/labor jobs.
2026-04-24 [inventory] — Sweep now skips manual/invoice-only items (vendor_source filter), eliminating false 60-day flags. 76 items dropped from Hemet sweep, 81% match rate on remainder.
