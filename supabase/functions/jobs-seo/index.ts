import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, supabaseKey);

    // Self-referencing canonical URL (the SSR endpoint itself)
    const canonicalUrl = `${SUPABASE_URL}/functions/v1/jobs-seo`;

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
      const titleLower = (listing.title || "").toLowerCase();

      // Calculate validThrough: use expires_at or default to posted_at + 30 days
      const validThrough = listing.expires_at
        ? listing.expires_at.split("T")[0]
        : new Date(new Date(listing.posted_at).getTime() + 30 * 86400000)
            .toISOString()
            .split("T")[0];

      // Map occupationalCategory using BLS SOC / O*NET codes
      const occupationalCategory = mapOccupationalCategory(titleLower);

      // Build skills list based on role
      const skills = buildSkills(titleLower);

      const posting: any = {
        "@context": "https://schema.org/",
        "@type": "JobPosting",
        title: listing.title,
        description: buildEnrichedDescription(listing.title, listing.description, company),
        datePosted: listing.posted_at?.split("T")[0],
        validThrough,
        employmentType: mapEmploymentType(listing.employment_type),
        occupationalCategory,
        industry: "Food Services",
        identifier: {
          "@type": "PropertyValue",
          name: company,
          value: listing.id,
        },
        hiringOrganization: {
          "@type": "Organization",
          name: company,
          sameAs: `https://croohq.com/apply/${org?.slug}`,
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
        url: `https://croohq.com/apply/${org?.slug}?utm_source=google_jobs&listing=${listing.id}`,
        skills,
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

      return posting;
    });

    // Build a lightweight HTML page with JSON-LD that Google can crawl
    const jobCards = activeListings
      .map((listing: any) => {
        const org = listing.organization;
        const company = org?.brand_name || org?.name || "";
        const city = parseAddress(listing.location?.address).city;
        const payStr = listing.pay_min
          ? `$${listing.pay_min}${listing.pay_max ? `-$${listing.pay_max}` : ""}/${listing.pay_type === "salary" ? "yr" : "hr"}`
          : "";

        return `<article>
        <h2><a href="https://croohq.com/apply/${org?.slug}?utm_source=google_jobs&listing=${listing.id}">${esc(listing.title)}</a></h2>
        <p><strong>${esc(company)}</strong>${city ? ` — ${esc(city)}` : ""}${payStr ? ` | ${payStr}` : ""}</p>
        <p>${esc((listing.description || "").substring(0, 300))}${(listing.description || "").length > 300 ? "…" : ""}</p>
      </article>`;
      })
      .join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Restaurant Jobs Near You | CrooHQ — Pizza, Fast Food & Food Service Careers</title>
  <meta name="description" content="Find restaurant and fast food jobs at Blaze Pizza and other brands. Apply for pizza maker, team member, shift manager, and kitchen positions — no account needed.">
  <link rel="canonical" href="${canonicalUrl}">
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
  <h1>Restaurant & Fast Food Jobs — Apply Now</h1>
  <p>${activeListings.length} open positions at pizza restaurants and fast food locations. <a href="https://croohq.com/jobs">View all on CrooHQ</a></p>
  ${jobCards}
  <footer><p><a href="https://croohq.com">CrooHQ</a> — Restaurant Management Platform</p></footer>
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

// --- Helpers ---

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
    const stateZipMatch = lastPart.match(
      /^([A-Za-z\s]+?)\s+(\d{5}(?:-\d{4})?)$/
    );
    if (stateZipMatch) {
      const city = parts.length >= 3 ? parts[parts.length - 2] : "";
      return {
        street: parts[0],
        city,
        state: stateZipMatch[1].trim(),
        zip: stateZipMatch[2],
      };
    }
    return {
      street: parts[0],
      city: parts.length >= 3 ? parts[1] : "",
      state: lastPart,
      zip: "",
    };
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

function mapOccupationalCategory(titleLower: string): string {
  // BLS SOC / O*NET codes for restaurant industry
  if (
    titleLower.includes("manager") ||
    titleLower.includes("supervisor") ||
    titleLower.includes("lead")
  ) {
    return "11-9051.00 - Food Service Managers";
  }
  if (titleLower.includes("cook") || titleLower.includes("chef")) {
    return "35-2014.00 - Cooks, Restaurant";
  }
  if (titleLower.includes("cashier")) {
    return "41-2011.00 - Cashiers";
  }
  // Default for team member / crew / counter worker roles
  return "35-3023.00 - Fast Food and Counter Workers";
}

function buildSkills(titleLower: string): string {
  const base = [
    "Customer Service",
    "Food Safety",
    "Cash Handling",
    "Teamwork",
    "Food Preparation",
    "Kitchen Operations",
    "Pizza Making",
    "Restaurant Operations",
  ];

  if (
    titleLower.includes("manager") ||
    titleLower.includes("supervisor") ||
    titleLower.includes("lead")
  ) {
    return [
      ...base,
      "Team Leadership",
      "Staff Training",
      "Inventory Management",
      "Labor Cost Management",
      "Shift Management",
      "Problem Solving",
    ].join(", ");
  }

  return base.join(", ");
}

function buildEnrichedDescription(
  title: string,
  description: string | null,
  company: string
): string {
  const base = description || title;
  // Append keyword-rich footer if description doesn't already mention key terms
  const lower = base.toLowerCase();
  const extras: string[] = [];

  if (!lower.includes("restaurant"))
    extras.push("restaurant");
  if (!lower.includes("food service"))
    extras.push("food service");
  if (!lower.includes("pizza") && company.toLowerCase().includes("pizza"))
    extras.push("pizza");
  if (!lower.includes("fast food"))
    extras.push("fast food");

  if (extras.length > 0) {
    return `${base}\n\nThis is a ${extras.join(" and ")} position at ${company}. Apply today — no account required.`;
  }
  return base;
}
