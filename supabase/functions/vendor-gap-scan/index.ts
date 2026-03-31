import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all active brands
    const { data: brands } = await supabase
      .from("brands")
      .select("id, name")
      .eq("is_active", true);

    if (!brands?.length) {
      return new Response(JSON.stringify({ message: "No active brands" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { brandId: string; brandName: string; newItems: number }[] = [];

    for (const brand of brands) {
      // Get existing templates for this brand
      const { data: templates } = await supabase
        .from("brand_inventory_templates")
        .select("item_number, pa_item_id")
        .eq("brand_id", brand.id);

      const existingPfgNumbers = new Set(
        (templates || []).map(t => t.item_number).filter(Boolean)
      );
      const existingPaIds = new Set(
        (templates || []).map(t => t.pa_item_id).filter(Boolean)
      );

      let newItemCount = 0;

      // --- PFG Scan ---
      // Find a location with PFG credentials for this brand
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id")
        .eq("brand_id", brand.id);

      if (orgs?.length) {
        const orgIds = orgs.map(o => o.id);
        const { data: locs } = await supabase
          .from("locations")
          .select("id")
          .in("organization_id", orgIds);

        if (locs?.length) {
          const locIds = locs.map(l => l.id);
          const { data: pfgInt } = await supabase
            .from("location_integrations")
            .select("credentials")
            .in("location_id", locIds)
            .eq("integration_type", "pfg")
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          if (pfgInt?.credentials) {
            const creds = pfgInt.credentials as any;
            const accessToken = creds?.access_token;
            const customerId = creds?.customer_id;

            if (accessToken && customerId) {
              try {
                // Call PFG API for bid guide
                const bidRes = await fetch(
                  `https://www3.pfgc.com/api/ecommerce/v3/customers/${customerId}/bidguide?pageSize=500&currentPage=1`,
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      Accept: "application/json",
                    },
                  }
                );

                if (bidRes.ok) {
                  const bidData = await bidRes.json();
                  const bidItems = bidData?.products || [];

                  for (const item of bidItems) {
                    const itemNumber = String(item.itemNumber || "").trim();
                    if (!itemNumber || existingPfgNumbers.has(itemNumber)) continue;

                    // Upsert into vendor_gap_alerts
                    const { error } = await supabase
                      .from("vendor_gap_alerts")
                      .upsert(
                        {
                          brand_id: brand.id,
                          vendor_source: "pfg",
                          item_number: itemNumber,
                          vendor_name: item.fullDescription || item.description || "",
                          vendor_description: item.fullDescription || "",
                          pack_size: item.packSize || "",
                          category_name: item.categoryName || "",
                          status: "new",
                        },
                        { onConflict: "brand_id,vendor_source,item_number" }
                      );

                    if (!error) newItemCount++;
                  }
                } else {
                  console.warn(`[vendor-gap-scan] PFG API error for ${brand.name}: ${bidRes.status}`);
                }
              } catch (e) {
                console.error(`[vendor-gap-scan] PFG scan error for ${brand.name}:`, e);
              }
            }
          }
        }
      }

      // --- PA Scan ---
      // Check PA orders for items not in templates
      if (orgs?.length) {
        const orgIds = orgs.map(o => o.id);
        const { data: locs } = await supabase
          .from("locations")
          .select("id")
          .in("organization_id", orgIds);

        if (locs?.length) {
          const locIds = locs.map(l => l.id);
          // Get unique PA item IDs from recent orders
          const { data: paOrders } = await supabase
            .from("produce_alliance_orders")
            .select("items")
            .in("location_id", locIds)
            .not("items", "is", null)
            .order("delivery_date", { ascending: false })
            .limit(30);

          const seenPaItems = new Map<string, any>();
          for (const order of paOrders || []) {
            const items = order.items as any[];
            if (!Array.isArray(items)) continue;
            for (const item of items) {
              const paId = String(item.itemId || item.item_id || "").trim();
              if (!paId || existingPaIds.has(paId) || seenPaItems.has(paId)) continue;
              seenPaItems.set(paId, item);
            }
          }

          for (const [paId, item] of seenPaItems) {
            const { error } = await supabase
              .from("vendor_gap_alerts")
              .upsert(
                {
                  brand_id: brand.id,
                  vendor_source: "pa",
                  item_number: paId,
                  vendor_name: item.description || item.name || "",
                  vendor_description: item.description || "",
                  pack_size: item.packSize || item.pack_size || "",
                  category_name: item.category || "",
                  status: "new",
                },
                { onConflict: "brand_id,vendor_source,item_number" }
              );

            if (!error) newItemCount++;
          }
        }
      }

      results.push({ brandId: brand.id, brandName: brand.name, newItems: newItemCount });
    }

    console.log(`[vendor-gap-scan] Complete:`, JSON.stringify(results));

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[vendor-gap-scan] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
