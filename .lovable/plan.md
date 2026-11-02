# Step 2 — Real notification email

## Result
Make Email settings work through the existing secured notification sender, including automatic email for important alerts when a phone has no push registration. Keep existing standalone emails unchanged. Do not publish or send test messages to employees.

## Build
- Add shared, byte-identical browser/server email defaults. Announcements, shift reminders, certifications and existing hiring/time-off defaults are ON; all others OFF, including every noisy cash/chat/pulse type.
- Add `notifyEmail.ts`: server-loaded records and shared branded header, short paragraph, one CrooHQ button, escaped values and the requested settings footer. Never use caller text or HTML.
- Separate email eligibility from personal push settings. Preserve role/org authorization and existing push behavior; evaluate Email opt-in independently. Important no-token/dead-token fallbacks ignore From home; normal opt-in emails follow From home. Never queue individual overdue-checklist emails.
- Load tokens for email-eligible users, track per-user push outcomes, then queue Email opt-ins/fallbacks even when no push remains. Preserve existing response fields and add `pushed`, `emailed`, `emailed_fallback` counts. Diagnostic sends remain push-only.
- Forward `alert_queue.dedup_key` as `data.dedup_ref` in both alert sender branches. Stable dedup keys prevent repeats; chat throttles use a 30-minute window and per-chat/user serialization so simultaneous sends cannot duplicate. Pulse dedup includes store/pulse identity.
- Add the requested settings help line and LOCKED-row wording; retain every Email checkbox. Add `/settings?section=notifications` support only for that section, including Duo presentation.

## Exact reset preview (read-only, before changes)
The following query was run; rerun immediately before the transaction and stop if the scope changes unexpectedly:

```sql
SELECT notification_type, count(*) AS total_rows,
 count(*) FILTER (WHERE email_enabled = true) AS currently_on,
 count(*) FILTER (WHERE email_enabled = false) AS currently_off,
 count(*) FILTER (WHERE email_enabled IS NULL) AS null_rows
FROM public.user_notification_settings
WHERE notification_type IN ('announcements','shift_reminders','certification_expiring',
 'chat_messages','hourly_sales_pulse','day_part_pulse','shift_overstay',
 'cash_drawer_count','cash_safe_count','cash_bank_deposit')
GROUP BY notification_type ORDER BY notification_type;
```

| Type | Total to snapshot | ON now | OFF now | New value | Changed |
|---|---:|---:|---:|---|---:|
| announcements | 41 | 24 | 17 | ON | 17 |
| shift_reminders | 28 | 13 | 15 | ON | 15 |
| certification_expiring | 40 | 17 | 23 | ON | 23 |
| chat_messages | 41 | 24 | 17 | OFF | 24 |
| hourly_sales_pulse | 29 | 13 | 16 | OFF | 13 |
| day_part_pulse | 29 | 11 | 18 | OFF | 11 |
| shift_overstay | 28 | 10 | 18 | OFF | 10 |
| cash_drawer_count | 38 | 18 | 20 | OFF | 18 |
| cash_safe_count | 38 | 18 | 20 | OFF | 18 |
| cash_bank_deposit | 38 | 18 | 20 | OFF | 18 |

**350 rows snapshotted, 187 email values changed; zero NULLs.** Back up `(id,email_enabled)` into service-only `user_notification_settings_email_backup_20261101`. Only email_enabled changes; verify push/alert/from_home and unrelated settings are identical. Platform migrations create the secured backup/necessary additive queue safeguards; the guarded data correction runs through the database tools, not as a data-only migration. Restore original email values by joining the snapshot on id.

## Technical safeguards and assumptions
- Keep `verify_jwt=true` and all Step 1 protections, including the corrected applicant/admin/crew paths.
- Do not modify `notificationGate.ts`, its LOCKED_KEYS, or its From home behavior. Email aliases are layered in the new module: shift reminders retain their own Email row/default despite the existing push alias to schedule_updates; schedule approvals map to schedule settings and drawer/safe/bank to cash keys.
- Keep push tokens and delivery errors private. Queue via the existing email sender, never new Resend calls; exclude inactive, example.com, bounced and suppressed addresses case-insensitively.
- Existing queue dedup is a partial unique index; use conflict-safe queue insertion appropriate to that index, without changing other email paths. Leave target_date NULL to avoid the existing one-email-per-location/date index.
- Unknown/missing record IDs must not pull caller content into email; use a verified scoped record or a fixed generic server template only when a trusted stable alert reference is available. Sensitive records must match the authorized store/thread and audience.
- Rollback: `NOTIFY_EMAIL_ENABLED=false`; restore snapshot if undoing the initial reset. Deployment activates real notifications through ordinary production sends, but all verification uses stubs/dry runs.
- Standalone hiring, write-up/review, waste-log email, availability insights and daily/weekly summaries are not migrated or duplicated. The overdue Email checkbox remains present but per-item email stays disabled until the Step 4 digest.

## Tests and deployment
- Deno seeded tests: no-token schedule/offer/announcement fallback and exact dedup; rerun no duplicates; push-token announcement toggle OFF/ON; no-token chat OFF/ON plus 30-minute throttle; dead 404/410 vs transient failure; From home vs fallback; example/bounced/suppressed/inactive exclusions; caller-text exclusion; overdue exclusion; rollback flag.
- Retain all Step 1 authorization tests and notification preference tests; assert the three new ON defaults and noisy OFF defaults in both copies.
- Browser checks: new-user defaults using intercepted settings reads (no stored changes), all Email checkboxes, notifications deep link and mobile layout.
- Deploy only changed notification functions, not the app; report exact callers, test results, migration/snapshot/reset counts and any verification limits.

## Client caller audit
The complete current caller table will be added before this plan is presented; no per-caller email changes are planned.