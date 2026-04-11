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
    const canonicalUrl = `${SUPABASE_URL}/functions/v1/jobs-seo`;

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
      (l: any) => !l.expires_at || l.expires_at > now
    );

    // Build JSON-LD
    const jsonLdItems = activeListings.map((listing: any) => {
      const addr = parseAddress(listing.location?.address);
      const org = listing.organization;
      const company = org?.brand_name || org?.name || "Company";
      const titleLower = (listing.title || "").toLowerCase();

      const validThrough = listing.expires_at
        ? listing.expires_at.split("T")[0]
        : new Date(new Date(listing.posted_at).getTime() + 30 * 86400000)
            .toISOString()
            .split("T")[0];

      const syndicationTitle = buildSyndicationTitle(listing.title, company, addr.city);

      const posting: any = {
        "@context": "https://schema.org/",
        "@type": "JobPosting",
        title: syndicationTitle,
        description: buildEnrichedDescription(listing.title, listing.description, company, addr.city, listing.employment_type),
        datePosted: listing.posted_at?.split("T")[0],
        validThrough,
        employmentType: mapEmploymentType(listing.employment_type),
        occupationalCategory: mapOccupationalCategory(titleLower),
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
          logo: "https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-transparent.webp",
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
        skills: buildSkills(titleLower),
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

    // Build rich HTML job cards
    const jobCards = activeListings
      .map((listing: any) => {
        const org = listing.organization;
        const company = org?.brand_name || org?.name || "";
        const addr = parseAddress(listing.location?.address);
        const payStr = listing.pay_min
          ? `$${listing.pay_min}${listing.pay_max ? `–$${listing.pay_max}` : ""}/${listing.pay_type === "salary" ? "yr" : "hr"}`
          : "";
        const empLabel = EMPLOYMENT_LABELS[listing.employment_type] || listing.employment_type;
        const daysAgo = Math.floor((Date.now() - new Date(listing.posted_at).getTime()) / 86400000);
        const postedLabel = daysAgo === 0 ? "Today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
        const applyUrl = `https://croohq.com/apply/${org?.slug}?utm_source=google_jobs&listing=${listing.id}`;

        return `<article itemscope itemtype="https://schema.org/JobPosting">
        <h2 itemprop="title"><a href="${applyUrl}">${esc(buildSyndicationTitle(listing.title, company, addr.city))}</a></h2>
        <p><strong itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">${esc(company)}</span></strong>
        ${addr.city ? ` — <span itemprop="jobLocation">${esc(addr.city)}, ${esc(addr.state)}</span>` : ""}
        ${payStr ? ` | ${payStr}` : ""} | <span itemprop="employmentType">${esc(empLabel)}</span> | Posted ${postedLabel}</p>
        <p>${esc((listing.description || "").substring(0, 500))}${(listing.description || "").length > 500 ? "…" : ""}</p>
        <p><strong><a href="${applyUrl}">Apply Now — No Account Required</a></strong></p>
      </article>`;
      })
      .join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Restaurant Jobs Near You | CrooHQ — Pizza, Fast Food & Food Service Careers</title>
  <meta name="description" content="Find restaurant and fast food jobs at Blaze Pizza and other brands. Apply for pizza maker, team member, shift manager, cook, and kitchen crew positions near you — no account needed.">
  <meta name="keywords" content="pizza jobs, fast food jobs, restaurant jobs, team member jobs, shift manager jobs, kitchen crew, food service careers, Blaze Pizza hiring, cook jobs near me, cashier restaurant jobs">
  <link rel="canonical" href="${canonicalUrl}">
  ${jsonLdItems.map((item: any) => `<script type="application/ld+json">
${JSON.stringify(item, null, 2)}
  </script>`).join("\n  ")}
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #333; line-height: 1.6; }
    h1 { color: #111; font-size: 1.8rem; }
    h2 { font-size: 1.2rem; margin-bottom: 0.25rem; }
    article { border-bottom: 1px solid #eee; padding: 1.25rem 0; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .intro { font-size: 1.05rem; color: #555; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>Restaurant & Fast Food Jobs — Apply Now</h1>
  <p class="intro">${activeListings.length} open restaurant, pizza, and fast food positions available now. Browse crew member, cook, shift manager, and kitchen staff jobs at Blaze Pizza and other brands. Apply directly — no account or sign-up required.</p>
  ${jobCards}
  <footer>
    <p>Powered by <a href="https://croohq.com">CrooHQ</a> — Restaurant Management Platform. Browse more <a href="https://croohq.com/jobs">restaurant jobs</a>.</p>
  </footer>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Content-Security-Policy": "default-src 'self'; script-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("Jobs SEO error:", err);
    return new Response("Internal server error", { status: 500 });
  }
});

// --- Constants ---

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  contract: "Contract",
  temporary: "Temporary",
  seasonal: "Seasonal",
  intern: "Intern",
};

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

function mapOccupationalCategory(titleLower: string): string {
  if (titleLower.includes("manager") || titleLower.includes("supervisor") || titleLower.includes("lead")) {
    return "11-9051.00";
  }
  if (titleLower.includes("cook") || titleLower.includes("chef")) {
    return "35-2014.00";
  }
  if (titleLower.includes("cashier")) {
    return "41-2011.00";
  }
  return "35-3023.00";
}

function buildSyndicationTitle(title: string, company: string, city: string): string {
  const lower = title.toLowerCase();
  // If title is generic like "Team Member", enrich it
  if (lower === "team member" || lower === "crew member") {
    return `Pizza Team Member – ${company}${city ? `, ${city}` : ""}`;
  }
  if (lower === "shift manager" || lower === "shift lead") {
    return `Shift Manager – ${company} Restaurant${city ? `, ${city}` : ""}`;
  }
  // For other titles, just append company
  if (!lower.includes(company.toLowerCase())) {
    return `${title} – ${company}`;
  }
  return title;
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
    "Point of Sale (POS)",
    "Food Hygiene",
  ];
  if (titleLower.includes("manager") || titleLower.includes("supervisor") || titleLower.includes("lead")) {
    return [...base, "Team Leadership", "Staff Training", "Inventory Management", "Labor Cost Management", "Shift Scheduling", "Conflict Resolution", "Performance Coaching"].join(", ");
  }
  return base.join(", ");
}

