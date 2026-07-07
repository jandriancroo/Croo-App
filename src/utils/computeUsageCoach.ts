import { DateTime } from "luxon";

/**
 * Point-to-point usage engine (POS-agnostic).
 *
 * Input shape lets Lite and Brand both feed the same math:
 *   counts:    submitted count snapshots (period_end + per-item qty in a common unit)
 *   receipts:  invoice line receipts (dated + per-item qty in the same common unit)
 *   items:     the catalog we're coaching on (id + display name + vendor)
 *   orderDays: per-vendor { order_day 0-6, delivery_day 0-6 | null }
 *
 * Output: per-item stats + coaching row.
 *
 * Formula between two consecutive submitted counts A → B (period_end A < B):
 *   usage_in_period = qty_A + sum(receipts dated (A, B]) − qty_B
 *   daily_usage     = usage_in_period / days_between(A, B)
 * Averaged across the last N periods (simple mean, ignoring negatives).
 *
 * Recommended order = max(0, ceil((daysUntilNextDelivery + safetyDays) * daily − projectedOnHand))
 *   projectedOnHand ≈ qty_lastCount + receiptsSinceLastCount − daily * daysSinceLastCount
 */

export interface UsageCount {
  period_end: string; // yyyy-MM-dd
  quantities: Record<string, number>; // item_id -> qty in normalized unit
}

export interface UsageReceipt {
  item_id: string;
  received_on: string; // yyyy-MM-dd
  quantity: number; // normalized units received
}

export interface UsageItem {
  id: string;
  name: string;
  vendor: string | null;
  unitLabel?: string;
}

export interface VendorOrderDay {
  vendor: string;
  order_day: number;
  delivery_day: number | null;
}

export interface UsageCoachRow {
  item: UsageItem;
  dailyUsage: number | null;
  periodsUsed: number;
  projectedOnHand: number | null;
  vendor: string | null;
  nextOrderDay: number | null;
  nextDeliveryDay: number | null;
  daysUntilNextDelivery: number | null;
  recommendedOrderQty: number | null;
  lastCountedOn: string | null;
  reason?: string;
}

const SAFETY_DAYS = 2;

function daysBetween(a: string, b: string) {
  return Math.max(
    1,
    Math.round(
      DateTime.fromFormat(b, "yyyy-MM-dd").diff(
        DateTime.fromFormat(a, "yyyy-MM-dd"),
        "days"
      ).days
    )
  );
}

function nextDowFromToday(dow: number, todayStr: string) {
  const today = DateTime.fromFormat(todayStr, "yyyy-MM-dd");
  const todayDow = today.weekday % 7; // 1=Mon..7=Sun -> 0=Sun..6=Sat
  let diff = dow - todayDow;
  if (diff <= 0) diff += 7;
  return diff;
}

