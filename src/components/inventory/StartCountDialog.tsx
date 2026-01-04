import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { CalendarDays, Calendar, CalendarRange, Loader2, Check } from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, addDays, subDays } from "date-fns";
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

const StartCountDialog = ({
  open,
  onOpenChange,
  locationId,
  onStartCount,
  isPending,
}: StartCountDialogProps) => {
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

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

  // Generate period options based on schedule settings
  const periodOptions = useMemo(() => {
    const options: PeriodOption[] = [];
    const today = new Date();

    // Check if a period has already been counted
    const isPeriodCounted = (type: string, endDate: string) => {
      return existingCounts?.some(
        (c) => c.period_type === type && c.period_end_date === endDate && c.status === "completed"
      );
    };

    // Weekly periods (current week and last week)
    const weeklySetting = scheduleSettings?.find((s) => s.frequency === "weekly");
    if (weeklySetting) {
      const dayOfWeek = weeklySetting.day_of_week ?? 0; // Default Sunday
      
      // Current week ending
      const weekEnd = endOfWeek(today, { weekStartsOn: dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6 });
      const weekEndStr = format(weekEnd, "yyyy-MM-dd");
      
      if (!isPeriodCounted("weekly", weekEndStr)) {
        options.push({
          id: `weekly-current`,
          type: "weekly",
          label: `Week Ending ${format(weekEnd, "MMM d")}`,
          description: `${format(startOfWeek(today, { weekStartsOn: dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6 }), "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`,
          periodEndDate: weekEndStr,
          icon: <CalendarDays className="h-5 w-5" />,
          isConfigured: true,
        });
      }

      // Previous week ending
      const prevWeekEnd = subDays(weekEnd, 7);
      const prevWeekEndStr = format(prevWeekEnd, "yyyy-MM-dd");
      
      if (!isPeriodCounted("weekly", prevWeekEndStr)) {
        options.push({
          id: `weekly-prev`,
          type: "weekly",
          label: `Week Ending ${format(prevWeekEnd, "MMM d")}`,
          description: `${format(subDays(prevWeekEnd, 6), "MMM d")} - ${format(prevWeekEnd, "MMM d, yyyy")}`,
          periodEndDate: prevWeekEndStr,
          icon: <CalendarDays className="h-5 w-5" />,
          isConfigured: true,
        });
      }
    }

    // Monthly periods (current month and last month)
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

      // Previous month
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

    // Yearly period (current year)
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

  const handleStart = () => {
    const selected = periodOptions.find((p) => p.id === selectedPeriod);
    if (selected) {
      onStartCount(
        selected.type === "adhoc" ? null : selected.type,
        selected.periodEndDate
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Inventory Count</DialogTitle>
          <DialogDescription>
            Select the period you're counting for
          </DialogDescription>
        </DialogHeader>

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
              disabled={!selectedPeriod || isPending}
              onClick={handleStart}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Start Count
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StartCountDialog;
