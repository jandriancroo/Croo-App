import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Package,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Check,
  Save,
  ArrowLeft,
  Minus,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDockToast } from "@/contexts/DockToastContext";

interface Props {
  countId: string;
  locationId: string;
  readOnly?: boolean;
  /** Called from the review screen's Submit button. */
  onSubmit?: () => void;
  /** Called from Save & Exit. Parent should route out (progress stays saved). */
  onExit?: () => void;
  /** Whether parent's submit mutation is currently pending. */
  submitPending?: boolean;
}

interface Item {
  id: string;
  name: string;
  unit: string | null;
  pack_size: string | null;
  cost_per_unit: number | null;
  storage_id: string | null;
  display_order: number | null;
  category: string | null;
  item_number: string | null;
  count_mode: "single" | "case_and_unit" | null;
  case_qty: number | null;
  unit_label: string | null;
  cost_per_inner_unit: number | null;
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
  case_quantity: number | null;
  inner_quantity: number | null;
  count_mode_at_count: "single" | "case_and_unit" | null;
  case_qty_at_count: number | null;
  unit_label_at_count: string | null;
  cost_per_inner_unit_at_count: number | null;
}

/** Line value = (cases × case cost) + (inner units × per-inner cost) for dual,
 *  or (quantity × unit cost) for single. Uses the row's snapshotted values so
 *  the number never changes after later item edits. */
function lineValue(row: CountRow): number {
  if (row.count_mode_at_count === "case_and_unit") {
    const caseVal = Number(row.case_quantity ?? 0) * Number(row.unit_value_at_count ?? 0);
    const innerVal =
      Number(row.inner_quantity ?? 0) * Number(row.cost_per_inner_unit_at_count ?? 0);
    return caseVal + innerVal;
  }
  return Number(row.quantity) * Number(row.unit_value_at_count);
}

/** Is this row "counted" (contributes to progress)? Dual-mode counts if either
 *  cases or inner units are entered. */
function rowIsCounted(row: CountRow): boolean {
  if (row.count_mode_at_count === "case_and_unit") {
    return Number(row.case_quantity ?? 0) > 0 || Number(row.inner_quantity ?? 0) > 0;
  }
  return Number(row.quantity) > 0;
}

/**
 * Lite counting session — Brand-parity structure (paginated per-storage nav,
 * sticky stats, review-before-submit, save/exit lock) scoped to Lite tables.
 *
 * Locking model: while draft (`!readOnly`) and in counting mode (not review),
 * a `beforeunload` handler guards against tab close/refresh. Parent hides its
 * back arrow in the same window and shows Save & Exit instead — so in-app
 * navigation is only possible via Save & Exit or Submit.
 */
