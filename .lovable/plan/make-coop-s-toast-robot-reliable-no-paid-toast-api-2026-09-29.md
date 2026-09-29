# Make Coop's Toast robot reliable (no paid Toast API)

## What went wrong today
- The robot reads Toast by opening a browser and signing in like a person. Yesterday it was running from my workspace, which shuts down on its own.
- The cloud schedule was supposed to start it at 10:45 AM Hayward time. No data arrived, nothing noticed, and the app showed "no one clocked in" and $0 when it should have warned you.
- Toast's "are you human" check hits cloud computers more often, so the cloud run most likely got stuck there.
- Because it's a robot pretending to be a person, it will sometimes break. The goal is to catch every break within minutes, fix itself where it can, and never show wrong numbers.

## The fix, in four parts

### 1. A watchdog that notices within 10 minutes
- Every 5 minutes while Coop's is open (until 2 hours after close), CrooHQ checks when Toast data last came in.
- No update for 10 minutes: it starts the cloud robot again on its own and sends you an alert, like "Toast data for Hayward stopped at 10:52 AM, restarting."
- Still no update 20 minutes later: a second alert says a person needs to look. The alert includes the reason the robot gave, for example "stuck at Toast's human check."
- To start the robot on its own, CrooHQ needs a GitHub key from you that can only run that one robot. Until you add the key, you still get the alerts.

### 2. A robot that doesn't quit
- **Starts reliably:** GitHub's timed starts can run late or get skipped. Instead of three fixed start times, the watchdog starts the robot at opening and at every handoff.
- **Reports in:** The robot checks in with CrooHQ every cycle: signed in, stuck at the human check, Toast page blank, or stopped. The watchdog and the alerts use that.
- **Human check:** It keeps its saved sign-in so the check rarely comes up. If the check shows, it waits it out and tries again, spacing tries at least 2 minutes apart, with no more than 4 full Toast sign-ins a day. The watchdog never contacts Toast itself; it only reads CrooHQ records.
- **Clean handoff:** A new run starts before the old one ends, so there's no gap.

### 3. Honest screens
- When a Toast store's data is more than 10 minutes old, the dashboard and mobile schedule show "Toast data delayed, last update 9:14 AM" instead of "no one clocked in" and $0.
- Last good numbers stay on screen. Nothing gets wiped.

### 4. Tonight's export catches up
- Once the robot is back, it re-pulls the whole day, so the day's final numbers come out right even after a gap.

## What I need from you
- One GitHub key (about 3 minutes, I'll walk you through it). It can only start the Toast robot.

## Technical details
- New table `toast_robot_heartbeats` (location_id, run_id, state: signed_in / human_check / blank / stopped, message, at), with GRANT to service_role and RLS read access for super admins. The runner posts to `toast-service` action `heartbeat` (x-cron-secret).
- New edge function `toast-watchdog` on pg_cron every 5 minutes. For each active Toast store inside its open window (open time to close + 120 minutes, in the store's own time zone), it reads the latest `toast_sales_cache.fetched_at` and the latest heartbeat. When data is stale for 10 minutes or more, it calls GitHub `workflow_dispatch` on `toast-live-scrape.yml` (secret `GITHUB_DISPATCH_TOKEN`, fine-grained, Actions write on this repo only) and queues alerts through the existing alert queue with push and email to super admins. A 15-minute cooldown per store prevents spam, and it escalates at 20 minutes.
- Workflow: keep the cron starts as a backup and add a dispatch from the watchdog at store open. The runner exits 20 minutes before its limit, after triggering its successor through a heartbeat flag, so the watchdog can dispatch the next run with no gap. Concurrency stays at one Toast sign-in at a time.
- On catch-up, the runner re-posts the full day through `toast-sync` (the same day payload the swappable-fetcher rule requires). Sales stay out of labor, labor keeps its source tags and upserts, and nothing writes to `sales_cache` directly.
- Freshness banner: a shared hook reads the latest Toast update time. It's used on the dashboard sales summary and the mobile schedule "NOW" block. No locked features are touched (cubes, dock/toasts).
