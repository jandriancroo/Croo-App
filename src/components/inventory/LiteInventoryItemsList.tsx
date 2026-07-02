import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, Search, Upload, Loader2, MoreVertical, Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import LiteInvoiceUploadDialog from "./LiteInvoiceUploadDialog";
import PackSizeInlineEdit from "./PackSizeInlineEdit";

interface LiteInventoryItemsListProps {
  locationId: string;
}

interface LiteItem {
  id: string;
  name: string;
  item_number: string | null;
  vendor_name_normalized: string | null;
  unit: string | null;
  pack_size: string | null;
  cost_per_unit: number | null;
  match_status: string | null;
  is_active: boolean;
  storage_id: string | null;
  updated_at: string;
}

interface Storage {
  id: string;
  name: string;
}

interface LastInvoiceLine {
  matched_item_id: string | null;
  candidate_item_id: string | null;
  invoice_id: string;
  invoice_date: string | null;
}

const UNASSIGNED = "__unassigned__";

/**
 * Lite Items screen — items derived from vendor invoices. Editable inline for
 * pack_size and storage; archive/restore via row menu. Snapshot rule: edits
 * here update the current item only; historical invoice line items are never
 * rewritten.
 */
export default function LiteInventoryItemsList({ locationId }: LiteInventoryItemsListProps) {
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const qc = useQueryClient();

  const invalidateItems = () =>
    qc.invalidateQueries({ queryKey: ["lite-inventory-items", locationId] });

  const savePackSize = async (itemId: string, next: string | null) => {
    const { error } = await supabase
      .from("lite_inventory_items" as any)
      .update({ pack_size: next })
      .eq("id", itemId);
    if (error) {
      toast.error("Couldn't save pack size", { description: error.message });
      throw error;
    }
    qc.setQueryData<LiteItem[]>(
      ["lite-inventory-items", locationId, includeArchived],
      (prev) => prev?.map((i) => (i.id === itemId ? { ...i, pack_size: next } : i)) || prev,
    );
    toast.success(next ? "Pack size updated" : "Pack size cleared");
  };

  const saveStorage = async (itemId: string, next: string | null) => {
    const { error } = await supabase
      .from("lite_inventory_items" as any)
      .update({ storage_id: next })
      .eq("id", itemId);
    if (error) {
      toast.error("Couldn't move item", { description: error.message });
      return;
    }
    qc.setQueryData<LiteItem[]>(
      ["lite-inventory-items", locationId, includeArchived],
      (prev) => prev?.map((i) => (i.id === itemId ? { ...i, storage_id: next } : i)) || prev,
    );
  };

  const toggleActive = async (item: LiteItem) => {
    const next = !item.is_active;
    const { error } = await supabase
      .from("lite_inventory_items" as any)
      .update({ is_active: next })
      .eq("id", item.id);
    if (error) {
      toast.error(next ? "Couldn't restore item" : "Couldn't archive item", { description: error.message });
      return;
    }
    invalidateItems();
    toast.success(next ? `Restored "${item.name}"` : `Archived "${item.name}"`);
  };

  const { data: items, isLoading } = useQuery({
    queryKey: ["lite-inventory-items", locationId, includeArchived],
    enabled: !!locationId,
    queryFn: async (): Promise<LiteItem[]> => {
      let q = supabase
        .from("lite_inventory_items" as any)
        .select("id, name, item_number, vendor_name_normalized, unit, pack_size, cost_per_unit, match_status, is_active, storage_id, updated_at")
        .eq("location_id", locationId);
      if (!includeArchived) q = q.eq("is_active", true);
      const { data, error } = await q.order("name");
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: storages } = useQuery({
    queryKey: ["lite-storages", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<Storage[]> => {
      const { data, error } = await supabase
        .from("lite_storage_locations" as any)
        .select("id, name")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data as any) || [];
    },
  });

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
        (i.item_number || "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const formatCost = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toFixed(2)}`;

  const activeCount = items?.filter((i) => i.is_active).length ?? 0;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              Items ({activeCount})
            </h3>
          </div>
          <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Invoice
          </Button>
        </div>

        <div className="p-3 border-b border-border/50 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items, vendors, or item numbers…"
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="include-archived"
              checked={includeArchived}
              onCheckedChange={setIncludeArchived}
            />
            <Label htmlFor="include-archived" className="text-xs text-muted-foreground cursor-pointer">
              Show archived
            </Label>
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
              const storageName =
                storages?.find((s) => s.id === item.storage_id)?.name || "Unassigned";
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 ${
                    !item.is_active ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{item.name}</span>
                      <PackSizeInlineEdit
                        value={item.pack_size}
                        onSave={(next) => savePackSize(item.id, next)}
                      />
                      {item.match_status === "new" && item.is_active && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                          new
                        </Badge>
                      )}
                      {!item.is_active && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                          archived
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {item.vendor_name_normalized || "Unknown vendor"}
                      {item.item_number ? ` • #${item.item_number}` : ""}
                      {lastInvoice ? ` • last invoice ${lastInvoice}` : ""}
                    </div>
                  </div>

                  <Select
                    value={item.storage_id || UNASSIGNED}
                    onValueChange={(v) => saveStorage(item.id, v === UNASSIGNED ? null : v)}
                  >
                    <SelectTrigger className="h-7 w-32 text-[11px] shrink-0">
                      <SelectValue placeholder="Storage">{storageName}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {(storages || []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">
                      {formatCost(item.cost_per_unit)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      per {item.unit || "unit"}
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground"
                        aria-label="Row actions"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {item.is_active ? (
                        <DropdownMenuItem onClick={() => toggleActive(item)}>
                          <Archive className="h-4 w-4 mr-2" />
                          Archive item
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => toggleActive(item)}>
                          <ArchiveRestore className="h-4 w-4 mr-2" />
                          Restore item
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled className="text-[11px] text-muted-foreground">
                        Archived items are hidden from counts
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
