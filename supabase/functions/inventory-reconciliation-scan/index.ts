import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * inventory-reconciliation-scan
 * 
 * Reusable edge function that scans for data integrity issues in inventory_items:
 * 1. Active items with brand_item_id = null → auto-match via brand_vendor_mappings or deactivate
 * 2. Duplicate active items per (location_id, brand_item_id) → collapse, re-point count history
 * 
 * Params: { location_id?: string } — specific location or omit for all locations
 * Returns: structured report of all actions taken
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth check
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const targetLocationId: string | null = body.location_id || null;

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Determine which locations to scan
    let locationIds: string[] = [];
    if (targetLocationId) {
      locationIds = [targetLocationId];
    } else {
      const { data: locs } = await admin.from("locations").select("id").eq("is_active", true);
      locationIds = (locs || []).map((l: any) => l.id);
    }

    const report = {
      locations_scanned: locationIds.length,
      phase1_orphan_resolution: {
        total_orphans_found: 0,
        auto_matched: 0,
        deactivated_with_gap_alert: 0,
        deactivated_true_orphans: 0,
        count_history_repointed: 0,
        collisions_resolved: 0,
      },
      phase2_duplicate_cleanup: {
        total_duplicate_groups: 0,
        rows_deactivated: 0,
        count_history_repointed: 0,
        count_history_merged: 0,
      },
      errors: [] as string[],
    };

    for (const locationId of locationIds) {
      // Get location's brand_id
      const { data: loc } = await admin
        .from("locations")
        .select("organization_id, name")
        .eq("id", locationId)
        .single();
      if (!loc?.organization_id) continue;

      const { data: org } = await admin
        .from("organizations")
        .select("brand_id")
        .eq("id", loc.organization_id)
        .single();
      const brandId = org?.brand_id;
      if (!brandId) continue;

      console.log(`[Reconciliation] Scanning ${loc.name} (${locationId})`);

      // ========================================
      // PHASE 1: Orphan Resolution
      // Find active items with brand_item_id = null
      // ========================================
      const { data: orphans } = await admin
        .from("inventory_items")
        .select("id, name, item_number, pa_item_id, vendor_source, storage_location_id")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .is("brand_item_id", null);

      if (orphans && orphans.length > 0) {
        report.phase1_orphan_resolution.total_orphans_found += orphans.length;
        console.log(`[Reconciliation] Found ${orphans.length} orphans at ${loc.name}`);

        // Load brand_vendor_mappings for this brand
        const { data: mappings } = await admin
          .from("brand_vendor_mappings")
          .select("vendor_item_id, brand_template_id, vendor")
          .in("vendor", ["pa", "pfg", "invoice"]);

        const mappingByVendorId = new Map<string, string>();
        for (const m of mappings || []) {
          if (m.vendor_item_id) {
            mappingByVendorId.set(m.vendor_item_id.toLowerCase(), m.brand_template_id);
          }
        }

        // Load brand templates for name resolution
        const { data: templates } = await admin
          .from("brand_inventory_templates")
          .select("id, product_name")
          .eq("brand_id", brandId);
        const templateNameMap = new Map<string, string>();
        for (const t of templates || []) {
          templateNameMap.set(t.id, t.product_name);
        }

        // Load all active items at this location for collision detection
        const { data: activeItems } = await admin
          .from("inventory_items")
          .select("id, brand_item_id")
          .eq("location_id", locationId)
          .eq("is_active", true)
          .not("brand_item_id", "is", null);

        const activeBrandItemIds = new Map<string, string>();
        for (const item of activeItems || []) {
          if (item.brand_item_id) activeBrandItemIds.set(item.brand_item_id, item.id);
        }

        const gapAlerts: any[] = [];

        for (const orphan of orphans) {
          // Try to match via brand_vendor_mappings
          let matchedTemplateId: string | null = null;

          // Check pa_item_id
          if (orphan.pa_item_id) {
            matchedTemplateId = mappingByVendorId.get(orphan.pa_item_id.toLowerCase()) || null;
          }
          // Check item_number
          if (!matchedTemplateId && orphan.item_number) {
            matchedTemplateId = mappingByVendorId.get(orphan.item_number.toLowerCase()) || null;
          }

          if (matchedTemplateId) {
            // Check for collision: does another active item already have this brand_item_id?
            const existingBrandItemRow = activeBrandItemIds.get(matchedTemplateId);

            if (!existingBrandItemRow) {
              // No collision — auto-upgrade this orphan
              const { error: upErr } = await admin
                .from("inventory_items")
                .update({ brand_item_id: matchedTemplateId })
                .eq("id", orphan.id);
              
              if (upErr) {
                report.errors.push(`Failed to upgrade orphan ${orphan.id}: ${upErr.message}`);
              } else {
                report.phase1_orphan_resolution.auto_matched++;
                activeBrandItemIds.set(matchedTemplateId, orphan.id);
                console.log(`[Reconciliation] Auto-matched orphan "${orphan.name}" → template ${matchedTemplateId}`);
              }
            } else {
              // COLLISION: brand item already exists at this location
              // The orphan is the duplicate. Re-point count history, then deactivate.
              await repointCountHistory(admin, orphan.id, existingBrandItemRow, report);
              
              const { error: deactErr } = await admin
                .from("inventory_items")
                .update({ is_active: false })
                .eq("id", orphan.id);
              
              if (deactErr) {
                report.errors.push(`Failed to deactivate collision orphan ${orphan.id}: ${deactErr.message}`);
              } else {
                report.phase1_orphan_resolution.collisions_resolved++;
                console.log(`[Reconciliation] Collision resolved: orphan "${orphan.name}" deactivated, count history re-pointed to ${existingBrandItemRow}`);
              }
            }
          } else if (orphan.pa_item_id || orphan.item_number) {
            // Has vendor ID but no mapping found — deactivate + gap alert
            const { error: deactErr } = await admin
              .from("inventory_items")
              .update({ is_active: false })
              .eq("id", orphan.id);
            
            if (!deactErr) {
              report.phase1_orphan_resolution.deactivated_with_gap_alert++;
              gapAlerts.push({
                brand_id: brandId,
                vendor_source: orphan.pa_item_id ? "pa" : "pfg",
                item_number: orphan.item_number || orphan.pa_item_id || `orphan-${orphan.id.slice(0, 8)}`,
                vendor_name: orphan.name || "Unknown",
                vendor_description: orphan.name,
                pack_size: null,
                category_name: null,
                status: "new",
              });
              console.log(`[Reconciliation] Deactivated unmapped orphan "${orphan.name}" → gap alert`);
            }
          } else {
            // True orphan — no vendor IDs at all
            // Re-point any count history before deactivating
            // Check if there's count data we need to preserve
            const { data: countData } = await admin
              .from("inventory_count_items")
              .select("id")
              .eq("item_id", orphan.id)
              .limit(1);

            if (countData && countData.length > 0) {
              // Has count history but no way to match — send to gap alert for manual review
              gapAlerts.push({
                brand_id: brandId,
                vendor_source: "orphan",
                item_number: `orphan-${orphan.id.slice(0, 8)}`,
                vendor_name: orphan.name || "Unknown",
                vendor_description: `${orphan.name} — has count history, needs manual review`,
                pack_size: null,
                category_name: null,
                status: "new",
              });
            }

            const { error: deactErr } = await admin
              .from("inventory_items")
              .update({ is_active: false })
              .eq("id", orphan.id);
            
            if (!deactErr) {
              report.phase1_orphan_resolution.deactivated_true_orphans++;
              console.log(`[Reconciliation] Deactivated true orphan "${orphan.name}"`);
            }
          }
        }

        // Write gap alerts
        if (gapAlerts.length > 0) {
          const { error: gapErr } = await admin
            .from("vendor_gap_alerts")
            .upsert(gapAlerts, { onConflict: "brand_id,vendor_source,item_number", ignoreDuplicates: true });
          if (gapErr) {
            report.errors.push(`Gap alert write error: ${gapErr.message}`);
            console.error("[Reconciliation] Gap alert error:", gapErr);
          }
        }
      }

      // ========================================
      // PHASE 2: Duplicate Cleanup
      // Find (location_id, brand_item_id) groups with multiple active rows
      // ========================================
      // Fetch all active branded items at this location to find duplicates
      const { data: allActive } = await admin
        .from("inventory_items")
        .select("id, brand_item_id, storage_location_id, last_synced_at, created_at")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .not("brand_item_id", "is", null)
        .order("brand_item_id");

      // Group by brand_item_id
      const groups = new Map<string, any[]>();
      for (const item of allActive || []) {
        const key = item.brand_item_id!;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }

      for (const [brandItemId, items] of groups) {
        if (items.length <= 1) continue;
        report.phase2_duplicate_cleanup.total_duplicate_groups++;

        // Rank: count history presence FIRST, then shelf assignment, then newest
        const ranked: { item: any; countRecords: number }[] = [];
        for (const item of items) {
          const { count: cnt } = await admin
            .from("inventory_count_items")
            .select("id", { count: "exact", head: true })
            .eq("item_id", item.id);
          ranked.push({ item, countRecords: cnt || 0 });
        }

        // Sort: most count records first, then has shelf, then newest
        ranked.sort((a, b) => {
          if (b.countRecords !== a.countRecords) return b.countRecords - a.countRecords;
          const aShelf = a.item.storage_location_id ? 1 : 0;
          const bShelf = b.item.storage_location_id ? 1 : 0;
          if (bShelf !== aShelf) return bShelf - aShelf;
          return new Date(b.item.last_synced_at || b.item.created_at).getTime() -
                 new Date(a.item.last_synced_at || a.item.created_at).getTime();
        });

        const winner = ranked[0].item;
        const losers = ranked.slice(1).map(r => r.item);

        console.log(`[Reconciliation] Duplicate group for brand_item_id ${brandItemId}: keeping ${winner.id}, deactivating ${losers.length} losers`);

        // Re-point count history from losers to winner
        for (const loser of losers) {
          await repointCountHistory(admin, loser.id, winner.id, report);

          // If winner has no shelf but loser does, steal the shelf
          if (!winner.storage_location_id && loser.storage_location_id) {
            await admin
              .from("inventory_items")
              .update({ storage_location_id: loser.storage_location_id })
              .eq("id", winner.id);
            winner.storage_location_id = loser.storage_location_id;
          }

          // Deactivate loser
          const { error: deactErr } = await admin
            .from("inventory_items")
            .update({ is_active: false })
            .eq("id", loser.id);
          
          if (deactErr) {
            report.errors.push(`Failed to deactivate duplicate ${loser.id}: ${deactErr.message}`);
          } else {
            report.phase2_duplicate_cleanup.rows_deactivated++;
          }
        }
      }
    }

    console.log("[Reconciliation] Complete:", JSON.stringify(report));

    return new Response(JSON.stringify({ success: true, report }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("inventory-reconciliation-scan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Re-point count history from one item to another.
 * Handles the collision case where both items were counted in the same session
 * by summing quantities before re-pointing.
 */
async function repointCountHistory(
  admin: any,
  fromItemId: string,
  toItemId: string,
  report: any
) {
  // Get all count records for the source item
  const { data: sourceRecords } = await admin
    .from("inventory_count_items")
    .select("id, count_id, item_id, quantity, storage_location_id, entered_cases, entered_units")
    .eq("item_id", fromItemId);

  if (!sourceRecords || sourceRecords.length === 0) return;

  report.phase1_orphan_resolution.count_history_repointed += sourceRecords.length;

  for (const srcRecord of sourceRecords) {
    // Check if the target item already has a record in this same count session + storage location
    const coalesced = srcRecord.storage_location_id || "00000000-0000-0000-0000-000000000000";
    const { data: existingTarget } = await admin
      .from("inventory_count_items")
      .select("id, quantity, entered_cases, entered_units")
      .eq("count_id", srcRecord.count_id)
      .eq("item_id", toItemId)
      .eq("storage_location_id", srcRecord.storage_location_id || "00000000-0000-0000-0000-000000000000")
      .maybeSingle();

    // The unique constraint uses COALESCE, so we need to handle null storage_location_id
    // Actually query by the actual value:
    let existingTargetResult;
    if (srcRecord.storage_location_id) {
      existingTargetResult = await admin
        .from("inventory_count_items")
        .select("id, quantity, entered_cases, entered_units")
        .eq("count_id", srcRecord.count_id)
        .eq("item_id", toItemId)
        .eq("storage_location_id", srcRecord.storage_location_id)
        .maybeSingle();
    } else {
      existingTargetResult = await admin
        .from("inventory_count_items")
        .select("id, quantity, entered_cases, entered_units")
        .eq("count_id", srcRecord.count_id)
        .eq("item_id", toItemId)
        .is("storage_location_id", null)
        .maybeSingle();
    }

    const existing = existingTargetResult?.data;

    if (existing) {
      // COLLISION in same count session — sum quantities, delete source
      const mergedQty = (existing.quantity || 0) + (srcRecord.quantity || 0);
      const mergedCases = (existing.entered_cases || 0) + (srcRecord.entered_cases || 0);
      const mergedUnits = (existing.entered_units || 0) + (srcRecord.entered_units || 0);

      await admin
        .from("inventory_count_items")
        .update({ quantity: mergedQty, entered_cases: mergedCases, entered_units: mergedUnits })
        .eq("id", existing.id);

      await admin
        .from("inventory_count_items")
        .delete()
        .eq("id", srcRecord.id);

      report.phase2_duplicate_cleanup.count_history_merged++;
      console.log(`[Reconciliation] Merged count record ${srcRecord.id} into ${existing.id} (session collision)`);
    } else {
      // No collision — simple re-point
      await admin
        .from("inventory_count_items")
        .update({ item_id: toItemId })
        .eq("id", srcRecord.id);
    }
  }
}
