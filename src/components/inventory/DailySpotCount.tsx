import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Minus, Plus, Check, Loader2, History, Sun, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { useAuth } from "@/lib/auth";

import { ALL_CONTAINERS, getPanUnits, type PanSizesConfig } from "@/components/inventory/PanSizesSection";

interface DailySpotCountProps {
  locationId: string;
  onSaved?: () => void;
}

interface TrackedItem {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  par_level: number | null;
  pack_quantity: number | null;
  pack_size: string | null;
  pan_sizes: PanSizesConfig | null;
  storage_location_name: string | null;
  cost_per_unit: number | null;
  /** Shortcut-level overrides */
  count_by: string;
  pan_enabled_keys: string[] | null;
}


const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const DailySpotCount = ({ locationId, onSaved }: DailySpotCountProps) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [caseInputs, setCaseInputs] = useState<Record<string, number>>({});
  const [unitInputs, setUnitInputs] = useState<Record<string, number>>({});
  const [panCounts, setPanCounts] = useState<Record<string, Record<string, number>>>({});
  const [showHistory, setShowHistory] = useState(false);

  // Fetch daily-tracked items with shortcut overrides
  const { data: trackedItems, isLoading: loadingItems } = useQuery({
    queryKey: ["daily-tracked-items", locationId],
    queryFn: async () => {
      // 1. Get items
      const { data: items, error } = await supabase
        .from("inventory_items")
        .select(`
          id, name, unit, category, par_level, pack_quantity, pack_size, pan_sizes, cost_per_unit,
          storage_location_id,
          storage_location:inventory_locations!inventory_items_storage_location_id_fkey(name)
        `)
        .eq("location_id", locationId)
        .eq("is_daily_tracked", true)
        .eq("is_active", true)
        .eq("user_hidden", false)
        .order("display_order", { ascending: true });

      if (error) throw error;
      if (!items || items.length === 0) return [];

      // 2. Find the "Daily Spot Check" storage location
      const { data: spotCheckLoc } = await supabase
        .from("inventory_locations")
        .select("id")
        .eq("location_id", locationId)
        .eq("name", "Daily Spot Check")
        .maybeSingle();

      // 3. Fetch shortcut overrides from inventory_item_locations
      let shortcutMap = new Map<string, { count_by: string; pan_enabled_keys: string[] | null }>();
      if (spotCheckLoc) {
        const itemIds = items.map(i => i.id);
        const { data: shortcuts } = await supabase
          .from("inventory_item_locations")
          .select("item_id, count_by, pan_enabled_keys")
          .eq("storage_location_id", spotCheckLoc.id)
          .in("item_id", itemIds);

        for (const s of shortcuts || []) {
          shortcutMap.set(s.item_id, {
            count_by: s.count_by || "inherit",
            pan_enabled_keys: s.pan_enabled_keys as string[] | null,
          });
        }
      }

      return items.map((item: any) => {
        const shortcut = shortcutMap.get(item.id);
        const panSizes = item.pan_sizes as unknown as PanSizesConfig | null;
        
        // If shortcut has custom pan_enabled_keys, filter the item's pan config
        let effectivePanSizes = panSizes;
        if (panSizes?.enabled && shortcut?.pan_enabled_keys && shortcut.pan_enabled_keys.length > 0) {
          effectivePanSizes = {
            ...panSizes,
            enabled_keys: shortcut.pan_enabled_keys,
          };
        }

        return {
          id: item.id,
          name: item.name,
          unit: item.unit,
          category: item.category,
          par_level: item.par_level,
          pack_quantity: item.pack_quantity,
          pack_size: item.pack_size,
          pan_sizes: effectivePanSizes,
          cost_per_unit: item.cost_per_unit,
          storage_location_name: item.storage_location?.name || null,
          count_by: shortcut?.count_by || "inherit",
          pan_enabled_keys: shortcut?.pan_enabled_keys || null,
        } as TrackedItem;
      });
    },
  });

  // Fetch today's spot count (if exists)
  const { data: todaysCount } = useQuery({
    queryKey: ["daily-spot-count", locationId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_spot_counts")
        .select("*, items:daily_spot_count_items(*)")
        .eq("location_id", locationId)
        .eq("count_date", today)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Fetch yesterday's count for deltas
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const { data: yesterdaysCount } = useQuery({
    queryKey: ["daily-spot-count", locationId, yesterday],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_spot_counts")
        .select("*, items:daily_spot_count_items(*)")
        .eq("location_id", locationId)
        .eq("count_date", yesterday)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Fetch recent history (last 7 days)
  const { data: recentHistory } = useQuery({
    queryKey: ["daily-spot-history", locationId],
    queryFn: async () => {
      const sevenDaysAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("daily_spot_counts")
        .select("*, items:daily_spot_count_items(*)")
        .eq("location_id", locationId)
        .gte("count_date", sevenDaysAgo)
        .order("count_date", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: showHistory,
  });

  // Initialize quantities from today's count
  useEffect(() => {
    if (todaysCount?.items) {
      const existing: Record<string, number> = {};
      (todaysCount.items as any[]).forEach((item: any) => {
        existing[item.item_id] = Number(item.quantity);
      });
      setQuantities(existing);
    }
  }, [todaysCount]);

  // Calculate total quantity for an item based on count_by and pans
  const getTotalQuantity = useCallback((itemId: string, item: TrackedItem): number => {
    const cases = caseInputs[itemId] || 0;
    const units = unitInputs[itemId] || 0;
    const packQty = item.pack_quantity || 1;
    
    // Pan units
    let panUnitsTotal = 0;
    if (item.pan_sizes?.enabled && panCounts[itemId]) {
      panUnitsTotal = Object.entries(panCounts[itemId]).reduce((sum, [key, qty]) => {
        const unitsPer = getPanUnits(item.pan_sizes!, key);
        return sum + (unitsPer ?? 0) * qty;
      }, 0);
    }

    const countBy = item.count_by;
    if (countBy === "cases_only") {
      return Math.round((cases * packQty + panUnitsTotal) * 100) / 100;
    } else if (countBy === "units_only") {
      return Math.round((units + panUnitsTotal) * 100) / 100;
    } else if (countBy === "cases_and_units") {
      return Math.round((cases * packQty + units + panUnitsTotal) * 100) / 100;
    }
    // inherit — use simple quantity stepper
    return (quantities[itemId] || 0) + panUnitsTotal;
  }, [caseInputs, unitInputs, quantities, panCounts]);

  // Save/upsert mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!trackedItems) throw new Error("No items");
      
      const { data: spotCount, error: countError } = await supabase
        .from("daily_spot_counts")
        .upsert(
          {
            location_id: locationId,
            count_date: today,
            counted_by: user?.id,
            completed_at: new Date().toISOString(),
          },
          { onConflict: "location_id,count_date" }
        )
        .select()
        .single();

      if (countError) throw countError;

      const yesterdayMap: Record<string, number> = {};
      if (yesterdaysCount?.items) {
        (yesterdaysCount.items as any[]).forEach((item: any) => {
          yesterdayMap[item.item_id] = Number(item.quantity);
        });
      }

      const entries = trackedItems
        .map((item) => ({
          spot_count_id: spotCount.id,
          item_id: item.id,
          quantity: getTotalQuantity(item.id, item),
          previous_quantity: yesterdayMap[item.id] ?? null,
        }))
        .filter((e) => e.quantity >= 0);

      if (entries.length > 0) {
        await supabase
          .from("daily_spot_count_items")
          .delete()
          .eq("spot_count_id", spotCount.id);

        const { error: itemsError } = await supabase
          .from("daily_spot_count_items")
          .insert(entries);

        if (itemsError) throw itemsError;
      }

      return spotCount;
    },
    onSuccess: () => {
      toast.success("Daily spot count saved!");
      queryClient.invalidateQueries({ queryKey: ["daily-spot-count", locationId, today] });
      queryClient.invalidateQueries({ queryKey: ["daily-spot-history", locationId] });
      queryClient.invalidateQueries({ queryKey: ["daily-spot-check-completed"] });
      onSaved?.();
    },
    onError: () => {
      toast.error("Failed to save spot count");
    },
  });

  const adjustQuantity = useCallback((itemId: string, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] || 0) + delta),
    }));
  }, []);

  const setQuantity = useCallback((itemId: string, value: number) => {
    setQuantities((prev) => ({
      ...prev,
      [itemId]: Math.max(0, value),
    }));
  }, []);

  const adjustCases = useCallback((itemId: string, delta: number) => {
    setCaseInputs((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] || 0) + delta),
    }));
  }, []);

  const adjustUnits = useCallback((itemId: string, delta: number) => {
    setUnitInputs((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] || 0) + delta),
    }));
  }, []);

  const updatePanCount = useCallback((itemId: string, panKey: string, delta: number) => {
    setPanCounts((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [panKey]: Math.max(0, (prev[itemId]?.[panKey] || 0) + delta),
      },
    }));
  }, []);

  if (loadingItems) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!trackedItems || trackedItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-2">
          <Sun className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No items tagged for daily tracking yet.
          </p>
          <p className="text-xs text-muted-foreground">
            Go to <span className="font-medium">Setup → Items</span> and tap an item to enable daily tracking.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isAlreadySaved = !!todaysCount?.completed_at;

  // Build yesterday lookup
  const yesterdayMap: Record<string, number> = {};
  if (yesterdaysCount?.items) {
    (yesterdaysCount.items as any[]).forEach((item: any) => {
      yesterdayMap[item.item_id] = Number(item.quantity);
    });
  }

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Daily Spot Check</h3>
          <Badge variant="outline" className="text-xs">
            {format(new Date(), "EEE, MMM d")}
          </Badge>
          {isAlreadySaved && (
            <Badge variant="secondary" className="text-xs">Saved</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowHistory(!showHistory)} title="7-Day History">
            <History className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
            Save
          </Button>
        </div>
      </div>

      {/* Item list */}
      <div className="space-y-1.5">
        {trackedItems.map((item) => {
          const countBy = item.count_by;
          const totalQty = getTotalQuantity(item.id, item);
          const prevQty = yesterdayMap[item.id];
          const delta = prevQty != null ? totalQty - prevQty : null;
          const displayName = item.name;
          const showCases = countBy === "cases_only" || countBy === "cases_and_units";
          const showUnits = countBy === "units_only" || countBy === "cases_and_units";
          const showSimple = countBy === "inherit" || (!showCases && !showUnits);
          const hasPans = item.pan_sizes?.enabled && item.pan_sizes.enabled_keys?.length > 0;
          const packQty = item.pack_quantity || 1;
          // In explicit modes (cases_only, cases_and_units, units_only), getTotalQuantity
          // returns individual units, so dividing by packQty gives case-cost correctly.
          // In inherit/simple mode, totalQty is in the item's native unit — no conversion needed
          // when the native unit is cases (cost_per_unit is already per-case).
          const isSimpleCaseUnit = showSimple && ['cs', 'case', 'cases'].includes((item.unit || '').toLowerCase());
          const itemCost = isSimpleCaseUnit
            ? (item.cost_per_unit || 0) * totalQty
            : (item.cost_per_unit || 0) * totalQty / packQty;
          const unitLabel = showSimple
            ? (item.unit || 'ea')
            : showCases && !showUnits ? 'cs' : 'ea';

          return (
            <div
              key={item.id}
              className="bg-card rounded-md border border-border overflow-hidden flex relative"
            >
              {/* Left accent bar (Vault) */}
              <div className="w-1 bg-primary flex-shrink-0" />

              {/* Value badge — pinned to top-right corner */}
              <div className="absolute top-0 right-0 bg-accent text-accent-foreground px-3 py-1.5 rounded-bl-lg">
                <p className="text-[15px] font-semibold tabular-nums leading-tight tracking-tight">{formatCurrency(itemCost)}</p>
                <p className="text-[9px] text-accent-foreground/70 text-center">
                  {totalQty} {unitLabel}
                </p>
              </div>

              <div className="flex-1 min-w-0">
                {/* Item header */}
                <div className="px-3 py-2.5 border-b border-border pr-20">
                  <p className="font-bold text-sm text-foreground truncate tracking-tight">{displayName}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      {item.pack_size || item.unit || 'ea'}
                    </span>
                    {item.par_level != null && (
                      <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        par {item.par_level}
                      </span>
                    )}
                  </div>
                </div>

                {/* Count controls */}
                <div className="p-3">
                  {showSimple ? (
                    /* Single stepper for inherit mode */
                    <div className="max-w-xs mx-auto">
                      <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider text-center">
                        Count ({item.unit || 'ea'})
                      </p>
                      <div className="flex items-center rounded-lg overflow-hidden border border-foreground/20">
                        <button
                          type="button"
                          className="h-11 w-11 flex items-center justify-center text-muted-foreground border-r border-inherit active:bg-muted transition-colors flex-shrink-0"
                          onClick={() => adjustQuantity(item.id, -1)}
                        >
                          <Minus className="h-4 w-4" strokeWidth={2} />
                        </button>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={quantities[item.id] || 0}
                          onChange={(e) => setQuantity(item.id, parseFloat(e.target.value) || 0)}
                          className="flex-1 text-center text-2xl font-bold text-foreground tabular-nums bg-transparent outline-none w-0"
                        />
                        <button
                          type="button"
                          className="h-11 w-11 flex items-center justify-center text-muted-foreground border-l border-inherit active:bg-muted transition-colors flex-shrink-0"
                          onClick={() => adjustQuantity(item.id, 1)}
                        >
                          <Plus className="h-4 w-4" strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Cases / Units grid */
                    <div className="grid grid-cols-2 gap-2">
                      {showCases && (
                        <div>
                          <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider">Cases</p>
                          <div className="flex items-center rounded-lg overflow-hidden border border-foreground/20">
                            <button
                              type="button"
                              className="h-11 w-11 flex items-center justify-center text-muted-foreground border-r border-inherit active:bg-muted transition-colors flex-shrink-0"
                              onClick={() => adjustCases(item.id, -1)}
                            >
                              <Minus className="h-4 w-4" strokeWidth={2} />
                            </button>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={caseInputs[item.id] || 0}
                              onChange={(e) => setCaseInputs(prev => ({ ...prev, [item.id]: Math.max(0, parseFloat(e.target.value) || 0) }))}
                              className="flex-1 text-center text-2xl font-bold text-foreground tabular-nums bg-transparent outline-none w-0"
                            />
                            <button
                              type="button"
                              className="h-11 w-11 flex items-center justify-center text-muted-foreground border-l border-inherit active:bg-muted transition-colors flex-shrink-0"
                              onClick={() => adjustCases(item.id, 1)}
                            >
                              <Plus className="h-4 w-4" strokeWidth={2} />
                            </button>
                          </div>
                        </div>
                      )}
                      {showUnits && (
                        <div>
                          <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider">
                            Units
                            {packQty > 1 && <span className="ml-1 normal-case tracking-normal">({packQty}/case)</span>}
                          </p>
                          <div className="flex items-center rounded-lg overflow-hidden border border-foreground/20">
                            <button
                              type="button"
                              className="h-11 w-11 flex items-center justify-center text-muted-foreground border-r border-inherit active:bg-muted transition-colors flex-shrink-0"
                              onClick={() => adjustUnits(item.id, -1)}
                            >
                              <Minus className="h-4 w-4" strokeWidth={2} />
                            </button>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={unitInputs[item.id] || 0}
                              onChange={(e) => setUnitInputs(prev => ({ ...prev, [item.id]: Math.max(0, parseFloat(e.target.value) || 0) }))}
                              className="flex-1 text-center text-2xl font-bold text-foreground tabular-nums bg-transparent outline-none w-0"
                            />
                            <button
                              type="button"
                              className="h-11 w-11 flex items-center justify-center text-muted-foreground border-l border-inherit active:bg-muted transition-colors flex-shrink-0"
                              onClick={() => adjustUnits(item.id, 1)}
                            >
                              <Plus className="h-4 w-4" strokeWidth={2} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Pan size rows */}
                  {hasPans && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mb-1.5">
                        Pan / Cambro
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {item.pan_sizes!.enabled_keys.map(panKey => {
                          const container = ALL_CONTAINERS.find(c => c.key === panKey);
                          if (!container) return null;
                          const unitsEach = getPanUnits(item.pan_sizes!, panKey);
                          const panQty = panCounts[item.id]?.[panKey] || 0;
                          return (
                            <div key={panKey} className="text-center">
                              <p className="text-[9px] text-muted-foreground font-medium mb-1 truncate">
                                {container.label}
                                {unitsEach != null && ` (${unitsEach})`}
                              </p>
                              <div className="flex items-center bg-background rounded-md border border-foreground/15 overflow-hidden">
                                <button
                                  type="button"
                                  className="h-8 w-8 flex items-center justify-center text-muted-foreground active:bg-muted transition-colors flex-shrink-0"
                                  onClick={() => updatePanCount(item.id, panKey, -0.5)}
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={panQty}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setPanCounts(prev => ({
                                      ...prev,
                                      [item.id]: {
                                        ...prev[item.id],
                                        [panKey]: Math.max(0, val),
                                      },
                                    }));
                                  }}
                                  className="flex-1 text-center text-sm font-bold bg-transparent outline-none w-0"
                                />
                                <button
                                  type="button"
                                  className="h-8 w-8 flex items-center justify-center text-muted-foreground active:bg-muted transition-colors flex-shrink-0"
                                  onClick={() => updatePanCount(item.id, panKey, 0.5)}
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Running total */}
      {trackedItems && trackedItems.length > 0 && (
        <div className="flex items-center justify-between bg-card rounded-md border border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Total Value</span>
          </div>
          <span className="text-lg font-bold text-primary tabular-nums">
            {formatCurrency(
              trackedItems.reduce((sum, item) => {
                const qty = getTotalQuantity(item.id, item);
                const packQty = item.pack_quantity || 1;
                return sum + (item.cost_per_unit || 0) * qty / packQty;
              }, 0)
            )}
          </span>
        </div>
      )}

      {/* 7-Day History */}
      {showHistory && recentHistory && recentHistory.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">7-Day History</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Item</th>
                    {recentHistory.map((day: any) => (
                      <th key={day.count_date} className="text-center py-1 px-1 font-medium text-muted-foreground whitespace-nowrap">
                        {format(new Date(day.count_date + "T12:00:00"), "EEE")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trackedItems?.map((item) => (
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="py-1 pr-2 font-medium truncate max-w-[120px]">
                        {item.name}
                      </td>
                      {recentHistory.map((day: any) => {
                        const entry = (day.items as any[])?.find((i: any) => i.item_id === item.id);
                        return (
                          <td key={day.count_date} className="text-center py-1 px-1">
                            {entry ? Number(entry.quantity) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DailySpotCount;
