import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

interface LocationSettingsSectionProps {
  locationId?: string;
}

export const LocationSettingsSection = ({ locationId }: LocationSettingsSectionProps) => {
  const { currentLocation } = useLocation();
  const effectiveLocationId = locationId || currentLocation?.id;
  const { toast } = useToast();
  const [hoursOpen, setHoursOpen] = useState("");
  const [hoursClose, setHoursClose] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [blackoutDates, setBlackoutDates] = useState<Date[]>([]);
  const [safeTarget, setSafeTarget] = useState<number>(300);
  const [drawerBank, setDrawerBank] = useState<number>(200);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchLocationSettings();
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
        setHoursOpen(data.hours_open || "");
        setHoursClose(data.hours_close || "");
        setTimezone(data.timezone || "America/Los_Angeles");
        setBlackoutDates(
          data.blackout_dates ? data.blackout_dates.map((d: string) => new Date(d)) : []
        );
        setSafeTarget(data.safe_target ?? 300);
        setDrawerBank(data.drawer_bank ?? 200);
      } else {
        setSettingsId(null);
        setHoursOpen("");
        setHoursClose("");
        setTimezone("America/Los_Angeles");
        setBlackoutDates([]);
        setSafeTarget(300);
        setDrawerBank(200);
      }
    } catch (error) {
      console.error("Error fetching location settings:", error);
    }
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
      const settingsData = {
        hours_open: hoursOpen || null,
        hours_close: hoursClose || null,
        timezone: timezone,
        blackout_dates: blackoutDates.map(d => format(d, "yyyy-MM-dd")),
        safe_target: safeTarget,
        drawer_bank: drawerBank,
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
          Configure operational hours and blackout dates for time-off requests
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger>
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Used for all time-based alerts and notifications
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="hours-open">Opening Time</Label>
            <Input
              id="hours-open"
              type="time"
              value={hoursOpen}
              onChange={(e) => setHoursOpen(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hours-close">Closing Time</Label>
            <Input
              id="hours-close"
              type="time"
              value={hoursClose}
              onChange={(e) => setHoursClose(e.target.value)}
            />
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

        {/* Cash Handling Settings */}
        <div className="space-y-4 pt-4 border-t">
          <div>
            <Label className="text-base font-medium">Cash Handling</Label>
            <p className="text-sm text-muted-foreground">
              Configure safe and drawer count targets for this location
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="safe-target">Safe Target ($)</Label>
              <Input
                id="safe-target"
                type="number"
                min="0"
                step="50"
                value={safeTarget}
                onChange={(e) => setSafeTarget(parseFloat(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Amount to keep in safe after balancing
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="drawer-bank">Drawer Bank ($)</Label>
              <Input
                id="drawer-bank"
                type="number"
                min="0"
                step="50"
                value={drawerBank}
                onChange={(e) => setDrawerBank(parseFloat(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                Starting drawer amount to keep after deposit
              </p>
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};
