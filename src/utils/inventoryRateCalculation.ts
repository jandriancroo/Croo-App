import { supabase } from "@/integrations/supabase/client";

/**
 * Auto-calculate usage rates when a count is completed.
 * 
 * Formula: (Opening Count + Deliveries - Closing Count) ÷ Units Sold = Usage Rate
 * 
 * - Opening Count = previous completed count's quantities
 * - Closing Count = current count's quantities  
 * - Deliveries = PFG orders delivered between the two count dates
 * - Units Sold = sum of product_mix quantities from sales_cache for mapped POS categories
 */
export async function calculateUsageRates(
  countId: string,
  locationId: string
): Promise<{ calculated: number; skipped: number }> {
  try {
    // 1. Get current count details
    const { data: currentCount, error: countErr } = await supabase
      .from("inventory_counts")
      .select("id, count_date, period_end_date, counted_at")
      .eq("id", countId)
      .single();
    
    if (countErr || !currentCount) {
      console.error("Failed to fetch current count:", countErr);
      return { calculated: 0, skipped: 0 };
    }

    // 2. Find previous completed count for this location
    const { data: previousCount } = await supabase
      .from("inventory_counts")
      .select("id, count_date, period_end_date, counted_at")
      .eq("location_id", locationId)
      .eq("status", "completed")
      .neq("id", countId)
      .order("count_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!previousCount) {
      console.log("No previous count found — skipping rate calculation (need 2 counts)");
      return { calculated: 0, skipped: 0 };
    }

    // Use counted_at for precise sales cutoff, fallback to count_date
    // Convert UTC timestamps to PST dates to avoid off-by-one errors
    const toLocalDate = (utcStr: string) => {
      const d = new Date(utcStr);
      return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    };
    const periodStart = previousCount.counted_at 
      ? toLocalDate(previousCount.counted_at)
      : previousCount.count_date;
    const periodEnd = currentCount.counted_at 
      ? toLocalDate(currentCount.counted_at)
      : currentCount.count_date;

    // 3. Get closing count items (current count)
    const { data: closingItems } = await supabase
      .from("inventory_count_items")
      .select("item_id, quantity")
      .eq("count_id", countId);

    // 4. Get opening count items (previous count)
    const { data: openingItems } = await supabase
      .from("inventory_count_items")
      .select("item_id, quantity")
      .eq("count_id", previousCount.id);

    if (!closingItems || !openingItems) {
      console.error("Failed to fetch count items");
      return { calculated: 0, skipped: 0 };
    }

    // Build maps
    const openingMap = new Map<string, number>();
    for (const item of openingItems) {
      openingMap.set(item.item_id, Number(item.quantity));
    }

    const closingMap = new Map<string, number>();
    for (const item of closingItems) {
      closingMap.set(item.item_id, Number(item.quantity));
    }

    // 5. Get reconciled deliveries for this count (instead of date-range filtering)
    const { data: reconciledDeliveries } = await supabase
      .from("inventory_count_deliveries")
      .select("order_id, order_type")
      .eq("count_id", countId)
      .eq("reconciled", true);

    // First get item mappings (qubeyond_item_id -> inventory item id)
    const { data: inventoryItems } = await supabase
      .from("inventory_items")
      .select("id, qubeyond_item_id, count_units_per_case, pack_quantity, pack_quantity_override")
      .eq("location_id", locationId)
      .eq("is_active", true)
      .not("qubeyond_item_id", "is", null);

    const qubeyondToItemId = new Map<string, string>();
    for (const item of inventoryItems || []) {
      if (item.qubeyond_item_id) {
        qubeyondToItemId.set(item.qubeyond_item_id, item.id);
      }
    }

    const deliveryMap = new Map<string, number>();

    if (reconciledDeliveries && reconciledDeliveries.length > 0) {
      // Get PFG orders that were reconciled
      const pfgOrderIds = reconciledDeliveries
        .filter(d => d.order_type === "pfg")
        .map(d => d.order_id);

      if (pfgOrderIds.length > 0) {
        const { data: pfgOrders } = await supabase
          .from("pfg_orders")
          .select("items")
          .in("id", pfgOrderIds);

        for (const order of pfgOrders || []) {
          const items = order.items as any[];
          if (!Array.isArray(items)) continue;
          for (const orderItem of items) {
            const itemId = qubeyondToItemId.get(orderItem.productId || orderItem.id);
            if (itemId) {
              const qty = Number(orderItem.quantityShipped || orderItem.quantity || 0);
              deliveryMap.set(itemId, (deliveryMap.get(itemId) || 0) + qty);
            }
          }
        }
      }

      // Get PA orders that were reconciled
      const paOrderIds = reconciledDeliveries
        .filter(d => d.order_type === "produce_alliance")
        .map(d => d.order_id);

      if (paOrderIds.length > 0) {
        const { data: paOrders } = await supabase
          .from("pa_orders")
          .select("items")
          .in("id", paOrderIds);

        for (const order of paOrders || []) {
          const items = order.items as any[];
          if (!Array.isArray(items)) continue;
          for (const orderItem of items) {
            const itemId = qubeyondToItemId.get(orderItem.productId || orderItem.id);
            if (itemId) {
              const qty = Number(orderItem.quantityShipped || orderItem.quantity || 0);
              deliveryMap.set(itemId, (deliveryMap.get(itemId) || 0) + qty);
            }
          }
        }
      }
    } else {
      // Fallback: no reconciliation records, use date-range (backwards compat)
      const { data: pfgOrders } = await supabase
        .from("pfg_orders")
        .select("items")
        .eq("location_id", locationId)
        .gte("delivery_date", periodStart)
        .lte("delivery_date", periodEnd);

      for (const order of pfgOrders || []) {
        const items = order.items as any[];
        if (!Array.isArray(items)) continue;
        for (const orderItem of items) {
          const itemId = qubeyondToItemId.get(orderItem.productId || orderItem.id);
          if (itemId) {
            const qty = Number(orderItem.quantityShipped || orderItem.quantity || 0);
            deliveryMap.set(itemId, (deliveryMap.get(itemId) || 0) + qty);
          }
        }
      }
    }

    // 6. Get product groups with POS category mappings (merge brand + location)
    // Resolve brand_id
    const { data: locData } = await supabase
      .from("locations")
      .select("organization_id")
      .eq("id", locationId)
      .maybeSingle();
    let brandId: string | null = null;
    if (locData?.organization_id) {
      const { data: orgData } = await supabase
        .from("organizations")
        .select("brand_id")
        .eq("id", locData.organization_id)
        .maybeSingle();
      brandId = orgData?.brand_id || null;
    }

    let brandGroups: any[] = [];
    if (brandId) {
      const { data } = await supabase
        .from("inventory_product_groups")
        .select("id, name, pos_categories, pos_items")
        .eq("brand_id", brandId)
        .eq("is_active", true);
      brandGroups = data || [];
    }

    const { data: localGroups } = await supabase
      .from("inventory_product_groups")
      .select("id, name, pos_categories, pos_items")
      .eq("location_id", locationId)
      .is("brand_id", null)
      .eq("is_active", true);

    // Merge: brand base + local overrides (local wins by name)
    const mergedMap = new Map<string, any>();
    for (const g of brandGroups) mergedMap.set(g.name.toLowerCase(), g);
    for (const g of (localGroups || [])) mergedMap.set(g.name.toLowerCase(), g);
    const productGroups = Array.from(mergedMap.values());

    if (productGroups.length === 0) {
      console.log("No product groups configured — skipping rate calculation");
      return { calculated: 0, skipped: 0 };
    }

    // 7. Get sales data for the period to calculate units sold per POS category
    const { data: salesData } = await supabase
      .from("sales_cache")
      .select("product_mix")
      .eq("location_id", locationId)
      .gte("sale_date", periodStart)
      .lte("sale_date", periodEnd)
      .not("product_mix", "is", null);

    // Sum quantities by POS category AND individual item name
    const categorySales = new Map<string, number>();
    const itemSales = new Map<string, number>();
    for (const day of salesData || []) {
      const mix = day.product_mix as any[];
      if (!Array.isArray(mix)) continue;
      for (const item of mix) {
        if (item.category && item.quantity) {
          const cat = item.category as string;
          categorySales.set(cat, (categorySales.get(cat) || 0) + Number(item.quantity));
        }
        if (item.itemName && item.quantity) {
          const name = item.itemName as string;
          itemSales.set(name, (itemSales.get(name) || 0) + Number(item.quantity));
        }
      }
    }

    // Calculate units sold per product group (sum of mapped POS categories)
    const groupUnitsSold = new Map<string, number>();
    for (const group of productGroups) {
      const cats = (group.pos_categories as string[]) || [];
      const items = (group.pos_items as string[]) || [];
      let total = 0;
      for (const cat of cats) {
        total += categorySales.get(cat) || 0;
      }
      for (const itemName of items) {
        total += itemSales.get(itemName) || 0;
      }
      groupUnitsSold.set(group.id, total);
    }

    // 8. Get existing usage rate mappings (only non-manual-override)
    const { data: usageRates } = await supabase
      .from("inventory_usage_rates")
      .select("id, inventory_item_id, product_group_id, manual_override")
      .eq("location_id", locationId);

    if (!usageRates || usageRates.length === 0) {
      console.log("No usage rate mappings — skipping calculation");
      return { calculated: 0, skipped: 0 };
    }

    // 9. Calculate and update rates
    let calculated = 0;
    let skipped = 0;

    for (const rate of usageRates) {
      // Skip manual overrides
      if (rate.manual_override) {
        skipped++;
        continue;
      }

      const opening = openingMap.get(rate.inventory_item_id) || 0;
      const closing = closingMap.get(rate.inventory_item_id) || 0;
      const deliveries = deliveryMap.get(rate.inventory_item_id) || 0;
      const unitsSold = groupUnitsSold.get(rate.product_group_id) || 0;

      if (unitsSold === 0) {
        skipped++;
        continue;
      }

      const totalUsed = opening + deliveries - closing;
      const usageRate = totalUsed / unitsSold;

      // Round to 4 decimal places
      const roundedRate = Math.round(usageRate * 10000) / 10000;

      const { error: updateErr } = await supabase
        .from("inventory_usage_rates")
        .update({
          usage_rate: roundedRate,
          calculated_from_period_start: periodStart,
          calculated_from_period_end: periodEnd,
          last_calculated_at: new Date().toISOString(),
        })
        .eq("id", rate.id);

      if (!updateErr) {
        calculated++;
      } else {
        console.error(`Failed to update rate ${rate.id}:`, updateErr);
        skipped++;
      }
    }

    console.log(`Usage rates calculated: ${calculated}, skipped: ${skipped} (period: ${periodStart} to ${periodEnd})`);
    return { calculated, skipped };
  } catch (err) {
    console.error("Usage rate calculation error:", err);
    return { calculated: 0, skipped: 0 };
  }
}
