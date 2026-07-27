import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { DateTime } from "luxon";

/**
 * Admin → Usage Models
 *
 * Read-only view of the current forecasting state per item, plus:
 *  - toggle usage_model_locked and override the class
 *  - inspect excluded periods, manually exclude/restore
 *  - "Refit location" runs the engine end-to-end
 */
export default function UsageModelsPage() {
  const { locationId } = useParams();
  const qc = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["usage-models-admin", locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("lite_inventory_items" as any)
        .select("id, name, usage_model, usage_model_locked, par_level, is_active")
        .eq("location_id", locationId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      const ids = ((items as any[]) || []).map((i) => i.id);
      const { data: rates } = await supabase
        .from("item_usage_rates" as any)
        .select("item_id, weekly_usage_level, residual_stddev, r2_usage_vs_sales, periods_used, last_fitted_at")
        .in("item_id", ids);
      const rateById = new Map<string, any>();
      ((rates as any[]) || []).forEach((r) => rateById.set(r.item_id, r));
      return ((items as any[]) || []).map((it) => ({ ...it, rate: rateById.get(it.id) }));
    },
  });

  const refit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("genius-usage-engine", {
        body: { action: "rebuildLocation", location_id: locationId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Location refitted");
      qc.invalidateQueries({ queryKey: ["usage-models-admin", locationId] });
    },
    onError: (e: any) => toast.error("Refit failed", { description: e?.message }),
  });

  const setModel = useMutation({
    mutationFn: async ({ id, model, locked }: { id: string; model?: string; locked?: boolean }) => {
      const patch: any = {};
      if (model) patch.usage_model = model;
      if (locked != null) patch.usage_model_locked = locked;
      const { error } = await supabase.from("lite_inventory_items" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-models-admin", locationId] }),
  });

  return (
    <Layout>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Usage Models</h1>
            <p className="text-xs text-muted-foreground">
              Current forecasting state for each item — locked overrides are respected.
            </p>
          </div>
          <Button
            onClick={() => refit.mutate()}
            disabled={refit.isPending}
            size="sm"
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${refit.isPending ? "animate-spin" : ""}`} />
            Refit location
          </Button>
        </div>

        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Lock</TableHead>
                  <TableHead className="text-right">R²</TableHead>
                  <TableHead className="text-right">Residual</TableHead>
                  <TableHead className="text-right">Periods</TableHead>
                  <TableHead className="text-right">Last fit</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows || []).map((it: any) => {
                  const r2 = it.rate?.r2_usage_vs_sales;
                  const residual = it.rate?.residual_stddev;
                  const periods = it.rate?.periods_used ?? 0;
                  const conf = periods >= 8 ? "green" : periods >= 4 ? "amber" : "red";
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.name}</TableCell>
                      <TableCell>
                        <Select
                          value={it.usage_model}
                          onValueChange={(v) => setModel.mutate({ id: it.id, model: v, locked: true })}
                        >
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sales_linked">Sales-linked</SelectItem>
                            <SelectItem value="time_based">Time-based</SelectItem>
                            <SelectItem value="par_based">Par-based</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={!!it.usage_model_locked}
                          onCheckedChange={(v) => setModel.mutate({ id: it.id, locked: v })}
                        />
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r2 != null ? Number(r2).toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {residual != null ? Number(residual).toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={
                            conf === "green"
                              ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                              : conf === "amber"
                                ? "text-amber-700 border-amber-200 bg-amber-50"
                                : "text-red-700 border-red-200 bg-red-50"
                          }
                        >
                          {periods}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-[11px] text-muted-foreground">
                        {it.rate?.last_fitted_at
                          ? DateTime.fromISO(it.rate.last_fitted_at).toRelative()
                          : "never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setSelectedItem(it.id === selectedItem ? null : it.id)}
                        >
                          {it.id === selectedItem ? "Hide" : "Periods"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        {selectedItem && <PeriodsCard itemId={selectedItem} />}
      </div>
    </Layout>
  );
}

function PeriodsCard({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const { data: periods, isLoading } = useQuery({
    queryKey: ["usage-periods-admin", itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_usage_periods" as any)
        .select("*")
        .eq("item_id", itemId)
        .order("period_end_date", { ascending: false })
        .limit(24);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, exclude }: { id: string; exclude: boolean }) => {
      const { data: userData } = await supabase.auth.getUser();
      const patch: any = exclude
        ? {
            is_excluded: true,
            exclusion_reason: "manual",
            excluded_by: userData.user?.id ?? null,
            excluded_at: new Date().toISOString(),
          }
        : {
            is_excluded: false,
            exclusion_reason: null,
            excluded_by: null,
            excluded_at: null,
          };
      const { error } = await supabase.from("item_usage_periods" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage-periods-admin", itemId] }),
  });

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-2 border-b bg-muted/30 text-xs font-semibold uppercase tracking-wide">
        Usage periods
      </div>
      {isLoading ? (
        <div className="p-6 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Window</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">Start</TableHead>
              <TableHead className="text-right">Rec'd</TableHead>
              <TableHead className="text-right">End</TableHead>
              <TableHead className="text-right">Usage</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">$/unit</TableHead>
              <TableHead></TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(periods || []).map((p: any) => (
              <TableRow key={p.id} className={p.is_excluded ? "opacity-60" : ""}>
                <TableCell className="text-xs">
                  {p.period_start_date} → {p.period_end_date}
                </TableCell>
                <TableCell className="text-right text-xs">{p.days_in_period}</TableCell>
                <TableCell className="text-right text-xs">{Number(p.qty_start).toFixed(1)}</TableCell>
                <TableCell className="text-right text-xs">{Number(p.qty_received).toFixed(1)}</TableCell>
                <TableCell className="text-right text-xs">{Number(p.qty_end).toFixed(1)}</TableCell>
                <TableCell className="text-right text-xs">{Number(p.usage).toFixed(1)}</TableCell>
                <TableCell className="text-right text-xs">
                  {p.net_sales != null ? `$${Number(p.net_sales).toFixed(0)}` : "—"}
                </TableCell>
                <TableCell className="text-right text-xs">
                  {p.usage_per_dollar != null ? Number(p.usage_per_dollar).toFixed(4) : "—"}
                </TableCell>
                <TableCell>
                  {p.is_excluded && (
                    <Badge variant="outline" className="text-[10px]">
                      {p.exclusion_reason || "excluded"}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => toggle.mutate({ id: p.id, exclude: !p.is_excluded })}
                  >
                    {p.is_excluded ? (
                      <><RotateCcw className="h-3 w-3" /> Restore</>
                    ) : (
                      <><XCircle className="h-3 w-3" /> Exclude</>
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
