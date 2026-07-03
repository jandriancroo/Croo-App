import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  GripVertical,
  ArrowUpDown,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  display_order: number | null;
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
const DEACTIVATED_KEY = "__deactivated__";

/** display_order (NULLS LAST) then name */
function shelfSort(a: LiteItem, b: LiteItem) {
  const ao = a.display_order;
  const bo = b.display_order;
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  if (ao != null && bo == null) return -1;
  if (ao == null && bo != null) return 1;
  return a.name.localeCompare(b.name);
}

export default function LiteInventoryItemsList({ locationId }: LiteInventoryItemsListProps) {
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editItem, setEditItem] = useState<LiteEditableItem | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ [DEACTIVATED_KEY]: true });
  const [reorderKey, setReorderKey] = useState<string | null>(null);
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
      toast.error(next ? "Couldn't activate item" : "Couldn't deactivate item", { description: error.message });
      return;
    }
    invalidateItems();
    toast.success(next ? `Activated "${item.name}"` : `Deactivated "${item.name}"`);
  };

  const { data: items, isLoading } = useQuery({
    queryKey: ["lite-inventory-items", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<LiteItem[]> => {
      const { data, error } = await supabase
        .from("lite_inventory_items" as any)
        .select(
          "id, name, item_number, vendor_name_normalized, unit, pack_size, cost_per_unit, match_status, is_active, storage_id, category, display_order, updated_at",
        )
        .eq("location_id", locationId)
        .order("name");
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

  // Active sections (per storage, sorted by display_order/name) + one flat Deactivated section
  const activeSections = useMemo(() => {
    const map = new Map<string, LiteItem[]>();
    for (const it of filtered) {
      if (!it.is_active) continue;
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
        items: list.sort(shelfSort),
        unassigned: false,
      });
    }
    const unassigned = map.get(UNASSIGNED_KEY);
    if (unassigned && unassigned.length) {
      sections.push({
        key: UNASSIGNED_KEY,
        name: "Unassigned",
        items: unassigned.sort(shelfSort),
        unassigned: true,
      });
    }
    return sections;
  }, [filtered, storages]);

  const deactivatedItems = useMemo(
    () => filtered.filter((i) => !i.is_active).sort((a, b) => a.name.localeCompare(b.name)),
    [filtered],
  );

  const persistOrder = async (ordered: LiteItem[]) => {
    // Assign 10, 20, 30… so intermediate inserts have room. Fire in parallel.
    const updates = ordered.map((it, idx) =>
      supabase
        .from("lite_inventory_items" as any)
        .update({ display_order: (idx + 1) * 10 })
        .eq("id", it.id),
    );
    const results = await Promise.all(updates);
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      toast.error("Couldn't save new order", { description: firstErr.message });
      invalidateItems();
      return;
    }
    invalidateItems();
  };

  const formatCost = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toFixed(2)}`;

  const activeCount = items?.filter((i) => i.is_active).length ?? 0;
  const deactivatedCount = deactivatedItems.length;

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
            {activeSections.map((section) => {
              const isOpen = !collapsed[section.key];
              const isReordering = reorderKey === section.key;
              return (
                <Collapsible
                  key={section.key}
                  open={isOpen}
                  onOpenChange={(open) =>
                    setCollapsed((prev) => ({ ...prev, [section.key]: !open }))
                  }
                >
                  <div
                    className={`w-full flex items-center gap-2 pl-4 pr-2 py-2 bg-muted/40 hover:bg-muted/60 ${
                      section.unassigned ? "opacity-70" : ""
                    }`}
                  >
                    <CollapsibleTrigger asChild>
                      <button type="button" className="flex items-center gap-2 flex-1 text-left">
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
                    {isOpen && section.items.length > 1 && (
                      <Button
                        variant={isReordering ? "default" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-[11px] gap-1"
                        onClick={() =>
                          setReorderKey((prev) => (prev === section.key ? null : section.key))
                        }
                      >
                        {isReordering ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Done
                          </>
                        ) : (
                          <>
                            <ArrowUpDown className="h-3.5 w-3.5" />
                            Reorder
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  <CollapsibleContent>
                    {isReordering ? (
                      <SortableItemList
                        items={section.items}
                        onReorder={(next) => persistOrder(next)}
                      />
                    ) : (
                      <div className="divide-y divide-border/50">
                        {section.items.map((item) => (
                          <ItemRow
                            key={item.id}
                            item={item}
                            lastInvoice={lastInvoiceMap?.get(item.id)}
                            onEdit={() => setEditItem(toEditable(item))}
                            onToggleActive={() => toggleActive(item)}
                            formatCost={formatCost}
                          />
                        ))}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

            {deactivatedCount > 0 && (
              <Collapsible
                open={!collapsed[DEACTIVATED_KEY]}
                onOpenChange={(open) =>
                  setCollapsed((prev) => ({ ...prev, [DEACTIVATED_KEY]: !open }))
                }
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-4 py-2 bg-muted/40 hover:bg-muted/60 text-left"
                  >
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        !collapsed[DEACTIVATED_KEY] ? "" : "-rotate-90"
                      }`}
                    />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Deactivated
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {deactivatedCount}
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y divide-border/50">
                    {deactivatedItems.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        lastInvoice={lastInvoiceMap?.get(item.id)}
                        onEdit={() => setEditItem(toEditable(item))}
                        onToggleActive={() => toggleActive(item)}
                        formatCost={formatCost}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
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

function toEditable(item: LiteItem): LiteEditableItem {
  return {
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
  };
}

function ItemRow({
  item,
  lastInvoice,
  onEdit,
  onToggleActive,
  formatCost,
}: {
  item: LiteItem;
  lastInvoice: string | undefined;
  onEdit: () => void;
  onToggleActive: () => void;
  formatCost: (n: number | null) => string;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-4 py-2.5 hover:bg-muted/30 cursor-pointer ${
        !item.is_active ? "opacity-60" : ""
      }`}
      onClick={onEdit}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{item.name}</span>
          {item.pack_size && (
            <span className="text-[11px] text-muted-foreground">{item.pack_size}</span>
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
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {item.vendor_name_normalized || "Unknown vendor"}
          {item.item_number ? ` • #${item.item_number}` : ""}
          {lastInvoice ? ` • last invoice ${lastInvoice}` : ""}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-sm font-semibold tabular-nums">{formatCost(item.cost_per_unit)}</div>
        <div className="text-[10px] text-muted-foreground">per {item.unit || "unit"}</div>
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
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit item
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {item.is_active ? (
            <DropdownMenuItem onClick={onToggleActive}>
              <Archive className="h-4 w-4 mr-2" />
              Deactivate item
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onToggleActive}>
              <ArchiveRestore className="h-4 w-4 mr-2" />
              Activate item
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Sortable list active only when a section is in Reorder mode. */
function SortableItemList({
  items,
  onReorder,
}: {
  items: LiteItem[];
  onReorder: (ordered: LiteItem[]) => void;
}) {
  const [local, setLocal] = useState(items);
  // Keep local in sync when the incoming list changes (e.g., after save/invalidate).
  useMemoSync(local, items, setLocal);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = local.findIndex((i) => i.id === active.id);
    const newIdx = local.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(local, oldIdx, newIdx);
    setLocal(next);
    onReorder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={local.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="divide-y divide-border/50">
          {local.map((item) => (
            <SortableRow key={item.id} item={item} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function useMemoSync<T>(current: T, incoming: T, setter: (v: T) => void) {
  useMemo(() => {
    setter(incoming);
    // Intentionally only re-sync when the incoming reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);
}

function SortableRow({ item }: { item: LiteItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-2.5 bg-background"
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="h-8 w-8 flex items-center justify-center text-muted-foreground touch-none cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {item.pack_size ? `${item.pack_size} • ` : ""}
          {item.vendor_name_normalized || "Unknown vendor"}
        </div>
      </div>
    </div>
  );
}
