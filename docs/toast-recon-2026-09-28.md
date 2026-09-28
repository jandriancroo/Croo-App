# Toast robot recon — first successful sign-in (2026-09-28)

## Sign-in (works, repeatable)
- Cloudflare "Just a moment" on www.toasttab.com → headful Chromium under Xvfb with stealth init script passes it (clicking the Turnstile box if interactive).
- Auth0 flow: auth.toasttab.com/u/login/identifier → email (input[name=username]) → Continue → password → Continue → MFA-OTP page ("Check your authenticator application for a code… every 30 days per device") → TOTP from saved setup key (input[inputmode=numeric]) → Continue.
- Lands on https://www.toasttab.com/restaurants/admin/home. Correct credentials + valid code only, no lockout seen across 3 spaced runs.
- Session cookies don't survive into a new browser context reliably; sign in once per run and reuse the session for all page pulls.

## Endpoints (seen in capture, all under www.toasttab.com/api/service)
- report-generator/v1/reportDefinition/sales/SalesSummary — GET, defines the report
- report-generator/v1/reportRequest — POST (654-byte request) → returns reportRequestGuid
- report-generator/v1/reportRequest/<guid>/results — JSON with status COMPLETED + rowCount blocks (diningOptions, revenueCenters, services, salesCategories, discounts, voids, netSales, cashSummary, employeeTips, paymentTypesSummary, revenueSummary, taxSummary, serviceModeSummary, unpaidOrders, trendsByDate, trendsByDay, trendsByHour, cashActivity)
- restaurant-admin-graphql/v1/graphql (persistedQuery ops) — session, permissions, employee lookups, restaurant info
- report-generator/v1/resolveEntities — employee name → userGuid mapping (EMPLOYEES entityType, userGuid + restaurantUserGuids) — usable for Toast↔CrooHQ employee matching

## Sales data shape (capture 0144, today @ Coop's default restaurant)
Per dining option: {diningOptionName, itemCount, orderCount, grossSales, discountAmount, netSales, taxAmount} — e.g. Dine In 122 items / 29 orders / net 990.48; Take Out 28 / 13 / 499.50.
Per revenue center: Bar 972.34, Dining Room 252.91, No RC 234.25, Patio 30.48.
Per service: Lunch 40 orders, net 1358.73. Tax 73.07, discounts 20.25. Daily net 1,489.98 (matches dashboard).
Contains everything sales_cache needs (net, gross, discounts, tax, orders, items, hourly trends, tips, cash).

## Time entry (punches)
- Time entry management page shows today's punches with employee, anomalies, location, job title, date, time-in: 7 rows today (Kayla Krogh 8:21 AM, Lora Hills 8:27 AM, …, Arianna Cuddy 9:54 AM, Douglas Kagigebi 1:19 PM). Related pages: Time entry reporting, Time entry audits, Break entries, Break adherence, Employee productivity (→Labor), Labor summary, Labor cost breakdown, Hourly sales, Shifts.
- The punch rows JSON was not captured this run (fetch fell outside the capture filter); next pass should capture the reportRequest for the time-entry report definition (same report-generator mechanism).

## Open items
- Which restaurant GUID is Hayward: default restaurant on login is c93b197b-bbc8-4d94-a8b3-cc24cddc8c06 ("Coop's Pizza") — the saved TOAST_HAYWARD_RESTAURANT_ID does NOT match it. Verify location switcher / restaurant sets (GetAccessibleRestaurantSets captured) and confirm Hayward's GUID before pointing the fetcher.
- Capture exact punch-row payload for the labor pairing features (read-only; user sign-off required before writing any labor_cache 'toast' source).
- Cookie consent + setup checklist popups must be dismissed per run.

## Resolved (2026-09-28 12:42 PT)
- User confirmed Coop's has only ONE Toast location. Working restaurant GUID for all Toast calls: c93b197b-bbc8-4d94-a8b3-cc24cddc8c06 (label "Coop's Pizza"). The saved TOAST_HAYWARD_RESTAURANT_ID value is a different string — treat c93b197b as authoritative; keep the saved secret untouched.
