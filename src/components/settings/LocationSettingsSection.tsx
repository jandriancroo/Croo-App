import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
];

const DAYS_OF_WEEK = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

interface DayHours {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

interface LocationSettingsSectionProps {
  locationId?: string;
}

export const LocationSettingsSection = ({ locationId }: LocationSettingsSectionProps) => {
  const { currentLocation } = useLocation();
  const effectiveLocationId = locationId || currentLocation?.id;
  const { toast } = useToast();
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [blackoutDates, setBlackoutDates] = useState<Date[]>([]);
  
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [businessHours, setBusinessHours] = useState<DayHours[]>(
    DAYS_OF_WEEK.map(day => ({
      day_of_week: day.value,
      open_time: "11:00",
      close_time: "22:00",
      is_closed: false,
    }))
  );

  useEffect(() => {
    fetchLocationSettings();
    fetchBusinessHours();
  }, [effectiveLocationId]);

  const fetchLocationSettings = async () => {
    if (!effectiveLocationId) return;

    try {
      const { data, error } = await supabase
        .from("location_settings")
        .select("*")
        .eq("location_id", effectiveLocationId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setTimezone(data.timezone || "America/Los_Angeles");
        setBlackoutDates(
          data.blackout_dates ? data.blackout_dates.map((d: string) => new Date(d)) : []
        );
      } else {
        setSettingsId(null);
        setTimezone("America/Los_Angeles");
        setBlackoutDates([]);
      }
    } catch (error) {
      console.error("Error fetching location settings:", error);
    }
  };

  const fetchBusinessHours = async () => {
    if (!effectiveLocationId) return;

    try {
      const { data, error } = await supabase
        .from("location_hours")
        .select("*")
        .eq("location_id", effectiveLocationId)
        .order("day_of_week");

      if (error) throw error;

      if (data && data.length > 0) {
        setBusinessHours(
          DAYS_OF_WEEK.map(day => {
            const existing = data.find(d => d.day_of_week === day.value);
            return existing
              ? {
                  day_of_week: existing.day_of_week,
                  open_time: existing.open_time || "11:00",
                  close_time: existing.close_time || "22:00",
                  is_closed: existing.is_closed,
                }
              : {
                  day_of_week: day.value,
                  open_time: "11:00",
                  close_time: "22:00",
                  is_closed: false,
                };
          })
        );
      }
    } catch (error) {
      console.error("Error fetching business hours:", error);
    }
  };

  const updateDayHours = (dayOfWeek: number, field: keyof DayHours, value: string | boolean) => {
    setBusinessHours(prev =>
      prev.map(day =>
        day.day_of_week === dayOfWeek ? { ...day, [field]: value } : day
      )
    );
  };

  const handleSave = async () => {
    if (!effectiveLocationId) {
      toast({
        title: "Error",
        description: "No location selected",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);

    try {
      // Save general settings
      const settingsData = {
        timezone: timezone,
        blackout_dates: blackoutDates.map(d => format(d, "yyyy-MM-dd")),
      };

      if (settingsId) {
        const { error } = await supabase
          .from("location_settings")
          .update({
            ...settingsData,
            updated_at: new Date().toISOString(),
          })
          .eq("location_id", effectiveLocationId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("location_settings")
          .insert({
            location_id: effectiveLocationId,
            ...settingsData,
          })
          .select()
          .single();

        if (error) throw error;
        setSettingsId(data.id);
      }

      // Save business hours (upsert each day)
      for (const dayHours of businessHours) {
        const { error } = await supabase
          .from("location_hours")
          .upsert({
            location_id: effectiveLocationId,
            day_of_week: dayHours.day_of_week,
            open_time: dayHours.is_closed ? null : dayHours.open_time,
            close_time: dayHours.is_closed ? null : dayHours.close_time,
            is_closed: dayHours.is_closed,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'location_id,day_of_week',
          });

        if (error) throw error;
      }

      toast({
        title: "Success",
        description: "Location settings saved successfully.",
      });
    } catch (error) {
      console.error("Error saving location settings:", error);
      toast({
        title: "Error",
        description: "Failed to save location settings.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addBlackoutDate = (date: Date | undefined) => {
    if (!date) return;
    
    const exists = blackoutDates.some(
      d => format(d, "yyyy-MM-dd") === format(date, "yyyy-MM-dd")
    );
    
    if (!exists) {
      setBlackoutDates([...blackoutDates, date]);
    }
  };

  const removeBlackoutDate = (dateToRemove: Date) => {
    setBlackoutDates(
      blackoutDates.filter(
        d => format(d, "yyyy-MM-dd") !== format(dateToRemove, "yyyy-MM-dd")
      )
    );
  };

  if (!effectiveLocationId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Location Settings</CardTitle>
        <CardDescription>
          Configure operational hours and blackout dates
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Business Hours */}
        <div className="space-y-3">
          <Label>Business Hours</Label>
          <p className="text-sm text-muted-foreground">
            Set opening and closing times for each day of the week
          </p>
          <div className="space-y-2">
            {DAYS_OF_WEEK.map((day) => {
              const dayHours = businessHours.find(d => d.day_of_week === day.value);
              return (
                <div key={day.value} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                  <span className="w-9 shrink-0 text-sm font-medium">{day.short}</span>
                  <Switch
                    checked={!dayHours?.is_closed}
                    onCheckedChange={(checked) => updateDayHours(day.value, 'is_closed', !checked)}
                  />
                  {dayHours?.is_closed ? (
                    <span className="text-xs text-muted-foreground">Closed</span>
                  ) : (
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      <Input
                        type="time"
                        value={dayHours?.open_time || "11:00"}
                        onChange={(e) => updateDayHours(day.value, 'open_time', e.target.value)}
                        className="flex-1 min-w-0 h-8 text-sm"
                      />
                      <span className="text-muted-foreground text-xs shrink-0">-</span>
                      <Input
                        type="time"
                        value={dayHours?.close_time || "22:00"}
                        onChange={(e) => updateDayHours(day.value, 'close_time', e.target.value)}
                        className="flex-1 min-w-0 h-8 text-sm"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Blackout Dates</Label>
          <p className="text-sm text-muted-foreground">
            Days when employees should not request time off (holidays, busy periods, etc.)
          </p>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                Add Blackout Date
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                onSelect={addBlackoutDate}
              />
            </PopoverContent>
          </Popover>

          {blackoutDates.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {blackoutDates
                .sort((a, b) => a.getTime() - b.getTime())
                .map((date, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1 bg-destructive/10 text-destructive px-3 py-1 rounded-md"
                  >
                    <span className="text-sm">{format(date, "MMM d, yyyy")}</span>
                    <button
                      onClick={() => removeBlackoutDate(date)}
                      className="hover:bg-destructive/20 rounded-sm p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>


        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};
