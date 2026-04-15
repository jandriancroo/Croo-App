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

interface CountExportDialogProps {
  countId: string;
  locationId: string;
  periodLabel: string;
}

const CountExportDialog = ({ countId, locationId, periodLabel }: CountExportDialogProps) => {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

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
          quantity,
          entered_cases,
          entered_units,
          item:inventory_items(
            name,
            unit,
            cost_per_unit,
            pack_quantity,
            pack_quantity_override,
            count_units_per_case,
            pack_size,
            item_number,
            category,
            storage_location:inventory_locations(name)
          )
        `)
        .eq("count_id", countId);

      if (error) throw error;
      return data;
    },
    enabled: open,
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
        "Cases",
        "Units",
        "Total Qty",
        "Cost Per Case",
        "Unit Value",
      ];

      const rows = exportItems.map((ci: any) => {
        const item = ci.item;
        const packQty = item?.pack_quantity_override ?? item?.count_units_per_case ?? item?.pack_quantity ?? 1;
        const costPerUnit = item?.cost_per_unit || 0;
        const unitValue = ci.quantity * (costPerUnit / Math.max(packQty, 1));

        const cases = ci.entered_cases ?? "";
        const units = ci.entered_units ?? "";

        return [
          item?.storage_location?.name || "",
          item?.name || "",
          item?.item_number || "",
          item?.pack_size || "",
          item?.category || "",
          item?.unit || "",
          cases,
          units,
          ci.quantity,
          costPerUnit.toFixed(2),
          unitValue.toFixed(2),
        ];
      });

      // Sort by storage location then item name
      rows.sort((a: any[], b: any[]) => {
        const locCmp = (a[0] as string).localeCompare(b[0] as string);
        if (locCmp !== 0) return locCmp;
        return (a[1] as string).localeCompare(b[1] as string);
      });

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
    const item = ci.item;
    const packQty = item?.pack_quantity_override ?? item?.count_units_per_case ?? item?.pack_quantity ?? 1;
    const costPerUnit = item?.cost_per_unit || 0;
    return sum + ci.quantity * (costPerUnit / Math.max(packQty, 1));
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
