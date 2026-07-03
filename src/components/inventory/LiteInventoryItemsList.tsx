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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Package,
  Search,
  Upload,
  Loader2,
  MoreVertical,
  Archive,
  ArchiveRestore,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import LiteInvoiceUploadDialog from "./LiteInvoiceUploadDialog";
import LiteItemEditSheet, { type LiteEditableItem } from "./LiteItemEditSheet";

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
  category: string | null;
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

const UNASSIGNED_KEY = "__unassigned__";

export default function LiteInventoryItemsList({ locationId }: LiteInventoryItemsListProps) {
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editItem, setEditItem] = useState<LiteEditableItem | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();

  const invalidateItems = () =>
    qc.invalidateQueries({ queryKey: ["lite-inventory-items", locationId] });

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
        .select("id, name, item_number, vendor_name_normalized, unit, pack_size, cost_per_unit, match_status, is_active, storage_id, category, updated_at")
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

  const categorySuggestions = useMemo(() => {
    const set = new Set<string>();
    items?.forEach((i) => {
      const c = (i.category || "").trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Group by storage
  const grouped = useMemo(() => {
    const map = new Map<string, LiteItem[]>();
    for (const it of filtered) {
      const key = it.storage_id || UNASSIGNED_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    const orderedStorageIds = (storages || []).map((s) => s.id);
    const sections: { key: string; name: string; items: LiteItem[]; unassigned: boolean }[] = [];
    for (const sid of orderedStorageIds) {
      const list = map.get(sid);
      if (!list || list.length === 0) continue;
      sections.push({
        key: sid,
        name: storages!.find((s) => s.id === sid)!.name,
        items: list.sort((a, b) => a.name.localeCompare(b.name)),
        unassigned: false,
      });
    }
    const unassigned = map.get(UNASSIGNED_KEY);
    if (unassigned && unassigned.length) {
      sections.push({
        key: UNASSIGNED_KEY,
        name: "Unassigned",
        items: unassigned.sort((a, b) => a.name.localeCompare(b.name)),
        unassigned: true,
      });
    }
    return sections;
  }, [filtered, storages]);

  const formatCost = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toFixed(2)}`;

  const activeCount = items?.filter((i) => i.is_active).length ?? 0;

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Items ({activeCount})</h3>
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
            {grouped.map((section) => {
              const isOpen = !collapsed[section.key];
              return (
                <Collapsible
                  key={section.key}
                  open={isOpen}
                  onOpenChange={(open) =>
                    setCollapsed((prev) => ({ ...prev, [section.key]: !open }))
                  }
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className={`w-full flex items-center gap-2 px-4 py-2 bg-muted/40 hover:bg-muted/60 text-left ${
                        section.unassigned ? "opacity-70" : ""
                      }`}
                    >
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          isOpen ? "" : "-rotate-90"
                        }`}
                      />
                      <span className="text-xs font-semibold uppercase tracking-wide">
                        {section.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {section.items.length}
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="divide-y divide-border/50">
                      {section.items.map((item) => {
                        const lastInvoice = lastInvoiceMap?.get(item.id);
                        return (
                          <div
                            key={item.id}
                            className={`flex items-center gap-2 px-4 py-2.5 hover:bg-muted/30 cursor-pointer ${
                              !item.is_active ? "opacity-60" : ""
                            }`}
                            onClick={() =>
                              setEditItem({
                                id: item.id,
                                name: item.name,
                                category: item.category,
                                pack_size: item.pack_size,
                                storage_id: item.storage_id,
                                is_active: item.is_active,
                                unit: item.unit,
                                cost_per_unit: item.cost_per_unit,
                                vendor_name_normalized: item.vendor_name_normalized,
                                item_number: item.item_number,
                              })
                            }
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium truncate">
                                  {item.name}
                                </span>
                                {item.pack_size && (
                                  <span className="text-[11px] text-muted-foreground">
                                    {item.pack_size}
                                  </span>
                                )}
                                {item.category && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] h-4 px-1.5 font-normal text-muted-foreground"
                                  >
                                    {item.category}
                                  </Badge>
                                )}
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

                            <div className="text-right shrink-0">
                              <div className="text-sm font-semibold tabular-nums">
                                {formatCost(item.cost_per_unit)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                per {item.unit || "unit"}
                              </div>
                            </div>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-muted-foreground"
                                  aria-label="Row actions"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setEditItem({
                                      id: item.id,
                                      name: item.name,
                                      category: item.category,
                                      pack_size: item.pack_size,
                                      storage_id: item.storage_id,
                                      is_active: item.is_active,
                                      unit: item.unit,
                                      cost_per_unit: item.cost_per_unit,
                                      vendor_name_normalized: item.vendor_name_normalized,
                                      item_number: item.item_number,
                                    })
                                  }
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit item
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
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
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
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

      <LiteItemEditSheet
        open={!!editItem}
        onOpenChange={(o) => !o && setEditItem(null)}
        item={editItem}
        locationId={locationId}
        storages={storages || []}
        categorySuggestions={categorySuggestions}
      />
    </>
  );
}
