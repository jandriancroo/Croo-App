import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, DollarSign, LucideIcon } from "lucide-react";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useUserRole } from "@/hooks/useUserRole";
import { formatInTimeZone } from "date-fns-tz";
import { TemporaryTaskCard } from "./TemporaryTaskCard";

interface CashHandlingTasksProps {
  locationHours: { hours_open: string | null; hours_close: string | null } | null;
  timezone?: string;
}

const TEAL_COLOR = "#14b8a6";

export function CashHandlingTasks({ locationHours, timezone = "America/Los_Angeles" }: CashHandlingTasksProps) {
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
  
  if (!canAccessCashHandling || !locationHours) return null;
  
  const safeCountCategory = categories?.find(c => c.name.toLowerCase().includes("safe count"));
  const drawerCountCategory = categories?.find(c => c.name.toLowerCase().includes("drawer count"));
  
  // Check submissions
  const safeCountEntries = todaysEntries?.filter(e => e.category_id === safeCountCategory?.id) || [];
  const drawerCountEntries = todaysEntries?.filter(e => e.category_id === drawerCountCategory?.id) || [];
  
  // Determine AM/PM safe counts by checking the value_text for shift indicator
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
  
  // Parse business hours
  const parseTime = (timeStr: string | null): number | null => {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
  };
  
  const openMinutes = parseTime(locationHours.hours_open);
  const closeMinutes = parseTime(locationHours.hours_close);
  
  // Get current time in location timezone
  const now = new Date();
  const currentTimeInTz = formatInTimeZone(now, timezone, "HH:mm");
  const [currentHours, currentMins] = currentTimeInTz.split(":").map(Number);
  const currentMinutes = currentHours * 60 + currentMins;
  
  // Visibility logic
  const amWindowStart = openMinutes !== null ? openMinutes - 120 : null;
  const amWindowEnd = openMinutes !== null ? openMinutes + 120 : null;
  const showAmSafeCount = !amSafeCountSubmitted && 
    amWindowStart !== null && 
    amWindowEnd !== null && 
    currentMinutes >= amWindowStart && 
    currentMinutes <= amWindowEnd;
  
  const pmWindowStart = closeMinutes;
  const pmWindowEnd = closeMinutes !== null ? closeMinutes + 120 : null;
  const showPmSafeCount = !pmSafeCountSubmitted && 
    pmWindowStart !== null && 
    pmWindowEnd !== null && 
    currentMinutes >= pmWindowStart && 
    currentMinutes <= pmWindowEnd;
  
  const showDeposit = !depositSubmitted && 
    pmWindowStart !== null && 
    pmWindowEnd !== null && 
    currentMinutes >= pmWindowStart && 
    currentMinutes <= pmWindowEnd;
  
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
  
  const tasks: { id: string; show: boolean; title: string; icon: LucideIcon; onClick: () => void }[] = [
    {
      id: "am-safe",
      show: showAmSafeCount,
      title: "AM Safe Count",
      icon: ShieldCheck,
      onClick: () => handleNavigate("safe", "AM"),
    },
    {
      id: "pm-safe",
      show: showPmSafeCount,
      title: "PM Safe Count",
      icon: ShieldCheck,
      onClick: () => handleNavigate("safe", "PM"),
    },
    {
      id: "drawer-count",
      show: showDeposit,
      title: "Drawer Count",
      icon: DollarSign,
      onClick: () => handleNavigate("drawer"),
    },
  ].filter(t => t.show);
  
  if (tasks.length === 0) return null;
  
  return (
    <>
      {tasks.map(task => {
        const Icon = task.icon;
        return (
          <div
            key={task.id}
            onClick={task.onClick}
            className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 pl-3 pr-1.5 py-1 cursor-pointer active:bg-muted transition-colors"
            style={{ borderLeftColor: TEAL_COLOR, borderLeftWidth: 3, minWidth: 'calc(50% - 3px)', flexGrow: 1 }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: TEAL_COLOR }} />
            <span className="text-xs font-medium truncate flex-1">{task.title}</span>
            <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center shrink-0">
              <Check className="h-3 w-3 text-primary-foreground" />
            </div>
          </div>
        );
      })}
    </>
  );
}
