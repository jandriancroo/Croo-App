# Make Coop's Toast data reliable

## What actually went wrong today

- The robot that reads Toast works by opening a web browser and signing in to Toast like a person would. It was running from my own workspace yesterday. That workspace shuts down on its own.
- The cloud schedule was supposed to start it at 10:45 AM Hayward time today. No data came in from it, and nothing noticed. The app kept saying "no one clocked in" and $0 instead of warning you.
- When I restarted it, Toast showed its "are you human" check. Cloud computers get that check more often than home computers do, so the cloud schedule most likely got stuck on it too.
- Bottom line: a robot pretending to be a person will always break sometimes. Retrying won't fix that. What fixes it is (1) using Toast's official data connection, (2) something that notices within minutes when data stops, and (3) screens that tell the truth when data is late.

## The fix, in three layers

### 1. The real fix: Toast's official data connection
Toast offers "Standard API access": read-only keys that let CrooHQ pull sales, checks, punches, and pay rates directly. No browser, no sign-in screen, and no "are you human" check. It's included with Toast's Restaurant Management Essentials plan (or higher) for U.S. customers.

- CrooHQ's own server pulls Coop's every 2 minutes during open hours and stops 2 hours after close. Nothing depends on my workspace or on GitHub.
- It feeds the same screens as today (dashboard, cubes, schedule, Toast icons, pay rates), so nothing changes for staff.
- The browser robot stays in place as a backup while we compare numbers for a few days. After that it gets retired.

**What I need from you (about 5 minutes):** in Toast Web, go to Integrations, then Toast API access, then Manage credentials. Create a read-only credential for Hayward and send me the Client ID and Client Secret through the secure box. If you don't see that menu, Coop's plan doesn't include it yet, and Toast support can turn it on.

### 2. The watchdog: notice within 10 minutes, not 2 hours
- Every 5 minutes while Coop's is open, CrooHQ checks when Toast data last came in.
- If more than 10 minutes pass with no update, it restarts the cloud robot on its own and sends you an alert: "Toast data for Hayward stopped at 10:52 AM, restarting."
- If it's still stale 20 minutes later, you get a second alert saying it needs a person.
- Restarting the cloud robot needs a GitHub access key from you, limited to running that one robot. Until you give me that key, the watchdog still sends the alerts.

### 3. Honest screens
- If a Toast store's data is more than 10 minutes old, the dashboard and mobile schedule show "Toast data delayed, last update 9:14 AM" in place of "no one clocked in" and $0.
- Last good numbers stay on screen. Nothing gets wiped.

## Order of work
1. Build layers 2 and 3 now. They protect you starting today, whatever happens with Toast's keys.
2. Build the official-connection puller so it's ready. Switch it on once you send the Toast keys, then run it side by side with the robot for 2 to 3 days to confirm the numbers match.
3. Retire the browser robot for Coop's once the numbers match.

## Technical details
- New edge function `toast-api-sync`: Toast OAuth client-credentials login (token cached until it expires), pulls orders by business date, labor time entries, employees, and jobs/wages. Normalizes into the same day payload and posts through `toast-sync` with `data_source='api'` (same rank as export, above live), per the swappable-fetcher rule. Writes nothing to `sales_cache` directly.
- pg_cron every 2 minutes; the function exits quickly when outside open hours to close + 120 minutes (America/Chicago for Hayward).
- Labor keeps going through the existing read-only Toast labor path, with source tagging and upserts. No change to the `labor_cache` rules, and labor is never merged into `sales_cache`.
- Watchdog: pg_cron every 5 minutes reads the latest Toast ingest time per Toast store. When stale, it calls GitHub `workflow_dispatch` for `toast-live-scrape.yml` (needs a `GITHUB_DISPATCH_TOKEN` secret with Actions write on this repo only), then alerts through the existing alert queue with push and email to super admins. A per-store cooldown prevents alert spam.
- Freshness banner: a small shared hook reads the latest Toast update time for Toast stores. It's used on the dashboard sales summary and the mobile schedule "NOW" block. Locked features (cubes, dock/toasts) are not touched.
- Secrets to request: `TOAST_API_CLIENT_ID`, `TOAST_API_CLIENT_SECRET`, `GITHUB_DISPATCH_TOKEN`.
