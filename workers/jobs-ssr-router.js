/**
 * CrooHQ jobs SSR router (Cloudflare Worker)
 *
 * Bind to routes:  croohq.com/jobs   and   croohq.com/jobs/*
 *
 * Crawlers get fully rendered HTML from the Supabase SSR edge functions:
 *   /jobs          -> jobs-index
 *   /jobs/<slug>   -> job-detail/<slug>
 * Everyone else (humans in browsers) passes straight through to the SPA origin.
 *
 * Fail-open by design: any error, timeout, or non-OK upstream response falls
 * back to the origin so the human experience can never be broken by this Worker.
 */

const SSR_BASE = "https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1";

const CRAWLER_UA = [
  "googlebot",
  "google-inspectiontool",
  "storebot-google",
  "bingbot",
  "linkedinbot",
  "slackbot",
  "facebookexternalhit",
  "twitterbot",
  "duckduckbot",
];

function isCrawler(userAgent) {
  const ua = (userAgent || "").toLowerCase();
  return CRAWLER_UA.some((bot) => ua.includes(bot));
}

function ssrTarget(pathname) {
  // Exact /jobs (with or without trailing slash) -> index
  if (pathname === "/jobs" || pathname === "/jobs/") {
    return `${SSR_BASE}/jobs-index`;
  }
  const m = pathname.match(/^\/jobs\/([^/?#]+)\/?$/);
  if (m) {
    return `${SSR_BASE}/job-detail/${m[1]}`;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only GET/HEAD on the jobs surface is eligible.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return fetch(request);
    }

    if (!isCrawler(request.headers.get("user-agent"))) {
      return fetch(request); // humans -> SPA origin, untouched
    }

    const target = ssrTarget(url.pathname);
    if (!target) return fetch(request);

    try {
      const upstream = await fetch(target, {
        method: "GET",
        headers: {
          // Pass the crawler identity through so logs reflect reality.
          "User-Agent": request.headers.get("user-agent") || "crawler",
          "Accept": "text/html",
        },
        redirect: "follow",
      });

      // 404 from SSR is meaningful (expired/removed listing) — pass it through.
      if (!upstream.ok && upstream.status !== 404) {
        return fetch(request); // fail-open to origin
      }

      const headers = new Headers(upstream.headers);
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("X-Croo-SSR", "jobs-router");
      // Strip anything that would stop a crawler rendering/indexing the HTML.
      headers.delete("content-security-policy");
      headers.delete("content-security-policy-report-only");
      headers.delete("x-frame-options");
      headers.delete("content-encoding");
      headers.delete("content-length");

      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    } catch (err) {
      console.error("jobs-ssr-router fallthrough:", err && err.message);
      return fetch(request); // fail-open
    }
  },
};
