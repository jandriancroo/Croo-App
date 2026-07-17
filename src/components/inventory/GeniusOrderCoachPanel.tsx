import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Sparkles, Loader2, Truck, Calendar, TrendingUp } from "lucide-react";
import { DateTime } from "luxon";
import {
  computeUsageCoach,
  DOW_SHORT,
  type UsageCount,
  type UsageReceipt,
  type UsageItem,
  type VendorOrderDay,
} from "@/utils/computeUsageCoach";

interface Props {
  locationId: string;
  timezone?: string;
}

/**
 * Genius Order Coach (Lite) — inline tab panel.
 *
 * Uses submitted counts + invoice receipts to compute point-to-point daily
 * usage per item, then combines with vendor order-day schedule to suggest
 * "order X units of Y before next order day".
 *
 * Math lives in @/utils/computeUsageCoach.ts so a future Brand adapter can
 * reuse the same engine.
 */
export default function GeniusOrderCoachPanel({
  locationId,
  timezone = "America/Los_Angeles",
}: Props) {
  const today = DateTime.now().setZone(timezone).toFormat("yyyy-MM-dd");

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["lite-items-for-genius", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lite_inventory_items" as any)
        .select("id, name, common_label, vendor_name_normalized, unit, is_active, case_qty")
        .eq("location_id", locationId)
        .eq("is_active", true);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const { data: countsData, isLoading: countsLoading } = useQuery({
    queryKey: ["lite-counts-for-genius", locationId],
    queryFn: async () => {
      const { data: heads, error } = await supabase
        .from("lite_inventory_counts" as any)
        .select("id, period_end, status")
        .eq("location_id", locationId)
        .eq("status", "submitted")
        .order("period_end", { ascending: false })
        .limit(8);
      if (error) throw error;
      const rows = (heads as any[]) || [];
      if (rows.length === 0) return { counts: [] as UsageCount[] };

      const ids = rows.map((r) => r.id);
      const { data: itemsRows, error: e2 } = await supabase
        .from("lite_inventory_count_items" as any)
        .select("count_id, item_id, quantity, case_quantity, inner_quantity, case_qty_at_count")
        .in("count_id", ids);
      if (e2) throw e2;

      const byCount = new Map<string, Record<string, number>>();
      (itemsRows as any[]).forEach((ci) => {
        const q =
          Number(ci.quantity ?? 0) +
          Number(ci.case_quantity ?? 0) * Number(ci.case_qty_at_count ?? 0) +
          Number(ci.inner_quantity ?? 0);
        const bag = byCount.get(ci.count_id) || {};
        bag[ci.item_id] = (bag[ci.item_id] || 0) + q;
        byCount.set(ci.count_id, bag);
      });

      const counts: UsageCount[] = rows.map((r) => ({
        period_end: r.period_end,
        quantities: byCount.get(r.id) || {},
      }));
      return { counts };
    },
  });

  const { data: receipts, isLoading: receiptsLoading } = useQuery({
    queryKey: ["lite-receipts-for-genius", locationId],
    enabled: !!items,
    queryFn: async (): Promise<UsageReceipt[]> => {
      const cutoff = DateTime.now().minus({ days: 120 }).toFormat("yyyy-MM-dd");
      const { data: invs, error } = await supabase
        .from("lite_vendor_invoices" as any)
        .select("id, invoice_date, delivery_date")
        .eq("location_id", locationId)
        .gte("invoice_date", cutoff);
      if (error) throw error;
      const invRows = (invs as any[]) || [];
      if (invRows.length === 0) return [];
      const invMap = new Map(
        invRows.map((i) => [i.id, i.delivery_date || i.invoice_date])
      );
      const { data: lines, error: e2 } = await supabase
        .from("lite_vendor_invoice_items" as any)
        .select("invoice_id, matched_item_id, quantity")
        .in("invoice_id", Array.from(invMap.keys()))
        .not("matched_item_id", "is", null);
      if (e2) throw e2;

      const caseQtyById = new Map<string, number>();
      (items || []).forEach((it: any) => {
        const cq = Number(it.case_qty ?? 0);
        caseQtyById.set(it.id, cq > 0 ? cq : 1);
      });

      return (lines as any[])
        .map((l) => {
          const perCase = caseQtyById.get(l.matched_item_id) ?? 1;
          const cases = Number(l.quantity ?? 0);
          return {
            item_id: l.matched_item_id as string,
            received_on: invMap.get(l.invoice_id) as string,
            quantity: cases * perCase,
          };
        })
        .filter((r) => !!r.received_on && r.quantity > 0);
    },
  });

  const { data: orderDays, isLoading: orderDaysLoading } = useQuery({
    queryKey: ["lite-order-days-for-genius", locationId],
    queryFn: async (): Promise<VendorOrderDay[]> => {
      const { data, error } = await supabase
        .from("lite_vendor_order_schedule" as any)
        .select("vendor_name, order_day, delivery_day")
        .eq("location_id", locationId);
      if (error) throw error;
      return (data as any[]).map((r) => ({
        vendor: r.vendor_name,
        order_day: r.order_day,
        delivery_day: r.delivery_day,
      }));
    },
  });

  const loading = itemsLoading || countsLoading || receiptsLoading || orderDaysLoading;

  // Map id -> pack info so we can convert the engine's "each" output back
  // into cases (how operators actually order).
  const packById = useMemo(() => {
    const map = new Map<string, { caseQty: number; eachLabel: string; caseLabel: string }>();
    (items || []).forEach((i: any) => {
      const cq = Number(i.case_qty ?? 0);
      map.set(i.id, {
        caseQty: cq > 0 ? cq : 1,
        eachLabel: (i.unit || "each").toString(),
        caseLabel: (i.common_label || "case").toString(),
      });
    });
    return map;
  }, [items]);

  const coach = useMemo(() => {
    if (loading || !items || !countsData) return [];
    const uItems: UsageItem[] = items.map((i: any) => ({
      id: i.id,
      name: i.name || "Unnamed item",
      vendor: i.vendor_name_normalized,
      unitLabel: i.unit || "each",
    }));
    return computeUsageCoach({
      today,
      items: uItems,
      counts: countsData.counts,
      receipts: receipts || [],
      orderDays: orderDays || [],
    });
  }, [loading, items, countsData, receipts, orderDays, today]);


  const grouped = useMemo(() => {
    const map = new Map<string, typeof coach>();
    coach.forEach((row) => {
      const key = row.vendor || "Unassigned vendor";
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    });
    const groups = Array.from(map.entries()).map(([vendor, rows]) => {
      const nextOrder = rows.find((r) => r.nextOrderDay != null)?.nextOrderDay ?? 99;
      const daysUntil = rows.find((r) => r.daysUntilNextDelivery != null)?.daysUntilNextDelivery ?? 99;
      const sorted = [...rows].sort((a, b) => {
        const ra = a.recommendedOrderQty ?? -1;
        const rb = b.recommendedOrderQty ?? -1;
        return rb - ra;
      });
      return { vendor, nextOrder, daysUntil, rows: sorted };
    });
    return groups.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [coach]);

  const hasEnoughData = (countsData?.counts.length ?? 0) >= 2;

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-start gap-3 bg-muted/20">
        <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="text-sm font-semibold">Genius Order Coach</div>
          <p className="text-xs text-muted-foreground">
            Smart order suggestions based on your submitted counts, invoice receipts,
            and vendor order days.
          </p>
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasEnoughData ? (
        <Card className="p-6 text-center space-y-2">
          <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <p className="text-sm font-medium">Not enough count history yet</p>
          <p className="text-xs text-muted-foreground">
            Genius needs at least 2 submitted counts to compute daily usage.
            Tip: use "Historical Count" (from New Count) to seed prior-system data.
          </p>
        </Card>
      ) : grouped.length === 0 ? (
        <p className="text-xs text-muted-foreground italic text-center py-10">
          No active items to coach on.
        </p>
      ) : (
        grouped.map((g) => (
          <Card key={g.vendor} className="overflow-hidden">
            <div className="px-3 py-2.5 bg-muted/30 border-b border-border/50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-semibold truncate">{g.vendor}</span>
              </div>
              {g.nextOrder < 99 ? (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Calendar className="h-3 w-3" />
                  Order {DOW_SHORT[g.nextOrder]}
                  {g.daysUntil < 99 && ` · ${g.daysUntil}d out`}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  No order day set
                </Badge>
              )}
            </div>
            <div className="divide-y divide-border/50">
              {g.rows.map((r) => {
                const showRec =
                  r.recommendedOrderQty != null && r.recommendedOrderQty > 0;
                const lastCounted = r.lastCountedOn
                  ? DateTime.fromFormat(r.lastCountedOn, "yyyy-MM-dd").toRelative({ base: DateTime.fromFormat(today, "yyyy-MM-dd") })
                  : null;
                return (
                  <div key={r.item.id} className="px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-1.5">
                        {r.item.name}
                        {r.item.unitLabel && (
                          <span className="text-[10px] font-normal text-muted-foreground/70 uppercase tracking-wide">
                            · {r.item.unitLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                        {r.dailyUsage != null ? (
                          <span className="inline-flex items-center gap-1">
                            <TrendingUp className="h-3 w-3" />
                            {r.dailyUsage.toFixed(2)}/day
                          </span>
                        ) : (
                          <span className="italic">No usage yet</span>
                        )}
                        {r.projectedOnHand != null && (
                          <span>· ~{r.projectedOnHand.toFixed(1)} on hand</span>
                        )}
                        {lastCounted && (
                          <span>· counted {lastCounted}</span>
                        )}
                        {r.periodsUsed > 0 && (
                          <span>· {r.periodsUsed}p avg</span>
                        )}
                      </div>
                      {r.reason && !showRec && (
                        <div className="text-[10px] text-muted-foreground/70 italic mt-0.5">
                          {r.reason}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      {showRec ? (
                        <>
                          <div className="text-base font-bold text-primary leading-tight">
                            {r.recommendedOrderQty}
                          </div>
                          <div className="text-[10px] text-muted-foreground leading-tight">
                            order {r.item.unitLabel || "units"}
                          </div>
                        </>
                      ) : r.recommendedOrderQty === 0 ? (
                        <Badge variant="outline" className="text-[10px]">OK</Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                );
              })}

            </div>
          </Card>
        ))
      )}
    </div>
  );
}
