#!/usr/bin/env node
// Assert JobPosting is in the raw HTML for every prerendered job, including the
// three live slugs. Default reads dist/ after vite build.
// After publish: node scripts/check-jobs-html.mjs --curl https://croohq.com
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PINNED_PUBLIC_JOBS,
  assertHomepageShell,
  assertJobHtml,
  assertJobsIndexHtml,
  jobPostingsIn,
} from "../src/lib/jobSeo.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const relax = process.env.JOBS_PRERENDER_RELAX === "1";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function notesFor(html, pin) {
  const notes = assertJobHtml(html, pin);
  for (const note of notes) console.warn(`FLAG ${note}`);
}

function checkHtmlSet({ homepage, index, pages, sitemap }) {
  assertHomepageShell(homepage);
  const pins = relax ? [] : PINNED_PUBLIC_JOBS;
  assertJobsIndexHtml(index, pins.length ? pins : PINNED_PUBLIC_JOBS.filter((pin) => pages.has(pin.slug)));
  if (!relax) {
    for (const pin of PINNED_PUBLIC_JOBS) {
      const html = pages.get(pin.slug);
      if (!html) fail(`Missing raw HTML for ${pin.slug}`);
      notesFor(html, pin);
    }
  }
  for (const [slug, html] of pages) {
    const pin = PINNED_PUBLIC_JOBS.find((item) => item.slug === slug);
    if (pin) continue;
    const postings = jobPostingsIn(html).filter((item) => item.url === `https://croohq.com/jobs/${slug}`);
    if (postings.length !== 1) fail(`${slug}: expected one JobPosting in raw HTML`);
    if (!html.includes(`href="https://croohq.com/jobs/${slug}"`)) fail(`${slug}: canonical missing`);
    if (html.includes("SoftwareApplication")) fail(`${slug}: homepage schema still present`);
  }
  for (const pin of relax ? [] : PINNED_PUBLIC_JOBS) {
    const loc = `https://croohq.com/jobs/${pin.slug}`;
    if (!sitemap.includes(`<loc>${loc}</loc>`)) fail(`jobs sitemap missing ${loc}`);
    if (!sitemap.includes("<lastmod>")) fail("jobs sitemap missing lastmod");
  }
  if (!sitemap.includes("<loc>https://croohq.com/jobs</loc>")) fail("jobs sitemap missing /jobs");
  console.log(`jobs html ok: ${pages.size} listing${pages.size === 1 ? "" : "s"}`);
}

async function fromDist() {
  const homepage = path.join(DIST, "index.html");
  const index = path.join(DIST, "jobs", "index.html");
  const sitemap = path.join(DIST, "jobs-sitemap.xml");
  if (!fs.existsSync(homepage) || !fs.existsSync(index)) {
    fail("dist/jobs is missing. Run npm run build.");
  }
  const pages = new Map();
  for (const name of fs.readdirSync(path.join(DIST, "jobs"))) {
    const file = path.join(DIST, "jobs", name, "index.html");
    if (fs.existsSync(file)) pages.set(name, fs.readFileSync(file, "utf8"));
  }
  checkHtmlSet({
    homepage: fs.readFileSync(homepage, "utf8"),
    index: fs.readFileSync(index, "utf8"),
    pages,
    sitemap: fs.readFileSync(sitemap, "utf8"),
  });
}

async function fromCurl(origin) {
  const root = origin.replace(/\/$/, "");
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", Accept: "text/html" };
  async function get(url) {
    const res = await fetch(url, { headers });
    if (!res.ok) fail(`${url} returned ${res.status}`);
    return res.text();
  }
  const pages = new Map();
  for (const pin of PINNED_PUBLIC_JOBS) {
    const url = `${root}/jobs/${pin.slug}`;
    console.log("curl", url);
    pages.set(pin.slug, await get(url));
  }
  checkHtmlSet({
    homepage: await get(`${root}/`),
    index: await get(`${root}/jobs`),
    pages,
    sitemap: await get(`${root}/jobs-sitemap.xml`),
  });
}

const curlAt = process.argv.indexOf("--curl");
const run = curlAt === -1 ? fromDist() : fromCurl(process.argv[curlAt + 1] || "https://croohq.com");
run.catch((err) => fail(err instanceof Error ? err.stack || err.message : String(err)));
