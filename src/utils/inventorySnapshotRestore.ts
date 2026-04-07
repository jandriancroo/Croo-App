/**
 * Inventory Snapshot & Restore Utility
 * 
 * Used during Step 5/6 location cleanup to preserve:
 * - Storage location assignments
 * - Display order
 * - Category assignments
 * - Multi-storage location configs (inventory_item_locations)
 * 
 * Flow:
 * 1. takeSnapshot(locationId) — before cleanup
 * 2. Perform cleanup (deactivate/re-sync)
 * 3. restoreSnapshot(locationId, snapshot) — after re-sync
 */

import { supabase } from "@/integrations/supabase/client";

export interface ItemSnapshot {
  item_number: string | null;
  pa_item_id: string | null;
  brand_item_id: string | null;
  storage_location_id: string | null;
  display_order: number | null;
  category: string | null;
  countable: boolean;
  is_daily_tracked: boolean;
  /** Multi-storage configs for this item */
  sub_locations: SubLocationSnapshot[];
}

export interface SubLocationSnapshot {
  storage_location_name: string; // name instead of ID for resilience
  count_by: string | null;
  pan_enabled_keys: string[] | null;
  pack_quantity_override: number | null;
  display_order: number | null;
}

export interface LocationSnapshot {
  location_id: string;
  taken_at: string;
  items: ItemSnapshot[];
  storage_locations: { id: string; name: string; display_order: number }[];
}

/**
 * Takes a full snapshot of inventory metadata for a location.
 * Call this BEFORE any cleanup/deactivation.
 */
export async function takeSnapshot(locationId: string): Promise<LocationSnapshot> {
  // Fetch all active items with their vendor keys
  const { data: items, error: itemsErr } = await supabase
    .from("inventory_items")
    .select("id, item_number, pa_item_id, brand_item_id, storage_location_id, display_order, category, countable, is_daily_tracked")
    .eq("location_id", locationId)
    .eq("is_active", true);

  if (itemsErr) throw new Error(`Failed to snapshot items: ${itemsErr.message}`);

  // Fetch storage locations for name-based matching
  const { data: storageLocations, error: slErr } = await supabase
    .from("inventory_locations")
    .select("id, name, display_order")
    .eq("location_id", locationId);

  if (slErr) throw new Error(`Failed to snapshot storage locations: ${slErr.message}`);

  const slMap = new Map(storageLocations?.map(sl => [sl.id, sl.name]) || []);

  // Fetch multi-storage configs
  const itemIds = items?.map(i => i.id) || [];
  let allSubLocations: any[] = [];

  // Batch in chunks of 200 to avoid query limits
  for (let i = 0; i < itemIds.length; i += 200) {
    const chunk = itemIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("inventory_item_locations")
      .select("item_id, storage_location_id, count_by, pan_enabled_keys, pack_quantity_override, display_order")
      .in("item_id", chunk);
    if (error) throw new Error(`Failed to snapshot sub-locations: ${error.message}`);
    if (data) allSubLocations.push(...data);
  }

  // Group sub-locations by item_id
  const subByItem = new Map<string, SubLocationSnapshot[]>();
  for (const sub of allSubLocations) {
    const list = subByItem.get(sub.item_id) || [];
    list.push({
      storage_location_name: slMap.get(sub.storage_location_id) || sub.storage_location_id,
      count_by: sub.count_by,
      pan_enabled_keys: sub.pan_enabled_keys,
      pack_quantity_override: sub.pack_quantity_override,
      display_order: sub.display_order,
    });
    subByItem.set(sub.item_id, list);
  }

  const snapshot: LocationSnapshot = {
    location_id: locationId,
    taken_at: new Date().toISOString(),
    items: (items || []).map(item => ({
      item_number: item.item_number,
      pa_item_id: item.pa_item_id,
      brand_item_id: item.brand_item_id,
      storage_location_id: item.storage_location_id,
      display_order: item.display_order,
      category: item.category,
      countable: item.countable !== false,
      is_daily_tracked: item.is_daily_tracked === true,
      sub_locations: subByItem.get(item.id) || [],
    })),
    storage_locations: (storageLocations || []).map(sl => ({
      id: sl.id,
      name: sl.name,
      display_order: sl.display_order,
    })),
  };

  console.log(`[Snapshot] Captured ${snapshot.items.length} items, ${snapshot.storage_locations.length} storage locations for location ${locationId}`);
  return snapshot;
}

