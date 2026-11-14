# Find the metrics in the Blaze daily sales summary report

## What the logs show today
- `fetch-qubeyond-sales`: no recent log lines contain `FULL RESPONSE`. That log line only prints when `fetchPeriodSales` runs, and none of the recent calls reached it.
- `sales-service`: it calls the same summary report, but only reads Net Sales (metricTypeId 1) and Check Count (metricTypeId 2). It never logs the full response, so no other metric names or ids appear.
- Answer for now: the metric list and whether "Gross Sales" is present **cannot be confirmed from the logs**.

## Proposed next step (needs your OK, read-only toward the sales feed)
Make one read-only call, run once from the sandbox through an existing admin check path, to `/api/v4/data/reports/summary/sections/sales` for one Blaze store and yesterday. Print only each item's `metric` and `metricTypeId`, with no dollar amounts.
- No code changes, no deploys, no database writes, nothing published.
- If a one-off call can't be made without the stored login details for the sales feed (they stay server-side), the fallback is a tiny temporary log line in `sales-service`. That would need a deploy, so I would ask you separately first.

## Reply format
1. A list of metric name = metricTypeId pairs.
2. Gross Sales present: yes/no.
