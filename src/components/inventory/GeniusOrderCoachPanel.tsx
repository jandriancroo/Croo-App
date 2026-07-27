import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sparkles, Loader2, Truck, Calendar, TrendingUp, RefreshCw } from "lucide-react";
import { DateTime } from "luxon";
import {
  computeUsageCoach,
  DOW_SHORT,
  type UsageCount,
  type UsageReceipt,
  type UsageItem,
  type VendorOrderDay,
} from "@/utils/computeUsageCoach";
import { useGeniusRecommendations } from "@/hooks/useGeniusRecommendations";

interface Props {
  locationId: string;
  timezone?: string;
}

// Pretty-print vendor names like "MCLANE FOODSERVICE, INC." -> "McLane Foodservice, Inc."
// Preserves common all-caps suffixes and inner caps (Mc*, Mac*).
function prettyVendor(raw: string | null | undefined): string {
  if (!raw) return "Unassigned vendor";
  const KEEP_UPPER = new Set(["LLC", "INC", "LTD", "CO", "USA", "US", "DBA"]);
  return raw
    .toLowerCase()
    .split(/(\s+|,)/)
    .map((tok) => {
      if (!tok.trim() || tok === ",") return tok;
      const bare = tok.replace(/\.$/, "");
      if (KEEP_UPPER.has(bare.toUpperCase())) return bare.toUpperCase() + (tok.endsWith(".") ? "." : "");
      if (/^mc[a-z]/.test(tok)) return "Mc" + tok.charAt(2).toUpperCase() + tok.slice(3);
      if (/^mac[a-z]/.test(tok)) return "Mac" + tok.charAt(3).toUpperCase() + tok.slice(4);
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    })
    .join("");
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
  const [useEngine, setUseEngine] = useState(false);
  const engine = useGeniusRecommendations(locationId, useEngine);

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["lite-items-for-genius", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lite_inventory_items" as any)
        .select("id, name, common_label, vendor_name_normalized, unit, is_active, case_qty, storage_id, display_order")
        .eq("location_id", locationId)
        .eq("is_active", true);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const { data: storages } = useQuery({
    queryKey: ["lite-storages-for-genius", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lite_storage_locations" as any)
        .select("id, name, sort_order")
        .eq("location_id", locationId)
        .order("sort_order")
        .order("name");
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
      // common_label/unit describe the *inner* counting unit (each/bag/sleeve).
      // We don't store a separate case-noun, so use "case" for the outer pack.
      const eachLabel = (i.common_label || i.unit || "each").toString();
      map.set(i.id, {
        caseQty: cq > 0 ? cq : 1,
        eachLabel,
        caseLabel: "case",
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
        <div className="space-y-0.5 flex-1">
          <div className="text-sm font-semibold">Genius Order Coach</div>
          <p className="text-xs text-muted-foreground">
            Smart order suggestions based on your submitted counts, invoice receipts,
            and vendor order days.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Switch checked={useEngine} onCheckedChange={setUseEngine} />
            Forecast v2
          </label>
          {useEngine && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => engine.refit.mutate()}
              disabled={engine.refit.isPending}
            >
              <RefreshCw className={`h-3 w-3 ${engine.refit.isPending ? "animate-spin" : ""}`} />
              Refit
            </Button>
          )}
        </div>
      </Card>

      {useEngine && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Forecast v2 — sales-linked engine
            </div>
            {engine.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {engine.data?.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Forecast is temporarily unavailable. Legacy recommendations are still shown below.
            </div>
          )}
          {engine.data && !engine.data.error && (() => {
            const rows = (engine.data.items as any[]).map((it: any) => {
              const rec = engine.data.recs[it.id];
              const rate = engine.data.rates[it.id];
              return { it, rec, rate };
            });
            // Split: items to order vs nothing needed, sort by size desc
            const toOrder = rows
              .filter((r) => r.rec && !r.rec.error && Number(r.rec.recommended_qty || 0) > 0)
              .sort((a, b) => Number(b.rec.recommended_qty) - Number(a.rec.recommended_qty));
            const noNeed = rows.filter(
              (r) => r.rec && !r.rec.error && Number(r.rec.recommended_qty || 0) <= 0,
            );
            const noData = rows.filter((r) => !r.rec || r.rec.error);
            const renderRow = ({ it, rec, rate }: any) => {
              const qty = Number(rec.recommended_qty || 0);
              const upc = Number(rec.units_per_case || 1);
              const cases = Number(rec.recommended_cases || 0);
              const unit = (it.common_label || it.unit || "each").toLowerCase();
              const orderInCases = upc > 1;
              // When we can convert to cases, show cases; when we can't, still
              // round up to whole counting units so we never show "0.4 sleeve".
              const displayQty = orderInCases ? cases : Math.ceil(qty);
              const displayLabel = orderInCases
                ? `case${displayQty === 1 ? "" : "s"}`
                : `${unit}${displayQty === 1 ? "" : "s"}`;
              const conf = rec.confidence as "green" | "amber" | "red";
              const badgeColor =
                conf === "green" ? "bg-emerald-100 text-emerald-800" :
                conf === "amber" ? "bg-amber-100 text-amber-800" :
                "bg-red-100 text-red-800";
              const weekly = Number(rate?.weekly_usage_level ?? 0);
              const weeklyDisplay = orderInCases
                ? `~${(weekly / upc).toFixed(1)} case/week`
                : `~${weekly.toFixed(1)} ${unit}/week`;
              const oh = Number(rec.projected_on_hand ?? 0);
              const ohDisplay = orderInCases
                ? `${(oh / upc).toFixed(1)} case on hand`
                : `${oh.toFixed(1)} on hand`;
              const perDay: { date: string; dow: number; forecast: number }[] = rec.per_day || [];
              const perDayTotal = perDay.reduce((s, d) => s + Number(d.forecast || 0), 0);
              return (
                <div key={it.id} className="py-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {weeklyDisplay} · {ohDisplay}
                        {!orderInCases && qty > 0 && (
                          <span className="ml-1 text-amber-700">· set case size to order in cases</span>
                        )}
                      </div>
                    </div>
                    <Badge className={`text-[10px] ${badgeColor}`} variant="outline">
                      {rec.periods_used}p
                    </Badge>
                    <div className="text-right">
                      <div className="text-base font-bold text-primary leading-tight">
                        {displayQty}
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        {displayLabel} to order
                      </div>
                    </div>
                  </div>
                  {perDay.length > 0 && (
                    <div className="rounded-md border border-border/50 bg-muted/20 p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                          Coverage · {perDay.length}d until delivery
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          ~{perDayTotal.toFixed(1)} {unit} needed
                        </span>
                      </div>
                      <div className="flex gap-1 overflow-x-auto">
                        {perDay.map((d, idx) => {
                          const isLast = idx === perDay.length - 1;
                          const dt = DateTime.fromFormat(d.date, "yyyy-MM-dd");
                          return (
                            <div
                              key={d.date}
                              className={`flex-1 min-w-[40px] text-center rounded px-1 py-1 ${
                                isLast
                                  ? "bg-primary/15 ring-1 ring-primary/40"
                                  : "bg-background/60"
                              }`}
                              title={`${dt.toFormat("EEE MMM d")}: ${Number(d.forecast).toFixed(2)} ${unit}${isLast ? " · delivery" : ""}`}
                            >
                              <div className={`text-[9px] uppercase leading-tight ${isLast ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                                {dt.toFormat("EEE")}
                              </div>
                              <div className={`text-[11px] font-semibold leading-tight ${isLast ? "text-primary" : "text-foreground"}`}>
                                {Number(d.forecast).toFixed(1)}
                              </div>
                              {isLast && (
                                <div className="text-[8px] text-primary/80 leading-tight">
                                  order
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            };
            return (
              <div className="divide-y divide-border/50">
                {toOrder.length === 0 && (
                  <div className="py-3 text-xs text-muted-foreground italic text-center">
                    Nothing to order right now.
                  </div>
                )}
                {toOrder.map(renderRow)}
                {(noNeed.length > 0 || noData.length > 0) && (
                  <details className="pt-2">
                    <summary className="text-[11px] text-muted-foreground cursor-pointer py-1.5 hover:text-foreground">
                      {noNeed.length} on-hand · {noData.length} no history yet
                    </summary>
                    <div className="divide-y divide-border/50 mt-1">
                      {noNeed.map(renderRow)}
                      {noData.map(({ it, rec }) => (
                        <div key={it.id} className="py-2 flex items-center justify-between text-xs">
                          <span className="truncate">{it.name}</span>
                          <span className="text-muted-foreground italic">{rec?.error || "no data"}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })()}
        </Card>
      )}

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
                <span className="text-sm font-semibold truncate">{prettyVendor(g.vendor)}</span>
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
                const pack = packById.get(r.item.id) || { caseQty: 1, eachLabel: "each", caseLabel: "case" };
                const showRec =
                  r.recommendedOrderQty != null && r.recommendedOrderQty > 0;
                const lastCounted = r.lastCountedOn
                  ? DateTime.fromFormat(r.lastCountedOn, "yyyy-MM-dd").toRelative({ base: DateTime.fromFormat(today, "yyyy-MM-dd") })
                  : null;

                // Convert engine "each" output to cases when we have a pack size > 1.
                const recEaches = r.recommendedOrderQty ?? 0;
                const recCases = pack.caseQty > 1 ? Math.ceil(recEaches / pack.caseQty) : recEaches;
                const usePackUnit = pack.caseQty > 1;

                // Daily usage
                const dailyEach = r.dailyUsage;
                const caseWord = pack.caseLabel;
                const eachWord = pack.eachLabel;
                const dailyDisplay =
                  dailyEach == null
                    ? null
                    : usePackUnit
                      ? `${(dailyEach / pack.caseQty).toFixed(2)} ${caseWord.toLowerCase()}s per day`
                      : `${dailyEach.toFixed(2)} ${eachWord.toLowerCase()} per day`;

                // On hand
                const onHandEach = r.projectedOnHand;
                const onHandDisplay =
                  onHandEach == null
                    ? null
                    : usePackUnit
                      ? `${(onHandEach / pack.caseQty).toFixed(1)} ${caseWord.toLowerCase()}s on hand`
                      : `${onHandEach.toFixed(1)} ${eachWord.toLowerCase()} on hand`;

                const lastCountedLabel = r.lastCountedOn && lastCounted
                  ? `Last counted ${lastCounted}`
                  : null;
                const avgLabel =
                  r.periodsUsed > 0 ? `${r.periodsUsed}-period average` : null;

                return (
                  <div key={r.item.id} className="px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.item.name}
                      </div>
                      {usePackUnit && (
                        <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mt-0.5">
                          1 {caseWord} = {pack.caseQty} {eachWord}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {dailyDisplay ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                            <TrendingUp className="h-3 w-3" />
                            {dailyDisplay}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[11px] italic">
                            No usage data yet
                          </span>
                        )}
                        {onHandDisplay && (
                          <span className="inline-flex items-center rounded-full bg-muted text-foreground/80 px-2 py-0.5 text-[11px] font-medium">
                            {onHandDisplay}
                          </span>
                        )}
                        {lastCountedLabel && (
                          <span className="inline-flex items-center rounded-full bg-muted/60 text-muted-foreground px-2 py-0.5 text-[11px]">
                            {lastCountedLabel}
                          </span>
                        )}
                        {avgLabel && (
                          <span className="inline-flex items-center rounded-full bg-muted/60 text-muted-foreground px-2 py-0.5 text-[11px]">
                            {avgLabel}
                          </span>
                        )}
                      </div>
                      {r.reason && !showRec && (
                        <div className="text-[10px] text-muted-foreground/70 italic mt-1">
                          {r.reason}
                        </div>
                      )}
                    </div>

                    <div className="text-right">
                      {showRec ? (
                        <>
                          <div className="text-base font-bold text-primary leading-tight">
                            {recCases}
                          </div>
                          <div className="text-[10px] text-muted-foreground leading-tight">
                            {usePackUnit
                              ? `${pack.caseLabel.toLowerCase()}${recCases === 1 ? "" : "s"} to order`
                              : `${pack.eachLabel.toLowerCase()} to order`}
                          </div>
                          {usePackUnit && (
                            <div className="text-[10px] text-muted-foreground/70 leading-tight">
                              need ~{recEaches} {pack.eachLabel.toLowerCase()}
                            </div>
                          )}
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