/**
 * Restores metadata from a snapshot onto the current inventory items.
 * Call this AFTER re-sync/re-activation.
 * 
 * Matching priority:
 * 1. brand_item_id (strongest link)
 * 2. item_number (PFG SKU)
 * 3. pa_item_id (Produce Alliance ID)
 */
export async function restoreSnapshot(
  locationId: string,
  snapshot: LocationSnapshot
): Promise<{ restored: number; unmatched: number; newItems: number }> {
  // Get current items after cleanup
  const { data: currentItems, error: ciErr } = await supabase
    .from("inventory_items")
    .select("id, item_number, pa_item_id, brand_item_id, display_order")
    .eq("location_id", locationId)
    .eq("is_active", true);

  if (ciErr) throw new Error(`Failed to read current items: ${ciErr.message}`);

  // Get current storage locations for name-based matching
  const { data: currentSL, error: cslErr } = await supabase
    .from("inventory_locations")
    .select("id, name")
    .eq("location_id", locationId);

  if (cslErr) throw new Error(`Failed to read storage locations: ${cslErr.message}`);

  const slNameToId = new Map(currentSL?.map(sl => [sl.name, sl.id]) || []);

  // Build lookup indexes from snapshot
  const byBrandId = new Map<string, ItemSnapshot>();
  const byItemNumber = new Map<string, ItemSnapshot>();
  const byPaId = new Map<string, ItemSnapshot>();

  for (const snap of snapshot.items) {
    if (snap.brand_item_id) byBrandId.set(snap.brand_item_id, snap);
    if (snap.item_number) byItemNumber.set(snap.item_number, snap);
    if (snap.pa_item_id) byPaId.set(snap.pa_item_id, snap);
  }

  let restored = 0;
  let unmatched = 0;
  let maxOrder = Math.max(...(currentItems || []).map(i => i.display_order || 0), 0);

  for (const item of currentItems || []) {
    // Try to find matching snapshot
    const match =
      (item.brand_item_id ? byBrandId.get(item.brand_item_id) : null) ||
      (item.item_number ? byItemNumber.get(item.item_number) : null) ||
      (item.pa_item_id ? byPaId.get(item.pa_item_id) : null);

    if (match) {
      // Restore metadata
      const { error: updateErr } = await supabase
        .from("inventory_items")
        .update({
          storage_location_id: match.storage_location_id,
          display_order: match.display_order,
          category: match.category,
          countable: match.countable,
          is_daily_tracked: match.is_daily_tracked,
        })
        .eq("id", item.id);

      if (updateErr) {
        console.warn(`[Restore] Failed to update item ${item.id}: ${updateErr.message}`);
        continue;
      }

      // Restore sub-location configs
      if (match.sub_locations.length > 0) {
        // Clear existing sub-locations for this item
        await supabase
          .from("inventory_item_locations")
          .delete()
          .eq("item_id", item.id);

        for (const sub of match.sub_locations) {
          const storageId = slNameToId.get(sub.storage_location_name);
          if (!storageId) {
            console.warn(`[Restore] Storage location "${sub.storage_location_name}" not found, skipping sub-location`);
            continue;
          }
          await supabase
            .from("inventory_item_locations")
            .insert({
              item_id: item.id,
              storage_location_id: storageId,
              count_by: sub.count_by,
              pan_enabled_keys: sub.pan_enabled_keys,
              pack_quantity_override: sub.pack_quantity_override,
              display_order: sub.display_order,
            });
        }
      }

      restored++;
    } else {
      // New item — append to end
      maxOrder += 10;
      await supabase
        .from("inventory_items")
        .update({ display_order: maxOrder })
        .eq("id", item.id);
      unmatched++;
    }
  }

  const newItems = unmatched;
  console.log(`[Restore] Done: ${restored} restored, ${newItems} new items appended`);
  return { restored, unmatched: 0, newItems };
}
