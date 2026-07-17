import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Loader2,
  Download,
  ChevronDown,
  ChevronRight,
  TrendingDown,
  DollarSign,
  Package,
  Receipt,
} from "lucide-react";
import { DateTime } from "luxon";
import {
  buildCogs,
  cogsToCsv,
  downloadCsv,
  filterInvoicesInWindow,
  formatMoney,
  sumCountItems,
  type LiteInvoiceRow,
} from "@/utils/liteCogs";


interface Props {
  countId: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  locationName?: string;
}

/**
 * Lite COGS panel — mirrors PeriodDetailPanel.tsx's stacked-card layout,
 * scoped to Lite tables only. No vendor logos (Lite has no vendor sync).
 * Only rendered for submitted counts (parent decides).
 */
export default function LiteCogsPanel({
  countId,
  locationId,
  periodStart,
  periodEnd,
  locationName = "Location",
}: Props) {
  const [invoicesOpen, setInvoicesOpen] = useState(false);

  // Current period: count items joined to lite_inventory_items for category
  // grouping. (Manual sales removed — we pull net_sales from sales_cache.)
  const { data: current, isLoading: currentLoading } = useQuery({
    queryKey: ["lite-cogs-current", countId],
    enabled: !!countId,
    queryFn: async () => {
      const { data: rows, error: rowsErr } = await supabase
        .from("lite_inventory_count_items" as any)
        .select(
          "quantity, unit_value_at_count, case_quantity, inner_quantity, count_mode_at_count, cost_per_inner_unit_at_count, item:lite_inventory_items!lite_inventory_count_items_item_id_fkey(category)",
        )
        .eq("count_id", countId);
      if (rowsErr) throw rowsErr;
      return { rows: (rows as any) || [] };
    },
  });

  // Prior submitted count (for Beginning Inventory). None → $0 (day-one rule).
  const { data: priorEnding, isLoading: priorLoading } = useQuery({
    queryKey: ["lite-cogs-prior", locationId, periodStart],
    enabled: !!locationId && !!periodStart,
    queryFn: async (): Promise<number> => {
      const { data: prior, error } = await supabase
        .from("lite_inventory_counts" as any)
        .select("id")
        .eq("location_id", locationId)
        .eq("status", "submitted")
        .lt("period_end", periodStart)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!prior) return 0;

      const { data: rows, error: rowsErr } = await supabase
        .from("lite_inventory_count_items" as any)
        .select("quantity, unit_value_at_count, case_quantity, inner_quantity, count_mode_at_count, cost_per_inner_unit_at_count")
        .eq("count_id", (prior as any).id);
      if (rowsErr) throw rowsErr;
      return sumCountItems((rows as any) || []);
    },
  });

  // All invoices for this location; filter client-side to window using the
  // delivery_date (fallback invoice_date) rule.
  const { data: allInvoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["lite-cogs-invoices", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<LiteInvoiceRow[]> => {
      const { data, error } = await supabase
        .from("lite_vendor_invoices" as any)
        .select("id, vendor_name, invoice_date, delivery_date, total_amount")
        .eq("location_id", locationId)
        .order("delivery_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return ((data as any) || []) as LiteInvoiceRow[];
    },
  });

  // POS-synced net sales for the period. Replaces the manual sales input —
  // sales_cache is populated by the POS backfill so this is always current.
  const { data: posSales, isLoading: salesLoading } = useQuery({
    queryKey: ["lite-cogs-pos-sales", locationId, periodStart, periodEnd],
    enabled: !!locationId && !!periodStart && !!periodEnd,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from("sales_cache")
        .select("net_sales")
        .eq("location_id", locationId)
        .gte("sale_date", periodStart)
        .lte("sale_date", periodEnd);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return data.reduce((s, r: any) => s + (Number(r.net_sales) || 0), 0);
    },
  });

  const invoicesInWindow = useMemo(
    () => filterInvoicesInWindow(allInvoices, periodStart, periodEnd),
    [allInvoices, periodStart, periodEnd],
  );

  const loading = currentLoading || priorLoading || invoicesLoading || salesLoading;

  const breakdown = useMemo(() => {
    if (!current) return null;
    return buildCogs({
      currentRows: current.rows,
      priorEnding: priorEnding ?? 0,
      invoicesInWindow,
      manualSales: posSales ?? null,
    });
  }, [current, priorEnding, invoicesInWindow, posSales]);


  const onExport = () => {
    if (!breakdown) return;
    const csv = cogsToCsv(breakdown, {
      locationName,
      periodStart,
      periodEnd,
    });
    downloadCsv(
      `lite-cogs-${locationName.toLowerCase().replace(/\s+/g, "-")}-${periodStart}-${periodEnd}.csv`,
      csv,
    );
  };

  if (loading || !breakdown) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const fmtDate = (d: string | null) =>
    d ? DateTime.fromFormat(d, "yyyy-MM-dd").toFormat("LLL d") : "—";

  const cogsPct = breakdown.cogsPct;
  const cogsTone =
    cogsPct == null ? "text-muted-foreground"
    : cogsPct >= 65 ? "text-red-600"
    : cogsPct >= 60 ? "text-amber-600"
    : "text-emerald-600";

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">COGS</h3>
            {cogsPct != null && (
              <div className="flex items-baseline gap-1 ml-2">
                <span className={`text-base font-bold tabular-nums ${cogsTone}`}>
                  {cogsPct.toFixed(1)}%
                </span>
              </div>
            )}
            {posSales == null && (
              <span className="text-[10px] text-muted-foreground ml-1">
                (no POS sales yet)
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onExport}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        </div>

        <div className="divide-y divide-border/50">
          <SummaryRow
            icon={<Package className="h-4 w-4 text-muted-foreground" />}
            label="Beginning Inventory"
            hint={
              priorEnding === 0
                ? "No prior submitted count — starting from $0"
                : "Ending value of the previous submitted count"
            }
            value={formatMoney(breakdown.beginning)}
          />

          <div>
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 text-left"
              onClick={() => setInvoicesOpen((v) => !v)}
            >
              <Receipt className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  + Purchases
                  <Badge variant="secondary" className="text-[10px]">
                    {breakdown.invoices.length} invoice
                    {breakdown.invoices.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Delivered {fmtDate(periodStart)} – {fmtDate(periodEnd)}
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {formatMoney(breakdown.purchases)}
              </div>
              {invoicesOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <Collapsible open={invoicesOpen}>
              <CollapsibleContent>
                {breakdown.invoices.length === 0 ? (
                  <div className="px-4 pb-3 text-xs text-muted-foreground">
                    No invoices delivered in this window.
                  </div>
                ) : (
                  <div className="px-4 pb-3 space-y-1.5">
                    {breakdown.invoices.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center gap-3 text-xs border border-border/50 rounded-md px-3 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {inv.vendor_name || "Unknown vendor"}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {fmtDate(inv.delivery_date ?? inv.invoice_date)}
                            {inv.delivery_date == null && inv.invoice_date != null
                              ? " (invoice date)"
                              : ""}
                          </div>
                        </div>
                        <div className="tabular-nums font-medium">
                          {formatMoney(Number(inv.total_amount || 0))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>

          <SummaryRow
            icon={<Package className="h-4 w-4 text-muted-foreground" />}
            label="− Ending Inventory"
            hint="This period's submitted count value"
            value={formatMoney(breakdown.ending)}
          />

          <div className="flex items-center gap-3 px-4 py-4 bg-primary/5">
            <DollarSign className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">COGS $</div>
              <div className="text-[11px] text-muted-foreground">
                {posSales != null
                  ? `POS net sales · ${formatMoney(posSales)}`
                  : "Beginning + Purchases − Ending"}
              </div>
            </div>
            <div className="text-xl font-bold tabular-nums text-primary">
              {formatMoney(breakdown.cogs)}
            </div>
          </div>
        </div>
      </Card>



      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-border/50">
          <h3 className="text-sm font-semibold">Ending Inventory by Category</h3>
        </div>
        {breakdown.byCategory.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No counted items to break down.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {breakdown.byCategory.map((c) => (
              <div key={c.category} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.category}</div>
                  <div className="h-1.5 mt-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary/70"
                      style={{ width: `${Math.min(100, c.pctOfEnding)}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums">
                    {formatMoney(c.endingValue)}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {c.pctOfEnding.toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  hint,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