export function computeUsageCoach(input: {
  today: string; // yyyy-MM-dd in location tz
  items: UsageItem[];
  counts: UsageCount[]; // sorted or unsorted; we sort inside
  receipts: UsageReceipt[];
  orderDays: VendorOrderDay[];
  maxPeriods?: number;
}): UsageCoachRow[] {
  const { today, items, receipts, orderDays } = input;
  const maxPeriods = input.maxPeriods ?? 4;

  const counts = [...input.counts].sort((a, b) =>
    a.period_end.localeCompare(b.period_end)
  );

  // Group receipts by item_id
  const receiptsByItem = new Map<string, UsageReceipt[]>();
  receipts.forEach((r) => {
    const list = receiptsByItem.get(r.item_id) || [];
    list.push(r);
    receiptsByItem.set(r.item_id, list);
  });

  // Vendor -> order days
  const orderDaysByVendor = new Map<string, VendorOrderDay[]>();
  orderDays.forEach((o) => {
    const list = orderDaysByVendor.get(o.vendor) || [];
    list.push(o);
    orderDaysByVendor.set(o.vendor, list);
  });

  return items.map<UsageCoachRow>((item) => {
    const itemReceipts = receiptsByItem.get(item.id) || [];

    // Build per-period usage from consecutive counts
    const usages: number[] = [];
    const consecutivePairs = counts.slice(-1 - maxPeriods).length - 1;
    const startIdx = Math.max(0, counts.length - 1 - maxPeriods);
    for (let i = startIdx; i < counts.length - 1; i++) {
      const a = counts[i];
      const b = counts[i + 1];
      const qtyA = a.quantities[item.id];
      const qtyB = b.quantities[item.id];
      if (qtyA == null || qtyB == null) continue;
      const received = itemReceipts
        .filter((r) => r.received_on > a.period_end && r.received_on <= b.period_end)
        .reduce((s, r) => s + (r.quantity || 0), 0);
      const usage = qtyA + received - qtyB;
      const days = daysBetween(a.period_end, b.period_end);
      if (usage >= 0 && days > 0) usages.push(usage / days);
    }
    void consecutivePairs;

    const dailyUsage =
      usages.length > 0
        ? usages.reduce((s, x) => s + x, 0) / usages.length
        : null;

    // Projected current on-hand
    const lastCount = counts[counts.length - 1];
    const lastQty = lastCount?.quantities[item.id] ?? null;
    const lastCountedOn = lastCount?.period_end ?? null;
    let projectedOnHand: number | null = null;
    if (lastQty != null && lastCountedOn) {
      const receivedSince = itemReceipts
        .filter((r) => r.received_on > lastCountedOn && r.received_on <= today)
        .reduce((s, r) => s + (r.quantity || 0), 0);
      const daysSince = Math.max(0, daysBetween(lastCountedOn, today) - 0);
      const usedSince = dailyUsage != null ? dailyUsage * daysSince : 0;
      projectedOnHand = Math.max(0, lastQty + receivedSince - usedSince);
    }

    // Vendor order schedule
    const vendor = item.vendor;
    const vendorSlots = vendor ? orderDaysByVendor.get(vendor) || [] : [];
    let nextOrderDay: number | null = null;
    let nextDeliveryDay: number | null = null;
    let daysUntilNextDelivery: number | null = null;

    if (vendorSlots.length > 0) {
      const upcoming = vendorSlots
        .map((s) => {
          const daysUntilOrder = nextDowFromToday(s.order_day, today);
          const deliveryDow = s.delivery_day ?? ((s.order_day + 1) % 7);
          // delivery is the next occurrence of deliveryDow AFTER the order day
          let daysUntilDelivery = daysUntilOrder + ((deliveryDow - s.order_day + 7) % 7);
          if (daysUntilDelivery === daysUntilOrder) daysUntilDelivery += 7;
          return { s, daysUntilOrder, daysUntilDelivery, deliveryDow };
        })
        .sort((a, b) => a.daysUntilOrder - b.daysUntilOrder)[0];
      nextOrderDay = upcoming.s.order_day;
      nextDeliveryDay = upcoming.deliveryDow;
      daysUntilNextDelivery = upcoming.daysUntilDelivery;
    }

    // Recommended order qty
    let recommendedOrderQty: number | null = null;
    let reason: string | undefined;
    if (dailyUsage == null) {
      reason = "Need at least 2 submitted counts";
    } else if (daysUntilNextDelivery == null) {
      reason = "No order day set for this vendor";
    } else if (projectedOnHand == null) {
      reason = "No baseline count yet";
    } else {
      const coverDays = daysUntilNextDelivery + SAFETY_DAYS;
      const target = coverDays * dailyUsage;
      recommendedOrderQty = Math.max(0, Math.ceil(target - projectedOnHand));
      if (recommendedOrderQty === 0) reason = "You have enough on hand";
    }

    return {
      item,
      dailyUsage,
      periodsUsed: usages.length,
      projectedOnHand,
      vendor,
      nextOrderDay,
      nextDeliveryDay,
      daysUntilNextDelivery,
      recommendedOrderQty,
      lastCountedOn,
      reason,
    };
  });
}

export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
