# Second Toast runner key (MacBook Pro, temporary)

## What changes
Only one file: `supabase/functions/_shared/toastRunnerKey.ts`. The Mac mini keeps working exactly as it does now. Jordan's MacBook Pro gets its own key so a temporary runner can sign in.

## Who uses this file (checked)
- `toast-sync`: uses `isToastRunner` and `TOAST_RUNNER_HEADER`
- `toast-service`: uses `isToastRunner` and `TOAST_RUNNER_HEADER`
- Nothing else in the project imports it. No app screens, robots or GitHub workflows read it, and nothing outside this file reads `TOAST_RUNNER_KEY_SHA256`.

## Edit
- Add `TOAST_RUNNER_KEY_SHA256S` (read-only array):
  - `299b746e2d3cbfa669c61c4420cafa399e2d4ef3d0a1b3677d618afc7c0275c4`: Mac mini
  - `b2f0a20318c06e5bff9c4618a45c9e0a13ad64f3e972bc2b343de84b44ad8d86`: MacBook Pro (temporary; comment says to remove it when the MacBook is done)
- Keep `TOAST_RUNNER_KEY_SHA256` exported, still equal to the Mac mini digest, so the export names stay the same.
- Keep `TOAST_RUNNER_HEADER` and the `isToastRunner(req)` signature unchanged.
- `isToastRunner`: hash the header once, then do a constant-time compare against every entry. There is no early exit: results are OR-ed into one `matched` flag, and the function returns after the loop. A missing header still returns false right away (same as today). The header value is never logged.

## Deploy
Redeploy only `toast-sync` and `toast-service`. No database changes, no other files, no punch clock or kiosk code, no publish.

## Checks
- Both functions deploy.
- A request with no runner header to `toast-service` `list_active` still gets turned away (same as today).
- The real keys can only be tested from the runners. Jordan or Ryan should confirm that the Mac mini keeps posting and that the MacBook's heartbeat shows up.

## Side effects
None for the app. Either Mac can now act as the Toast robot, so both could pull at the same time if both are left running. The data stays correct because the saves are idempotent, but daily full-login counts in the heartbeat are shared across both Macs.
