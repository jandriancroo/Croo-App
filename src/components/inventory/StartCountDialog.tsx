import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  CalendarDays, 
  Calendar, 
  CalendarRange, 
  Loader2, 
  Check, 
  RefreshCw, 
  ArrowRight,
  ArrowLeft,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface StartCountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  onStartCount: (periodType: string | null, periodEndDate: string | null) => void;
  isPending: boolean;
}

interface PeriodOption {
  id: string;
  type: "weekly" | "monthly" | "yearly" | "adhoc";
  label: string;
  description: string;
  periodEndDate: string | null;
  icon: React.ReactNode;
  isConfigured: boolean;
}

interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}

const StartCountDialog = ({
  open,
  onOpenChange,
  locationId,
  onStartCount,
  isPending,
}: StartCountDialogProps) => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"period" | "sync">("period");
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncComplete, setSyncComplete] = useState(false);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setStep("period");
      setSelectedPeriod(null);
      setSyncComplete(false);
      setSyncProgress(null);
    }
  }, [open]);

  // Fetch schedule settings
  const { data: scheduleSettings, isLoading } = useQuery({
    queryKey: ["inventory-schedule-settings", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_schedule_settings")
        .select("*")
        .eq("location_id", locationId)
        .eq("is_active", true);
      
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch existing counts to check which periods are already counted
  const { data: existingCounts } = useQuery({
    queryKey: ["inventory-existing-periods", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("period_type, period_end_date, status")
        .eq("location_id", locationId)
        .not("period_end_date", "is", null);
      
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch PFG integration status
  const { data: pfgIntegration } = useQuery({
    queryKey: ["pfg-integration", locationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("location_integrations")
        .select("*")
        .eq("location_id", locationId)
        .eq("integration_type", "pfg")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: open,
  });

  // Fetch last sync time from inventory items
  const { data: lastSyncInfo, refetch: refetchSyncInfo } = useQuery({
    queryKey: ["inventory-last-sync", locationId],
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("inventory_items")
        .select("updated_at, cost_per_unit")
        .eq("location_id", locationId)
        .order("updated_at", { ascending: false })
        .limit(1);
      
      if (error) throw error;
      
      const { count } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("is_active", true);
      
      const { count: itemsWithPrices } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("is_active", true)
        .not("cost_per_unit", "is", null);
      
      return {
        lastUpdated: items?.[0]?.updated_at || null,
        totalItems: count || 0,
        itemsWithPrices: itemsWithPrices || 0,
      };
    },
    enabled: open && step === "sync",
  });

  // Generate period options based on schedule settings
  const periodOptions = useMemo(() => {
    const options: PeriodOption[] = [];
    const today = new Date();

    const isPeriodCounted = (type: string, endDate: string) => {
      return existingCounts?.some(
        (c) => c.period_type === type && c.period_end_date === endDate && c.status === "completed"
      );
    };

    // Weekly periods - week ends on the configured day
    const weeklySetting = scheduleSettings?.find((s) => s.frequency === "weekly");
    if (weeklySetting) {
      // day_of_week is the day the week ENDS on (0 = Sunday, 1 = Monday, etc.)
      const weekEndDay = weeklySetting.day_of_week ?? 0;
      
      // Calculate the week start day (the day after the week end day)
      const weekStartDay = ((weekEndDay + 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      
      // Find the current/upcoming week end date
      const todayDay = today.getDay();
      let daysUntilEnd = weekEndDay - todayDay;
      if (daysUntilEnd < 0) daysUntilEnd += 7;
      
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() + daysUntilEnd);
      const weekEndStr = format(weekEnd, "yyyy-MM-dd");
      
      // Week start is 6 days before week end
      const weekStart = subDays(weekEnd, 6);
      
      if (!isPeriodCounted("weekly", weekEndStr)) {
        options.push({
          id: `weekly-current`,
          type: "weekly",
          label: `Week Ending ${format(weekEnd, "MMM d")}`,
          description: `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`,
          periodEndDate: weekEndStr,
          icon: <CalendarDays className="h-5 w-5" />,
          isConfigured: true,
        });
      }

      // Previous week
      const prevWeekEnd = subDays(weekEnd, 7);
      const prevWeekStart = subDays(prevWeekEnd, 6);
      const prevWeekEndStr = format(prevWeekEnd, "yyyy-MM-dd");
      
      if (!isPeriodCounted("weekly", prevWeekEndStr)) {
        options.push({
          id: `weekly-prev`,
          type: "weekly",
          label: `Week Ending ${format(prevWeekEnd, "MMM d")}`,
          description: `${format(prevWeekStart, "MMM d")} - ${format(prevWeekEnd, "MMM d, yyyy")}`,
          periodEndDate: prevWeekEndStr,
          icon: <CalendarDays className="h-5 w-5" />,
          isConfigured: true,
        });
      }
    }

    // Monthly periods
    const monthlySetting = scheduleSettings?.find((s) => s.frequency === "monthly");
    if (monthlySetting) {
      const monthEnd = endOfMonth(today);
      const monthEndStr = format(monthEnd, "yyyy-MM-dd");
      
      if (!isPeriodCounted("monthly", monthEndStr)) {
        options.push({
          id: `monthly-current`,
          type: "monthly",
          label: `${format(today, "MMMM")} Month End`,
          description: `${format(startOfMonth(today), "MMM d")} - ${format(monthEnd, "MMM d, yyyy")}`,
          periodEndDate: monthEndStr,
          icon: <Calendar className="h-5 w-5" />,
          isConfigured: true,
        });
      }

      const prevMonth = subDays(startOfMonth(today), 1);
      const prevMonthEnd = endOfMonth(prevMonth);
      const prevMonthEndStr = format(prevMonthEnd, "yyyy-MM-dd");
      
      if (!isPeriodCounted("monthly", prevMonthEndStr)) {
        options.push({
          id: `monthly-prev`,
          type: "monthly",
          label: `${format(prevMonth, "MMMM")} Month End`,
          description: `${format(startOfMonth(prevMonth), "MMM d")} - ${format(prevMonthEnd, "MMM d, yyyy")}`,
          periodEndDate: prevMonthEndStr,
          icon: <Calendar className="h-5 w-5" />,
          isConfigured: true,
        });
      }
    }

    // Yearly period
    const yearlySetting = scheduleSettings?.find((s) => s.frequency === "yearly");
    if (yearlySetting) {
      const yearEnd = endOfYear(today);
      const yearEndStr = format(yearEnd, "yyyy-MM-dd");
      
      if (!isPeriodCounted("yearly", yearEndStr)) {
        options.push({
          id: `yearly-current`,
          type: "yearly",
          label: `${format(today, "yyyy")} Year End`,
          description: `${format(startOfYear(today), "MMM d")} - ${format(yearEnd, "MMM d, yyyy")}`,
          periodEndDate: yearEndStr,
          icon: <CalendarRange className="h-5 w-5" />,
          isConfigured: true,
        });
      }
    }

    // Always show ad-hoc option
    options.push({
      id: "adhoc",
      type: "adhoc",
      label: "Quick Count",
      description: "Count without a specific period",
      periodEndDate: null,
      icon: <Check className="h-5 w-5" />,
      isConfigured: false,
    });

    return options;
  }, [scheduleSettings, existingCounts]);

  // Sync from PFG
  const syncFromPFG = async () => {
    if (!pfgIntegration) return;
    
    setIsSyncing(true);
    setSyncProgress({ phase: "Connecting to PFG...", current: 0, total: 100 });
    
    try {
      const productListHeaderId = (pfgIntegration?.credentials as any)?.product_list_header_id 
        || "b4680e1a-4815-44c6-968e-634e94188009";
      const customerId = (pfgIntegration?.credentials as any)?.customer_id
        || "73094123-ab82-4044-9722-65099b55a11e";
      
      setSyncProgress({ phase: "Fetching products from PFG...", current: 15, total: 100 });
      
      const { data, error } = await supabase.functions.invoke("pfg-service", {
        body: { locationId, action: "categories", productListHeaderId, customerId }
      });

      if (error) throw error;
      if (!data?.authenticated) {
        throw new Error("PFG authentication failed");
      }

      const categories = data?.data?.categories || [];
      
      if (categories.length === 0) {
        setSyncProgress({ phase: "No items found", current: 100, total: 100 });
        setSyncComplete(true);
        return;
      }

      let totalProducts = 0;
      for (const cat of categories) {
        totalProducts += (cat.products || []).length;
      }

      setSyncProgress({ phase: "Updating storage locations...", current: 25, total: 100 });

      // Upsert storage locations
      const locationMap = new Map<string, string>();
      
      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        const { data: existing } = await supabase
          .from("inventory_locations")
          .select("id")
          .eq("location_id", locationId)
          .ilike("name", cat.name)
          .maybeSingle();
        
        if (existing) {
          locationMap.set(cat.name.toLowerCase(), existing.id);
        } else {
          const { data: inserted } = await supabase
            .from("inventory_locations")
            .insert({ location_id: locationId, name: cat.name, display_order: i })
            .select("id")
            .single();
          
          if (inserted) {
            locationMap.set(cat.name.toLowerCase(), inserted.id);
          }
        }
      }

      setSyncProgress({ phase: "Updating items & prices...", current: 35, total: 100, detail: `0 / ${totalProducts}` });

      // Upsert items
      let processedItems = 0;
      
      for (const cat of categories) {
        const storageLocationId = locationMap.get(cat.name.toLowerCase());
        if (!storageLocationId) continue;

        for (const product of cat.products || []) {
          processedItems++;
          
          if (processedItems % 5 === 0 || processedItems === totalProducts) {
            const progressPct = 35 + Math.floor((processedItems / totalProducts) * 55);
            setSyncProgress({ 
              phase: "Updating items & prices...", 
              current: progressPct, 
              total: 100, 
              detail: `${processedItems} / ${totalProducts}` 
            });
          }
          
          const { data: existing } = await supabase
            .from("inventory_items")
            .select("id, image_url")
            .eq("location_id", locationId)
            .eq("qubeyond_item_id", product.id)
            .maybeSingle();
          
          const price = product.price ? Number(product.price) : null;
          const packQuantity = product.packQuantity ? Number(product.packQuantity) : null;
          const imageUrl = existing?.image_url || product.imageUrl || null;
          
          const itemData = {
            name: product.name,
            unit: product.unit?.toLowerCase() || "case",
            storage_location_id: storageLocationId,
            cost_per_unit: price,
            pack_size: product.packSize || null,
            pack_quantity: packQuantity,
            brand: product.brand || null,
            item_number: product.itemNumber || null,
            image_url: imageUrl,
            is_active: true
          };
          
          if (existing) {
            await supabase
              .from("inventory_items")
              .update(itemData)
              .eq("id", existing.id);
          } else {
            await supabase
              .from("inventory_items")
              .insert({
                location_id: locationId,
                qubeyond_item_id: product.id,
                display_order: processedItems,
                ...itemData
              });
          }
        }
      }

      // Also sync PFG orders in background
      supabase.functions.invoke("pfg-service?action=sync_orders", {
        body: { locationId }
      }).catch(console.warn);

      setSyncProgress({ phase: "Sync complete!", current: 100, total: 100 });
      setSyncComplete(true);
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      refetchSyncInfo();
      
    } catch (err) {
      console.error("PFG sync error:", err);
      setSyncProgress({ phase: "Sync failed", current: 0, total: 100 });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleContinueToSync = () => {
    setStep("sync");
  };

  const handleBack = () => {
    setStep("period");
    setSyncComplete(false);
    setSyncProgress(null);
  };

  const handleStart = () => {
    const selected = periodOptions.find((p) => p.id === selectedPeriod);
    if (selected) {
      onStartCount(
        selected.type === "adhoc" ? null : selected.type,
        selected.periodEndDate
      );
    }
  };

  const selectedPeriodData = periodOptions.find((p) => p.id === selectedPeriod);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "period" ? "Select Count Period" : "Sync Items & Prices"}
          </DialogTitle>
          <DialogDescription>
            {step === "period" 
              ? "Choose the period you're counting for"
              : "Update your inventory data before counting"
            }
          </DialogDescription>
        </DialogHeader>

        {step === "period" && (
          <>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {periodOptions.map((option) => (
                  <Card
                    key={option.id}
                    className={cn(
                      "cursor-pointer transition-all",
                      selectedPeriod === option.id
                        ? "border-primary ring-2 ring-primary/20"
                        : "hover:border-primary/50"
                    )}
                    onClick={() => setSelectedPeriod(option.id)}
                  >
                    <CardContent className="p-4 flex items-center gap-4">
                      <div
                        className={cn(
                          "h-10 w-10 rounded-full flex items-center justify-center",
                          selectedPeriod === option.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {option.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{option.label}</p>
                          {option.isConfigured && (
                            <Badge variant="secondary" className="text-xs">
                              Scheduled
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {option.description}
                        </p>
                      </div>
                      {selectedPeriod === option.id && (
                        <Check className="h-5 w-5 text-primary" />
                      )}
                    </CardContent>
                  </Card>
                ))}

                {periodOptions.length === 1 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No scheduled periods configured.{" "}
                    <span className="text-primary">Set up in the Setup tab.</span>
                  </p>
                )}

                <Button
                  className="w-full mt-4"
                  size="lg"
                  disabled={!selectedPeriod}
                  onClick={handleContinueToSync}
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </>
        )}

        {step === "sync" && (
          <div className="space-y-4">
            {/* Selected Period Summary */}
            {selectedPeriodData && (
              <Card className="bg-muted/50">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    {selectedPeriodData.icon}
                  </div>
                  <div>
                    <p className="font-medium">{selectedPeriodData.label}</p>
                    <p className="text-sm text-muted-foreground">{selectedPeriodData.description}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Sync Status Card */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">Inventory Items</span>
                  </div>
                  <Badge variant="outline">
                    {lastSyncInfo?.totalItems || 0} items
                  </Badge>
                </div>

                {/* Last Sync Info */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Last synced</span>
                  </div>
                  <span>
                    {lastSyncInfo?.lastUpdated 
                      ? formatDistanceToNow(new Date(lastSyncInfo.lastUpdated), { addSuffix: true })
                      : "Never"
                    }
                  </span>
                </div>

                {/* Prices Status */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {lastSyncInfo && lastSyncInfo.itemsWithPrices === lastSyncInfo.totalItems ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    )}
                    <span>Items with prices</span>
                  </div>
                  <span>
                    {lastSyncInfo?.itemsWithPrices || 0} / {lastSyncInfo?.totalItems || 0}
                  </span>
                </div>

                {/* Sync Progress */}
                {syncProgress && (
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{syncProgress.phase}</span>
                      <span className="text-muted-foreground">{syncProgress.current}%</span>
                    </div>
                    <Progress value={syncProgress.current} className="h-2" />
                    {syncProgress.detail && (
                      <p className="text-xs text-muted-foreground text-center">{syncProgress.detail}</p>
                    )}
                  </div>
                )}

                {/* Sync Button */}
                {pfgIntegration && !syncComplete && (
                  <Button 
                    variant="outline"
                    className="w-full" 
                    onClick={syncFromPFG}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Sync Items & Prices from PFG
                  </Button>
                )}

                {syncComplete && (
                  <div className="flex items-center justify-center gap-2 text-green-600 py-2">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">Sync complete</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isSyncing || isPending}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                className="flex-1"
                size="lg"
                disabled={isSyncing || isPending}
                onClick={handleStart}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Start Counting
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StartCountDialog;
