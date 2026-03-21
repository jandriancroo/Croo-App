import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2 } from "lucide-react";
import type { WeeklyAvailability, DayAvailability } from "./SchedulingPreferencesSection";
import { getDisplayName } from "@/utils/displayName";

interface Employee {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
  min_weekly_hours: number | null;
  max_weekly_hours: number | null;
  weekly_availability: WeeklyAvailability | null;
}

interface EmployeePreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
  onSave: (
    employeeId: string,
    minHours: number | null,
    maxHours: number | null,
    availability: WeeklyAvailability
  ) => Promise<void>;
}

const DAYS = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
] as const;

const DEFAULT_AVAILABILITY: WeeklyAvailability = {
  monday: { available: true },
  tuesday: { available: true },
  wednesday: { available: true },
  thursday: { available: true },
  friday: { available: true },
  saturday: { available: true },
  sunday: { available: true },
};

export function EmployeePreferencesDialog({
  open,
  onOpenChange,
  employee,
  onSave,
}: EmployeePreferencesDialogProps) {
  const [minHours, setMinHours] = useState<string>("");
  const [maxHours, setMaxHours] = useState<string>("");
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);
  const [saving, setSaving] = useState(false);

  // Reset form when employee changes
  useEffect(() => {
    if (employee) {
      setMinHours(employee.min_weekly_hours?.toString() ?? "");
      setMaxHours(employee.max_weekly_hours?.toString() ?? "");
      setAvailability(employee.weekly_availability ?? DEFAULT_AVAILABILITY);
    }
  }, [employee]);

  const handleDayToggle = (day: keyof WeeklyAvailability) => {
    setAvailability((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        available: !prev[day].available,
        // Clear times when turning off
        ...(prev[day].available ? { start: undefined, end: undefined } : {}),
      },
    }));
  };

  const handleTimeChange = (
    day: keyof WeeklyAvailability,
    field: "start" | "end",
    value: string
  ) => {
    setAvailability((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value || undefined,
      },
    }));
  };

  const handleSave = async () => {
    if (!employee) return;
    
    setSaving(true);
    try {
      await onSave(
        employee.id,
        minHours ? parseFloat(minHours) : null,
        maxHours ? parseFloat(maxHours) : null,
        availability
      );
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (!employee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={employee.profile_photo_url || undefined} />
              <AvatarFallback>{getInitials(getDisplayName(employee.full_name, employee.nickname))}</AvatarFallback>
            </Avatar>
            <DialogTitle>{getDisplayName(employee.full_name, employee.nickname)}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Weekly Hours */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Weekly Hours</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="minHours" className="text-xs text-muted-foreground">
                  Minimum
                </Label>
                <Input
                  id="minHours"
                  type="number"
                  min={0}
                  max={168}
                  step={1}
                  placeholder="—"
                  value={minHours}
                  onChange={(e) => setMinHours(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxHours" className="text-xs text-muted-foreground">
                  Maximum
                </Label>
                <Input
                  id="maxHours"
                  type="number"
                  min={0}
                  max={168}
                  step={1}
                  placeholder="—"
                  value={maxHours}
                  onChange={(e) => setMaxHours(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </div>

          {/* Weekly Availability */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Weekly Availability</Label>
            <p className="text-xs text-muted-foreground">
              Toggle days on/off. Add time windows for partial availability.
            </p>
            <div className="space-y-2">
              {DAYS.map(({ key, label }) => {
                const dayAvail = availability[key];
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      dayAvail.available
                        ? "bg-primary/5 border-primary/20"
                        : "bg-muted/30 border-border"
                    }`}
                  >
                    <Switch
                      checked={dayAvail.available}
                      onCheckedChange={() => handleDayToggle(key)}
                    />
                    <span className={`w-10 font-medium text-sm ${
                      !dayAvail.available ? "text-muted-foreground" : ""
                    }`}>
                      {label}
                    </span>
                    
                    {dayAvail.available && (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="time"
                          value={dayAvail.start ?? ""}
                          onChange={(e) => handleTimeChange(key, "start", e.target.value)}
                          className="h-8 text-xs flex-1"
                          placeholder="Start"
                        />
                        <span className="text-muted-foreground text-xs">to</span>
                        <Input
                          type="time"
                          value={dayAvail.end ?? ""}
                          onChange={(e) => handleTimeChange(key, "end", e.target.value)}
                          className="h-8 text-xs flex-1"
                          placeholder="End"
                        />
                      </div>
                    )}
                    
                    {!dayAvail.available && (
                      <span className="text-xs text-muted-foreground italic">
                        Not available
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
