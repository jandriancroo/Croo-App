import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useInventoryPeriodSettings } from "@/hooks/useInventoryPeriodSettings";

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

type FrequencyType = "weekly" | "monthly";

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
};

const InventoryScheduleSettings = ({ locationId }: InventoryScheduleSettingsProps) => {
  const queryClient = useQueryClient();
  const [savingFrequency, setSavingFrequency] = useState<FrequencyType | null>(null);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const { config: periodConfig } = useInventoryPeriodSettings(locationId);

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

  const updatePeriodSetting = useMutation({
    mutationFn: async (updates: { inventory_period_end_day?: number; inventory_period_cutoff?: string }) => {
      const { error } = await supabase
        .from("location_settings")
        .update(updates)
        .eq("location_id", locationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-period-settings", locationId] });
      toast.success("Period setting saved");
    },
    onError: () => toast.error("Failed to save period setting"),
    onSettled: () => setSavingPeriod(false),
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

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Calendar className="h-4 w-4" />
          Count Schedule
        </div>
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
            <div className="flex flex-col">
              <span className="text-sm font-medium">Monthly</span>
              {monthlySetting.is_active && (
                <span className="text-[10px] text-muted-foreground leading-tight">Last day of month</span>
              )}
            </div>
            {savingFrequency === "monthly" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/50" />

        {/* Period End Settings */}
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Settings2 className="h-4 w-4" />
          Period Closing
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Week ends on</span>
          <div className="flex items-center gap-2">
            {savingPeriod && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <Select
              value={periodConfig.periodEndDay.toString()}
              onValueChange={(v) => {
                setSavingPeriod(true);
                updatePeriodSetting.mutate({ inventory_period_end_day: parseInt(v) });
              }}
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
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Period closes</span>
          <div className="flex items-center gap-2">
            {savingPeriod && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <Select
              value={periodConfig.periodCutoff}
              onValueChange={(v) => {
                setSavingPeriod(true);
                updatePeriodSetting.mutate({ inventory_period_cutoff: v });
              }}
            >
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="after_close">After Close</SelectItem>
                <SelectItem value="before_open">Before Open</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground leading-tight">
          {periodConfig.periodCutoff === "after_close"
            ? `${DAYS_OF_WEEK.find(d => d.value === periodConfig.periodEndDay)?.label}'s sales are included in the ending period.`
            : `${DAYS_OF_WEEK.find(d => d.value === periodConfig.periodEndDay)?.label}'s sales start the next period.`}
        </p>
      </CardContent>
    </Card>
  );
};

export default InventoryScheduleSettings;
