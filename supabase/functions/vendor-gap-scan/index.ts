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
        .select("id, item_number, pa_item_id")
        .eq("brand_id", brand.id);

      const templateIds = (templates || []).map(t => t.id);
      const existingPfgNumbers = new Set(
        (templates || []).map(t => t.item_number).filter(Boolean)
      );
      const existingPaIds = new Set(
        (templates || []).map(t => t.pa_item_id).filter(Boolean)
      );

      // Also check brand_vendor_mappings for ALL mapped vendor IDs
      let existingVendorIds = new Set<string>();
      if (templateIds.length > 0) {
        const { data: mappings } = await supabase
          .from("brand_vendor_mappings")
          .select("vendor_item_id")
          .in("brand_template_id", templateIds);
        existingVendorIds = new Set(
          (mappings || []).map(m => String(m.vendor_item_id || "").trim()).filter(Boolean)
        );
      }

      let newItemCount = 0;

      // --- PFG Scan (Bid Guide) ---
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
                    if (!itemNumber) continue;
                    // Check all three sources
                    if (existingPfgNumbers.has(itemNumber) || existingVendorIds.has(itemNumber)) continue;

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

          // --- PA Scan (Catalog only — no order history fallback) ---
          const seenPaItems = new Map<string, any>();

          for (const locId of locIds) {
            const { data: catalogItems } = await supabase
              .from("pa_catalog_items")
              .select("pa_item_id, description, pack_size, category, unit_price")
              .eq("location_id", locId);

            if (catalogItems?.length) {
              for (const item of catalogItems) {
                const paId = String(item.pa_item_id || "").trim();
                if (!paId || existingPaIds.has(paId) || existingVendorIds.has(paId) || seenPaItems.has(paId)) continue;
                seenPaItems.set(paId, {
                  description: item.description,
                  pack_size: item.pack_size,
                  category: item.category,
                  unit_price: item.unit_price,
                });
              }
            }
          }

          console.log(`[vendor-gap-scan] PA catalog unique items: ${seenPaItems.size}`);

          for (const [paId, item] of seenPaItems) {
            const { error } = await supabase
              .from("vendor_gap_alerts")
              .upsert(
                {
                  brand_id: brand.id,
                  vendor_source: "pa",
                  item_number: paId,
                  vendor_name: item.description || "",
                  vendor_description: item.description || "",
                  pack_size: item.pack_size || "",
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
