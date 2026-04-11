import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALE_DAYS = 14;
const DISCONTINUED_DAYS = 30;
const UPSERT_BATCH_SIZE = 50;

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
          const stateMatch = (loc.address || "").match(/\b([A-Z]{2})\s*\.?\s*\d{5}/i)
            || (loc.address || "").match(/,\s*([A-Z]{2})\s*$/i)
            || (loc.address || "").match(/,\s*([A-Z]{2})\s+/i);
          territoryMap.set(loc.id, stateMatch ? stateMatch[1].toUpperCase() : "unknown");
        }
      }

      const locIds = locations.map(l => l.id);
      const skuMap = new Map<string, { lastSeen: string; lastPrice: number | null; lastLocationId: string; productName: string }>();

      // --- Scan PFG orders (last 90 days) ---
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      for (let i = 0; i < locIds.length; i += 10) {
        const batch = locIds.slice(i, i + 10);
        const { data: pfgOrders } = await supabase
          .from("pfg_orders")
          .select("location_id, item_number, description, unit_price, delivery_date")
          .in("location_id", batch)
          .gte("delivery_date", ninetyDaysAgo)
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
          .gte("delivery_date", ninetyDaysAgo)
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

      // --- Load existing records to detect first_seen_at and status transitions ---
      const { data: existingHealth } = await supabase
        .from("vendor_sku_health")
        .select("id, vendor_source, vendor_sku, vendor_territory, last_seen_at, status, first_seen_at")
        .eq("brand_id", brand.id);

      const existingMap = new Map<string, any>();
      for (const r of (existingHealth || [])) {
        existingMap.set(`${r.vendor_source}|${r.vendor_sku}|${r.vendor_territory}`, r);
      }

      // --- Classify all SKUs and build upsert batch ---
      const now = new Date();
      let staleCount = 0;
      let discontinuedCount = 0;

      // Track territory-level transitions for scoped alerts
      const territoryAlerts = new Map<string, { stale: number; discontinued: number; examples: string[] }>();

      const upsertRows: any[] = [];

      for (const [key, data] of skuMap) {
        const [vendorSource, vendorSku, territory] = key.split("|");
        const lastSeenDate = new Date(data.lastSeen);
        const daysSince = Math.floor((now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24));

        let status: string = "active";
        if (daysSince > DISCONTINUED_DAYS) {
          status = "discontinued";
          discontinuedCount++;
        } else if (daysSince > STALE_DAYS) {
          status = "stale";
          staleCount++;
        }

        // Detect transition for territory-scoped alerts
        const existing = existingMap.get(key);
        const oldStatus = existing?.status || null;
        if (oldStatus && oldStatus !== status && status !== "active") {
          if (!territoryAlerts.has(territory)) {
            territoryAlerts.set(territory, { stale: 0, discontinued: 0, examples: [] });
          }
          const ta = territoryAlerts.get(territory)!;
          if (status === "stale") ta.stale++;
          if (status === "discontinued") ta.discontinued++;
          if (ta.examples.length < 3) ta.examples.push(data.productName || vendorSku);
        }
        // New SKU that's already stale/discontinued on first detection
        if (!oldStatus && status !== "active") {
          if (!territoryAlerts.has(territory)) {
            territoryAlerts.set(territory, { stale: 0, discontinued: 0, examples: [] });
          }
          const ta = territoryAlerts.get(territory)!;
          if (status === "stale") ta.stale++;
          if (status === "discontinued") ta.discontinued++;
          if (ta.examples.length < 3) ta.examples.push(data.productName || vendorSku);
        }

        // FIX #2: Preserve first_seen_at from existing record, or set to now for new SKUs
        const firstSeenAt = existing?.first_seen_at || now.toISOString();

        upsertRows.push({
          brand_id: brand.id,
          vendor_source: vendorSource,
          vendor_sku: vendorSku,
          vendor_territory: territory,
          status,
          last_seen_at: data.lastSeen,
          last_price: data.lastPrice,
          last_location_id: data.lastLocationId,
          product_name: data.productName,
          first_seen_at: firstSeenAt,
        });
      }

      // --- FIX #3: Batched upserts instead of sequential ---
      let updated = 0;
      for (let i = 0; i < upsertRows.length; i += UPSERT_BATCH_SIZE) {
        const batch = upsertRows.slice(i, i + UPSERT_BATCH_SIZE);
        const { error, count } = await supabase
          .from("vendor_sku_health")
          .upsert(batch, { onConflict: "brand_id,vendor_source,vendor_sku,vendor_territory" });
        if (!error) updated += batch.length;
        else console.error(`[vendor-sku-health-sync] Batch upsert error:`, error.message);
      }

      // --- Update existing records NOT seen in this scan ---
      const updateBatch: { id: string; status: string }[] = [];
      for (const record of (existingHealth || [])) {
        const key = `${record.vendor_source}|${record.vendor_sku}|${record.vendor_territory}`;
        if (skuMap.has(key)) continue;

        const lastSeenDate = new Date(record.last_seen_at);
        const daysSince = Math.floor((now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24));

        let newStatus = record.status;
        if (daysSince > DISCONTINUED_DAYS && record.status !== "discontinued") {
          newStatus = "discontinued";
          discontinuedCount++;
        } else if (daysSince > STALE_DAYS && record.status === "active") {
          newStatus = "stale";
          staleCount++;
        }

        if (newStatus !== record.status) {
          updateBatch.push({ id: record.id, status: newStatus });
          const territory = record.vendor_territory || "unknown";
          if (!territoryAlerts.has(territory)) {
            territoryAlerts.set(territory, { stale: 0, discontinued: 0, examples: [] });
          }
          const ta = territoryAlerts.get(territory)!;
          if (newStatus === "stale") ta.stale++;
          if (newStatus === "discontinued") ta.discontinued++;
          if (ta.examples.length < 3) ta.examples.push(record.product_name || record.vendor_sku);
        }
      }

      // Batch status updates
      for (const item of updateBatch) {
        await supabase
          .from("vendor_sku_health")
          .update({ status: item.status })
          .eq("id", item.id);
      }

      // --- FIX #1: Territory-scoped alerts instead of brand-level ---
      if (territoryAlerts.size > 0) {
        const today = new Date().toISOString().split("T")[0];

        const { data: brandMembers } = await supabase
          .from("brand_members")
          .select("user_id")
          .eq("brand_id", brand.id)
          .eq("brand_role", "admin");

        const userIds = (brandMembers || []).map(m => m.user_id);

        if (userIds.length > 0) {
          for (const [territory, alert] of territoryAlerts) {
            if (alert.stale === 0 && alert.discontinued === 0) continue;

            const dedupKey = `vendor_health_${brand.id}_${territory}_${today}`;
            const exampleStr = alert.examples.length > 0 ? ` (e.g. ${alert.examples.join(", ")})` : "";
            const body = `${territory}: ${alert.stale} stale, ${alert.discontinued} discontinued SKUs${exampleStr}`;

            await supabase
              .from("alert_queue")
              .upsert(
                {
                  alert_type: "vendor_sku_health",
                  dedup_key: dedupKey,
                  payload: {
                    user_ids: userIds,
                    title: `🔍 ${brand.name} — ${territory} SKU Health`,
                    body,
                    notification_type: "vendor_sku_health",
                    data: { type: "vendor_sku_health", brand_id: brand.id, territory },
                  },
                },
                { onConflict: "dedup_key" }
              );
          }
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
