#!/usr/bin/env node
// After vite build, stamp JobPosting JSON-LD into the raw HTML Googlebot fetches.
// Lovable serves dist/jobs/<slug>/index.html for /jobs/<slug> (same as public/blog).
// Each file is the SPA shell, so the visible app is unchanged once JS runs.
// Listings are read at build time; publish again after a job opens or closes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildJobsIndexDocument, injectJobDocument, renderJobsSitemap } from "../src/lib/jobSeo.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
}

async function fetchJobs() {
  loadEnvFile();
  const base = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
  const url = new URL("/rest/v1/job_listings", base);
  url.searchParams.set(
    "select",
    "id,title,description,employment_type,pay_min,pay_max,pay_type,posted_at,expires_at,updated_at,location:locations(name,address),organization:organizations(name,slug,brand_name,logo_url)",
  );
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("syndication_enabled", "eq.true");
  url.searchParams.set("posted_at", `lte.${new Date().toISOString()}`);
  url.searchParams.set("order", "posted_at.desc");
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`job_listings fetch failed: ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("job_listings fetch did not return a list");
  const now = Date.now();
  return rows.filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now);
}

export async function prerenderJobs(distDir = path.join(ROOT, "dist")) {
  const shellPath = path.join(distDir, "index.html");
  if (!fs.existsSync(shellPath)) throw new Error(`Missing ${shellPath}. Run vite build first.`);
  const shell = fs.readFileSync(shellPath, "utf8");
  const now = new Date();
  const listings = await fetchJobs();
  const { jobs, document } = buildJobsIndexDocument(listings, now);
  const jobsDir = path.join(distDir, "jobs");
  fs.rmSync(jobsDir, { recursive: true, force: true });
  fs.mkdirSync(jobsDir, { recursive: true });

  for (const job of jobs) {
    const html = injectJobDocument(shell, job.document);
    const dir = path.join(jobsDir, job.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
    const flags = [...job.gaps.map((gap) => `MISSING ${gap}`), ...job.notes.map((note) => `FLAG ${note}`)];
    if (flags.length) console.warn(`jobs prerender ${job.slug}\n  - ${flags.join("\n  - ")}`);
    else console.log("jobs prerender", job.slug);
  }

  fs.writeFileSync(path.join(jobsDir, "index.html"), injectJobDocument(shell, document));
  const lastmod = now.toISOString().slice(0, 10);
  const sitemap = renderJobsSitemap([
    { loc: "https://croohq.com/jobs", lastmod },
    ...jobs.map((job) => ({ loc: job.canonical, lastmod })),
  ]);
  fs.writeFileSync(path.join(distDir, "jobs-sitemap.xml"), sitemap);
  console.log(`jobs prerender: ${jobs.length} live listing${jobs.length === 1 ? "" : "s"}, lastmod ${lastmod}`);
  return jobs;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  prerenderJobs().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
