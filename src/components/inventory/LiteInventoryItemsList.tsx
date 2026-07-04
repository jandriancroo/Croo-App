import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Package,
  Search,
  Upload,
  Loader2,
  ChevronDown,
  ChevronUp,
  ListOrdered,
  MoveRight,
  X,
  Power,
  PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import { arrayMove } from "@dnd-kit/sortable";
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    [DEACTIVATED_KEY]: true,
  });

  // Selection state — mirrors InventoryItemsManager.tsx
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [activeSelectGroup, setActiveSelectGroup] = useState<string | null>(null);
  const [selectionContext, setSelectionContext] = useState<"active" | "deactivated" | null>(
    null,
  );

  // Reorder state
  const [reorderModeGroup, setReorderModeGroup] = useState<string | null>(null);
  const [isBulkDragMode, setIsBulkDragMode] = useState(false);
  const [bulkDragGroupKey, setBulkDragGroupKey] = useState<string | null>(null);
  const [bulkDragItemIds, setBulkDragItemIds] = useState<string[]>([]);
  const [optimisticOrder, setOptimisticOrder] = useState<Record<string, string[]>>({});

  // Move dialog
  const [showBulkMoveDialog, setShowBulkMoveDialog] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState<string | null>(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  const qc = useQueryClient();

  const invalidateItems = () =>
    qc.invalidateQueries({ queryKey: ["lite-inventory-items", locationId] });

  const clearSelection = () => {
    setSelectedItemIds(new Set());
    setActiveSelectGroup(null);
    setSelectionContext(null);
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

  // Apply optimistic reorder overrides to a group's sorted items
  const applyOptimistic = useCallback(
    (key: string, groupItems: LiteItem[]): LiteItem[] => {
      const order = optimisticOrder[key];
      if (!order) return groupItems;
      const byId = new Map(groupItems.map((i) => [i.id, i]));
      const ordered: LiteItem[] = [];
      for (const id of order) {
        const it = byId.get(id);
        if (it) {
          ordered.push(it);
          byId.delete(id);
        }
      }
      // Any items not in optimistic order fall to the end
      byId.forEach((it) => ordered.push(it));
      return ordered;
    },
    [optimisticOrder],
  );

  const activeSections = useMemo(() => {
    const map = new Map<string, LiteItem[]>();
    for (const it of filtered) {
      if (!it.is_active) continue;
      const key = it.storage_id || UNASSIGNED_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    const orderedStorageIds = (storages || []).map((s) => s.id);
    const sections: {
      key: string;
      name: string;
      items: LiteItem[];
      unassigned: boolean;
    }[] = [];
    for (const sid of orderedStorageIds) {
      const list = map.get(sid);
      if (!list || list.length === 0) continue;
      sections.push({
        key: sid,
        name: storages!.find((s) => s.id === sid)!.name,
        items: applyOptimistic(sid, list.sort(shelfSort)),
        unassigned: false,
      });
    }
    const unassigned = map.get(UNASSIGNED_KEY);
    if (unassigned && unassigned.length) {
      sections.push({
        key: UNASSIGNED_KEY,
        name: "Unassigned",
        items: applyOptimistic(UNASSIGNED_KEY, unassigned.sort(shelfSort)),
        unassigned: true,
      });
    }
    return sections;
  }, [filtered, storages, applyOptimistic]);

  const deactivatedItems = useMemo(
    () =>
      filtered
        .filter((i) => !i.is_active)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filtered],
  );

  // Debounced reorder save (600ms), matches Brand pattern
  const reorderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReorderRef = useRef<{ id: string; display_order: number }[] | null>(null);

  const reorderMutation = useMutation({
    mutationFn: async (updates: { id: string; display_order: number }[]) => {
      const results = await Promise.all(
        updates.map((u) =>
          supabase
            .from("lite_inventory_items" as any)
            .update({ display_order: u.display_order })
            .eq("id", u.id),
        ),
      );
      const err = results.find((r) => r.error)?.error;
      if (err) throw err;
    },
    onSuccess: () => invalidateItems(),
    onError: (e: any) => {
      toast.error("Couldn't save new order", { description: e.message });
      invalidateItems();
    },
  });

  const flushReorder = useCallback(() => {
    if (reorderSaveTimerRef.current) {
      clearTimeout(reorderSaveTimerRef.current);
      reorderSaveTimerRef.current = null;
    }
    if (pendingReorderRef.current) {
      reorderMutation.mutate(pendingReorderRef.current);
      pendingReorderRef.current = null;
    }
  }, [reorderMutation]);

  const scheduleReorderSave = useCallback(
    (updates: { id: string; display_order: number }[]) => {
      pendingReorderRef.current = updates;
      if (reorderSaveTimerRef.current) clearTimeout(reorderSaveTimerRef.current);
      reorderSaveTimerRef.current = setTimeout(() => {
        if (pendingReorderRef.current) {
          reorderMutation.mutate(pendingReorderRef.current);
          pendingReorderRef.current = null;
        }
        reorderSaveTimerRef.current = null;
      }, 600);
    },
    [reorderMutation],
  );

  const buildOrderPayload = (ordered: LiteItem[]) =>
    ordered.map((it, idx) => ({ id: it.id, display_order: (idx + 1) * 10 }));

  // Per-row arrow move within a group
  const handleArrowMove = useCallback(
    (direction: "up" | "down", groupKey: string, groupItems: LiteItem[], itemId: string) => {
      const idx = groupItems.findIndex((i) => i.id === itemId);
      if (idx === -1) return;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= groupItems.length) return;
      const reordered = arrayMove(groupItems, idx, targetIdx);
      setOptimisticOrder((prev) => ({ ...prev, [groupKey]: reordered.map((i) => i.id) }));
      scheduleReorderSave(buildOrderPayload(reordered));
    },
    [scheduleReorderSave],
  );

  // Bulk block arrow move
  const handleBulkArrowMove = useCallback(
    (direction: "up" | "down", groupKey: string, groupItems: LiteItem[]) => {
      if (bulkDragItemIds.length === 0) return;
      const bulkSet = new Set(bulkDragItemIds);
      const nonGroupItems = groupItems.filter((i) => !bulkSet.has(i.id));
      const draggedItems = groupItems.filter((i) => bulkSet.has(i.id));

      const groupStartIdx = groupItems.findIndex((i) => bulkSet.has(i.id));
      let insertIdx = nonGroupItems.findIndex((i) => {
        const origIdx = groupItems.indexOf(i);
        return origIdx > groupStartIdx;
      });
      if (insertIdx === -1) insertIdx = nonGroupItems.length;

      if (direction === "up") {
        if (insertIdx <= 0 && groupStartIdx === 0) return;
        insertIdx = Math.max(0, insertIdx - 1);
      } else {
        if (insertIdx >= nonGroupItems.length) return;
        insertIdx = insertIdx + 1;
      }
      const reordered = [
        ...nonGroupItems.slice(0, insertIdx),
        ...draggedItems,
        ...nonGroupItems.slice(insertIdx),
      ];
      setOptimisticOrder((prev) => ({ ...prev, [groupKey]: reordered.map((i) => i.id) }));
      scheduleReorderSave(buildOrderPayload(reordered));
    },
    [bulkDragItemIds, scheduleReorderSave],
  );

  const formatCost = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toFixed(2)}`;

  const activeCount = items?.filter((i) => i.is_active).length ?? 0;
  const deactivatedCount = deactivatedItems.length;

  // Compute which section (if any) is in bulk-drag mode and its live items
  const bulkDragSection = isBulkDragMode
    ? activeSections.find((s) => s.key === bulkDragGroupKey)
    : null;

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
          <p className="text-[11px] text-muted-foreground mt-2">
            Long-press (or right-click) a row to select. Then use the bar to move,
            reorder, or deactivate.
          </p>
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
              const isReorderThisGroup = reorderModeGroup === section.key;
              const isBulkDragThisGroup =
                isBulkDragMode && bulkDragGroupKey === section.key;
              const isSelectingThisGroup =
                selectionContext === "active" && activeSelectGroup === section.key;
              const showReorderBtn =
                isOpen &&
                section.items.length > 1 &&
                !isBulkDragMode &&
                !activeSelectGroup;

              // Build render list: in bulk-drag, replace consecutive selected items with a group row
              const bulkSet = new Set(bulkDragItemIds);
              type Row =
                | { type: "item"; item: LiteItem }
                | { type: "group"; items: LiteItem[] };
              const rows: Row[] = [];
              if (isBulkDragThisGroup) {
                let inserted = false;
                for (const item of section.items) {
                  if (bulkSet.has(item.id)) {
                    if (!inserted) {
                      rows.push({
                        type: "group",
                        items: section.items.filter((i) => bulkSet.has(i.id)),
                      });
                      inserted = true;
                    }
                  } else {
                    rows.push({ type: "item", item });
                  }
                }
              } else {
                for (const item of section.items) rows.push({ type: "item", item });
              }
              const groupIdx = rows.findIndex((r) => r.type === "group");
              const isBulkFirst = groupIdx === 0;
              const isBulkLast = groupIdx === rows.length - 1;

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
                      <button
                        type="button"
                        className="flex items-center gap-2 flex-1 text-left"
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
                    {showReorderBtn && (
                      <Button
                        variant={isReorderThisGroup ? "default" : "ghost"}
                        size="sm"
                        className="h-7 px-2 text-[11px] gap-1"
                        onClick={() => {
                          if (isReorderThisGroup) {
                            flushReorder();
                            setOptimisticOrder((prev) => {
                              const next = { ...prev };
                              delete next[section.key];
                              return next;
                            });
                            setReorderModeGroup(null);
                          } else {
                            setReorderModeGroup(section.key);
                          }
                        }}
                      >
                        <ListOrdered className="h-3.5 w-3.5" />
                        {isReorderThisGroup ? "Done" : "Reorder"}
                      </Button>
                    )}
                  </div>
                  <CollapsibleContent>
                    <div className="divide-y divide-border/50">
                      {rows.map((r, idx) => {
                        if (r.type === "group") {
                          return (
                            <BulkGroupRow
                              key="__bulk_group__"
                              items={r.items}
                              isFirst={isBulkFirst}
                              isLast={isBulkLast}
                              onMoveUp={() =>
                                handleBulkArrowMove("up", section.key, section.items)
                              }
                              onMoveDown={() =>
                                handleBulkArrowMove("down", section.key, section.items)
                              }
                            />
                          );
                        }
                        const item = r.item;
                        return (
                          <ItemRow
                            key={item.id}
                            item={item}
                            lastInvoice={lastInvoiceMap?.get(item.id)}
                            isSelected={selectedItemIds.has(item.id)}
                            isSelectingThisGroup={
                              isSelectingThisGroup && !isBulkDragThisGroup
                            }
                            isReorderMode={isReorderThisGroup || isBulkDragThisGroup}
                            isFirst={idx === 0}
                            isLast={idx === rows.length - 1}
                            onMoveUp={
                              isReorderThisGroup
                                ? () =>
                                    handleArrowMove(
                                      "up",
                                      section.key,
                                      section.items,
                                      item.id,
                                    )
                                : undefined
                            }
                            onMoveDown={
                              isReorderThisGroup
                                ? () =>
                                    handleArrowMove(
                                      "down",
                                      section.key,
                                      section.items,
                                      item.id,
                                    )
                                : undefined
                            }
                            onClick={() => {
                              if (isBulkDragThisGroup || isReorderThisGroup) return;
                              if (isSelectingThisGroup) {
                                const next = new Set(selectedItemIds);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                setSelectedItemIds(next);
                                if (next.size === 0) clearSelection();
                              } else {
                                setEditItem(toEditable(item));
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (isBulkDragMode || reorderModeGroup) return;
                              setSelectionContext("active");
                              setActiveSelectGroup(section.key);
                              setSelectedItemIds(new Set([item.id]));
                            }}
                            formatCost={formatCost}
                          />
                        );
                      })}
                    </div>
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
                        isSelected={selectedItemIds.has(item.id)}
                        isSelectingThisGroup={selectionContext === "deactivated"}
                        isReorderMode={false}
                        isFirst={false}
                        isLast={false}
                        onClick={() => {
                          if (selectionContext === "deactivated") {
                            const next = new Set(selectedItemIds);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            setSelectedItemIds(next);
                            if (next.size === 0) setSelectionContext(null);
                          } else {
                            setEditItem(toEditable(item));
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (isBulkDragMode || reorderModeGroup) return;
                          if (selectionContext === "active") setActiveSelectGroup(null);
                          setSelectionContext("deactivated");
                          setSelectedItemIds(new Set([item.id]));
                        }}
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

      {/* Bulk Move dialog */}
      <Dialog open={showBulkMoveDialog} onOpenChange={setShowBulkMoveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              Move {selectedItemIds.size} item{selectedItemIds.size !== 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {(storages || []).map((s) => (
              <button
                key={s.id}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  bulkMoveTarget === s.id
                    ? "bg-primary/10 ring-1 ring-primary/30 font-medium"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => setBulkMoveTarget(s.id)}
              >
                {s.name}
              </button>
            ))}
            <button
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors italic ${
                bulkMoveTarget === UNASSIGNED_KEY
                  ? "bg-primary/10 ring-1 ring-primary/30 font-medium"
                  : "hover:bg-muted/50"
              }`}
              onClick={() => setBulkMoveTarget(UNASSIGNED_KEY)}
            >
              Unassigned
            </button>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBulkMoveDialog(false)}
              disabled={isBulkUpdating}
            >
              Cancel
            </Button>
            <Button
              disabled={!bulkMoveTarget || isBulkUpdating}
              onClick={async () => {
                if (!bulkMoveTarget) return;
                setIsBulkUpdating(true);
                try {
                  const ids = Array.from(selectedItemIds);
                  const newStorageId =
                    bulkMoveTarget === UNASSIGNED_KEY ? null : bulkMoveTarget;
                  const { error } = await supabase
                    .from("lite_inventory_items" as any)
                    .update({ storage_id: newStorageId })
                    .in("id", ids);
                  if (error) throw error;
                  const label =
                    bulkMoveTarget === UNASSIGNED_KEY
                      ? "Unassigned"
                      : storages?.find((s) => s.id === bulkMoveTarget)?.name || "storage";
                  toast.success(`Moved ${ids.length} item${ids.length !== 1 ? "s" : ""} to ${label}`);
                  invalidateItems();
                  qc.invalidateQueries({
                    queryKey: ["lite-storage-item-counts", locationId],
                  });
                  clearSelection();
                  setShowBulkMoveDialog(false);
                  setBulkMoveTarget(null);
                } catch (e: any) {
                  toast.error("Move failed", { description: e.message });
                } finally {
                  setIsBulkUpdating(false);
                }
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Bulk Action Bar — active items */}
      {selectionContext === "active" &&
        activeSelectGroup &&
        selectedItemIds.size > 0 &&
        !isBulkDragMode && (
          <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-4 fade-in">
            <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg overflow-x-auto">
              <Badge
                variant="secondary"
                className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary shrink-0"
              >
                {selectedItemIds.size} selected
              </Badge>

              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
                onClick={() => {
                  const groupKey = activeSelectGroup;
                  if (!groupKey || selectedItemIds.size === 0) return;
                  const section = activeSections.find((s) => s.key === groupKey);
                  if (!section) return;
                  const groupItems = section.items;
                  const selectedArr = Array.from(selectedItemIds);
                  const indices = selectedArr
                    .map((id) => groupItems.findIndex((i) => i.id === id))
                    .filter((i) => i !== -1)
                    .sort((a, b) => a - b);
                  if (indices.length === 0) return;
                  const isConsecutive = indices.every(
                    (val, i) => i === 0 || val === indices[i - 1] + 1,
                  );
                  if (!isConsecutive) {
                    toast.error("Select consecutive items to reorder as a group");
                    return;
                  }
                  const orderedIds = indices.map((idx) => groupItems[idx].id);
                  setBulkDragItemIds(orderedIds);
                  setBulkDragGroupKey(groupKey);
                  setIsBulkDragMode(true);
                }}
              >
                <ListOrdered className="h-3.5 w-3.5" />
                Reorder
              </button>

              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
                onClick={() => {
                  setBulkMoveTarget(null);
                  setShowBulkMoveDialog(true);
                }}
              >
                <MoveRight className="h-3.5 w-3.5" />
                Move
              </button>

              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
                onClick={async () => {
                  setIsBulkUpdating(true);
                  try {
                    const ids = Array.from(selectedItemIds);
                    const { error } = await supabase
                      .from("lite_inventory_items" as any)
                      .update({ is_active: false })
                      .in("id", ids);
                    if (error) throw error;
                    toast.success(`Deactivated ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
                    invalidateItems();
                    qc.invalidateQueries({
                      queryKey: ["lite-storage-item-counts", locationId],
                    });
                    clearSelection();
                  } catch (e: any) {
                    toast.error("Couldn't deactivate", { description: e.message });
                  } finally {
                    setIsBulkUpdating(false);
                  }
                }}
              >
                <PowerOff className="h-3.5 w-3.5" />
                Deactivate
              </button>

              <button
                className="p-1.5 rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors shrink-0"
                onClick={clearSelection}
                aria-label="Clear selection"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

      {/* Floating Bulk Action Bar — deactivated items */}
      {selectionContext === "deactivated" && selectedItemIds.size > 0 && (
        <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg overflow-x-auto">
            <Badge
              variant="secondary"
              className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary shrink-0"
            >
              {selectedItemIds.size} selected
            </Badge>

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
              onClick={async () => {
                setIsBulkUpdating(true);
                try {
                  const ids = Array.from(selectedItemIds);
                  const { error } = await supabase
                    .from("lite_inventory_items" as any)
                    .update({ is_active: true })
                    .in("id", ids);
                  if (error) throw error;
                  toast.success(`Activated ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
                  invalidateItems();
                  qc.invalidateQueries({
                    queryKey: ["lite-storage-item-counts", locationId],
                  });
                  clearSelection();
                } catch (e: any) {
                  toast.error("Couldn't activate", { description: e.message });
                } finally {
                  setIsBulkUpdating(false);
                }
              }}
            >
              <Power className="h-3.5 w-3.5" />
              Activate
            </button>

            <button
              className="p-1.5 rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors shrink-0"
              onClick={clearSelection}
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk drag mode banner */}
      {isBulkDragMode && bulkDragSection && (
        <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)]">
          <div className="bg-primary text-primary-foreground rounded-lg shadow-lg px-4 sm:px-6 py-3 flex items-center gap-3 border-2 border-primary-foreground/20">
            <span className="font-semibold text-sm">
              Use arrows to move {bulkDragItemIds.length} items
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                flushReorder();
                setOptimisticOrder({});
                setIsBulkDragMode(false);
                setBulkDragGroupKey(null);
                setBulkDragItemIds([]);
                clearSelection();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
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
  isSelected,
  isSelectingThisGroup,
  isReorderMode,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onClick,
  onContextMenu,
  formatCost,
}: {
  item: LiteItem;
  lastInvoice: string | undefined;
  isSelected: boolean;
  isSelectingThisGroup: boolean;
  isReorderMode: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  formatCost: (n: number | null) => string;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary/10 ring-1 ring-primary/30"
          : !item.is_active
            ? "opacity-60 hover:bg-muted/30"
            : "hover:bg-muted/30"
      }`}
      onClick={onClick}
      onContextMenu={isReorderMode ? undefined : onContextMenu}
    >
      {isReorderMode && onMoveUp && onMoveDown && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            className={`p-0.5 rounded hover:bg-primary/20 transition-colors ${
              isFirst ? "opacity-30 pointer-events-none" : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp();
            }}
            disabled={isFirst}
            aria-label="Move up"
          >
            <ChevronUp className="h-4 w-4 text-primary" />
          </button>
          <button
            className={`p-0.5 rounded hover:bg-primary/20 transition-colors ${
              isLast ? "opacity-30 pointer-events-none" : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            disabled={isLast}
            aria-label="Move down"
          >
            <ChevronDown className="h-4 w-4 text-primary" />
          </button>
        </div>
      )}

      {!isReorderMode && isSelectingThisGroup && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => {}}
          className="h-3.5 w-3.5 flex-shrink-0 pointer-events-none"
        />
      )}

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
        <div className="text-sm font-semibold tabular-nums">
          {formatCost(item.cost_per_unit)}
        </div>
        <div className="text-[10px] text-muted-foreground">per {item.unit || "unit"}</div>
      </div>
    </div>
  );
}

function BulkGroupRow({
  items,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  items: LiteItem[];
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 text-sm bg-primary/10 ring-2 ring-primary border border-primary/30">
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          className={`p-0.5 rounded hover:bg-primary/20 transition-colors ${
            isFirst ? "opacity-30 pointer-events-none" : ""
          }`}
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label="Move block up"
        >
          <ChevronUp className="h-4 w-4 text-primary" />
        </button>
        <button
          className={`p-0.5 rounded hover:bg-primary/20 transition-colors ${
            isLast ? "opacity-30 pointer-events-none" : ""
          }`}
          onClick={onMoveDown}
          disabled={isLast}
          aria-label="Move block down"
        >
          <ChevronDown className="h-4 w-4 text-primary" />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge className="bg-primary text-primary-foreground text-xs px-2">
            {items.length} items
          </Badge>
          <span className="text-xs text-muted-foreground truncate">
            {items
              .slice(0, 3)
              .map((i) => i.name)
              .join(", ")}
            {items.length > 3 ? ` +${items.length - 3} more` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
