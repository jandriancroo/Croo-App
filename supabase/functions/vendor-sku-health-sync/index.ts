import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALE_DAYS = 14;
const DISCONTINUED_DAYS = 30;

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

    const results: { brandId: string; brandName: string; updated: number; stale: number; discontinued: number }[] = [];

    for (const brand of brands) {
      // Get all locations for this brand with their territories
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id")
        .eq("brand_id", brand.id);

      if (!orgs?.length) continue;

      const { data: locations } = await supabase
        .from("locations")
        .select("id, vendor_territory, address")
        .in("organization_id", orgs.map(o => o.id))
        .eq("is_active", true);

      if (!locations?.length) continue;

      // Build territory map: location_id -> territory
      const territoryMap = new Map<string, string>();
      for (const loc of locations) {
        if (loc.vendor_territory) {
          territoryMap.set(loc.id, loc.vendor_territory);
        } else {
          // Fallback: derive from address state
          const stateMatch = (loc.address || "").match(/\b([A-Z]{2})\s*\.?\s*\d{5}/i)
            || (loc.address || "").match(/,\s*([A-Z]{2})\s*$/i)
            || (loc.address || "").match(/,\s*([A-Z]{2})\s+/i);
          territoryMap.set(loc.id, stateMatch ? stateMatch[1].toUpperCase() : "unknown");
        }
      }

      const locIds = locations.map(l => l.id);
      const skuMap = new Map<string, { lastSeen: string; lastPrice: number | null; lastLocationId: string; productName: string }>();

      // --- Scan PFG orders (last 90 days) ---
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      // Process in batches of location IDs to avoid query limits
      for (let i = 0; i < locIds.length; i += 10) {
        const batch = locIds.slice(i, i + 10);
        const { data: pfgOrders } = await supabase
          .from("pfg_orders")
          .select("location_id, item_number, description, unit_price, delivery_date")
          .in("location_id", batch)
          .gte("delivery_date", ninetyDaysAgo.split("T")[0])
          .order("delivery_date", { ascending: false });

        for (const order of (pfgOrders || [])) {
          const sku = String(order.item_number || "").trim();
          if (!sku) continue;
          const territory = territoryMap.get(order.location_id) || "unknown";
          const key = `pfg|${sku}|${territory}`;
          const existing = skuMap.get(key);
          if (!existing || order.delivery_date > existing.lastSeen) {
            skuMap.set(key, {
              lastSeen: order.delivery_date,
              lastPrice: order.unit_price,
              lastLocationId: order.location_id,
              productName: order.description || "",
            });
          }
        }
      }

      // --- Scan PA orders (last 90 days) ---
      for (let i = 0; i < locIds.length; i += 10) {
        const batch = locIds.slice(i, i + 10);
        const { data: paOrders } = await supabase
          .from("pa_orders")
          .select("location_id, pa_item_id, description, unit_price, delivery_date")
          .in("location_id", batch)
          .gte("delivery_date", ninetyDaysAgo.split("T")[0])
          .order("delivery_date", { ascending: false });

        for (const order of (paOrders || [])) {
          const sku = String(order.pa_item_id || "").trim();
          if (!sku) continue;
          const territory = territoryMap.get(order.location_id) || "unknown";
          const key = `pa|${sku}|${territory}`;
          const existing = skuMap.get(key);
          if (!existing || order.delivery_date > existing.lastSeen) {
            skuMap.set(key, {
              lastSeen: order.delivery_date,
              lastPrice: order.unit_price,
              lastLocationId: order.location_id,
              productName: order.description || "",
            });
          }
        }
      }

      // --- Upsert into vendor_sku_health ---
      let updated = 0;
      let staleCount = 0;
      let discontinuedCount = 0;
      const now = new Date();

      for (const [key, data] of skuMap) {
        const [vendorSource, vendorSku, territory] = key.split("|");
        const lastSeenDate = new Date(data.lastSeen);
        const daysSince = Math.floor((now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24));

        let status: "active" | "stale" | "discontinued" = "active";
        if (daysSince > DISCONTINUED_DAYS) {
          status = "discontinued";
          discontinuedCount++;
        } else if (daysSince > STALE_DAYS) {
          status = "stale";
          staleCount++;
        }

        const { error } = await supabase
          .from("vendor_sku_health")
          .upsert(
            {
              brand_id: brand.id,
              vendor_source: vendorSource,
              vendor_sku: vendorSku,
              vendor_territory: territory,
              status,
              last_seen_at: data.lastSeen,
              last_price: data.lastPrice,
              last_location_id: data.lastLocationId,
              product_name: data.productName,
            },
            { onConflict: "brand_id,vendor_source,vendor_sku,vendor_territory" }
          );

        if (!error) updated++;
      }

      // --- Update existing records not seen in this scan to stale/discontinued ---
      const { data: existingHealth } = await supabase
        .from("vendor_sku_health")
        .select("id, vendor_source, vendor_sku, vendor_territory, last_seen_at, status")
        .eq("brand_id", brand.id);

      for (const record of (existingHealth || [])) {
        const key = `${record.vendor_source}|${record.vendor_sku}|${record.vendor_territory}`;
        if (skuMap.has(key)) continue; // Already updated

        const lastSeenDate = new Date(record.last_seen_at);
        const daysSince = Math.floor((now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24));

        let newStatus: "active" | "stale" | "discontinued" = record.status as any;
        if (daysSince > DISCONTINUED_DAYS && record.status !== "discontinued") {
          newStatus = "discontinued";
          discontinuedCount++;
        } else if (daysSince > STALE_DAYS && record.status === "active") {
          newStatus = "stale";
          staleCount++;
        }

        if (newStatus !== record.status) {
          await supabase
            .from("vendor_sku_health")
            .update({ status: newStatus })
            .eq("id", record.id);
        }
      }

      // --- Queue alerts for newly stale/discontinued items ---
      if (staleCount > 0 || discontinuedCount > 0) {
        const today = new Date().toISOString().split("T")[0];
        const dedupKey = `vendor_health_${brand.id}_${today}`;

        // Get brand admin user IDs
        const { data: brandMembers } = await supabase
          .from("brand_members")
          .select("user_id")
          .eq("brand_id", brand.id)
          .eq("brand_role", "admin");

        const userIds = (brandMembers || []).map(m => m.user_id);

        if (userIds.length > 0) {
          const body = `${staleCount} stale, ${discontinuedCount} discontinued SKUs detected across territories`;

          await supabase
            .from("alert_queue")
            .upsert(
              {
                alert_type: "vendor_sku_health",
                dedup_key: dedupKey,
                payload: {
                  user_ids: userIds,
                  title: `🔍 ${brand.name} — Vendor SKU Health`,
                  body,
                  notification_type: "vendor_sku_health",
                  data: { type: "vendor_sku_health", brand_id: brand.id },
                },
              },
              { onConflict: "dedup_key" }
            );
        }
      }

      results.push({
        brandId: brand.id,
        brandName: brand.name,
        updated,
        stale: staleCount,
        discontinued: discontinuedCount,
      });
    }

    console.log("[vendor-sku-health-sync] Complete:", JSON.stringify(results));

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[vendor-sku-health-sync] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
