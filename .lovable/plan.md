# Brand integration governance and POS-neutral sales plan

## Goal
Give each brand a clear integration profile, while making sales, projections, pacing, and brand calculations work consistently across QuBeyond, Clover, Aloha, and future sales systems.

## Brand integration controls
- Add an **Integrations** section to each brand’s edit window in Manage Brands.
- Super admins can choose:
  - one primary sales system: QuBeyond, Clover, Aloha, or None;
  - which supporting integrations are available: PFG, Produce Alliance, and OvationUp.
- Inventory stays always available and is not changed or made optional.
- A disabled integration disappears from location settings and cannot be newly connected for that brand.
- Existing credentials and historical data remain intact; disabling brand visibility does not delete data or silently erase an existing connection.
- Show enabled integrations on each brand card for quick review.

## Enforcement
- Store brand integration choices in a dedicated brand-level settings table with strict super-admin access.
- Enforce one primary sales system at the database level.
- Add a shared brand-integration check used by location settings and connection services, so hiding a card is not the only protection.
- New brands start with no sales system and no optional vendors enabled; the super admin must choose deliberately.
- Seed current brands from their existing live connections so nothing disappears during rollout.

## POS-neutral sales foundation
- Keep current shared sales column names and existing vendor archives; do not rename live columns.
- Define one normalized sales contract covering actual sales, checks, guests, hourly sales, product mix, discounts, tenders, source, and data quality.
- Each vendor adapter only translates its raw data into that contract.
- Route all vendors through the same shared calculations for:
  - initial and live projections;
  - overrides and pace-adjusted projections;
  - hourly pace, daypart/shift resets, grace periods, year-over-year, and recent trends;
  - custom brand calculations and product-mix rules.
- Move full-week projection seeding out of QuBeyond and into a shared process for every enabled primary sales system.
- Replace QuBeyond-specific screen refreshes with POS-neutral refresh actions.

## Surfaces to update
- Location integration settings: show only integrations enabled for the selected brand.
- Schedule Week Insights, dashboards, watch views, alerts, reports, Theo, and background jobs: read the same normalized sales/projection results regardless of POS.
- Brand inventory vendor readiness: use the brand’s enabled food vendors instead of assuming every brand requires both PFG and Produce Alliance. This changes the readiness check only; it does not alter inventory counting, deployment, matching, or sync behavior.

## Safety and rollout
1. Add brand settings and seed them from current connections without changing runtime behavior.
2. Add the Manage Brands controls and location-card visibility/blocking.
3. Add shared POS calculation orchestration beside current vendor paths.
4. Compare outputs per location for actuals, projections, pace, and custom calculations.
5. Switch each brand only after parity checks pass; retain vendor-specific raw archives and rollback capability.
6. Verify Blaze remains QuBeyond + PFG + Produce Alliance + OvationUp, with Clover and Aloha hidden.
7. Verify Playa Bowls exposes Clover, and BWW GO exposes Aloha, based on their saved brand settings.

## Technical details
- Use a new brand integration policy table rather than adding vendor-specific columns to `brands`.
- Use constrained integration keys and a unique brand/key record; enforce only one enabled POS-category record per brand.
- Keep `location_integrations` as location credentials/status and use brand policy as the allowed catalogue.
- Preserve `sales_cache` as the normalized sales mailroom, preserve `pos_source`, and do not write labor into it.
- Do not change `labor_cache`, scheduled labor, live labor, availability, locked 3D cubes, dock/toasts, updates, support tickets, or protected inventory flows.
- Add adapter contract tests, projection/pace parity tests, permission tests, and mobile/desktop visibility checks.
