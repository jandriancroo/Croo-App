import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildSlug(listing: any): string {
  const city = parseAddress(listing.location?.address).city || listing.location?.name || "";
  const shortId = (listing.id || "").slice(0, 8);
  return [slugify(city), slugify(listing.title), shortId].filter(Boolean).join("-");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    // Accept slug from path segment (/job-detail/<slug>) OR query (?slug=, ?id=)
    const id = url.searchParams.get("id");
    const querySlug = url.searchParams.get("slug");
    // Path may be /functions/v1/job-detail/<slug> or /job-detail/<slug>
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const fnIdx = pathSegments.indexOf("job-detail");
    const pathSlug = fnIdx >= 0 && pathSegments.length > fnIdx + 1 ? pathSegments[fnIdx + 1] : null;
    const slug = querySlug || pathSlug;

    let listingId = id;
    if (!listingId && slug) {
      const m = slug.match(/([0-9a-f]{8})$/i);
      if (m) listingId = m[1];
    }

    if (!listingId) {
      return new Response("Missing id or slug", { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // If we only have an 8-char prefix, look up by prefix
    let data: any = null;
    if (listingId.length === 36) {
      const res = await supabase
        .from("job_listings")
        .select(`
          *,
          location:locations(id, name, address),
          organization:organizations(id, name, slug, brand_name)
        `)
        .eq("status", "active")
        .eq("syndication_enabled", true)
        .eq("id", listingId)
        .maybeSingle();
      if (res.error) throw res.error;
      data = res.data;
    } else {
      // Fetch active syndicated listings and match prefix in code
      const res = await supabase
        .from("job_listings")
        .select(`
          *,
          location:locations(id, name, address),
          organization:organizations(id, name, slug, brand_name)
        `)
        .eq("status", "active")
        .eq("syndication_enabled", true);
      if (res.error) throw res.error;
      data = (res.data || []).find((l: any) => (l.id || "").toLowerCase().startsWith(listingId!.toLowerCase())) || null;
    }

    if (!data) {
      return new Response(notFoundHtml(), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const listing = data as any;
    const addr = parseAddress(listing.location?.address);
    const company = listing.organization?.brand_name || listing.organization?.name || "Company";
    const empLabel = EMPLOYMENT_LABEL[listing.employment_type] || "Full Time";
    const empSchema = EMPLOYMENT_SCHEMA[listing.employment_type] || "FULL_TIME";
    const payStr = listing.pay_min
      ? `$${listing.pay_min}${listing.pay_max && listing.pay_max !== listing.pay_min ? `–$${listing.pay_max}` : ""}/${listing.pay_type === "salary" ? "yr" : "hr"}`
      : "";
    const titleText = `${listing.title} – ${company}${addr.city ? `, ${addr.city}` : ""}`;
    const metaDescription = (listing.description || `Apply for ${listing.title} at ${company}${addr.city ? ` in ${addr.city}` : ""}.`).slice(0, 158);
    const slugUrl = buildSlug(listing);
    const canonical = `${APP_URL}/jobs/${slugUrl}`;
    const applyUrl = `${APP_URL}/apply/${listing.organization?.slug}?utm_source=job_detail&listing=${listing.id}`;

    const jsonLd: any = {
      "@context": "https://schema.org/",
      "@type": "JobPosting",
      title: listing.title,
      description: listing.description || listing.title,
      datePosted: listing.posted_at?.split("T")[0],
      employmentType: empSchema,
      hiringOrganization: { "@type": "Organization", name: company, sameAs: `${APP_URL}/apply/${listing.organization?.slug}` },
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
      // Apply happens on a separate page (/apply/...), not inline on this URL
      directApply: false,
      url: canonical,
      industry: "Food Services",
    };
    // Only set validThrough when we actually have an expiry — never fake it
    if (listing.expires_at) {
      jsonLd.validThrough = listing.expires_at.split("T")[0];
    }
    if (listing.pay_min || listing.pay_max) {
      jsonLd.baseSalary = {
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

    const descParagraphs = (listing.description || "")
      .split(/\n{2,}|\r\n{2,}/)
      .map((p: string) => p.trim())
      .filter(Boolean)
      .map((p: string) => `<p>${escapeHtml(p)}</p>`) 
      .join("\n          ");

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(titleText)} | CrooHQ Jobs</title>
<meta name="description" content="${escapeHtml(metaDescription)}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta property="og:title" content="${escapeHtml(titleText)}" />
<meta property="og:description" content="${escapeHtml(metaDescription)}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta name="robots" content="index,follow" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#f5f4f1; color:#1f2937; margin:0; padding:0; line-height:1.6; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  header.site { display:flex; align-items:center; gap:12px; margin-bottom:24px; }
  header.site img { width: 32px; height: 32px; }
  header.site .pub { font-size: 12px; color:#6b7280; }
  h1 { font-size: 28px; margin: 0 0 8px; color:#111827; }
  .company { color:#0f766e; font-weight:600; margin: 0 0 16px; }
  .meta { display:flex; flex-wrap:wrap; gap:16px; font-size:14px; color:#4b5563; margin-bottom:24px; }
  .meta span { background:#fff; border:1px solid #e5e7eb; padding:6px 12px; border-radius:999px; }
  .apply { display:inline-block; background:#0f766e; color:#fff; text-decoration:none; padding:14px 28px; border-radius:10px; font-weight:600; margin: 8px 0 32px; }
  .apply:hover { background:#0d5e57; }
  .desc { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:24px; }
  .desc p { margin: 0 0 14px; }
  .desc p:last-child { margin-bottom: 0; }
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
    <article>
      <h1>${escapeHtml(listing.title)}</h1>
      <p class="company">${escapeHtml(company)}</p>
      <div class="meta">
        ${addr.city ? `<span>📍 ${escapeHtml(addr.city)}${addr.state ? `, ${escapeHtml(addr.state)}` : ""}${addr.zip ? ` ${escapeHtml(addr.zip)}` : ""}</span>` : ""}
        ${payStr ? `<span>💵 ${escapeHtml(payStr)}</span>` : ""}
        <span>🕒 ${escapeHtml(empLabel)}</span>
      </div>
      <a class="apply" href="${escapeHtml(applyUrl)}" rel="nofollow">Apply for this position →</a>
      <section class="desc" aria-label="Job description">
        ${descParagraphs || `<p>${escapeHtml(listing.title)} at ${escapeHtml(company)}.</p>`}
      </section>
      <p style="margin-top:24px;">
        <a class="apply" href="${escapeHtml(applyUrl)}" rel="nofollow">Apply now →</a>
      </p>
    </article>
    <footer>
      Posted ${escapeHtml(listing.posted_at?.split("T")[0] || "")} · <a href="${APP_URL}/jobs">Browse all open positions</a>
    </footer>
  </main>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=600",
      },
    });
  } catch (err) {
    console.error("job-detail error:", err);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
});

function notFoundHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Job not found | CrooHQ</title><meta name="robots" content="noindex"></head><body style="font-family:sans-serif;text-align:center;padding:64px"><h1>Job not found</h1><p>This job listing is no longer available.</p><p><a href="${APP_URL}/jobs">Browse open positions →</a></p></body></html>`;
}
