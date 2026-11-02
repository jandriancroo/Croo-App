# Step 1: secure notification sending

## Scope
Change only `supabase/functions/send-push-notification/index.ts` plus Deno tests beside it and project notes. No schema, UI, email, punch/kiosk/time-clock, goal or claims-policy changes. Deploy this function only; do not publish. Rollback restores its previous index.ts.

## Security rules
- Authenticate before parsing, throttling, expanding targets or performing any delivery/write with `requireCaller`. Missing/invalid token → 401.
- One exported known-type catalog covers existing service types and aliases. Unknown types → fixed error. Service callers bypass user authorization, not existing delivery preferences.
- User types: chat_messages, announcements, schedule_updates, shift_approvals, logbook_entry, drawer_count, safe_count, waste_log, catering_order, task_assigned, quick_task, test. Test targets only the caller.
- Resolve role targets first; validate every target before filtering sender or throttling. Fail closed, reject the whole request if any target is unauthorized.
- Normal sends require caller and every target to pass has_location_access. Chat sends use verified is_chat_member for caller/targets, allowing cross-store chats. Hiring conversations without chat_members use verified location access.
- Support exceptions are recognized only from a server-loaded support ticket, never from a claimed request marker alone. Caller/target admin or super_admin status is server-verified. Preserve support replies without editing the locked support panel.
- Manager alert types require shift_manager-or-higher using existing role resolution plus access to the resolved location. Recipient roles remain unrestricted beyond access/preferences.
- Strip HTML, collapse whitespace, cap user title/body at 80/200 characters (including formatted title prefix). Ignore html, subject and email_* request fields. No email writes are added.
- Rejections contain only Unauthorized / Forbidden / Unknown notification type. Log one safe caller/type/location/reason line; remove token/endpoint previews and raw provider errors.

## Compatibility issues found — decision needed
**The literal requirement that user requests supply location_id conflicts with the one-function-only/no-breakage scope.** Existing callers below omit it. Recommended one-function solution: securely derive a missing location from a verified schedule, post, chat, hiring conversation or support ticket. For diagnostics only, resolve caller default location and enforce self-targeting. Do not trust unverified ids or infer location from a recipient.

Two remaining conflicts cannot be honestly marked compatible without an explicit exception:
1. HiringChat's applicant path is token-based, not a signed-in store employee. Mandatory requireCaller + store membership rejects it. It may already fail the current gateway, but its notification path is not guaranteed preserved. Keep applicant notification handling outside this step, or authorize a separate verified server-side applicant path later; never bypass JWT based on a claimed hiring marker.
2. DiagnosticMode sends service-only alert types and a fake chat_id. Exact user allowlist/chat membership rules reject those sends. Preserve the strict rules and report these diagnostics as intentionally rejected, or approve a narrowly self-targeted admin diagnostic exception.

Default proposal: preserve strict security for these two cases; securely resolve missing locations for legitimate record-backed callers. No client changes.

## Every current client caller checked (19 call sites, 15 files)
| Caller | Type | Targets | 2a–2c compatibility |
|---|---|---|---|
| pages/HiringChat.tsx | chat_messages | application-store admin/manager/general_manager roles | Type allowed; applicant lacks user/store auth: conflict above. |
| components/hiring/HiringChatPanel.tsx | chat_messages | same application-store management roles, excludes sender | Pass for staff with store access; hiring fallback uses location, not chat_members. |
| lib/chatMessages.ts | chat_messages | other chat_members | Pass via caller and target chat membership, including cross-store chats. |
| lib/feedPosts.ts | chat_messages or announcements | feed channel audience minus sender | Store checks; announcements additionally require shift_manager+. Reject cross-store audience unless separately authorized; not silently drop. |
| lib/quickTasks.ts | task_assigned | employeeIds and/or role-expanded users at location | Pass for shift_manager+ creator and same-store targets. |
| lib/scheduleActions.ts | schedule_updates | affected scheduled employees | Missing location; derive from verified schedule_id; shift_manager+ gate. |
| hooks/useLogBookData.tsx | logbook_entry | configured management roles; fallback manager+ | Pass for shift_manager+ sender and store recipients; lower-role submitters denied per requested rule. |
| components/schedule/MobileShiftDialog.tsx | shift_approvals | approved selected claimant | Missing location; derive from verified schedule_id; manager approver passes. |
| components/DiagnosticMode.tsx (three calls) | catalog of types; test; chat_messages | self only | Missing location; service-only type/fake chat_id conflicts above; ordinary self-test can use verified caller location. |
| components/feed/SeenByDialog.tsx | announcements | unseen post audience | Missing location; derive verified postId; sender must be shift_manager+, all targets need store access. |
| components/messages/AnnouncementStats.tsx | announcements | unread chat members | Missing location; derive verified chatId; requires shift_manager+ at chat location. Cross-store announcements remain outside chat_messages exception. |
| components/logbook/CateringOrdersSection.tsx | catering_order | admin/manager/shift_manager/training roles at location | Pass for shift_manager+ creator and same-store targets. |
| components/logbook/CateringOrderUploadInline.tsx | catering_order | same catering roles | Same checks as above. |
| components/dashboard/ShareTaskDialog.tsx | chat_messages | other chat members | Missing location, camelCase chatId; normalize alias, verify all memberships. |
| components/logbook/LogBookNewEntrySheet.tsx (three calls) | waste_log; drawer_count; safe_count | management role sets at location | Pass for shift_manager+ creator and same-store targets; lower-role submissions denied per requested rule. |
| components/support/SupportChatPanel.tsx | chat_messages | ticket owner | Missing location; server-load ticket_id and confirm support exception and admin status. |

These are source audits, not claims that every real user has passed the new checks. Existing lower-role manager-alert senders will be rejected as explicitly requested. No recipient manager-only gate will be added.

## Technical approach
Keep exported policy/handler hooks in index.ts with `if (import.meta.main)` serving, so Deno tests can import it without starting a server. Inject a fake client/auth/delivery boundary only in tests; never add a caller-controlled dry-run or auth bypass. Use existing RPC signatures `_user_id`, `_location_id`, `_chat_id`. Keep notificationGate, onClock and transport behavior unchanged except removing unsafe logs. Preserve verify_jwt configuration unless a verified signing-key failure requires a separately approved change.

## Tests and safe manual check
Deno tests run the actual handler against in-memory seeded identities and stub delivery:
- Team Store A → Store B recipient: 403, zero writes/deliveries.
- Shift manager Store A → Store A schedule update: 200, stub push delivered.
- Team member schedule update: 403.
- Service alert-push-sender, feed trigger payloads and future NCNS-shaped known-type payload: allowed, stub delivery. NCNS path is not yet present, so no real step-3 integration claim.
- HTML/subject/email_* plus 2,000-character body: plain-text 200-character push; no email_queue write.
- Unknown type: rejected for user and service. Missing/invalid auth: 401.
- Mixed valid/invalid targets, role expansion, chat membership, hiring fallback, verified support, missing-location resolution, self-test restriction and sanitized logs.
Manual live check only sends unauthorized/invalid requests that cannot deliver; successful paths use stubs only. Do not trigger real cron/feed pushes, send real employee notifications or create test business rows. Check deployment boot and preview build. Report tested versus unverified paths explicitly.
