import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface InventoryScheduleSettingsProps {
  locationId: string;
}

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1}${getOrdinalSuffix(i + 1)}`,
}));

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

type FrequencyType = "weekly" | "monthly" | "yearly";

interface ScheduleSetting {
  id?: string;
  frequency: FrequencyType;
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  is_active: boolean;
}

const DEFAULT_SETTINGS: Record<FrequencyType, ScheduleSetting> = {
  weekly: { frequency: "weekly", day_of_week: 0, day_of_month: null, month_of_year: null, is_active: false },
  monthly: { frequency: "monthly", day_of_week: null, day_of_month: 1, month_of_year: null, is_active: false },
  yearly: { frequency: "yearly", day_of_week: null, day_of_month: 1, month_of_year: 1, is_active: false },
};

const InventoryScheduleSettings = ({ locationId }: InventoryScheduleSettingsProps) => {
  const queryClient = useQueryClient();
  const [savingFrequency, setSavingFrequency] = useState<FrequencyType | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["inventory-schedule-settings", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_schedule_settings")
        .select("*")
        .eq("location_id", locationId);
      
      if (error) throw error;
      return data;
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (setting: ScheduleSetting & { location_id: string }) => {
      const { error } = await supabase
        .from("inventory_schedule_settings")
        .upsert(setting, { onConflict: "location_id,frequency" });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-schedule-settings", locationId] });
      toast.success("Schedule saved");
    },
    onError: () => {
      toast.error("Failed to save schedule");
    },
    onSettled: () => {
      setSavingFrequency(null);
    },
  });

  const getSetting = (frequency: FrequencyType): ScheduleSetting => {
    const found = settings?.find((s) => s.frequency === frequency);
    if (found) {
      return {
        id: found.id,
        frequency: found.frequency as FrequencyType,
        day_of_week: found.day_of_week,
        day_of_month: found.day_of_month,
        month_of_year: found.month_of_year,
        is_active: found.is_active,
      };
    }
    return DEFAULT_SETTINGS[frequency];
  };

  const handleToggle = (frequency: FrequencyType, enabled: boolean) => {
    const current = getSetting(frequency);
    setSavingFrequency(frequency);
    upsertMutation.mutate({
      ...current,
      location_id: locationId,
      is_active: enabled,
    });
  };

  const handleDayChange = (frequency: FrequencyType, field: keyof ScheduleSetting, value: number) => {
    const current = getSetting(frequency);
    setSavingFrequency(frequency);
    upsertMutation.mutate({
      ...current,
      location_id: locationId,
      [field]: value,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const weeklySetting = getSetting("weekly");
  const monthlySetting = getSetting("monthly");
  const yearlySetting = getSetting("yearly");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Count Schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Weekly - compact row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Switch
              checked={weeklySetting.is_active}
              onCheckedChange={(checked) => handleToggle("weekly", checked)}
            />
            <span className="text-sm font-medium">Weekly</span>
            {savingFrequency === "weekly" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          {weeklySetting.is_active && (
            <Select
              value={weeklySetting.day_of_week?.toString() ?? "0"}
              onValueChange={(v) => handleDayChange("weekly", "day_of_week", parseInt(v))}
            >
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_WEEK.map((day) => (
                  <SelectItem key={day.value} value={day.value.toString()}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Monthly - compact row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Switch
              checked={monthlySetting.is_active}
              onCheckedChange={(checked) => handleToggle("monthly", checked)}
            />
            <span className="text-sm font-medium">Monthly</span>
            {savingFrequency === "monthly" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          {monthlySetting.is_active && (
            <Select
              value={monthlySetting.day_of_month?.toString() ?? "1"}
              onValueChange={(v) => handleDayChange("monthly", "day_of_month", parseInt(v))}
            >
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OF_MONTH.map((day) => (
                  <SelectItem key={day.value} value={day.value.toString()}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Yearly - compact row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Switch
              checked={yearlySetting.is_active}
              onCheckedChange={(checked) => handleToggle("yearly", checked)}
            />
            <span className="text-sm font-medium">Yearly</span>
            {savingFrequency === "yearly" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          {yearlySetting.is_active && (
            <div className="flex items-center gap-1.5">
              <Select
                value={yearlySetting.month_of_year?.toString() ?? "1"}
                onValueChange={(v) => handleDayChange("yearly", "month_of_year", parseInt(v))}
              >
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((month) => (
                    <SelectItem key={month.value} value={month.value.toString()}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={yearlySetting.day_of_month?.toString() ?? "1"}
                onValueChange={(v) => handleDayChange("yearly", "day_of_month", parseInt(v))}
              >
                <SelectTrigger className="w-20 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_MONTH.map((day) => (
                    <SelectItem key={day.value} value={day.value.toString()}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default InventoryScheduleSettings;
