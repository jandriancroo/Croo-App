import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASE_URL = "https://croohq.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all active syndicated listings
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

    // Filter expired
    const now = new Date().toISOString();
    const activeListings = (listings || []).filter(
      (l: any) => !l.expires_at || l.expires_at > now
    );

    // Build JSON-LD array
    const jsonLdItems = activeListings.map((listing: any) => {
      const addr = parseAddress(listing.location?.address);
      const org = listing.organization;
      const company = org?.brand_name || org?.name || "Company";

      const posting: any = {
        "@context": "https://schema.org/",
        "@type": "JobPosting",
        title: listing.title,
        description: listing.description || listing.title,
        datePosted: listing.posted_at?.split("T")[0],
        employmentType: mapEmploymentType(listing.employment_type),
        identifier: {
          "@type": "PropertyValue",
          name: company,
          value: listing.id,
        },
        hiringOrganization: {
          "@type": "Organization",
          name: company,
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
        directApply: true,
        url: `${BASE_URL}/apply/${org?.slug}?utm_source=google_jobs&listing=${listing.id}`,
      };

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

      if (listing.expires_at) {
        posting.validThrough = listing.expires_at.split("T")[0];
      }

      return posting;
    });

    // Build a lightweight HTML page with JSON-LD that Google can crawl
    const jobCards = activeListings.map((listing: any) => {
      const org = listing.organization;
      const company = org?.brand_name || org?.name || "";
      const city = parseAddress(listing.location?.address).city;
      const payStr = listing.pay_min
        ? `$${listing.pay_min}${listing.pay_max ? `-$${listing.pay_max}` : ""}/${listing.pay_type === "salary" ? "yr" : "hr"}`
        : "";

      return `<article>
        <h2><a href="${BASE_URL}/apply/${org?.slug}?utm_source=google_jobs&listing=${listing.id}">${esc(listing.title)}</a></h2>
        <p><strong>${esc(company)}</strong>${city ? ` — ${esc(city)}` : ""}${payStr ? ` | ${payStr}` : ""}</p>
        <p>${esc((listing.description || "").substring(0, 300))}${(listing.description || "").length > 300 ? "…" : ""}</p>
      </article>`;
    }).join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Restaurant Jobs Near You | CrooHQ</title>
  <meta name="description" content="Find restaurant jobs at Blaze Pizza and other brands. Apply directly — no account needed.">
  <link rel="canonical" href="${BASE_URL}/jobs">
  <script type="application/ld+json">
${JSON.stringify(jsonLdItems, null, 2)}
  </script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #333; }
    h1 { color: #111; }
    article { border-bottom: 1px solid #eee; padding: 1rem 0; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Open Positions</h1>
  <p>${activeListings.length} jobs available. <a href="${BASE_URL}/jobs">View all on CrooHQ</a></p>
  ${jobCards}
  <footer><p><a href="${BASE_URL}">CrooHQ</a> — Restaurant Management Platform</p></footer>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Jobs SEO error:", err);
    return new Response("Internal server error", { status: 500 });
  }
});

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseAddress(address: string | null) {
  if (!address) return { street: "", city: "", state: "", zip: "" };
  const parts = address.split(",").map((s) => s.trim());
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const stateZipMatch = lastPart.match(/^([A-Za-z\s]+?)\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZipMatch) {
      const city = parts.length >= 3 ? parts[parts.length - 2] : "";
      return { street: parts[0], city, state: stateZipMatch[1].trim(), zip: stateZipMatch[2] };
    }
    return { street: parts[0], city: parts.length >= 3 ? parts[1] : "", state: lastPart, zip: "" };
  }
  return { street: address, city: "", state: "", zip: "" };
}

function mapEmploymentType(type: string): string {
  const map: Record<string, string> = {
    full_time: "FULL_TIME",
    part_time: "PART_TIME",
    contract: "CONTRACTOR",
    temporary: "TEMPORARY",
    intern: "INTERN",
    seasonal: "TEMPORARY",
  };
  return map[type] || "FULL_TIME";
}
