# Playa Bowls shared projections and pace

## Goal
Make Playa Bowls’ Clover data produce the same complete Week Insights sales forecast and live pace results as every supported POS, without changing historical sales or labor.

## Build
1. Add a POS-neutral projection action that reads normalized `sales_cache` history and generates daily forecasts for a requested week.
2. Use the existing shared projection and pace formulas; Clover remains responsible only for translating and saving raw Clover sales.
3. Preserve manager overrides and the first saved projection. Create missing future-day rows only, or fill missing projection fields without replacing actual sales or overrides.
4. Update Week Insights to request the shared projection action instead of calling the QuBeyond-only action. Today will refresh through the brand’s enabled POS; future days will then load from the shared cache.
5. Connect the existing nightly/today sales process to refresh the upcoming week for every enabled POS brand.

## Safety boundaries
- Do not alter `labor_cache`, live labor, scheduled labor, availability, inventory, or any locked feature.
- Do not rename or remove existing sales columns.
- Do not overwrite Clover history, manager overrides, or valid existing projections.
- Use America/Los_Angeles/store-local business dates.

## Before-and-after proof
For Playa Bowls Georgetown, September 14–20, 2026:
- Record the current seven daily sales/projection values and sources from `sales_cache` and Week Insights.
- Run the shared forecast for the week.
- Record the resulting daily values, sources, weekly total, and today’s pace value.
- Verify historical days are byte-for-byte unchanged and future days now show projections.
- Verify the Week Insights screen displays the same numbers on desktop and mobile widths.
