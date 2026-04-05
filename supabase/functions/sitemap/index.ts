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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const baseUrl = "https://croohq.com";

    // Fetch all active syndicated listings
    const { data: listings } = await supabase
      .from("job_listings")
      .select("id, posted_at, organization:organizations(slug)")
      .eq("status", "active")
      .eq("syndication_enabled", true)
      .order("posted_at", { ascending: false });

    const now = new Date().toISOString();
    const urls: string[] = [];

    // Static pages
    urls.push(`  <url>
    <loc>${baseUrl}/jobs</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
    <lastmod>${now.split("T")[0]}</lastmod>
  </url>`);

    // Server-rendered jobs page with JSON-LD for Google Jobs
    const seoUrl = supabaseUrl.replace('//', '//') + "/functions/v1/jobs-seo";
    urls.push(`  <url>
    <loc>${seoUrl}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <lastmod>${now.split("T")[0]}</lastmod>
  </url>`);

    // Individual job listing apply pages
    for (const listing of listings || []) {
      const orgSlug = (listing as any).organization?.slug;
      if (!orgSlug) continue;
      urls.push(`  <url>
    <loc>${baseUrl}/apply/${orgSlug}?listing=${listing.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <lastmod>${listing.posted_at?.split("T")[0] || now.split("T")[0]}</lastmod>
  </url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

    return new Response(xml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml; charset=utf-8" },
    });
  } catch (err) {
    console.error("Sitemap error:", err);
    return new Response("Internal server error", { status: 500 });
  }
});
