import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { calculateCountItemValue } from "@/utils/countItemValue";
import { useBrandConversions } from "@/hooks/useBrandConversions";
import { resolveBrandId } from "@/utils/resolveBrandId";

interface CountExportDialogProps {
  countId: string;
  locationId: string;
  periodLabel: string;
}

const CountExportDialog = ({ countId, locationId, periodLabel }: CountExportDialogProps) => {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Resolve brand for Pipeline 1 conversion fallback (standard SOT contract)
  const { data: brandId } = useQuery({
    queryKey: ["location-brand-id", locationId],
    queryFn: () => resolveBrandId(locationId),
    enabled: !!locationId && open,
    staleTime: 10 * 60 * 1000,
  });
  const { conversionMap } = useBrandConversions(brandId);

  // Fetch location name
  const { data: location } = useQuery({
    queryKey: ["export-location", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("name, store_number")
        .eq("id", locationId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch all count items with details when dialog opens
  const { data: exportItems, isLoading } = useQuery({
    queryKey: ["export-count-items", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_count_items")
        .select(`
          id,
          quantity,
          cost_at_count,
          pack_quantity_at_count,
          inner_pack_quantity_at_count,
          entered_cases,
          entered_units,
          entered_inner_packs,
          item:inventory_items(
            name,
            unit,
            cost_per_unit,
            pack_quantity,
            pack_quantity_override,
            inner_pack_quantity,
            brand_item_id,
            pack_size,
            item_number,
            category,
            is_recipe,
            recipe_yield_qty,
            recipe_yield_unit,
            storage_location:inventory_locations(name)
          )
        `)
        .eq("count_id", countId);

      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Gate: only fetch legs data when location has opted in.
  const { data: legsEnabledForLocation } = useQuery({
    queryKey: ["export-location-legs-enabled", locationId],
    enabled: !!locationId && open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations" as any)
        .select("legs_enabled")
        .eq("id", locationId)
        .maybeSingle();
      if (error) throw error;
      return (data as any)?.legs_enabled === true;
    },
  });

  // Pack config labels keyed by pack_config_id, used to label per-leg rows.
  const { data: legLabelById } = useQuery({
    queryKey: ["export-leg-labels", locationId, legsEnabledForLocation],
    enabled: !!locationId && legsEnabledForLocation === true && open,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_pack_selections" as any)
        .select("brand_pack_configs!inner(id, label, status)")
        .eq("location_id", locationId);
      if (error) throw error;
      const m = new Map<string, string>();
      for (const row of (data as any[]) || []) {
        const bpc = row?.brand_pack_configs;
        if (!bpc?.id) continue;
        if (bpc.status && bpc.status !== "approved") continue;
        m.set(bpc.id, bpc.label ?? "");
      }
      return m;
    },
  });

  // Per-count-item legs (snapshot-driven valuation).
  type ExportLegRow = {
    pack_config_id: string;
    entered_cases: number | null;
    entered_inner_packs: number | null;
    entered_units: number | null;
    quantity_common: number | null;
    pack_quantity_at_count: number | null;
    inner_pack_quantity_at_count: number | null;
    cost_at_count: number | null;
  };
  const { data: legsByCountItemId } = useQuery({
    queryKey: ["export-legs-by-count-item", countId, legsEnabledForLocation],
    enabled: !!countId && legsEnabledForLocation === true && open,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_count_item_legs" as any)
        .select("count_item_id, pack_config_id, entered_cases, entered_inner_packs, entered_units, quantity_common, pack_quantity_at_count, inner_pack_quantity_at_count, cost_at_count, inventory_count_items!inner(count_id)")
        .eq("inventory_count_items.count_id", countId);
      if (error) throw error;
      const map = new Map<string, ExportLegRow[]>();
      for (const row of (data as any[]) || []) {
        if (!row?.count_item_id) continue;
        const list = map.get(row.count_item_id) ?? [];
        list.push({
          pack_config_id: row.pack_config_id,
          entered_cases: row.entered_cases,
          entered_inner_packs: row.entered_inner_packs,
          entered_units: row.entered_units,
          quantity_common: row.quantity_common,
          pack_quantity_at_count: row.pack_quantity_at_count,
          inner_pack_quantity_at_count: row.inner_pack_quantity_at_count,
          cost_at_count: row.cost_at_count,
        });
        map.set(row.count_item_id, list);
      }
      return map;
    },
  });

  const handleExport = () => {
    if (!exportItems) return;
    setExporting(true);

    try {
      const locationName = location?.name || "Unknown";
      const storeNum = location?.store_number ? ` (#${location.store_number})` : "";

      // Build CSV rows
      const headers = [
        "Storage Location",
        "Item Name",
        "Item Number",
        "Pack Size",
        "Category",
        "Unit",
        "Pack Config Label",
        "Pack Config ID",
        "Cases",
        "Units",
        "Total Qty",
        "Cost Per Case",
        "Unit Value",
      ];

      // Single source of truth — see src/utils/countItemValue.ts.
      // forceLiveData=false → exports honor snapshots so historical CSVs match the saved count.
      // For multi-config items (≥2 legs), pass legs[] so per-leg snapshots drive the parent total.
      const computeLineValue = (ci: any, item: any, legs?: ExportLegRow[]) => {
        const conversion = item?.brand_item_id ? conversionMap.get(item.brand_item_id) : null;
        return calculateCountItemValue(
          ci,
          {
            brand_item_id: item?.brand_item_id,
            cost_per_unit: item?.cost_per_unit,
            pack_quantity: item?.pack_quantity,
            pack_quantity_override: item?.pack_quantity_override,
            inner_pack_quantity: item?.inner_pack_quantity,
            is_recipe: item?.is_recipe === true,
            unit: item?.unit,
            recipe_yield_qty: item?.recipe_yield_qty,
            recipe_yield_unit: item?.recipe_yield_unit,
          },
          conversion || null,
          false,
          legs && legs.length >= 2 ? legs : undefined
        );
      };

      // Sort parents first (storage → name), then emit per-leg detail lines under each parent.
      const sortedItems = [...exportItems].sort((a: any, b: any) => {
        const aLoc = a.item?.storage_location?.name || "";
        const bLoc = b.item?.storage_location?.name || "";
        const locCmp = aLoc.localeCompare(bLoc);
        if (locCmp !== 0) return locCmp;
        return (a.item?.name || "").localeCompare(b.item?.name || "");
      });

      const rows: any[][] = [];
      for (const ci of sortedItems) {
        const item: any = ci.item || {};
        const legs = legsByCountItemId?.get(ci.id) || [];
        const isMultiConfig = legs.length >= 2;

        const parentValue = computeLineValue(ci, item, isMultiConfig ? legs : undefined);
        const parentCostPerCase = ci.cost_at_count != null
          ? Number(ci.cost_at_count) || 0
          : Number(item?.cost_per_unit) || 0;

        rows.push([
          item?.storage_location?.name || "",
          item?.name || "",
          item?.item_number || "",
          item?.pack_size || "",
          item?.category || "",
          item?.unit || "",
          "",
          "",
          ci.entered_cases ?? "",
          ci.entered_units ?? "",
          ci.quantity,
          parentCostPerCase.toFixed(2),
          parentValue.toFixed(2),
        ]);

        if (isMultiConfig) {
          for (const leg of legs) {
            const legValue = calculateCountItemValue(
              {
                quantity: leg.quantity_common,
                entered_cases: leg.entered_cases,
                entered_units: leg.entered_units,
                entered_inner_packs: leg.entered_inner_packs,
                cost_at_count: leg.cost_at_count,
                pack_quantity_at_count: leg.pack_quantity_at_count,
                inner_pack_quantity_at_count: leg.inner_pack_quantity_at_count,
              },
              {
                brand_item_id: item?.brand_item_id,
                cost_per_unit: item?.cost_per_unit,
                pack_quantity: item?.pack_quantity,
                pack_quantity_override: item?.pack_quantity_override,
                inner_pack_quantity: item?.inner_pack_quantity,
                is_recipe: item?.is_recipe === true,
                unit: item?.unit,
                recipe_yield_qty: item?.recipe_yield_qty,
                recipe_yield_unit: item?.recipe_yield_unit,
              },
              item?.brand_item_id ? conversionMap.get(item.brand_item_id) || null : null,
              false
            );
            const legCostPerCase = leg.cost_at_count != null ? Number(leg.cost_at_count) || 0 : 0;
            rows.push([
              item?.storage_location?.name || "",
              `  └ ${item?.name || ""}`,
              item?.item_number || "",
              item?.pack_size || "",
              item?.category || "",
              item?.unit || "",
              legLabelById?.get(leg.pack_config_id) || "",
              leg.pack_config_id,
              leg.entered_cases ?? "",
              leg.entered_units ?? "",
              leg.quantity_common ?? "",
              legCostPerCase.toFixed(2),
              legValue.toFixed(2),
            ]);
          }
        }
      }

      const csvContent = [
        headers.join(","),
        ...rows.map((row: any[]) =>
          row.map((cell: any) => {
            const str = String(cell);
            return str.includes(",") || str.includes('"')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          }).join(",")
        ),
      ].join("\n");

      // Download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = `${locationName}${storeNum} - ${periodLabel}`.replace(/[^a-zA-Z0-9 _()-]/g, "");
      link.href = url;
      link.download = `${safeName}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Export downloaded!");
      setOpen(false);
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const totalItems = exportItems?.length || 0;
  const countedItems = exportItems?.filter((i: any) => i.quantity > 0).length || 0;
  const totalValue = exportItems?.reduce((sum: number, ci: any) => {
    const item: any = ci.item || {};
    const conversion = item.brand_item_id ? conversionMap.get(item.brand_item_id) : null;
    return sum + calculateCountItemValue(
      ci,
      {
        brand_item_id: item.brand_item_id,
        cost_per_unit: item.cost_per_unit,
        pack_quantity: item.pack_quantity,
        pack_quantity_override: item.pack_quantity_override,
        inner_pack_quantity: item.inner_pack_quantity,
        is_recipe: item.is_recipe === true,
        unit: item.unit,
        recipe_yield_qty: item.recipe_yield_qty,
        recipe_yield_unit: item.recipe_yield_unit,
      },
      conversion || null,
      false
    );
  }, 0) || 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Count</DialogTitle>
          <DialogDescription>
            Download this count as a CSV file.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-6 text-center text-muted-foreground text-sm animate-pulse">
            Loading count data...
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium">{location?.name || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">{periodLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items Counted</span>
                <span className="font-medium">{countedItems} / {totalItems}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Value</span>
                <span className="font-medium text-primary">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalValue)}
                </span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isLoading || exporting || !exportItems}>
            <Download className="h-4 w-4 mr-2" />
            {exporting ? "Exporting..." : "Download CSV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CountExportDialog;
