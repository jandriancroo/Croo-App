import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Loader2, Settings2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { useInventoryPeriodSettings } from "@/hooks/useInventoryPeriodSettings";

interface InventoryScheduleSettingsProps {
  locationId: string;
}

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

interface ScheduleRow {
  id: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  is_active: boolean;
}

const InventoryScheduleSettings = ({ locationId }: InventoryScheduleSettingsProps) => {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const { config: periodConfig } = useInventoryPeriodSettings(locationId);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["inventory-schedule-settings", locationId],
    queryFn: async (): Promise<ScheduleRow[]> => {
      const { data, error } = await supabase
        .from("inventory_schedule_settings")
        .select("*")
        .eq("location_id", locationId);
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["inventory-schedule-settings", locationId] });

  const weeklyRows = (rows || [])
    .filter((r) => r.frequency === "weekly" && r.is_active)
    .sort((a, b) => (a.day_of_week ?? 0) - (b.day_of_week ?? 0));
  const monthlyRow = (rows || []).find((r) => r.frequency === "monthly");
  const enabledDays = new Set(weeklyRows.map((r) => r.day_of_week));
  const availableDays = DAYS_OF_WEEK.filter((d) => !enabledDays.has(d.value));

  const addWeeklyDay = useMutation({
    mutationFn: async (day: number) => {
      const { error } = await supabase.from("inventory_schedule_settings").insert({
        location_id: locationId,
        frequency: "weekly",
        day_of_week: day,
        day_of_month: null,
        month_of_year: null,
        is_active: true,
      } as any);
      if (error) throw error;
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => {
      invalidate();
      toast.success("Count day added");
    },
    onError: () => toast.error("Couldn't add day"),
  });

  const removeWeeklyDay = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_schedule_settings").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => {
      invalidate();
      toast.success("Count day removed");
    },
    onError: () => toast.error("Couldn't remove day"),
  });

  const toggleMonthly = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (monthlyRow) {
        const { error } = await supabase
          .from("inventory_schedule_settings")
          .update({ is_active: enabled })
          .eq("id", monthlyRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory_schedule_settings").insert({
          location_id: locationId,
          frequency: "monthly",
          day_of_week: null,
          day_of_month: 1,
          month_of_year: null,
          is_active: enabled,
        } as any);
        if (error) throw error;
      }
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: () => {
      invalidate();
      toast.success("Schedule saved");
    },
    onError: () => toast.error("Couldn't save"),
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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Calendar className="h-4 w-4" />
          Count Schedule
          {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
        </div>

        {/* Weekly — multi-day */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Weekly count days</div>
          {weeklyRows.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">No weekly count days scheduled.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {weeklyRows.map((r) => {
                const day = DAYS_OF_WEEK.find((d) => d.value === r.day_of_week);
                return (
                  <Badge key={r.id} variant="secondary" className="pl-2 pr-1 py-0.5 gap-1 text-xs">
                    {day?.label}
                    <button
                      onClick={() => removeWeeklyDay.mutate(r.id)}
                      className="hover:bg-muted rounded p-0.5 -mr-0.5"
                      aria-label={`Remove ${day?.label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
          {availableDays.length > 0 && (
            <Select
              value=""
              onValueChange={(v) => addWeeklyDay.mutate(parseInt(v))}
            >
              <SelectTrigger className="w-full h-8 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Plus className="h-3 w-3" />
                  <SelectValue placeholder="Add count day" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {availableDays.map((day) => (
                  <SelectItem key={day.value} value={day.value.toString()}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Monthly */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Switch
              checked={!!monthlyRow?.is_active}
              disabled={toggleMonthly.isPending}
              onCheckedChange={(v) => toggleMonthly.mutate(v)}
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium">Monthly</span>
              {monthlyRow?.is_active && (
                <span className="text-[10px] text-muted-foreground leading-tight">
                  Last day of month
                </span>
              )}
            </div>
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
            ? `${DAYS_OF_WEEK.find((d) => d.value === periodConfig.periodEndDay)?.label}'s sales are included in the ending period.`
            : `${DAYS_OF_WEEK.find((d) => d.value === periodConfig.periodEndDay)?.label}'s sales start the next period.`}
        </p>
      </CardContent>
    </Card>
  );
};

export default InventoryScheduleSettings;
