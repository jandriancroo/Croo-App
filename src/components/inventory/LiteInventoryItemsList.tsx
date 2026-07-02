import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Package, Search, Upload, Loader2 } from "lucide-react";
import LiteInvoiceUploadDialog from "./LiteInvoiceUploadDialog";

interface LiteInventoryItemsListProps {
  locationId: string;
}

interface LiteItem {
  id: string;
  name: string;
  item_number: string | null;
  vendor_name_normalized: string | null;
  unit: string | null;
  cost_per_unit: number | null;
  match_status: string | null;
  updated_at: string;
}

interface LastInvoiceLine {
  matched_item_id: string | null;
  candidate_item_id: string | null;
  invoice_id: string;
  invoice_date: string | null;
}

/**
 * Lite Items screen — mirrors the brand Items tab conceptually, but reads
 * `lite_inventory_items` (invoice-derived rows) instead of `inventory_items`.
 * Purely a viewer for now; edits happen via re-uploading a corrected invoice.
 */
export default function LiteInventoryItemsList({ locationId }: LiteInventoryItemsListProps) {
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: items, isLoading } = useQuery({
    queryKey: ["lite-inventory-items", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<LiteItem[]> => {
      const { data, error } = await supabase
        .from("lite_inventory_items" as any)
        .select("id, name, item_number, vendor_name_normalized, unit, cost_per_unit, match_status, updated_at")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data as any) || [];
    },
  });

  // Pull the most recent invoice date per item for the "Last invoice" column.
  const { data: lastInvoiceMap } = useQuery({
    queryKey: ["lite-last-invoice", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data: invoices } = await supabase
        .from("lite_vendor_invoices" as any)
        .select("id, invoice_date")
        .eq("location_id", locationId);
      const invById = new Map<string, string | null>();
      (invoices as any[] | null)?.forEach((i) => invById.set(i.id, i.invoice_date));

      const invoiceIds = Array.from(invById.keys());
      if (invoiceIds.length === 0) return new Map();

      const { data: lines } = await supabase
        .from("lite_vendor_invoice_items" as any)
        .select("matched_item_id, candidate_item_id, invoice_id")
        .in("invoice_id", invoiceIds);

      const byItem = new Map<string, string>();
      (lines as unknown as LastInvoiceLine[] | null)?.forEach((ln) => {
        const itemId = ln.matched_item_id || ln.candidate_item_id;
        if (!itemId) return;
        const d = invById.get(ln.invoice_id);
        if (!d) return;
        const existing = byItem.get(itemId);
        if (!existing || d > existing) byItem.set(itemId, d);
      });
      return byItem;
    },
  });

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.vendor_name_normalized || "").toLowerCase().includes(q) ||
        (i.item_number || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const formatCost = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toFixed(2)}`;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              Items ({items?.length ?? 0})
            </h3>
          </div>
          <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Invoice
          </Button>
        </div>

        <div className="p-3 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items, vendors, or item numbers…"
              className="pl-8"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (items?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
            <Package className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground max-w-sm">
              No items yet. Upload a vendor invoice and we'll pull items, prices,
              and pack sizes from it automatically.
            </p>
            <Button onClick={() => setUploadOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Upload Invoice
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No items match "{search}".
          </p>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map((item) => {
              const lastInvoice = lastInvoiceMap?.get(item.id);
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{item.name}</span>
                      {item.match_status === "new" && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                          new
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {item.vendor_name_normalized || "Unknown vendor"}
                      {item.item_number ? ` • #${item.item_number}` : ""}
                      {lastInvoice ? ` • last invoice ${lastInvoice}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">
                      {formatCost(item.cost_per_unit)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      per {item.unit || "unit"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <LiteInvoiceUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        locationId={locationId}
      />
    </>
  );
}
