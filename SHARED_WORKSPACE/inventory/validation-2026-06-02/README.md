# Inventory count validation pack

- Active locations: **14**
- Locations with a submitted count: **5**
- Latest submitted counts with 0 eligible NULL inner-pack rows: **5/5**
- Latest submitted counts inside the $3k-$15k range: **5/5**

## Files
- `validation_summary.csv` — one row per active location, including locations with no submitted count yet
- `validation_details.csv` — every line item on each latest submitted count, with computed value and flags
- `validation_legs.csv` — per-leg valuation detail for multi-pack items
- `validation_outliers.csv` — filtered rows that are high-value or large share-of-location

## Current summary

| Location | Latest count date | Ending value | Eligible NULL ipq | Top item |
|---|---:|---:|---:|---|
| Akers Mill | — | — | — | No submitted count |
| Anaheim | — | — | — | No submitted count |
| Georgetown | — | — | — | No submitted count |
| Hemet | 2026-05-23 | $5260.40 | 0 | Shredded Mozzarella ($356.76) |
| IUPUI | — | — | — | No submitted count |
| Niles | — | — | — | No submitted count |
| Palm Desert | 2026-06-01 | $4623.59 | 0 | Yeast - Individual ($324.44) |
| Palm Springs | 2026-06-01 | $6759.66 | 0 | Shredded Mozzarella ($376.58) |
| Reno | — | — | — | No submitted count |
| Reno | — | — | — | No submitted count |
| Rowlett | 2026-06-01 | $4803.75 | 0 | Receipt Paper Roll ($312.21) |
| Sandbox | — | — | — | No submitted count |
| Sparks | — | — | — | No submitted count |
| Tuscaloosa | 2026-06-01 | $6143.84 | 0 | Shredded Mozzarella ($1007.76) |
