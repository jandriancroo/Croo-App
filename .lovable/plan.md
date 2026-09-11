# Reporting hourly sales + schedule preview / Clover trace

## Answer

### 1. Can Reporting show hourly sales?
**Yes — both day-by-day and combined for the selected period are feasible from data already stored.**

- Route: `src/App.tsx:88,222` loads `src/pages/Reporting.tsx` at `/reporting`.
- Reporting currently offers only a **Sales Total** block (`src/pages/Reporting.tsx:48,70-78,552-576`).
- Its data hook, `src/hooks/useReportData.ts:60-67`, reads only
  `sales_cache.net_sales` and `guest_count`; `LocationReportData.sales` only carries
  `{ net, guests }` (`:45,52`). It does **not** request `sale_date` or `hourly_data`.
- The selected period and selected locations already flow into
  `useMultiLocationReportData` (`src/pages/Reporting.tsx:681`).

Smallest future shape:
- Add `sale_date, hourly_data` to the existing `sales_cache` read.
- **Day-by-day:** one row/series per date, with its 24 hourly buckets.
- **Combined period:** sum matching hour buckets across all selected dates; when
  multiple locations are selected, either sum locations or retain the existing
  separate-location behavior based on `combineLocations`.
- This needs no new Clover sync or table. A new report block and export formatting
  would be the visible work.

### 2. Why schedule day preview hourly sales can be empty for Clover
**Leading diagnosis: the preview is calling the QU-only function instead of reading the shared sales cache. Clover sync itself is populating hourly data.**

There are two schedule day-preview surfaces with the same assumption:
- `src/components/schedule/DayBreakdownDialog.tsx:60-118`
- `src/components/schedule/MobileDayPreviewSheet.tsx:60-120`

For a past date they first try the browser's QU sales cache. On a miss, both call:

```text
fetch-qubeyond-sales({ locationId, targetDate })
```

They then expect `data.hourly[]`. That bypasses the POS-neutral `sales_cache` row.
For a Clover location, an empty/error QU response therefore leaves the preview
empty even though Clover hourly sales exist in the database.

Future-date projections in `DayBreakdownDialog.tsx:140-188` already query
`sales_cache.hourly_data`, so the component is internally split between a
POS-specific actual-sales path and a POS-neutral historical projection path.

### Clover hourly sync is healthy
- `supabase/functions/clover-sync/index.ts:86-95` builds the store-local business-day window.
- `:166-185` fetches orders in that window.
- `:335-393` buckets every eligible order into 24 local hourly buckets and produces
  `{ hour, sales, checksCount }`.
- `:498-531` writes that array to `clover_sales_cache.hourly_data`.
- `:534-562` dual-writes the same array to the shared
  `sales_cache.hourly_data` with `pos_source = 'clover'`.
- The live database confirms Georgetown's recent Clover rows contain 24 hourly
  buckets; Sep 10 has 11 non-zero hours and $1,104.30 net sales. This rules out a
  general Clover hourly-ingestion failure.

## Smallest recommended ship, if Jordan names it
1. Change both desktop and mobile schedule day previews to read actual past/today
   sales from `sales_cache` first, regardless of POS; retain the existing future-date
   projection logic.
2. Add an Hourly Sales report block backed by the same `sales_cache.hourly_data`,
   with a `Day by day / Combined` display option.
3. Keep all date keys as `yyyy-MM-dd` in the location's timezone and normalize the
   existing `{ hour, sales, checksCount }` shape before rendering.

No code or database changes were made.
