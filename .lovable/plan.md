# Google for Jobs — where CrooHQ actually stands

Diagnosis only. No code written. Homepage untouched.

## Short answer

About 85% of the machinery is built and live. One missing piece blocks everything: when Google visits a real job page on croohq.com, it gets a blank app shell with no job data in it. The fully-formed, Google-ready version of that same page exists — it just isn't wired to the public address.

There are 3 live job listings marked for syndication today (Team Member, Shift Manager, and one more) across Blaze locations.

## What already works

- **Job pages render correct Google job markup** — the app's job page builds a proper JobPosting block (title, description, posted date, employment type, company, full address, pay range, expiry only when real, apply-elsewhere flag).
- **A crawler-ready version exists and responds correctly.** Requested directly, it returns real HTML with the job title in the page title and the JobPosting block present.
- **Sitemaps are live and correct.** croohq.com/sitemap.xml points at a generator that lists /jobs plus every active listing at its clean URL (e.g. /jobs/hemet-shift-manager-e80d9518). A second, near-duplicate jobs sitemap also exists.
- **robots.txt allows Google** and names the sitemap.
- **An XML job feed for Indeed/LinkedIn-style boards is live**, plus a JSON version.
- All of these answer publicly with no login required — verified live today.

## What's missing

1. **The public job URL doesn't serve the job.** `https://croohq.com/jobs/<slug>` returns the generic CrooHQ shell: title still reads "CrooHQ — Restaurant operation system…", zero job markup in the HTML. Google for Jobs will not list a page whose markup only appears after the browser runs the app. The code even carries a comment saying an external rewrite is supposed to redirect crawlers to the ready-made version — **that rewrite does not exist anywhere in this project.** This is the single blocker.
2. **Nobody is recording syndication activity.** The `job_syndication_logs` table was created months ago and has 0 rows; no code anywhere writes to it. So there's no history of what was submitted where.
3. **No Indexing API usage.** Nothing in the project notifies Google when a job is posted, edited, or expires. Google would only find jobs on its own crawl schedule, and expired jobs would linger.
4. **Two overlapping sitemaps** (main and jobs-only) risk drifting apart; only the main one is actually referenced.
5. **No Google site verification tag** on the site, so nobody can watch indexing results or submit URLs.
6. **Address parsing is fragile.** City/state/zip are guessed by splitting the location's single address text. If a store address isn't formatted "street, city, ST 92543", Google will reject the posting for a bad location.
7. **Description quality risk.** Google requires a real HTML job description; short one-liners or plain text with no structure often get rejected.

## Exact steps to get a live posting into Google

1. **Fix the public URL** (the ship). Pick one:
   - *Recommended:* make `/jobs/<slug>` and `/jobs` serve the already-working crawler-ready HTML at croohq.com, via a hosting-level rewrite in front of the app.
   - *Alternative:* upgrade the project to a server-rendered template so React pages ship their markup in the HTML directly. Bigger change, better long term ([what the upgrade gives you](https://lovable.dev/blog/building-apps-using-tanstack-start)).
2. **Verify croohq.com in Google Search Console** and submit `https://croohq.com/sitemap.xml`.
3. **Audit the 3 live listings' addresses and descriptions** against Google's rules before submitting; fix any store address that doesn't parse into city/state/zip.
4. **Add Indexing API notification** on job publish / edit / expire, and log each call into `job_syndication_logs` so there's an audit trail. (Separate, smaller ship — do after step 1 proves indexing works.)
5. **Retire or alias the duplicate jobs sitemap** so there's one source of truth.

## How to test

1. `curl` a live job URL with a Googlebot user agent and confirm the HTML contains `JobPosting` and the job's real title. Right now this fails; after step 1 it must pass.
2. Paste the same URL into Google's Rich Results Test and confirm "Job posting" detected with no errors.
3. In Search Console, use URL Inspection on that job URL, then request indexing.
4. After indexing, search `site:croohq.com/jobs` and check the job appears in Google's job search box.
5. Expire a listing and confirm the URL drops out of the sitemap and returns not-found or an expired state.

## Scope notes

- Homepage untouched in every option above.
- No writes made. Awaiting a named ship from Jordan for step 1.
