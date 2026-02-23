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
  storage_location_name: string | null;
}


const DailySpotCount = ({ locationId }: DailySpotCountProps) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [showHistory, setShowHistory] = useState(false);

  // Fetch daily-tracked items
  const { data: trackedItems, isLoading: loadingItems } = useQuery({
    queryKey: ["daily-tracked-items", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(`
          id, name, common_name, unit, category, par_level,
          storage_location:inventory_locations!inventory_items_storage_location_id_fkey(name)
        `)
        .eq("location_id", locationId)
        .eq("is_daily_tracked", true)
        .eq("is_active", true)
        .eq("user_hidden", false)
        .order("display_order", { ascending: true });

      if (error) throw error;
      return (data || []).map((item: any) => ({
        ...item,
        storage_location_name: item.storage_location?.name || null,
      })) as TrackedItem[];
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

  // Save/upsert mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Upsert the spot count session
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

      // Build item entries with previous quantities from yesterday
      const yesterdayMap: Record<string, number> = {};
      if (yesterdaysCount?.items) {
        (yesterdaysCount.items as any[]).forEach((item: any) => {
          yesterdayMap[item.item_id] = Number(item.quantity);
        });
      }

      const entries = Object.entries(quantities)
        .filter(([_, qty]) => qty >= 0)
        .map(([item_id, quantity]) => ({
          spot_count_id: spotCount.id,
          item_id,
          quantity,
          previous_quantity: yesterdayMap[item_id] ?? null,
        }));

      if (entries.length > 0) {
        // Delete existing items for this count, then re-insert
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
          const qty = quantities[item.id] || 0;
          const prevQty = yesterdayMap[item.id];
          const delta = prevQty != null ? qty - prevQty : null;
          const displayName = item.common_name || item.name;

          return (
            <Card key={item.id} className="overflow-hidden">
              <CardContent className="p-3 flex items-center gap-3">
                {/* Item info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-muted-foreground">{item.unit}</span>
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

                {/* Stepper */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => adjustQuantity(item.id, -1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="w-14 text-center text-sm font-semibold bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary/30 rounded-md py-1"
                    value={qty}
                    onChange={(e) => setQuantity(item.id, parseFloat(e.target.value) || 0)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => adjustQuantity(item.id, 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
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