export default function LiteCountSession({
  countId,
  locationId,
  readOnly = false,
  onSubmit,
  onExit,
  submitPending = false,
}: Props) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { setDockContent } = useDockToast();
  const [activeIdx, setActiveIdx] = useState(0);
  const [mode, setMode] = useState<"count" | "review">("count");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["lite-inventory-items-count", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await supabase
        .from("lite_inventory_items" as any)
        .select(
          "id, name, unit, pack_size, cost_per_unit, storage_id, display_order, category, item_number, count_mode, case_qty, unit_label, cost_per_inner_unit",
        )
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
        .select("id, item_id, quantity, unit_value_at_count, storage_id_at_count, case_quantity, inner_quantity, count_mode_at_count, case_qty_at_count, unit_label_at_count, cost_per_inner_unit_at_count")
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
    const shelfSort = (a: Item, b: Item) => {
      const ao = a.display_order;
      const bo = b.display_order;
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      return a.name.localeCompare(b.name);
    };
    return Array.from(byStorage.entries())
      .sort(([a], [b]) => {
        if (a === null) return 1;
        if (b === null) return -1;
        return storageOrder.indexOf(a) - storageOrder.indexOf(b);
      })
      .map(([storageId, list]) => ({
        storageId,
        name: nameFor(storageId),
        items: list.slice().sort(shelfSort),
      }));
  }, [items, storages]);

  // Keep activeIdx in bounds if items change.
  useEffect(() => {
    if (activeIdx >= grouped.length && grouped.length > 0) {
      setActiveIdx(Math.max(0, grouped.length - 1));
    }
  }, [grouped.length, activeIdx]);

  const upsert = useMutation({
    mutationFn: async ({
      item,
      quantity,
      caseQuantity,
      innerQuantity,
    }: {
      item: Item;
      quantity?: number;
      caseQuantity?: number;
      innerQuantity?: number;
    }) => {
      const isDual = item.count_mode === "case_and_unit";
      const existing = rowByItem.get(item.id);
      if (existing) {
        const patch: Record<string, any> = {
          counted_at: new Date().toISOString(),
        };
        if (isDual) {
          if (caseQuantity !== undefined) patch.case_quantity = caseQuantity;
          if (innerQuantity !== undefined) patch.inner_quantity = innerQuantity;
        } else if (quantity !== undefined) {
          patch.quantity = quantity;
        }
        const { error } = await supabase
          .from("lite_inventory_count_items" as any)
          .update(patch)
          .eq("id", existing.id);
        if (error) throw error;
        return { ...existing, ...patch };
      }
      const { data: userData } = await supabase.auth.getUser();
      // Snapshot the counting shape onto the row so future item edits never
      // rewrite historical counts.
      const derivedInner =
        item.cost_per_inner_unit != null
          ? Number(item.cost_per_inner_unit)
          : item.case_qty && item.case_qty > 0 && item.cost_per_unit != null
          ? Number(item.cost_per_unit) / item.case_qty
          : 0;
      const insertPayload: Record<string, any> = {
        count_id: countId,
        item_id: item.id,
        quantity: isDual ? 0 : quantity ?? 0,
        unit_value_at_count: item.cost_per_unit ?? 0,
        storage_id_at_count: item.storage_id,
        counted_by: userData.user?.id ?? null,
        count_mode_at_count: isDual ? "case_and_unit" : "single",
        case_quantity: isDual ? caseQuantity ?? 0 : null,
        inner_quantity: isDual ? innerQuantity ?? 0 : null,
        case_qty_at_count: isDual ? item.case_qty : null,
        unit_label_at_count: isDual ? item.unit_label : null,
        cost_per_inner_unit_at_count: isDual ? derivedInner : null,
      };
      const { data, error } = await supabase
        .from("lite_inventory_count_items" as any)
        .insert(insertPayload)
        .select(
          "id, item_id, quantity, unit_value_at_count, storage_id_at_count, case_quantity, inner_quantity, count_mode_at_count, case_qty_at_count, unit_label_at_count, cost_per_inner_unit_at_count",
        )
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
      setLastSavedAt(new Date());
    },
    onError: (err: any) => {
      toast.error("Couldn't save count", { description: err?.message });
    },
  });

  // Elapsed timer — only while actively counting a draft.
  useEffect(() => {
    if (readOnly || mode !== "count") return;
    const t = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [readOnly, mode]);


  // ---- Save & Exit lock (draft + counting mode only) ------------------------
  // Scoped narrowly: only armed when session is draft AND not on review AND not
  // during submit. Disarms in the same tick as submit or Save & Exit before
  // parent navigates, so nothing traps the user post-submit.
  const locked = !readOnly && mode === "count" && !submitPending;
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!lockedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  // --------------------------------------------------------------------------

  const totalItems = items?.length ?? 0;
  const countedItems = useMemo(
    () => (rows || []).filter(rowIsCounted).length,
    [rows],
  );
  const totalValue = useMemo(
    () => (rows || []).reduce((sum, r) => sum + lineValue(r), 0),
    [rows],
  );
  const progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

  // Swipe handling for the active storage view.
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 60) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  const goPrev = () => setActiveIdx((i) => Math.max(0, i - 1));
  const goNext = () => setActiveIdx((i) => Math.min(grouped.length - 1, i + 1));

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
          No active items yet. Add items from the Invoices tab, then start counting.
        </p>
      </Card>
    );
  }

  // ---- REVIEW MODE ---------------------------------------------------------
  if (mode === "review") {
    const uncounted = totalItems - countedItems;
    return (
      <div className="space-y-4">
        <StatsBar
          countedItems={countedItems}
          totalItems={totalItems}
          totalValue={totalValue}
          progressPct={progressPct}
          label="Review before submit"
        />

        {grouped.map(({ storageId, name, items: groupItems }) => {
          const subtotal = groupItems.reduce((sum, it) => {
            const row = rowByItem.get(it.id);
            return row ? sum + lineValue(row) : sum;
          }, 0);
          return (
            <Card key={storageId ?? "unassigned"} className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/30">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {name}{" "}
                  <span className="text-muted-foreground/70">({groupItems.length})</span>
                </h3>
                <span className="text-xs tabular-nums font-semibold">
                  ${subtotal.toFixed(2)}
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {groupItems.map((it) => {
                  const row = rowByItem.get(it.id);
                  const val = row ? lineValue(row) : 0;
                  const isDual = row?.count_mode_at_count === "case_and_unit";
                  return (
                    <div
                      key={it.id}
                      className="flex items-center gap-3 px-4 py-2 text-sm"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{it.name}</div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {isDual ? (
                            <>
                              {Number(row?.case_quantity ?? 0)} case{Number(row?.case_quantity ?? 0) === 1 ? "" : "s"}
                              {" + "}
                              {Number(row?.inner_quantity ?? 0)} {row?.unit_label_at_count || it.unit_label || "unit"}
                            </>
                          ) : (
                            <>
                              {row ? Number(row.quantity) : 0} {it.unit || "unit"} × $
                              {Number(row?.unit_value_at_count ?? it.cost_per_unit ?? 0).toFixed(2)}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-right tabular-nums font-semibold shrink-0">
                        ${val.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}

        {uncounted > 0 && (
          <Card className="p-3 border-amber-500/30 bg-amber-500/5">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {uncounted} item{uncounted === 1 ? "" : "s"} not counted — they'll be
              treated as $0 on this count.
            </p>
          </Card>
        )}

        <div className="sticky bottom-0 z-20 flex gap-2 bg-background/95 backdrop-blur border-t border-border/60 -mx-4 px-4 py-3 md:mx-0 md:rounded-lg md:border">
          <Button variant="outline" onClick={() => setMode("count")} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to counting
          </Button>
          <Button
            className="flex-1 gap-2"
            onClick={() => onSubmit?.()}
            disabled={submitPending || !onSubmit}
          >
            {submitPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Submit Count
          </Button>
        </div>
      </div>
    );
  }

  // ---- READ-ONLY (post-submit) — flat list, no nav ------------------------
  if (readOnly) {
    return (
      <div className="space-y-4">
        <StatsBar
          countedItems={countedItems}
          totalItems={totalItems}
          totalValue={totalValue}
          progressPct={progressPct}
          label="Submitted"
        />
        {grouped.map(({ storageId, name, items: groupItems }) => (
          <Card key={storageId ?? "unassigned"} className="overflow-hidden">
            <div className="px-4 py-2 border-b border-border/50 bg-muted/30">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {name}{" "}
                <span className="text-muted-foreground/70">({groupItems.length})</span>
              </h3>
            </div>
            <div className="divide-y divide-border/50">
              {groupItems.map((it) => {
                const row = rowByItem.get(it.id);
                const isDual = row?.count_mode_at_count === "case_and_unit";
                return (
                  <div
                    key={it.id}
                    className="flex items-center gap-3 px-4 py-2 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{it.name}</div>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      {isDual ? (
                        <>
                          {Number(row?.case_quantity ?? 0)} case
                          {Number(row?.case_quantity ?? 0) === 1 ? "" : "s"} +{" "}
                          {Number(row?.inner_quantity ?? 0)}{" "}
                          {row?.unit_label_at_count || it.unit_label || "unit"}
                        </>
                      ) : (
                        <>
                          {row ? Number(row.quantity) : 0} {it.unit || "unit"}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  // ---- COUNTING MODE (paginated) ------------------------------------------
  const active = grouped[activeIdx];
  const activeSubtotal = active
    ? active.items.reduce((sum, it) => {
        const row = rowByItem.get(it.id);
        return row ? sum + lineValue(row) : sum;
      }, 0)
    : 0;
  const isLast = activeIdx >= grouped.length - 1;

  return (
    <div className="space-y-3">
      <StatsBar
        countedItems={countedItems}
        totalItems={totalItems}
        totalValue={totalValue}
        progressPct={progressPct}
      />

      {/* Sticky storage-page nav — Brand-parity pill */}
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.25rem+0.5rem)] md:top-[8.5rem] z-20 mt-2 bg-primary/95 backdrop-blur-md text-primary-foreground rounded-md px-2 py-2 shadow-md overflow-hidden border border-white/10">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
            onClick={goPrev}
            disabled={activeIdx === 0}
            aria-label="Previous storage"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-center flex-1 min-w-0">
            <p className="font-semibold text-sm text-primary-foreground truncate leading-tight">
              {active?.name || "—"} ({active?.items.length ?? 0}) — ${activeSubtotal.toFixed(2)}
            </p>
            <p className="text-[11px] text-primary-foreground/70 tabular-nums leading-tight">
              Page {activeIdx + 1}/{grouped.length}
            </p>
          </div>
          <button
            type="button"
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
            onClick={goNext}
            disabled={isLast}
            aria-label="Next storage"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Item cards — Brand-parity card-per-item */}
      <div
        className="space-y-3"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {active?.items.map((it) => {
          const row = rowByItem.get(it.id);
          return (
            <ItemCard
              key={it.id}
              item={it}
              row={row}
              disabled={upsert.isPending}
              onCommitSingle={(q) => upsert.mutate({ item: it, quantity: q })}
              onCommitCases={(q) =>
                upsert.mutate({
                  item: it,
                  caseQuantity: q,
                  innerQuantity: row ? Number(row.inner_quantity ?? 0) : 0,
                })
              }
              onCommitInner={(q) =>
                upsert.mutate({
                  item: it,
                  caseQuantity: row ? Number(row.case_quantity ?? 0) : 0,
                  innerQuantity: q,
                })
              }
            />
          );
        })}
      </div>

      <div className="sticky bottom-0 z-20 flex gap-2 bg-background/95 backdrop-blur border-t border-border/60 -mx-4 px-4 py-3 md:mx-0 md:rounded-lg md:border">
        <Button variant="outline" onClick={() => onExit?.()} className="gap-2">
          <Save className="h-4 w-4" />
          Save & Exit
        </Button>
        {isLast ? (
          <Button className="flex-1 gap-2" onClick={() => setMode("review")}>
            Review
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="flex-1 gap-2" onClick={goNext}>
            Next storage
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}


function StatsBar({
  countedItems,
  totalItems,
  totalValue,
  progressPct,
  label,
}: {
  countedItems: number;
  totalItems: number;
  totalValue: number;
  progressPct: number;
  label?: string;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-4 md:mx-0">
      <Card className="mx-4 md:mx-0 p-3 shadow-sm">
        {label && (
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
            {label}
          </div>
        )}
        <Progress value={progressPct} className="h-1.5 mb-2" />
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground text-[10px] mb-0.5">
              <Package className="h-3 w-3" /> Items
            </div>
            <p className="text-lg font-bold tabular-nums">
              {countedItems}/{totalItems}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                ({progressPct}%)
              </span>
            </p>
          </div>
          <div>
            <div className="flex items-center justify-center gap-1 text-muted-foreground text-[10px] mb-0.5">
              <DollarSign className="h-3 w-3" /> Total Value
            </div>
            <p className="text-lg font-bold tabular-nums text-primary">
              ${totalValue.toFixed(2)}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Brand-parity Item Card ──────────────────────────────────────────────────
// White bordered card per item with:
//   • bold name top-left
//   • cost-breakdown subtitle (pack_size · #item_number · $/cs · $/unit)
//   • orange price badge top-right (live line value + counted-units label)
//   • one lane per active count method:
//       single mode → 1 lane (item.unit or "Units")
//       case_and_unit → 2 lanes (Cases + unit_label)
// Each lane: uppercase label header, large centered number, coral(down)/mint(up) buttons.

interface LaneSpec {
  key: string;
  label: string;
  value: number;
  onCommit: (n: number) => void;
}

function ItemCard({
  item,
  row,
  disabled,
  onCommitSingle,
  onCommitCases,
  onCommitInner,
}: {
  item: Item;
  row: CountRow | undefined;
  disabled: boolean;
  onCommitSingle: (q: number) => void;
  onCommitCases: (q: number) => void;
  onCommitInner: (q: number) => void;
}) {
  const isDual = item.count_mode === "case_and_unit";

  // Cost breakdown subtitle mirrors Brand's header format.
  const caseCost = Number(item.cost_per_unit ?? 0);
  const derivedInner =
    item.cost_per_inner_unit != null
      ? Number(item.cost_per_inner_unit)
      : item.case_qty && item.case_qty > 0 && item.cost_per_unit != null
      ? caseCost / item.case_qty
      : 0;
  const innerLabel = item.unit_label || item.unit || "Unit";
  const pluralInner = /s$/i.test(innerLabel) ? innerLabel : `${innerLabel}s`;

  const bits: string[] = [];
  if (item.pack_size) bits.push(item.pack_size);
  if (item.item_number) bits.push(`#${item.item_number}`);
  if (caseCost > 0) bits.push(`$${caseCost.toFixed(2)}/${isDual ? "case" : item.unit || "unit"}`);
  if (isDual && derivedInner > 0) bits.push(`$${derivedInner.toFixed(2)}/${innerLabel}`);
  const subtitle = bits.join(" · ");

  // Live line value + counted-units label (identical to Brand pattern).
  const liveValue = row ? lineValue(row) : 0;
  let unitsCount = 0;
  let unitsLabel = "";
  if (isDual) {
    const cases = row ? Number(row.case_quantity ?? 0) : 0;
    const inner = row ? Number(row.inner_quantity ?? 0) : 0;
    const perCase = item.case_qty ?? row?.case_qty_at_count ?? 0;
    unitsCount = cases * perCase + inner;
    unitsLabel = unitsCount === 1 ? innerLabel : pluralInner;
  } else {
    unitsCount = row ? Number(row.quantity) : 0;
    unitsLabel = (item.unit || "unit") + (unitsCount === 1 ? "" : "s");
  }

  const lanes: LaneSpec[] = isDual
    ? [
        {
          key: "cases",
          label: "Cases",
          value: row ? Number(row.case_quantity ?? 0) : 0,
          onCommit: onCommitCases,
        },
        {
          key: "inner",
          label: pluralInner,
          value: row ? Number(row.inner_quantity ?? 0) : 0,
          onCommit: onCommitInner,
        },
      ]
    : [
        {
          key: "units",
          label: (item.unit || "Units").toString(),
          value: row ? Number(row.quantity) : 0,
          onCommit: onCommitSingle,
        },
      ];

  const gridColsClass = lanes.length === 2 ? "grid-cols-2" : "grid-cols-1";

  return (
    <div className="bg-card rounded-lg border border-border/60 overflow-hidden relative">
      {/* Header: name + subtitle + orange live-value badge */}
      <div className="relative px-3.5 py-3 sm:px-5 sm:py-4 border-b border-border/60">
        <div
          className="absolute top-0 right-0 text-white text-center leading-tight"
          style={{
            backgroundColor: "#e85d04",
            padding: "6px 11px",
            borderTopRightRadius: "calc(0.5rem - 1px)",
            borderBottomLeftRadius: "0.5rem",
          }}
        >
          <p className="text-[15px] sm:text-base font-semibold tabular-nums tracking-tight">
            ${liveValue.toFixed(2)}
          </p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.85)" }}>
            {unitsCount} {unitsLabel}
          </p>
        </div>
        <div style={{ paddingRight: 76 }}>
          <p className="text-[15px] sm:text-base font-bold text-foreground truncate leading-tight">
            {item.name}
          </p>
          {subtitle && (
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Lane grid: equal-width columns, one per active lane */}
      <div className={`grid ${gridColsClass}`}>
        {lanes.map((lane, i) => (
          <LaneColumn
            key={lane.key}
            lane={lane}
            disabled={disabled}
            withDivider={i < lanes.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function LaneColumn({
  lane,
  disabled,
  withDivider,
}: {
  lane: LaneSpec;
  disabled: boolean;
  withDivider: boolean;
}) {
  const [draft, setDraft] = useState<string>(String(lane.value));
  useEffect(() => {
    setDraft(String(lane.value));
  }, [lane.value]);

  const commitRaw = (raw: string) => {
    const parsed = raw.trim() === "" ? 0 : Number(raw);
    if (Number.isNaN(parsed) || parsed < 0) {
      setDraft(String(lane.value));
      return;
    }
    if (parsed === lane.value) return;
    lane.onCommit(parsed);
  };

  const step = (delta: number) => {
    const next = Math.max(0, lane.value + delta);
    if (next === lane.value) return;
    lane.onCommit(next);
  };

  return (
    <div
      className={`flex flex-col items-center gap-1.5 py-3 px-2 ${
        withDivider ? "border-r border-border/60" : ""
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {lane.label}
      </p>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commitRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={disabled}
        className="w-full text-center font-bold leading-none tabular-nums bg-transparent outline-none"
        style={{ fontSize: 40, minHeight: 0 }}
      />
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled || lane.value <= 0}
          aria-label={`Decrement ${lane.label}`}
          className="h-[42px] w-[42px] flex items-center justify-center rounded-md border border-[#F5C4B3] bg-[#FEF3EE] text-[#993C1D] active:scale-95 transition-transform disabled:opacity-40"
        >
          <Minus className="h-[18px] w-[18px]" strokeWidth={2.25} />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled}
          aria-label={`Increment ${lane.label}`}
          className="h-[42px] w-[42px] flex items-center justify-center rounded-md border border-[#9FE1CB] bg-[#E1F5EE] text-[#0F6E56] active:scale-95 transition-transform disabled:opacity-40"
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

