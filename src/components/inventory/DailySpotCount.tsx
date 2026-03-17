import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Minus, Plus, Check, TrendingDown, TrendingUp, Loader2, History, Sun } from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ALL_CONTAINERS, getPanUnits, type PanSizesConfig } from "@/components/inventory/PanSizesSection";

interface DailySpotCountProps {
  locationId: string;
}

interface TrackedItem {
  id: string;
  name: string;
  common_name: string | null;
  unit: string;
  category: string | null;
  par_level: number | null;
  pack_quantity: number | null;
  pack_size: string | null;
  pan_sizes: PanSizesConfig | null;
  storage_location_name: string | null;
  /** Shortcut-level overrides */
  count_by: string;
  pan_enabled_keys: string[] | null;
}


const DailySpotCount = ({ locationId }: DailySpotCountProps) => {
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
          id, name, common_name, unit, category, par_level, pack_quantity, pack_size, pan_sizes,
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
          common_name: item.common_name,
          unit: item.unit,
          category: item.category,
          par_level: item.par_level,
          pack_quantity: item.pack_quantity,
          pack_size: item.pack_size,
          pan_sizes: effectivePanSizes,
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

  const renderStepper = (
    value: number,
    onMinus: () => void,
    onPlus: () => void,
    onChange: (v: number) => void,
    label?: string,
  ) => (
    <div className="flex items-center gap-1 flex-shrink-0">
      {label && <span className="text-[10px] text-muted-foreground font-medium mr-1 w-5">{label}</span>}
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={onMinus}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <input
        type="text"
        inputMode="decimal"
        className="w-12 text-center text-sm font-semibold bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary/30 rounded-md py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={onPlus}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">
            Daily Spot Check
          </h3>
          <Badge variant="outline" className="text-xs">
            {format(new Date(), "EEE, MMM d")}
          </Badge>
          {isAlreadySaved && (
            <Badge variant="secondary" className="text-xs">Saved</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-4 w-4 mr-1" />
            <span className="text-xs">7-Day</span>
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
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
          const displayName = item.common_name || item.name;
          const showCases = countBy === "cases_only" || countBy === "cases_and_units";
          const showUnits = countBy === "units_only" || countBy === "cases_and_units";
          const showSimple = countBy === "inherit" || (!showCases && !showUnits);
          const hasPans = item.pan_sizes?.enabled && item.pan_sizes.enabled_keys?.length > 0;

          // Determine unit label
          let unitLabel = item.unit;
          if (showCases && !showUnits) unitLabel = "cs";
          else if (showUnits && !showCases) unitLabel = "ea";
          else if (showCases && showUnits) unitLabel = "cs + ea";

          return (
            <Card key={item.id} className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  {/* Item info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground">{unitLabel}</span>
                      {item.par_level != null && (
                        <span className="text-xs text-muted-foreground">
                          · par {item.par_level}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delta indicator */}
                  {delta != null && (
                    <div className={cn(
                      "flex items-center gap-0.5 text-xs font-medium",
                      delta > 0 ? "text-emerald-600 dark:text-emerald-400" :
                      delta < 0 ? "text-destructive" :
                      "text-muted-foreground"
                    )}>
                      {delta > 0 ? <TrendingUp className="h-3 w-3" /> :
                       delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                      {delta > 0 ? `+${delta}` : delta}
                    </div>
                  )}

                  {/* Simple stepper (inherit mode, no cases/units split) */}
                  {showSimple && renderStepper(
                    quantities[item.id] || 0,
                    () => adjustQuantity(item.id, -1),
                    () => adjustQuantity(item.id, 1),
                    (v) => setQuantity(item.id, v),
                  )}
                </div>

                {/* Cases / Units inputs */}
                {(showCases || showUnits) && (
                  <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-border">
                    {showCases && renderStepper(
                      caseInputs[item.id] || 0,
                      () => adjustCases(item.id, -1),
                      () => adjustCases(item.id, 1),
                      (v) => setCaseInputs(prev => ({ ...prev, [item.id]: Math.max(0, v) })),
                      "cs",
                    )}
                    {showUnits && renderStepper(
                      unitInputs[item.id] || 0,
                      () => adjustUnits(item.id, -1),
                      () => adjustUnits(item.id, 1),
                      (v) => setUnitInputs(prev => ({ ...prev, [item.id]: Math.max(0, v) })),
                      "ea",
                    )}
                  </div>
                )}


                {/* Pan size inputs */}
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
                                      ...(prev[item.id] || {}),
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
              </CardContent>
            </Card>
          );
        })}
      </div>

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
                        {item.common_name || item.name}
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
