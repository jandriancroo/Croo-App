# Performance review submit fails for everyone (not just Joey)

## What's happening

Joey Tapia is Admin at Palm Springs and passes every access rule for performance reviews. The failure is not permissions.

The real cause: every time a performance review is saved, an automatic history/audit record is supposed to be written. That history step asks the review for an "overall rating" value — but performance reviews no longer store an overall rating. Postgres rejects the whole save, so the review never gets created and the screen shows "Error saving review".

Evidence: `performance_reviews` has **zero rows ever saved**, and both insert/delete audit triggers point at the same history routine that reads `overall_rating`, a column that does not exist on that table. So this is a fleet-wide breakage, not a Joey/Palm Springs issue.

## Findings (technical)

- Submit handler: `src/components/logbook/LogBookNewEntrySheet.tsx:119-150` — inserts `performance_reviews`, then `performance_review_ratings`, then a "Sign Performance Review" `temporary_tasks` row + assignment.
- Client toast on failure: `toast({ title: "Error saving review", description: error.message, variant: "destructive" })` at `LogBookNewEntrySheet.tsx:148`. Expected message: `record "new" has no field "overall_rating"`.
- Form required fields: `src/components/logbook/PerformanceReviewForm.tsx:207-234` — Employee (`employee_id`) and at least one star rating. Palm Springs has 7 active review items, so the form itself is fine.
- Trigger: `audit_perf_review_insert` / `audit_perf_review_delete` on `performance_reviews`, both call `public.log_logbook_audit('performance_review')`.
- `log_logbook_audit` `performance_review` branch builds metadata from `v_record.overall_rating`; `performance_reviews` has no such column (confirmed via information_schema).
- Access rules are fine: `performance_reviews`, `performance_review_ratings`, `performance_review_items` all require location membership + manager-or-higher; `has_role(joey,'manager')` returns true and he is mapped to Palm Springs. `temporary_tasks` / `temporary_task_assignments` insert rules also pass for admin. `logbook_audit` insert works because the trigger function is SECURITY DEFINER.

## Proposed fix (needs a named ship)

1. Database migration: update `public.log_logbook_audit` so the `performance_review` branch stops reading `overall_rating`. Replace that metadata with something that exists on the row (e.g. `follow_up_notes` presence, or an empty metadata object). No other branch changes.
2. Re-test one Palm Springs review submit end-to-end: review row created, ratings rows created, "Sign Performance Review" task assigned to the employee.
3. No client code change expected. If the toast still fires after the migration, capture the new message before touching `LogBookNewEntrySheet.tsx`.

## Not touching

Corrective Action / write-up audit branch, punch clock, logbook categories, review items, or the signature flow.
