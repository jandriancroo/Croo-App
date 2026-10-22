import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, DollarSign, LucideIcon } from "lucide-react";
import { TemporaryTaskCard } from "./TemporaryTaskCard";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useUserRole } from "@/hooks/useUserRole";
import { formatInTimeZone } from "date-fns-tz";
import { cashTaskWindows, parseHHMM, type QuickExtraRow } from "@/lib/quickTasks/extraRows";

interface CashHandlingTasksProps {
  locationHours: { hours_open: string | null; hours_close: string | null } | null;
  timezone?: string;
}

const TEAL_COLOR = "#14b8a6";

export function useCashHandlingRows({ locationHours, timezone = "America/Los_Angeles" }: CashHandlingTasksProps): QuickExtraRow[] {
  const navigate = useNavigate();
  const { currentLocation } = useAppLocation();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  
  // Only show to shift_manager and above
  const canAccessCashHandling = isShiftManager || isGeneralManager || isManager || isAdmin;
  
  // Get today's date string in location timezone
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  
  // Fetch logbook categories to get Safe Count and Drawer Count IDs
  const { data: categories } = useQuery({
    queryKey: ["logbook-categories-cash", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from("logbook_categories")
        .select("id, name")
        .eq("location_id", currentLocation.id)
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation && canAccessCashHandling,
    staleTime: 5 * 60 * 1000,
  });
  
  // Fetch today's logbook entries to check what's been submitted
  const { data: todaysEntries } = useQuery({
    queryKey: ["logbook-entries-today", currentLocation?.id, today],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from("logbook_entries")
        .select(`
          id,
          category_id,
          logbook_entry_values(field_id, value_text)
        `)
        .eq("location_id", currentLocation.id)
        .eq("entry_date", today);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation && canAccessCashHandling,
    staleTime: 15 * 1000,
    refetchInterval: 30000,
  });
  
  if (!canAccessCashHandling || !locationHours) return [];
  
  const safeCountCategory = categories?.find(c => c.name.toLowerCase().includes("safe count"));
  const drawerCountCategory = categories?.find(c => c.name.toLowerCase().includes("drawer count"));
  const safeCountEntries = todaysEntries?.filter(e => e.category_id === safeCountCategory?.id) || [];
  const drawerCountEntries = todaysEntries?.filter(e => e.category_id === drawerCountCategory?.id) || [];
  const amSafeCountSubmitted = safeCountEntries.some(entry => 
    entry.logbook_entry_values?.some((v: any) => 
      v.value_text?.toLowerCase().includes('"shift":"am"') || 
      v.value_text?.includes('"shift":"AM"')
    )
  );
  const pmSafeCountSubmitted = safeCountEntries.some(entry => 
    entry.logbook_entry_values?.some((v: any) => 
      v.value_text?.toLowerCase().includes('"shift":"pm"') || 
      v.value_text?.includes('"shift":"PM"')
    )
  );
  const depositSubmitted = drawerCountEntries.length > 0;
  const currentTimeInTz = formatInTimeZone(new Date(), timezone, "HH:mm");
  const [currentHours, currentMins] = currentTimeInTz.split(":").map(Number);
  const w = cashTaskWindows({
    openMin: parseHHMM(locationHours.hours_open),
    closeMin: parseHHMM(locationHours.hours_close),
    nowMin: currentHours * 60 + currentMins,
    amSubmitted: amSafeCountSubmitted,
    pmSubmitted: pmSafeCountSubmitted,
    depositSubmitted,
  });
  const showAmSafeCount = w.showAm, showPmSafeCount = w.showPm, showDeposit = w.showDeposit;
  
  const handleNavigate = (categoryName: string, shift?: string) => {
    const params = new URLSearchParams();
    if (categoryName === "safe") {
      params.set("category", "Safe Count");
      if (shift) params.set("shift", shift);
    } else {
      params.set("category", "Drawer Count");
    }
    navigate(`/logbook?${params.toString()}`);
  };
  
  const tasks: { id: string; show: boolean; title: string; icon: LucideIcon; overdue: boolean; onClick: () => void }[] = [
    {
      id: "am-safe",
      show: showAmSafeCount,
      title: "AM Safe Count",
      icon: ShieldCheck,
      overdue: w.amOverdue,
      onClick: () => handleNavigate("safe", "AM"),
    },
    {
      id: "pm-safe",
      show: showPmSafeCount,
      title: "PM Safe Count",
      icon: ShieldCheck,
      overdue: w.pmOverdue,
      onClick: () => handleNavigate("safe", "PM"),
    },
    {
      id: "drawer-count",
      show: showDeposit,
      title: "Drawer Count",
      icon: DollarSign,
      overdue: w.pmOverdue,
      onClick: () => handleNavigate("drawer"),
    },
  ].filter(t => t.show);
  
  return tasks.map(t => ({ key: `cash-${t.id}`, title: t.title, icon: t.icon, wash: "teal" as const, overdue: t.overdue, onSelect: t.onClick }));
}

/** Legacy loose-card rendering (no longer mounted on the Dash). */
export function CashHandlingTasks(props: CashHandlingTasksProps) {
  const rows = useCashHandlingRows(props);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rows.map(r => (
        <TemporaryTaskCard key={r.key} id={r.key} title={r.title} icon={r.icon} accentColor={TEAL_COLOR} variant="system" onAction={r.onSelect} />
      ))}
    </div>
  );
}
