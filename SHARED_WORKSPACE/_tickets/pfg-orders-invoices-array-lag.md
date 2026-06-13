# PFG Orders — Invoices[] Array Lag

## Summary
pfg_orders rows captured before invoicing have empty Invoices[] arrays.
PS June 11 order had empty Invoices[] until orders were re-synced,
which then populated the invoice keys needed for invoice sync.

## Impact
Invoice sync misses invoices at locations where orders were captured
pre-invoicing. Affects any store where sync_orders ran before PFG
completed invoicing for that delivery.

## Pattern
Same-day deliveries: order captured ~morning, invoiced ~afternoon/evening.
If sync_orders runs before invoicing completes, Invoices[] is empty.
Next day's order sync populates it correctly.

## Current mitigation
Nightly order sync (newly added) re-syncs recent orders which repopulates
Invoices[] before the invoice sync runs. Since invoice sync runs 5 minutes
after order sync, this self-heals overnight.

## Residual risk
Same-day manual syncs may still miss invoices if run before invoicing
completes. Acceptable — nightly will catch it.
