import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Vault, Banknote } from "lucide-react";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useUserRole } from "@/hooks/useUserRole";
import { format } from "date-fns";

interface CashHandlingTasksProps {
  locationHours: { hours_open: string | null; hours_close: string | null } | null;
}

export function CashHandlingTasks({ locationHours }: CashHandlingTasksProps) {
  const navigate = useNavigate();
  const { currentLocation } = useAppLocation();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  
  // Only show to shift_manager and above
  const canAccessCashHandling = isShiftManager || isGeneralManager || isManager || isAdmin;
  
  // Get today's date string
  const today = format(new Date(), "yyyy-MM-dd");
  
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
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
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
      icon: Banknote,
      onClick: () => handleNavigate("drawer"),
    },
  ].filter(t => t.show);
  
  if (tasks.length === 0) return null;
  
  return (
    <>
      {tasks.map(task => (
        <Card 
          key={task.id}
          className="hover:shadow-lg transition-shadow overflow-hidden p-0 flex flex-col border-teal-500/30 bg-teal-500/5"
        >
          <CardHeader className="py-2 px-3">
            <div className="flex items-center gap-2">
              <task.icon className="h-5 w-5 text-teal-500 flex-shrink-0" />
              <CardTitle className="text-base font-semibold flex-1 truncate">{task.title}</CardTitle>
              <Badge className="text-xs px-2 py-0.5 flex-shrink-0 bg-teal-500 text-white">
                action
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="py-2 px-3 pt-0 flex-1">
            <p className="text-sm text-muted-foreground">Required task</p>
          </CardContent>
          <Button 
            className="w-full h-10 text-sm rounded-none rounded-b-lg mt-auto bg-teal-500 hover:bg-teal-600 text-white"
            onClick={task.onClick}
          >
            Complete
          </Button>
        </Card>
      ))}
    </>
  );
}
