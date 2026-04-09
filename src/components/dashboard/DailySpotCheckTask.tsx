import { useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useUserRole } from "@/hooks/useUserRole";
import { formatInTimeZone } from "date-fns-tz";
import { ClipboardCheck, CircleCheck, Loader2 } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { lazyWithRetry } from "@/utils/lazyWithRetry";

const DailySpotCount = lazyWithRetry(() => import("@/components/inventory/DailySpotCount"));

const TEAL_COLOR = "#14b8a6";

interface DailySpotCheckTaskProps {
  locationHours: { hours_open: string | null; hours_close: string | null } | null;
  timezone?: string;
}

export function DailySpotCheckTask({ locationHours, timezone = "America/Los_Angeles" }: DailySpotCheckTaskProps) {
  const { currentLocation } = useAppLocation();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const canAccess = isShiftManager || isGeneralManager || isManager || isAdmin;

  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");

  // Check if location has daily-tracked items
  const { data: hasTrackedItems } = useQuery({
    queryKey: ["has-daily-tracked-items", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return false;
      const { count, error } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("location_id", currentLocation.id)
        .eq("is_daily_tracked", true)
        .eq("is_active", true)
        .eq("user_hidden", false);
      if (error) return false;
      return (count || 0) > 0;
    },
    enabled: !!currentLocation && canAccess,
    staleTime: 5 * 60 * 1000,
  });

  // Check if today's spot count is already completed
  const { data: isCompleted } = useQuery({
    queryKey: ["daily-spot-check-completed", currentLocation?.id, today],
    queryFn: async () => {
      if (!currentLocation) return true;
      const { data, error } = await supabase
        .from("daily_spot_counts")
        .select("completed_at")
        .eq("location_id", currentLocation.id)
        .eq("count_date", today)
        .maybeSingle();
      if (error) return false;
      return !!data?.completed_at;
    },
    enabled: !!currentLocation && canAccess && !!hasTrackedItems,
    staleTime: 15 * 1000,
    refetchInterval: 30000,
  });

  if (!canAccess || !locationHours || !hasTrackedItems || isCompleted) return null;

  // Time window: close → close + 2 hours
  const parseTime = (timeStr: string | null): number | null => {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const closeMinutes = parseTime(locationHours.hours_close);
  if (closeMinutes === null) return null;

  const now = new Date();
  const currentTimeInTz = formatInTimeZone(now, timezone, "HH:mm");
  const [currentHours, currentMins] = currentTimeInTz.split(":").map(Number);
  const currentMinutes = currentHours * 60 + currentMins;

  const windowStart = closeMinutes;
  const windowEnd = closeMinutes + 120;
  if (currentMinutes < windowStart || currentMinutes > windowEnd) return null;

  return (
    <>
      <div
        onClick={() => setDrawerOpen(true)}
        className="dashboard-task-pill flex items-center gap-1.5 px-2 py-1.5 rounded-lg overflow-hidden cursor-pointer active:opacity-80 transition-opacity min-w-[calc(50%-4px)] max-w-full flex-grow"
        style={{ backgroundColor: `${TEAL_COLOR}10` }}
      >
        <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: TEAL_COLOR }} />
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0" style={{ color: TEAL_COLOR }} />
        <span className="text-xs font-medium truncate flex-1">Daily Spot Check</span>
        <CircleCheck className="h-4 w-4 text-muted-foreground/40 shrink-0" />
      </div>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle>Daily Spot Check</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            {currentLocation && (
              <Suspense fallback={
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              }>
                <DailySpotCount
                  locationId={currentLocation.id}
                  onSaved={() => setDrawerOpen(false)}
                />
              </Suspense>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
