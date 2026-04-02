import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "xml";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all active+syndicated listings across all orgs/locations
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

    // Filter out expired listings
    const now = new Date().toISOString();
    const activeListings = (listings || []).filter(
      (l: any) => !l.expires_at || l.expires_at > now
    );

    if (format === "json") {
      // JSON-LD format for Google Jobs
      const jsonLd = activeListings.map((listing: any) => toJsonLd(listing, supabaseUrl));
      return new Response(JSON.stringify(jsonLd, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // XML feed (Indeed/Monster/LinkedIn compatible)
    const xml = toXmlFeed(activeListings, supabaseUrl);
    return new Response(xml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml; charset=utf-8" },
    });
  } catch (err) {
    console.error("Job feed error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function parseAddress(address: string | null): { street: string; city: string; state: string; zip: string } {
  if (!address) return { street: '', city: '', state: '', zip: '' };
  // Try to parse "Street, City, ST ZIP" format
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    const street = parts.slice(0, -1).join(', ');
    const lastPart = parts[parts.length - 1];
    const stateZipMatch = lastPart.match(/^([A-Za-z\s]+?)\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZipMatch) {
      const city = parts.length >= 3 ? parts[parts.length - 2] : '';
      return { street: parts[0], city, state: stateZipMatch[1].trim(), zip: stateZipMatch[2] };
    }
    return { street: parts[0], city: parts.length >= 3 ? parts[1] : '', state: lastPart, zip: '' };
  }
  return { street: address, city: '', state: '', zip: '' };
}

function getApplicationUrl(listing: any, supabaseUrl: string, source: string) {
  const orgSlug = listing.organization?.slug;
  // Use the published app URL pattern
  const baseUrl = Deno.env.get("APP_URL") || "https://croohq.com";
  return `${baseUrl}/apply/${orgSlug}?utm_source=${source}&listing=${listing.id}`;
}

function toJsonLd(listing: any, supabaseUrl: string) {
  const addr = parseAddress(listing.location?.address);
  const org = listing.organization;

  const jobPosting: any = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: listing.title,
    description: listing.description || listing.title,
    identifier: {
      "@type": "PropertyValue",
      name: org?.brand_name || org?.name || "Company",
      value: listing.id,
    },
    datePosted: listing.posted_at?.split("T")[0],
    employmentType: mapEmploymentType(listing.employment_type),
    hiringOrganization: {
      "@type": "Organization",
      name: org?.brand_name || org?.name || "Company",
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
    url: getApplicationUrl(listing, supabaseUrl, "google_jobs"),
  };

  if (listing.pay_min || listing.pay_max) {
    jobPosting.baseSalary = {
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
    jobPosting.validThrough = listing.expires_at.split("T")[0];
  }

  return jobPosting;
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toXmlFeed(listings: any[], supabaseUrl: string): string {
  const items = listings
    .map((listing) => {
      const addr = parseAddress(listing.location?.address);
      const org = listing.organization;
      const applyUrl = getApplicationUrl(listing, supabaseUrl, "xml_feed");

      return `    <job>
      <title><![CDATA[${listing.title}]]></title>
      <date>${listing.posted_at?.split("T")[0] || ""}</date>
      <referencenumber>${listing.id}</referencenumber>
      <url>${escapeXml(applyUrl)}</url>
      <company><![CDATA[${org?.brand_name || org?.name || ""}]]></company>
      <city><![CDATA[${addr.city}]]></city>
      <state><![CDATA[${addr.state}]]></state>
      <country>US</country>
      <postalcode>${addr.zip}</postalcode>
      <description><![CDATA[${listing.description || listing.title}]]></description>
      <jobtype>${mapEmploymentTypeXml(listing.employment_type)}</jobtype>
      ${listing.pay_min ? `<salary>${listing.pay_min}${listing.pay_max ? `-${listing.pay_max}` : ""}</salary>` : ""}
      ${listing.pay_type ? `<salarytype>${listing.pay_type === "salary" ? "yearly" : "hourly"}</salarytype>` : ""}
      ${listing.expires_at ? `<expirationdate>${listing.expires_at.split("T")[0]}</expirationdate>` : ""}
    </job>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<source>
  <publisher>CrooHQ</publisher>
  <publisherurl>https://croohq.lovable.app</publisherurl>
  <lastBuildDate>${new Date().toISOString()}</lastBuildDate>
${items}
</source>`;
}

function mapEmploymentTypeXml(type: string): string {
  const map: Record<string, string> = {
    full_time: "fulltime",
    part_time: "parttime",
    contract: "contract",
    temporary: "temporary",
    intern: "intern",
    seasonal: "seasonal",
  };
  return map[type] || "fulltime";
}
