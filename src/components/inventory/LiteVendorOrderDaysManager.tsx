import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Loader2, X, Plus } from "lucide-react";
import { toast } from "sonner";

interface Props {
  locationId: string;
}

const DAYS = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

interface OrderRow {
  id: string;
  vendor_name: string;
  order_day: number;
  delivery_day: number | null;
}

/**
 * Manages weekly order + delivery days per vendor for a Lite location.
 * Vendors are pulled from any invoices ever uploaded at this location.
 */
export default function LiteVendorOrderDaysManager({ locationId }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: vendors, isLoading: vendorsLoading } = useQuery({
    queryKey: ["lite-inventory-vendors", locationId],
    queryFn: async (): Promise<string[]> => {
      // Pull vendors from the items catalog (normalized names) so the labels
      // here match exactly what the Genius engine keys off of. Also include
      // invoice vendors as a fallback for stores with items still unmatched.
      const [{ data: itemRows, error: e1 }, { data: invRows, error: e2 }] =
        await Promise.all([
          supabase
            .from("lite_inventory_items" as any)
            .select("vendor_name_normalized")
            .eq("location_id", locationId)
            .not("vendor_name_normalized", "is", null),
          supabase
            .from("lite_vendor_invoices" as any)
            .select("vendor_name")
            .eq("location_id", locationId)
            .not("vendor_name", "is", null),
        ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const set = new Set<string>();
      (itemRows as any[]).forEach((r) => r.vendor_name_normalized && set.add(r.vendor_name_normalized));
      (invRows as any[]).forEach((r) => r.vendor_name && set.add(r.vendor_name));
      return Array.from(set).sort();
    },
  });

  const { data: rows, isLoading: rowsLoading } = useQuery({
    queryKey: ["lite-vendor-order-schedule", locationId],
    queryFn: async (): Promise<OrderRow[]> => {
      const { data, error } = await supabase
        .from("lite_vendor_order_schedule" as any)
        .select("id, vendor_name, order_day, delivery_day")
        .eq("location_id", locationId)
        .order("vendor_name")
        .order("order_day");
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["lite-vendor-order-schedule", locationId] });

  const addSlot = useMutation({
    mutationFn: async ({ vendor, order_day }: { vendor: string; order_day: number }) => {
      const { error } = await supabase.from("lite_vendor_order_schedule" as any).insert({
        location_id: locationId,
        vendor_name: vendor,
        order_day,
      });
      if (error) throw error;
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => {
      invalidate();
      toast.success("Order day added");
    },
    onError: (e: any) => toast.error("Couldn't add", { description: e?.message }),
  });

  const updateDelivery = useMutation({
    mutationFn: async ({ id, delivery_day }: { id: string; delivery_day: number | null }) => {
      const { error } = await supabase
        .from("lite_vendor_order_schedule" as any)
        .update({ delivery_day })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => invalidate(),
    onError: () => toast.error("Couldn't update delivery day"),
  });

  const removeSlot = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("lite_vendor_order_schedule" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => {
      invalidate();
      toast.success("Removed");
    },
  });

  if (vendorsLoading || rowsLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const rowsByVendor = new Map<string, OrderRow[]>();
  (rows || []).forEach((r) => {
    const list = rowsByVendor.get(r.vendor_name) || [];
    list.push(r);
    rowsByVendor.set(r.vendor_name, list);
  });

  const allVendors = Array.from(
    new Set([...(vendors || []), ...Array.from(rowsByVendor.keys())])
  ).sort();

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Truck className="h-4 w-4" />
          Vendor Order Days
          {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
        </div>

        {allVendors.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">
            Vendors will appear here after you upload their first invoice.
          </p>
        ) : (
          <div className="space-y-3">
            {allVendors.map((vendor) => {
              const vRows = rowsByVendor.get(vendor) || [];
              const usedDays = new Set(vRows.map((r) => r.order_day));
              const availDays = DAYS.filter((d) => !usedDays.has(d.value));

              return (
                <div key={vendor} className="rounded-md border border-border/50 p-2.5 space-y-2">
                  <div className="text-sm font-medium truncate">{vendor}</div>

                  {vRows.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic">
                      No order days set.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {vRows.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <Badge variant="secondary" className="pl-2 pr-1 py-0.5 gap-1">
                            Order {DAYS[r.order_day]?.short}
                            <button
                              onClick={() => removeSlot.mutate(r.id)}
                              className="hover:bg-muted rounded p-0.5 -mr-0.5"
                              aria-label="Remove"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                          <span className="text-muted-foreground">→ delivers</span>
                          <Select
                            value={r.delivery_day?.toString() ?? "none"}
                            onValueChange={(v) =>
                              updateDelivery.mutate({
                                id: r.id,
                                delivery_day: v === "none" ? null : parseInt(v),
                              })
                            }
                          >
                            <SelectTrigger className="h-7 text-xs w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {DAYS.map((d) => (
                                <SelectItem key={d.value} value={d.value.toString()}>
                                  {d.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  )}

                  {availDays.length > 0 && (
                    <Select
                      value=""
                      onValueChange={(v) =>
                        addSlot.mutate({ vendor, order_day: parseInt(v) })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Plus className="h-3 w-3" />
                          <SelectValue placeholder="Add order day" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {availDays.map((d) => (
                          <SelectItem key={d.value} value={d.value.toString()}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
