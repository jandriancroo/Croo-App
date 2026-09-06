# Performance Review — save failure fix

## 2026-09-05 — reviews could never be saved (fleet-wide)

**Symptom:** Joey Tapia (admin, Palm Springs) got the toast "Error saving review" when submitting a
performance review. `performance_reviews` had 0 rows globally — no review had ever saved.

**Root cause:** the insert/delete audit triggers on `performance_reviews`
(`audit_perf_review_insert`, `audit_perf_review_delete`) call `public.log_logbook_audit('performance_review')`.
That branch built metadata from `v_record.overall_rating`, but `performance_reviews` has no
`overall_rating` column (ratings live in `performance_review_ratings`). Postgres raised 42703 and
rolled back every insert.

**Fix:** migration replacing the `WHEN 'performance_review'` metadata with
`jsonb_build_object('has_follow_up_notes', ...)`. No other audit branch changed. No React changes.

**Verification:** live insert of one Palm Springs review succeeded (no 42703), then the test row and
its audit rows were deleted. `performance_reviews` back to 0 rows, `logbook_audit` performance_review
rows back to 0.

**Access rules confirmed fine:** reviews / ratings / items all require location membership +
manager-or-higher; Joey passes `has_role(...,'manager')` and is mapped to Palm Springs.
