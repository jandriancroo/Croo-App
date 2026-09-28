# Georgetown (Clover): hourly sales overcount daily net

Status: open (pre-existing, not caused by the Sept 2026 bundle)

Days where the hourly breakdown sums to more than daily net sales (net matches pkgc_backup_sales_cache exactly):

| Date | Net sales | Sum of hourly | Over by |
|---|---|---|---|
| 2026-08-12 | 1137.56 | 1162.04 | 24.48 |
| 2026-09-07 | 1641.76 | 1646.74 | 4.98 |
| 2026-09-11 | 961.35 | 964.35 | 3.00 |

Resync did not fix them. Likely cause: Clover hourly bucketing counts something (refunds, voids or modifiers) that the net formula excludes.
Rows left as is. Fix: make clover-sync scale hourly to net the same way aloha-sync does, or find the line items that differ.
