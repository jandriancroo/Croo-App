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

    // Return JSON data for the React frontend to consume
    return new Response(JSON.stringify({ listings: activeListings }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Jobs SEO error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
