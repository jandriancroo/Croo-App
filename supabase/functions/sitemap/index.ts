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

/**
 * Public sitemap for croohq.com.
 *
 * Emits ONLY canonical job detail URLs (https://croohq.com/jobs/<slug>).
 * The Cloudflare Worker rewrites those paths to the SSR edge function so
 * Googlebot gets fully-rendered HTML with JobPosting JSON-LD.
 *
 * Apply URLs (/apply/<org>) are intentionally NOT in the sitemap — they
 * are application endpoints, not discoverable content.
 */
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
    const today = now.split("T")[0];

    const urls: string[] = [];
    urls.push(`  <url><loc>${APP_URL}/jobs</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`);

    for (const l of active) {
      const city = parseCity((l as any).location?.address) || (l as any).location?.name || "";
      const slug = [slugify(city), slugify((l as any).title), ((l as any).id || "").slice(0, 8)].filter(Boolean).join("-");
      const lastmod = ((l as any).updated_at || (l as any).posted_at || now).split("T")[0];
      urls.push(`  <url><loc>${APP_URL}/jobs/${slug}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

    return new Response(xml, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=600, s-maxage=1800",
      },
    });
  } catch (err) {
    console.error("Sitemap error:", err);
    return new Response("Internal server error", { status: 500, headers: corsHeaders });
  }
});
