import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logSyndicationServed } from "../_shared/jobSyndicationLog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const APP_URL = Deno.env.get("APP_URL") || "https://croohq.com";

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  contract: "Contract",
  temporary: "Temporary",
  seasonal: "Seasonal",
  intern: "Intern",
};

const EMPLOYMENT_SCHEMA: Record<string, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  temporary: "TEMPORARY",
  intern: "INTERN",
  seasonal: "TEMPORARY",
};

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseAddress(address: string | null) {
  if (!address) return { street: "", city: "", state: "", zip: "" };
  const parts = address.split(",").map((s) => s.trim());
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const m = lastPart.match(/^([A-Za-z\s]+?)\s+(\d{5}(?:-\d{4})?)$/);
    if (m) {
      const city = parts.length >= 3 ? parts[parts.length - 2] : "";
      return { street: parts[0], city, state: m[1].trim(), zip: m[2] };
    }
    return { street: parts[0], city: parts.length >= 3 ? parts[1] : "", state: lastPart, zip: "" };
  }
  return { street: address, city: "", state: "", zip: "" };
}

function slugify(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildSlug(listing: any): string {
  const city = parseAddress(listing.location?.address).city || listing.location?.name || "";
  return [slugify(city), slugify(listing.title), (listing.id || "").slice(0, 8)]
    .filter(Boolean)
    .join("-");
}

function toJobPosting(listing: any, canonical: string) {
  const addr = parseAddress(listing.location?.address);
  const company = listing.organization?.brand_name || listing.organization?.name || "Company";

  const posting: any = {
    "@type": "JobPosting",
    title: listing.title,
    description: listing.description || listing.title,
    datePosted: listing.posted_at?.split("T")[0],
    employmentType: EMPLOYMENT_SCHEMA[listing.employment_type] || "FULL_TIME",
    hiringOrganization: {
      "@type": "Organization",
      name: company,
      sameAs: `${APP_URL}/apply/${listing.organization?.slug}`,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        streetAddress: addr.street,
        addressLocality: addr.city,
        addressRegion: addr.state,
        postalCode: addr.zip,
        addressCountry: "US",
      },
    },
    identifier: { "@type": "PropertyValue", name: company, value: listing.id },
    directApply: false,
    url: canonical,
    industry: "Food Services",
  };

  // Never fake an expiry — only emit validThrough when one really exists.
  if (listing.expires_at) {
    posting.validThrough = listing.expires_at.split("T")[0];
  }
  if (listing.pay_min || listing.pay_max) {
    posting.baseSalary = {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: {
        "@type": "QuantitativeValue",
        minValue: listing.pay_min,
        maxValue: listing.pay_max || listing.pay_min,
        unitText: listing.pay_type === "salary" ? "YEAR" : "HOUR",
      },
    };
  }
  return posting;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Same query pattern as job-feed — one data model for every public surface.
    const { data: listings, error } = await supabase
      .from("job_listings")
      .select(`
        *,
        location:locations(id, name, address),
        organization:organizations(id, name, slug, brand_name)
      `)
      .eq("status", "active")
      .eq("syndication_enabled", true)
      .lte("posted_at", new Date().toISOString())
      .order("posted_at", { ascending: false });

    if (error) throw error;

    const now = new Date().toISOString();
    const activeListings = (listings || []).filter(
      (l: any) => !l.expires_at || l.expires_at > now,
    );

    const canonical = `${APP_URL}/jobs`;
    const pageTitle =
      "Restaurant Jobs Near You | CrooHQ — Pizza, Fast Food & Food Service Careers";
    const metaDescription =
      "Find restaurant and fast food jobs at Blaze Pizza and other brands. Apply for pizza maker, team member, shift manager, cook, and kitchen crew positions near you — no account needed.";

    // ItemList wrapping the JobPosting entries for each open role.
    const itemListJsonLd = {
      "@context": "https://schema.org/",
      "@type": "ItemList",
      name: "Open restaurant positions",
      numberOfItems: activeListings.length,
      itemListElement: activeListings.map((listing: any, i: number) => {
        const jobUrl = `${APP_URL}/jobs/${buildSlug(listing)}`;
        return {
          "@type": "ListItem",
          position: i + 1,
          url: jobUrl,
          item: toJobPosting(listing, jobUrl),
        };
      }),
    };

    const cards = activeListings
      .map((listing: any) => {
        const addr = parseAddress(listing.location?.address);
        const company =
          listing.organization?.brand_name || listing.organization?.name || "Company";
        const payStr = listing.pay_min
          ? `$${listing.pay_min}${
              listing.pay_max && listing.pay_max !== listing.pay_min ? `–$${listing.pay_max}` : ""
            }/${listing.pay_type === "salary" ? "yr" : "hr"}`
          : "";
        const empLabel = EMPLOYMENT_LABEL[listing.employment_type] || "Full Time";
        const jobUrl = `${APP_URL}/jobs/${buildSlug(listing)}`;
        const blurb = (listing.description || "").split(/\n{2,}/)[0]?.slice(0, 220) || "";
        return `      <li class="card">
        <h2><a href="${escapeHtml(jobUrl)}">${escapeHtml(listing.title)}</a></h2>
        <p class="company">${escapeHtml(company)}</p>
        <div class="meta">
          ${
            addr.city
              ? `<span>${escapeHtml(addr.city)}${addr.state ? `, ${escapeHtml(addr.state)}` : ""}</span>`
              : ""
          }
          ${payStr ? `<span>${escapeHtml(payStr)}</span>` : ""}
          <span>${escapeHtml(empLabel)}</span>
        </div>
        ${blurb ? `<p class="blurb">${escapeHtml(blurb)}</p>` : ""}
        <a class="more" href="${escapeHtml(jobUrl)}">View job &amp; apply →</a>
      </li>`;
      })
      .join("\n");

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(metaDescription)}" />
<meta name="keywords" content="pizza jobs, fast food jobs, restaurant jobs, team member jobs, shift manager jobs, kitchen crew, food service careers, Blaze Pizza hiring, cook jobs near me, cashier restaurant jobs" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta property="og:title" content="${escapeHtml(pageTitle)}" />
<meta property="og:description" content="${escapeHtml(metaDescription)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta name="robots" content="index,follow" />
<script type="application/ld+json">${JSON.stringify(itemListJsonLd)}</script>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#f5f4f1; color:#1f2937; margin:0; line-height:1.6; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  header.site { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
  header.site img { width:32px; height:32px; }
  header.site .pub { font-size:12px; color:#6b7280; }
  h1 { font-size:28px; margin:16px 0 4px; color:#111827; }
  .count { color:#6b7280; font-size:14px; margin:0 0 24px; }
  ul.list { list-style:none; margin:0; padding:0; display:grid; gap:14px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:20px; }
  .card h2 { font-size:18px; margin:0 0 4px; }
  .card h2 a { color:#111827; text-decoration:none; }
  .company { color:#0f766e; font-weight:600; margin:0 0 10px; }
  .meta { display:flex; flex-wrap:wrap; gap:10px; font-size:13px; color:#4b5563; margin-bottom:10px; }
  .meta span { background:#f9fafb; border:1px solid #e5e7eb; padding:4px 10px; border-radius:999px; }
  .blurb { font-size:14px; color:#4b5563; margin:0 0 12px; }
  .more { color:#0f766e; font-weight:600; text-decoration:none; font-size:14px; }
  footer { margin-top:32px; font-size:12px; color:#6b7280; text-align:center; }
  footer a { color:#0f766e; }
</style>
</head>
<body>
  <main class="wrap">
    <header class="site">
      <img src="${APP_URL}/croo-logo-inverted.webp" alt="CrooHQ logo" />
      <div>
        <div style="font-weight:600;color:#111827;">Restaurant Jobs</div>
        <div class="pub">Powered by CrooHQ</div>
      </div>
    </header>
    <h1>Restaurant &amp; Food Service Jobs</h1>
    <p class="count">${activeListings.length} open position${activeListings.length === 1 ? "" : "s"}</p>
    <ul class="list">
${cards || `      <li class="card"><p>No open positions right now. Check back soon.</p></li>`}
    </ul>
    <footer>
      <a href="${APP_URL}/jobs">croohq.com/jobs</a> · Powered by CrooHQ
    </footer>
  </main>
</body>
</html>`;

    // Log that crawler-ready HTML was served for each listing on this page.
    await logSyndicationServed(
      supabase,
      activeListings.map((l: any) => ({ jobListingId: l.id, feedUrl: canonical })),
    );

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    });
  } catch (err) {
    console.error("jobs-index error:", err);
    return new Response("Internal error", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  }
});
