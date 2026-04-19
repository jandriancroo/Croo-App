import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const APP_URL = Deno.env.get("APP_URL") || "https://croohq.com";

function slugify(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseCity(address: string | null): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim());
  if (parts.length >= 3) return parts[parts.length - 2];
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("job_listings")
      .select("id, title, updated_at, posted_at, expires_at, location:locations(address, name)")
      .eq("status", "active")
      .eq("syndication_enabled", true)
      .lte("posted_at", new Date().toISOString());

    if (error) throw error;

    const now = new Date().toISOString();
    const active = (data || []).filter((l: any) => !l.expires_at || l.expires_at > now);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const urls = active.map((l: any) => {
      const city = parseCity(l.location?.address) || l.location?.name || "";
      const slug = [slugify(city), slugify(l.title), (l.id || "").slice(0, 8)].filter(Boolean).join("-");
      const lastmod = (l.updated_at || l.posted_at || new Date().toISOString()).split("T")[0];
      // Point sitemap at SSR endpoint so Google crawls fully-rendered HTML
      return `  <url><loc>${supabaseUrl}/functions/v1/job-detail/${slug}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq></url>`;
    }).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${APP_URL}/jobs</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
${urls}
</urlset>`;

    return new Response(xml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml; charset=utf-8" },
    });
  } catch (err) {
    console.error("jobs-sitemap error:", err);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
});
