import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";

export const LocationSettingsSection = () => {
  const { currentLocation } = useLocation();
  const { toast } = useToast();
  const [hoursOpen, setHoursOpen] = useState("");
  const [hoursClose, setHoursClose] = useState("");
  const [blackoutDates, setBlackoutDates] = useState<Date[]>([]);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentLocation) {
      fetchLocationSettings();
    }
  }, [currentLocation]);

  const fetchLocationSettings = async () => {
    if (!currentLocation) return;

    try {
      const { data, error } = await supabase
        .from("location_settings")
        .select("*")
        .eq("location_id", currentLocation.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setHoursOpen(data.hours_open || "");
        setHoursClose(data.hours_close || "");
        setBlackoutDates(
          data.blackout_dates ? data.blackout_dates.map((d: string) => new Date(d)) : []
        );
      } else {
        // Reset if no settings exist
        setSettingsId(null);
        setHoursOpen("");
        setHoursClose("");
        setBlackoutDates([]);
      }
    } catch (error) {
      console.error("Error fetching location settings:", error);
    }
  };

  const handleSave = async () => {
    if (!currentLocation) return;
    setLoading(true);

    try {
      const settingsData = {
        location_id: currentLocation.id,
        hours_open: hoursOpen || null,
        hours_close: hoursClose || null,
        blackout_dates: blackoutDates.map(d => format(d, "yyyy-MM-dd")),
        updated_at: new Date().toISOString(),
      };

      if (settingsId) {
        // Update existing
        const { error } = await supabase
          .from("location_settings")
          .update(settingsData)
          .eq("id", settingsId);

        if (error) throw error;
      } else {
        // Create new
        const { data, error } = await supabase
          .from("location_settings")
          .insert([settingsData])
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
    
    // Check if date already exists
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

  if (!currentLocation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Location Settings</CardTitle>
          <CardDescription>Please select a location first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Location Settings - {currentLocation.name}</CardTitle>
        <CardDescription>
          Configure hours of operation and blackout dates for time-off requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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

        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};
