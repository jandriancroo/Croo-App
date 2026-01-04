import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Vault, CircleDollarSign, Building2 } from "lucide-react";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useUserRole } from "@/hooks/useUserRole";
import { format, subDays } from "date-fns";
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
    refetchInterval: 30000, // Refresh every 30 seconds
  });
  
  // Fetch count of undeposited drawer counts (for bank deposit task)
  const { data: undepositedCount = 0 } = useQuery({
    queryKey: ["undeposited-drawer-counts", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return 0;
      
      // Get drawer count category
      const drawerCategory = categories?.find(c => c.name.toLowerCase().includes("drawer count"));
      if (!drawerCategory) return 0;
      
      // Get bank deposit category
      const bankDepositCategory = categories?.find(c => c.name.toLowerCase().includes("bank deposit"));
      
      // Get all drawer count entries from last 30 days
      const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");
      
      const { data: drawerEntries, error: entriesError } = await supabase
        .from("logbook_entries")
        .select("id, entry_date")
        .eq("location_id", currentLocation.id)
        .eq("category_id", drawerCategory.id)
        .gte("entry_date", thirtyDaysAgo);
      
      if (entriesError) throw entriesError;
      
      if (!drawerEntries || drawerEntries.length === 0) return 0;
      
      // Get bank deposit entries to find which drawer entries have been deposited
      if (!bankDepositCategory) {
        // No bank deposit category exists yet, all drawer entries are undeposited
        return drawerEntries.length;
      }
      
      const { data: bankDepositEntries, error: depositError } = await supabase
        .from("logbook_entries")
        .select("id, logbook_entry_values(value_text)")
        .eq("location_id", currentLocation.id)
        .eq("category_id", bankDepositCategory.id);
      
      if (depositError) throw depositError;
      
      // Parse bank deposit entries to find deposited entry IDs
      const depositedIds = new Set<string>();
      bankDepositEntries?.forEach(entry => {
        entry.logbook_entry_values?.forEach((val: any) => {
          try {
            const data = JSON.parse(val.value_text || "{}");
            if (data.entries && Array.isArray(data.entries)) {
              data.entries.forEach((e: any) => {
                if (e.entryId) depositedIds.add(e.entryId);
              });
            }
          } catch {
            // Not JSON, skip
          }
        });
      });
      
      const undeposited = drawerEntries.filter(e => !depositedIds.has(e.id));
      
      return undeposited.length;
    },
    enabled: !!currentLocation && canAccessCashHandling && !!categories?.length,
    refetchInterval: 60000, // Refresh every minute
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
  // AM Safe Count: 2 hours before open to 2 hours after open (or until submitted)
  const amWindowStart = openMinutes !== null ? openMinutes - 120 : null;
  const amWindowEnd = openMinutes !== null ? openMinutes + 120 : null;
  const showAmSafeCount = !amSafeCountSubmitted && 
    amWindowStart !== null && 
    amWindowEnd !== null && 
    currentMinutes >= amWindowStart && 
    currentMinutes <= amWindowEnd;
  
  // PM Safe Count: At close to 2 hours after close (or until submitted)
  const pmWindowStart = closeMinutes;
  const pmWindowEnd = closeMinutes !== null ? closeMinutes + 120 : null;
  const showPmSafeCount = !pmSafeCountSubmitted && 
    pmWindowStart !== null && 
    pmWindowEnd !== null && 
    currentMinutes >= pmWindowStart && 
    currentMinutes <= pmWindowEnd;
  
  // Deposit: At close to 2 hours after close (or until submitted)
  const showDeposit = !depositSubmitted && 
    pmWindowStart !== null && 
    pmWindowEnd !== null && 
    currentMinutes >= pmWindowStart && 
    currentMinutes <= pmWindowEnd;
  
  // Bank Deposit: Show if there are 3+ undeposited drawer counts
  const showBankDeposit = undepositedCount >= 3;
  
  const handleNavigate = (categoryName: string, shift?: string) => {
    const params = new URLSearchParams();
    if (categoryName === "safe") {
      params.set("category", "Safe Count");
      if (shift) params.set("shift", shift);
    } else if (categoryName === "bank-deposit") {
      // Navigate to logbook and trigger bank deposit form
      navigate("/logbook");
      // Use a small delay to let the page load, then trigger the sheet
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('open-bank-deposit'));
      }, 100);
      return;
    } else {
      params.set("category", "Drawer Count");
    }
    navigate(`/logbook?${params.toString()}`);
  };
  
  const tasks = [
    {
      id: "am-safe",
      show: showAmSafeCount,
      title: "AM Safe Count",
      icon: Vault,
      onClick: () => handleNavigate("safe", "AM"),
    },
    {
      id: "pm-safe",
      show: showPmSafeCount,
      title: "PM Safe Count",
      icon: Vault,
      onClick: () => handleNavigate("safe", "PM"),
    },
    {
      id: "deposit",
      show: showDeposit,
      title: "Deposit",
      icon: CircleDollarSign,
      onClick: () => handleNavigate("drawer"),
    },
    {
      id: "bank-deposit",
      show: showBankDeposit,
      title: `Bank Run (${undepositedCount} days)`,
      icon: Building2,
      onClick: () => handleNavigate("bank-deposit"),
    },
  ].filter(t => t.show);
  
  if (tasks.length === 0) return null;
  
  return (
    <>
      {tasks.map(task => (
        <TemporaryTaskCard
          key={task.id}
          id={task.id}
          title={task.title}
          icon={task.icon}
          accentColor={TEAL_COLOR}
          onAction={task.onClick}
          iconStyle="minimal"
        />
      ))}
    </>
  );
}
