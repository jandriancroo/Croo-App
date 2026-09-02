import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";
import { isExcludedLocation } from "../_shared/inventoryGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  {
    const denied = await requireAuthorizedCaller(req, corsHeaders, { minRole: "admin" });
    if (denied) return denied;
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
      // Get existing templates for this brand — EXCLUDE archived rows so they
      // don't falsely block new gap alerts or trigger auto-resolution.
      const { data: templates } = await supabase
        .from("brand_inventory_templates")
        .select("id, item_number, pa_item_id, status")
        .eq("brand_id", brand.id)
        .neq("status", "archived");

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

      // AUTO-RESOLVE: Any existing 'new' alert whose item_number is now mapped
      // (either as a template item_number/pa_item_id OR in brand_vendor_mappings)
      // should be flipped to 'resolved' so it disappears from the gap finder.
      // This handles the race where a user links the item AFTER an alert was created.
      const { data: openAlerts } = await supabase
        .from("vendor_gap_alerts")
        .select("id, vendor_source, item_number")
        .eq("brand_id", brand.id)
        .eq("status", "new");

      const idsToResolve: string[] = [];
      for (const a of (openAlerts || [])) {
        const itemNum = String(a.item_number || "").trim();
        if (!itemNum) continue;
        const isMapped =
          existingVendorIds.has(itemNum) ||
          (a.vendor_source === "pfg" && existingPfgNumbers.has(itemNum)) ||
          (a.vendor_source === "produce_alliance" && existingPaIds.has(itemNum));
        if (isMapped) idsToResolve.push(a.id);
      }

      if (idsToResolve.length > 0) {
        // Chunk to avoid URL length limits
        for (let i = 0; i < idsToResolve.length; i += 50) {
          const chunk = idsToResolve.slice(i, i + 50);
          await supabase
            .from("vendor_gap_alerts")
            .update({ status: "resolved", resolved_at: new Date().toISOString() })
            .in("id", chunk);
        }
        console.log(`[vendor-gap-scan] Auto-resolved ${idsToResolve.length} alerts for ${brand.name} (now mapped)`);
        // Also remove from existingAlertKeys so logic below treats them fresh
        for (const a of (openAlerts || [])) {
          if (idsToResolve.includes(a.id)) {
            existingAlertKeys.delete(`${a.vendor_source}:${a.item_number}`);
          }
        }
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
          // Hard, named exclusion (sandbox stores) — never scanned.
          const locIds = locs.map(l => l.id).filter(id => !isExcludedLocation(id));
          if (locIds.length === 0) continue;
          const locNameById = new Map((locs || []).map(l => [l.id, l.name]));

          // --- PFG Scan: loop EVERY active PFG integration for this brand ---
          // Bug-fix history: previously we did .limit(1).maybeSingle() against
          // .in(location_id, locIds) which scanned exactly one location's bid
          // guide per brand. Locations with unique SKU sets (e.g. Rowlett vs
          // Hemet) produced zero gap alerts because their bid was never fetched.
          // Now we iterate every PFG-connected location and call the same
          // pfg-service `categories` action that deploy-location-inventory uses
          // — that's the territory-scoped, authoritative product list.
          const { data: pfgInts } = await supabase
            .from("location_integrations")
            .select("credentials, location_id")
            .in("location_id", locIds)
            .eq("integration_type", "pfg")
            .eq("is_active", true);

          console.log(`[vendor-gap-scan] ${brand.name}: ${pfgInts?.length || 0} active PFG integrations to scan`);

          for (const pfgInt of (pfgInts || [])) {
            const creds = (pfgInt.credentials || {}) as any;
            const productListHeaderId = creds?.product_list_header_id;
            const customerId = creds?.customer_id;
            const pfgLocId = pfgInt.location_id;
            const pfgLocName = locNameById.get(pfgLocId) || "Unknown";

            // Skip locations missing the bid-guide config rather than crashing the brand scan.
            if (!productListHeaderId || !customerId) {
              console.warn(`[vendor-gap-scan] Skipping ${pfgLocName} — missing product_list_header_id or customer_id`);
              continue;
            }

            try {
              const { data: catData, error: catErr } = await supabase.functions.invoke(
                "pfg-service",
                {
                  body: {
                    action: "categories",
                    locationId: pfgLocId,
                    productListHeaderId,
                    customerId,
                  },
                }
              );

              if (catErr) {
                console.warn(`[vendor-gap-scan] pfg-service categories failed for ${pfgLocName}: ${catErr.message}`);
                continue;
              }

              const categories = catData?.data?.categories || [];
              let scannedSkus = 0;
              let locNewCount = 0;

              // Flatten products across ALL categories — not just the first one.
              for (const cat of categories) {
                for (const item of (cat.products || [])) {
                  const itemNumber = String(item?.itemNumber || "").trim();
                  if (!itemNumber) continue;
                  scannedSkus++;
                  if (existingPfgNumbers.has(itemNumber) || existingVendorIds.has(itemNumber)) continue;

                  const vendorName = item.fullDescription || item.description || item.name || "";
                  // The RPC merges reported_by_locations so a SKU missing at
                  // multiple locations becomes ONE alert row with both tagged.
                  const isNewAlert = !existingAlertKeys.has(`pfg:${itemNumber}`);

                  const { error } = await supabase.rpc('upsert_vendor_gap_with_location', {
                    _brand_id: brand.id,
                    _vendor_source: "pfg",
                    _item_number: itemNumber,
                    _vendor_name: vendorName,
                    _vendor_description: item.fullDescription || vendorName,
                    _pack_size: item.packSize || "",
                    _category_name: cat.name || cat.categoryName || item.categoryName || "",
                    _location_id: pfgLocId,
                    _location_name: pfgLocName,
                  });

                  if (!error) {
                    if (isNewAlert) {
                      newItemCount++;
                      locNewCount++;
                      // Track so the next location in this loop merges instead of double-counting as new.
                      existingAlertKeys.add(`pfg:${itemNumber}`);
                    }
                  }
                }
              }

              console.log(`[vendor-gap-scan] PFG ${pfgLocName}: scanned ${scannedSkus} SKUs, ${locNewCount} new gap alerts`);
            } catch (e) {
              console.error(`[vendor-gap-scan] PFG scan error for ${pfgLocName}:`, e);
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
            // NOTE: do NOT skip when alert already exists — the RPC merges
            // reported_by_locations so existing gaps accumulate location tags.
            const isNewAlert = !existingAlertKeys.has(`produce_alliance:${paId}`);

            const paLocId = paItemFirstLoc.get(paId)!;
            const paLocName = locNameById.get(paLocId) || "Unknown";

            const { error } = await supabase.rpc('upsert_vendor_gap_with_location', {
              _brand_id: brand.id,
              _vendor_source: "produce_alliance",
              _item_number: paId,
              _vendor_name: vendorName,
              _vendor_description: vendorName,
              _pack_size: item.pack_size || "",
              _category_name: item.category || "",
              _location_id: paLocId,
              _location_name: paLocName,
            });

            if (!error && isNewAlert) newItemCount++;
          }
        }
      }

      // Stamp last scan timestamp so the UI can show "Last updated at"
      await supabase
        .from("brands")
        .update({ last_vendor_gap_scan_at: new Date().toISOString() })
        .eq("id", brand.id);

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