function buildEnrichedDescription(
  title: string,
  description: string | null,
  company: string,
  city: string,
  employmentType: string
): string {
  const base = description || title;
  const empLabel = EMPLOYMENT_LABELS[employmentType] || employmentType;
  const cityStr = city ? ` in ${city}` : "";

  // Build a rich, natural description that includes high-intent search phrases
  const enrichment = `

About This ${title} Position at ${company}

${company} is hiring a ${title} for our fast casual pizza restaurant${cityStr}. This is a ${empLabel.toLowerCase()} food service position ideal for anyone looking for restaurant jobs, fast food careers, or kitchen crew opportunities in the area.

What You'll Do:
• Prepare fresh ingredients and build custom artisanal pizzas on our assembly line
• Operate the pizza oven, cash register, and point-of-sale system
• Deliver fast, friendly customer service in a high-energy dining environment
• Maintain food safety standards, kitchen cleanliness, and health code compliance
• Work as part of a restaurant crew in a fast-paced kitchen setting

Who Should Apply:
This position is perfect for people searching for pizza jobs, fast food jobs, restaurant crew member roles, line cook positions, cashier jobs, or entry-level food service careers. No previous experience is required — we provide full training for all kitchen and counter positions.

${company} offers flexible scheduling, competitive hourly pay, meal discounts, and real opportunities to grow into shift manager and leadership roles. Whether you're looking for part-time evening shifts, weekend work, or a full-time restaurant career, we'd love to hear from you.

Apply today through CrooHQ — no account or sign-up needed. Just tap Apply and you're in.`;

  return base + enrichment;
}
