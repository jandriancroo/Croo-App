# Roadmap

## In progress
- [ ] Per-till expected cash fix: fetch individual QU till rows (AM/PM), match to the count instead of summing the day; keep live fallbacks; never $0.

## Open
- [ ] Overnight fill-in: after QU reconciles the closing till, fill expected cash for counts saved with no/blank expected.
- [ ] Backfill the 54 Tuscaloosa nights (and any SM gaps) with QU per-till expected figures — needs approval before writing history.
- [ ] Deposit single-system rule: deposits happen either in CrooHQ or in the POS, not both. Decide detection/UX (e.g., notice when a store deposits in QU) and guidance.
- [ ] Pre-existing security findings (28) still awaiting user review.
