# Performance review submit — diagnosis (plan only)

## Bottom line
Nothing in the current code or database should still block Joey. The trigger bug that broke every review insert ever (`42703` in `log_logbook_audit`) was fixed live on 2026-09-05, and the fix is confirmed deployed. The "0 rows globally" is historical damage — every insert since launch failed — not evidence of a remaining blocker. Next step is a retry by Joey, not new code.

## Exact submit sequence
File: `src/components/logbook/LogBookNewEntrySheet.tsx:119-149` (form: `PerformanceReviewForm.tsx:207-234`)

1. `performance_reviews` insert — `{location_id, employee_id, created_by, follow_up_notes|null}` (`.select().single()`)
2. `performance_review_ratings` insert — one row per rating with `{review_id, item_id, rating, notes|null}`
3. `temporary_tasks` insert — "Sign Performance Review" quick task, `push_enabled: true`
4. `temporary_task_assignments` insert — assigns task to the reviewed employee
5. `performance_reviews` update — sets `task_id` to the new task

Note: rating photos upload earlier to the `logbook-uploads` storage bucket (`PerformanceReviewForm.tsx:153-186`); those URLs are collected but **not saved** to the ratings rows (insert at line 129 has no image column). This silently drops photos — a data gap, not a submit blocker.

## Required fields (form-side)
- Employee selected — else toast "Please select an employee"
- At least one rating > 0 — else toast "Please provide at least one rating"
- Follow-up notes optional

## Failure toast
Any server error in steps 1–5 → red toast: **"Error saving review"** with the database error message as the description (`LogBookNewEntrySheet.tsx:147-149`).

## Verification done today
- Fix confirmed live: `log_logbook_audit` no longer references `overall_rating` (uses `has_follow_up_notes`).
- `performance_reviews` columns: only `location_id`, `employee_id`, `created_by` are NOT NULL without defaults — all supplied by the form. No hidden constraint.
- RLS: manager policies exist and pass for INSERT on all five touched tables (`performance_reviews`, `performance_review_ratings`, `performance_review_items`, `temporary_tasks`, `temporary_task_assignments`).
- Joey confirmed: `has_role manager = true`, on Palm Springs `user_locations`; Palm Springs has 7 review items.

## Remaining risks (small)
- Steps 1–5 are not a transaction: if step 3 or 4 fails, an orphan review row is left. Would show as a partial success anomaly, not a failure.
- If Joey's app session predates the fix (stale tab), the error string in the toast description would name the real cause — ask him to screenshot the toast description text if it recurs.

## Recommended next step (no code)
Joey retries the submit once. If it succeeds, the zero-row history is explained and closed. If it fails, capture the exact toast description text — that string names the failing step precisely, and only then is a follow-up fix warranted.

## Technical details
- Submit handler: `src/components/logbook/LogBookNewEntrySheet.tsx:119-149`
- Form validation: `src/components/logbook/PerformanceReviewForm.tsx:207-234`
- Photo upload (unsaved): `src/components/logbook/PerformanceReviewForm.tsx:153-186`
- Fixed trigger: `public.log_logbook_audit()` (live DB, verified `has_follow_up_notes` present)
- Palm Springs location id: `d667741f-6d4c-433e-bb22-307e817ea7f1`; Joey: `b11846ef-880f-491a-85c9-2677ecc53d5f`
