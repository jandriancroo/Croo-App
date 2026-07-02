import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Package, DollarSign } from "lucide-react";
import { toast } from "sonner";

interface Props {
  countId: string;
  locationId: string;
  readOnly?: boolean;
}

interface Item {
  id: string;
  name: string;
  unit: string | null;
  pack_size: string | null;
  cost_per_unit: number | null;
  storage_id: string | null;
}

interface Storage {
  id: string;
  name: string;
  sort_order: number;
}

interface CountRow {
  id: string;
  item_id: string;
  quantity: number;
  unit_value_at_count: number;
  storage_id_at_count: string | null;
}

/**
 * Lite counting session. One row per active item, grouped by storage area
 * ("Unassigned" bucket last). Quantity edits upsert into
 * lite_inventory_count_items with cost + storage snapshotted at write time —
 * never overwritten on later edits.
 */
export default function LiteCountSession({ countId, locationId, readOnly = false }: Props) {
  const qc = useQueryClient();

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["lite-inventory-items", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await supabase
        .from("lite_inventory_items" as any)
        .select("id, name, unit, pack_size, cost_per_unit, storage_id")
        .eq("location_id", locationId)
        .eq("is_active", true)
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
        .select("id, name, sort_order")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["lite-count-rows", countId],
    enabled: !!countId,
    queryFn: async (): Promise<CountRow[]> => {
      const { data, error } = await supabase
        .from("lite_inventory_count_items" as any)
        .select("id, item_id, quantity, unit_value_at_count, storage_id_at_count")
        .eq("count_id", countId);
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const rowByItem = useMemo(() => {
    const m = new Map<string, CountRow>();
    (rows || []).forEach((r) => m.set(r.item_id, r));
    return m;
  }, [rows]);

  const grouped = useMemo(() => {
    if (!items) return [];
    const byStorage = new Map<string | null, Item[]>();
    for (const it of items) {
      const key = it.storage_id ?? null;
      const arr = byStorage.get(key) || [];
      arr.push(it);
      byStorage.set(key, arr);
    }
    const storageOrder = (storages || []).map((s) => s.id);
    const nameFor = (id: string | null) =>
      id === null ? "Unassigned" : storages?.find((s) => s.id === id)?.name || "Unknown";
    return Array.from(byStorage.entries())
      .sort(([a], [b]) => {
        if (a === null) return 1;
        if (b === null) return -1;
        return storageOrder.indexOf(a) - storageOrder.indexOf(b);
      })
      .map(([storageId, list]) => ({
        storageId,
        name: nameFor(storageId),
        items: list,
      }));
  }, [items, storages]);

  const upsert = useMutation({
    mutationFn: async ({ item, quantity }: { item: Item; quantity: number }) => {
      const existing = rowByItem.get(item.id);
      if (existing) {
        // Snapshot fields stay put — only quantity changes.
        const { error } = await supabase
          .from("lite_inventory_count_items" as any)
          .update({ quantity, counted_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
        return { ...existing, quantity };
      }
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("lite_inventory_count_items" as any)
        .insert({
          count_id: countId,
          item_id: item.id,
          quantity,
          unit_value_at_count: item.cost_per_unit ?? 0,
          storage_id_at_count: item.storage_id,
          counted_by: userData.user?.id ?? null,
        })
        .select("id, item_id, quantity, unit_value_at_count, storage_id_at_count")
        .single();
      if (error) throw error;
      return data as any;
    },
    onSuccess: (row: any) => {
      qc.setQueryData<CountRow[]>(["lite-count-rows", countId], (prev) => {
        const next = (prev || []).filter((r) => r.item_id !== row.item_id);
        next.push(row);
        return next;
      });
    },
    onError: (err: any) => {
      toast.error("Couldn't save count", { description: err?.message });
    },
  });

  const totalItems = items?.length ?? 0;
  const countedItems = useMemo(
    () => (rows || []).filter((r) => Number(r.quantity) > 0).length,
    [rows],
  );
  const totalValue = useMemo(
    () => (rows || []).reduce((sum, r) => sum + Number(r.quantity) * Number(r.unit_value_at_count), 0),
    [rows],
  );

  if (itemsLoading) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!items || items.length === 0) {
    return (
      <Card className="p-6 text-center space-y-2">
        <Package className="h-8 w-8 mx-auto text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">
          No active items yet. Upload a vendor invoice to build your item list, then start counting.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground text-xs mb-1">
              <Package className="h-3.5 w-3.5" />
              Items
            </div>
            <p className="text-2xl font-bold">{countedItems}/{totalItems}</p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground text-xs mb-1">
              <DollarSign className="h-3.5 w-3.5" />
              Total Value
            </div>
            <p className="text-2xl font-bold text-primary">
              ${totalValue.toFixed(2)}
            </p>
          </div>
        </div>
      </Card>

      {grouped.map(({ storageId, name, items: groupItems }) => (
        <Card key={storageId ?? "unassigned"} className="overflow-hidden">
          <div className="px-4 py-2 border-b border-border/50 bg-muted/30">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {name} <span className="text-muted-foreground/70">({groupItems.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-border/50">
            {groupItems.map((it) => {
              const row = rowByItem.get(it.id);
              return (
                <ItemCountRow
                  key={it.id}
                  item={it}
                  currentQty={row ? Number(row.quantity) : null}
                  disabled={readOnly || upsert.isPending}
                  onCommit={(q) => upsert.mutate({ item: it, quantity: q })}
                />
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ItemCountRow({
  item,
  currentQty,
  disabled,
  onCommit,
}: {
  item: Item;
  currentQty: number | null;
  disabled: boolean;
  onCommit: (q: number) => void;
}) {
  const commit = (raw: string) => {
    const parsed = raw.trim() === "" ? 0 : Number(raw);
    if (Number.isNaN(parsed) || parsed < 0) return;
    if (currentQty !== null && parsed === currentQty) return;
    if (currentQty === null && parsed === 0) return;
    onCommit(parsed);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {item.pack_size ? `${item.pack_size} • ` : ""}
          ${Number(item.cost_per_unit ?? 0).toFixed(2)} / {item.unit || "unit"}
        </div>
      </div>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        defaultValue={currentQty ?? ""}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        }}
        disabled={disabled}
        className="w-24 h-9 text-right tabular-nums"
        placeholder="0"
      />
    </div>
  );
}
