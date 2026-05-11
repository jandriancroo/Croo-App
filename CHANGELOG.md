# CrooHQ Changelog

Plain-language notes for meaningful changes. SupaCRM ingests this file via the GitHub PAT and surfaces per-page notes by filtering on `[tag]`.

**Format:** `YYYY-MM-DD [page-tag] — One-line human summary.`

**Tags in use:** `[dashboard]`, `[inventory]`, `[sales]`, `[labor]`, `[schedule]`, `[tasks]`, `[logbook]`, `[messages]`, `[users]`, `[brand]`, `[org-dashboard]`, `[kds]`, `[punchclock]`, `[hiring]`, `[theo-ai]`, `[auth]`, `[settings]`, `[infra]`, `[crm-pattern]`. Add new tags as needed — keep them lowercase, hyphenated, and tied to a page or system.

---

2026-04-24 [crm-pattern] — Established CHANGELOG convention so SupaCRM can show plain-language notes alongside per-page commit feeds.
2026-04-24 [inventory] — Wired inventory-availability-sweep into queue_nightly_maintenance; runs nightly at 3am PST after vendor/labor jobs.
2026-04-24 [inventory] — Sweep now skips manual/invoice-only items (vendor_source filter), eliminating false 60-day flags. 76 items dropped from Hemet sweep, 81% match rate on remainder.
2026-05-11 [inventory] — A4: Nightly sweep now auto-deploys missing recipe ingredients. Brand recipes referencing brand templates not present locally get the local row created (or reactivated) automatically; every event logged to brand_auto_deployment_log. Emerald "Auto-deployed N items" badge appears on AvT report; full log at /brand/:brandId/inventory/auto-deploy-log.
2026-05-11 [inventory] — A5: Database trigger now blocks any inventory_items row from being active without a brand_item_id, enforcing the Brand-Centric Manifesto end-to-end. 491 inactive legacy orphans untouched.
