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
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  DAY_KEYS,
  DEFAULT_WEEKLY_AVAILABILITY,
  normalizeWeeklyAvailability,
  sanitizeBlocks,
  timeToMinutes,
  type DayKey,
  type UnavailableBlock,
  type WeeklyAvailability,
  type WeeklyHours,
} from "@/types/availability";
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
  /** Store hours, used to migrate legacy "can only work" windows on read. */
  locationHours?: WeeklyHours;
  onSave: (
    employeeId: string,
    minHours: number | null,
    maxHours: number | null,
    availability: WeeklyAvailability
  ) => Promise<void>;
}

const DAY_LABELS: Record<DayKey, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export function EmployeePreferencesDialog({
  open,
  onOpenChange,
  employee,
  locationHours,
  onSave,
}: EmployeePreferencesDialogProps) {
  const [minHours, setMinHours] = useState<string>("");
  const [maxHours, setMaxHours] = useState<string>("");
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_WEEKLY_AVAILABILITY);
  const [saving, setSaving] = useState(false);

  // Reset form when employee changes (migrating legacy shapes on read)
  useEffect(() => {
    if (employee) {
      setMinHours(employee.min_weekly_hours?.toString() ?? "");
      setMaxHours(employee.max_weekly_hours?.toString() ?? "");
      setAvailability(
        normalizeWeeklyAvailability(employee.weekly_availability, locationHours) ??
          DEFAULT_WEEKLY_AVAILABILITY
      );
    }
  }, [employee, locationHours]);

  const dayOf = (day: DayKey) => availability[day] ?? { available: true, blocks: [] };

  const handleDayToggle = (day: DayKey) => {
    const current = dayOf(day);
    setAvailability((prev) => ({
      ...prev,
      [day]: current.available
        ? { available: false, blocks: [] }
        : { available: true, blocks: [] },
    }));
  };

  const setBlocks = (day: DayKey, blocks: UnavailableBlock[]) => {
    setAvailability((prev) => ({
      ...prev,
      [day]: { available: true, blocks },
    }));
  };

  const addBlock = (day: DayKey) => {
    const blocks = [...(dayOf(day).blocks ?? [])];
    blocks.push({ start: "", end: "" });
    setBlocks(day, blocks);
  };

  const removeBlock = (day: DayKey, index: number) => {
    const blocks = [...(dayOf(day).blocks ?? [])];
    blocks.splice(index, 1);
    setBlocks(day, blocks);
  };

  const updateBlock = (
    day: DayKey,
    index: number,
    field: "start" | "end",
    value: string
  ) => {
    const blocks = [...(dayOf(day).blocks ?? [])];
    blocks[index] = { ...blocks[index], [field]: value };
    setBlocks(day, blocks);
  };

  const handleSave = async () => {
    if (!employee) return;

    // Validation: every block needs both times and end after start
    for (const day of DAY_KEYS) {
      const d = dayOf(day);
      if (!d.available) continue;
      for (const b of d.blocks ?? []) {
        if (!b.start || !b.end) {
          toast.error(`${DAY_LABELS[day]}: fill in both times for each unavailable block`);
          return;
        }
        if (timeToMinutes(b.end) <= timeToMinutes(b.start)) {
          toast.error(`${DAY_LABELS[day]}: end time must be after start time`);
          return;
        }
      }
    }

    const cleaned: WeeklyAvailability = {};
    for (const day of DAY_KEYS) {
      const d = dayOf(day);
      cleaned[day] = d.available
        ? { available: true, blocks: sanitizeBlocks(d.blocks) }
        : { available: false, blocks: [] };
    }

    setSaving(true);
    try {
      await onSave(
        employee.id,
        minHours ? parseFloat(minHours) : null,
        maxHours ? parseFloat(maxHours) : null,
        cleaned
      );
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

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
              Turn a day off if they can't work at all. Otherwise add the times they
              <span className="font-medium"> can't work</span> — you can add more than one per day.
            </p>
            <div className="space-y-2">
              {DAY_KEYS.map((key) => {
                const dayAvail = dayOf(key);
                const blocks = dayAvail.blocks ?? [];
                return (
                  <div
                    key={key}
                    className={`rounded-lg border p-3 space-y-2 transition-colors ${
                      dayAvail.available
                        ? "bg-primary/5 border-primary/20"
                        : "bg-muted/30 border-border"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={dayAvail.available}
                        onCheckedChange={() => handleDayToggle(key)}
                      />
                      <span
                        className={`w-10 font-medium text-sm ${
                          !dayAvail.available ? "text-muted-foreground" : ""
                        }`}
                      >
                        {DAY_LABELS[key]}
                      </span>

                      {dayAvail.available ? (
                        <div className="flex-1 flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            {blocks.length === 0
                              ? "Available all day"
                              : `${blocks.length} unavailable ${blocks.length === 1 ? "block" : "blocks"}`}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => addBlock(key)}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Can't work
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          Unavailable all day
                        </span>
                      )}
                    </div>

                    {dayAvail.available && blocks.length > 0 && (
                      <div className="space-y-2 pl-[3.25rem]">
                        {blocks.map((block, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              type="time"
                              value={block.start ?? ""}
                              onChange={(e) => updateBlock(key, index, "start", e.target.value)}
                              className="h-8 text-xs flex-1"
                              aria-label={`${DAY_LABELS[key]} unavailable start`}
                            />
                            <span className="text-muted-foreground text-xs">to</span>
                            <Input
                              type="time"
                              value={block.end ?? ""}
                              onChange={(e) => updateBlock(key, index, "end", e.target.value)}
                              className="h-8 text-xs flex-1"
                              aria-label={`${DAY_LABELS[key]} unavailable end`}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                              onClick={() => removeBlock(key, index)}
                              aria-label="Remove block"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
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
