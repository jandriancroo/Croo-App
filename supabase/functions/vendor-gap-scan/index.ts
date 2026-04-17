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
      // Batch in chunks of 50 to avoid PostgREST URL length limits
      let existingVendorIds = new Set<string>();
      if (templateIds.length > 0) {
        const CHUNK_SIZE = 50;
        for (let i = 0; i < templateIds.length; i += CHUNK_SIZE) {
          const chunk = templateIds.slice(i, i + CHUNK_SIZE);
          const { data: mappings } = await supabase
            .from("brand_vendor_mappings")
            .select("vendor_item_id")
            .in("brand_template_id", chunk);
          for (const m of (mappings || [])) {
            const vid = String(m.vendor_item_id || "").trim();
            if (vid) existingVendorIds.add(vid);
          }
        }
      }

      // Track existing alert keys (vendor_source + item_number) to avoid overwriting status
      // on rows that have already been resolved/ignored/dismissed by a human.
      // We deliberately do NOT name-blacklist anymore — a different SKU for the same product
      // name is a legitimate new gap and should surface so it can be linked.
      const { data: existingAlerts } = await supabase
        .from("vendor_gap_alerts")
        .select("vendor_source, item_number")
        .eq("brand_id", brand.id);

      const existingAlertKeys = new Set<string>();
      for (const alert of (existingAlerts || [])) {
        existingAlertKeys.add(`${alert.vendor_source}:${alert.item_number}`);
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
          .select("id, name")
          .in("organization_id", orgIds);

        if (locs?.length) {
          const locIds = locs.map(l => l.id);
          const locNameById = new Map((locs || []).map(l => [l.id, l.name]));
          const { data: pfgInt } = await supabase
            .from("location_integrations")
            .select("credentials, location_id")
            .in("location_id", locIds)
            .eq("integration_type", "pfg")
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          if (pfgInt?.credentials) {
            const creds = pfgInt.credentials as any;
            const accessToken = creds?.access_token;
            const customerId = creds?.customer_id;
            const pfgLocId = pfgInt.location_id;
            const pfgLocName = locNameById.get(pfgLocId) || "Unknown";

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
                    if (existingPfgNumbers.has(itemNumber) || existingVendorIds.has(itemNumber)) continue;

                    const vendorName = item.fullDescription || item.description || "";
                    if (existingAlertKeys.has(`pfg:${itemNumber}`)) continue;

                    const { error } = await supabase.rpc('upsert_vendor_gap_with_location', {
                      _brand_id: brand.id,
                      _vendor_source: "pfg",
                      _item_number: itemNumber,
                      _vendor_name: vendorName,
                      _vendor_description: item.fullDescription || "",
                      _pack_size: item.packSize || "",
                      _category_name: item.categoryName || "",
                      _location_id: pfgLocId,
                      _location_name: pfgLocName,
                    });

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
          // Track first-seen location per PA item so we can tag the gap with that source
          const seenPaItems = new Map<string, any>();
          const paItemFirstLoc = new Map<string, string>();

          for (const locId of locIds) {
            const { data: catalogItems } = await supabase
              .from("pa_catalog_items")
              .select("pa_item_id, description, pack_size, category, unit_price")
              .eq("location_id", locId);

            if (catalogItems?.length) {
              for (const item of catalogItems) {
                const paId = String(item.pa_item_id || "").trim();
                if (!paId || existingPaIds.has(paId) || existingVendorIds.has(paId)) continue;
                if (!seenPaItems.has(paId)) {
                  seenPaItems.set(paId, {
                    description: item.description,
                    pack_size: item.pack_size,
                    category: item.category,
                    unit_price: item.unit_price,
                  });
                  paItemFirstLoc.set(paId, locId);
                }
              }
            }
          }

          console.log(`[vendor-gap-scan] PA catalog unique items: ${seenPaItems.size}`);

          for (const [paId, item] of seenPaItems) {
            const vendorName = item.description || "";
            if (existingAlertKeys.has(`pa:${paId}`)) continue;

            const paLocId = paItemFirstLoc.get(paId)!;
            const paLocName = locNameById.get(paLocId) || "Unknown";

            const { error } = await supabase.rpc('upsert_vendor_gap_with_location', {
              _brand_id: brand.id,
              _vendor_source: "pa",
              _item_number: paId,
              _vendor_name: vendorName,
              _vendor_description: vendorName,
              _pack_size: item.pack_size || "",
              _category_name: item.category || "",
              _location_id: paLocId,
              _location_name: paLocName,
            });

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
