import React, { useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useUserRole } from "@/hooks/useUserRole";
import { formatInTimeZone } from "date-fns-tz";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { TemporaryTaskCard } from "./TemporaryTaskCard";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { lazyWithRetry } from "@/utils/lazyWithRetry";
import { parseHHMM, spotCheckWindow, type QuickExtraRow } from "@/lib/quickTasks/extraRows";

const DailySpotCount = lazyWithRetry(() => import("@/components/inventory/DailySpotCount"));

const TEAL_COLOR = "#14b8a6";

interface DailySpotCheckTaskProps {
  locationHours: { hours_open: string | null; hours_close: string | null } | null;
  timezone?: string;
}

export function useDailySpotCheckRow({ locationHours, timezone = "America/Los_Angeles" }: DailySpotCheckTaskProps): { rows: QuickExtraRow[]; overlay: React.ReactNode } {
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

  let win = { show: false, overdue: false };
  if (canAccess && locationHours && hasTrackedItems && !isCompleted) {
    const currentTimeInTz = formatInTimeZone(new Date(), timezone, "HH:mm");
    const [currentHours, currentMins] = currentTimeInTz.split(":").map(Number);
    win = spotCheckWindow(parseHHMM(locationHours.hours_close), currentHours * 60 + currentMins);
  }
  const rows: QuickExtraRow[] = win.show
    ? [{ key: "daily-spot-check", title: "Daily Spot Check", icon: ClipboardCheck, wash: "teal", overdue: win.overdue, onSelect: () => setDrawerOpen(true) }]
    : [];

  const overlay = (
    <>
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
  return { rows, overlay };
}

/** Legacy loose-card rendering (no longer mounted on the Dash). */
export function DailySpotCheckTask(props: DailySpotCheckTaskProps) {
  const { rows, overlay } = useDailySpotCheckRow(props);
  if (rows.length === 0) return <>{overlay}</>;
  return (
    <>
      <TemporaryTaskCard id="daily-spot-check" title="Daily Spot Check" icon={ClipboardCheck} accentColor={TEAL_COLOR} variant="system" onAction={rows[0].onSelect} />
      {overlay}
    </>
  );
}
