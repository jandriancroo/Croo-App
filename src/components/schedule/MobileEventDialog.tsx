import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Plus, CalendarIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { startOfWeek, addDays, format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface EventCategory {
  id: string;
  name: string;
  color: string;
}

interface MobileEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleId: string | null;
  locationId?: string;
  selectedDayOfWeek: number;
  onEventCreated: () => void;
}

const PRESET_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#6366f1", // indigo
];

export function MobileEventDialog({
  open,
  onOpenChange,
  scheduleId,
  locationId,
  selectedDayOfWeek,
  onEventCreated,
}: MobileEventDialogProps) {
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(PRESET_COLORS[0]);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eventMode, setEventMode] = useState<"one-time" | "recurring">("one-time");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [formData, setFormData] = useState({
    event_name: "",
    event_time: "08:00",
    event_end_time: "" as string,
    event_date: null as Date | null,
    selected_days: [selectedDayOfWeek] as number[],
    notes: "",
    tagged_roles: [] as string[],
    category_id: "" as string,
    is_daily_task: false,
    is_meeting: false,
  });

  useEffect(() => {
    if (locationId && open) {
      fetchCategories();
    }
  }, [locationId, open]);

  // Reset form when dialog opens with new day
  useEffect(() => {
    if (open) {
      // Calculate initial date from selectedDayOfWeek
      const today = new Date();
      const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });
      const initialDate = addDays(currentWeekStart, selectedDayOfWeek);
      // If that date is in the past, move to next week
      const eventDate = initialDate < today ? addDays(initialDate, 7) : initialDate;
      
      setFormData({
        event_name: "",
        event_time: "08:00",
        event_end_time: "",
        event_date: eventDate,
        selected_days: [selectedDayOfWeek],
        notes: "",
        tagged_roles: [],
        category_id: "",
        is_daily_task: false,
        is_meeting: false,
      });
      setEventMode("one-time");
      setShowDatePicker(false);
    }
  }, [open, selectedDayOfWeek]);

  const fetchCategories = async () => {
    if (!locationId) return;
    const { data, error } = await supabase
      .from("event_categories")
      .select("*")
      .eq("location_id", locationId)
      .order("name");

    if (!error && data) {
      setCategories(data);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || !locationId) return;

    const { data, error } = await supabase
      .from("event_categories")
      .insert({
        name: newCategoryName.trim(),
        color: newCategoryColor,
        location_id: locationId,
      })
      .select()
      .single();

    if (error) {
      toast.error("Failed to create category");
      return;
    }

    setCategories([...categories, data]);
    setFormData({ ...formData, category_id: data.id });
    setNewCategoryName("");
    setShowNewCategory(false);
    toast.success("Category created");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleId || !locationId) {
      toast.error("Missing schedule or location");
      return;
    }
    if (formData.selected_days.length === 0) {
      toast.error("Please select at least one day");
      return;
    }
    if (!formData.event_name.trim()) {
      toast.error("Please enter an event name");
      return;
    }

    setSaving(true);

    try {
      if (eventMode === "one-time") {
        // One-time event with specific date
        if (!formData.event_date) {
          toast.error("Please select a date");
          setSaving(false);
          return;
        }
        
        const eventDateStr = format(formData.event_date, "yyyy-MM-dd");
        const dayOfWeek = (formData.event_date.getDay() + 6) % 7; // Convert to Monday=0 format
        
        const { error } = await supabase.from("schedule_events").insert({
          schedule_id: scheduleId,
          event_name: formData.event_name,
          event_time: formData.event_time,
          event_end_time: formData.event_end_time || null,
          event_date: eventDateStr,
          day_of_week: dayOfWeek,
          days_of_week: null,
          notes: formData.notes || null,
          tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
          is_recurring: false,
          category_id: formData.category_id || null,
          is_daily_task: formData.is_daily_task,
          is_meeting: formData.is_meeting,
          location_id: locationId,
        });

        if (error) throw error;
      } else {
        // Recurring event
        const dbDays = formData.selected_days;

        const { error } = await supabase.from("schedule_events").insert({
          schedule_id: null,
          event_name: formData.event_name,
          event_time: formData.event_time,
          event_end_time: formData.event_end_time || null,
          day_of_week: dbDays[0],
          days_of_week: dbDays.length > 1 ? dbDays : null,
          notes: formData.notes || null,
          tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
          is_recurring: true,
          category_id: formData.category_id || null,
          is_daily_task: formData.is_daily_task,
          is_meeting: formData.is_meeting,
          location_id: locationId,
        });

        if (error) throw error;
      }

      toast.success("Event created");
      onOpenChange(false);
      onEventCreated();
    } catch (error: any) {
      console.error("Error saving event:", error);
      toast.error("Failed to save event");
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (dayIndex: number) => {
    const newDays = formData.selected_days.includes(dayIndex)
      ? formData.selected_days.filter((d) => d !== dayIndex)
      : [...formData.selected_days, dayIndex].sort((a, b) => a - b);
    setFormData({ ...formData, selected_days: newDays });
  };

  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle>Add Event</DrawerTitle>
        </DrawerHeader>
        <form onSubmit={handleSubmit} className="px-4 space-y-4 overflow-y-auto max-h-[60vh]">
          <div>
            <Label htmlFor="event_name">Event Name</Label>
            <Input
              id="event_name"
              value={formData.event_name}
              onChange={(e) => setFormData({ ...formData, event_name: e.target.value })}
              placeholder="e.g., Order Produce"
              required
            />
          </div>

          {/* Event Type Toggle */}
          <div>
            <Label>Event Type</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                type="button"
                onClick={() => setEventMode("one-time")}
                className={cn(
                  "p-2 text-sm rounded-md border transition-colors",
                  eventMode === "one-time"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                )}
              >
                One-time
              </button>
              <button
                type="button"
                onClick={() => setEventMode("recurring")}
                className={cn(
                  "p-2 text-sm rounded-md border transition-colors",
                  eventMode === "recurring"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                )}
              >
                Recurring
              </button>
            </div>
          </div>

          {/* Date picker for one-time events */}
          {eventMode === "one-time" && (
            <div>
              <Label>Date</Label>
              <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal mt-1",
                      !formData.event_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.event_date ? format(formData.event_date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.event_date || undefined}
                    onSelect={(date) => {
                      setFormData({ ...formData, event_date: date || null });
                      setShowDatePicker(false);
                    }}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Days of week for recurring events */}
          {eventMode === "recurring" && (
            <div>
              <Label>Days of Week</Label>
              <div className="grid grid-cols-7 gap-1 mt-2">
                {weekDays.map((day, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => toggleDay(index)}
                    className={cn(
                      "p-2 text-xs rounded-md border transition-colors",
                      formData.selected_days.includes(index)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    )}
                  >
                    {format(day, "EEE")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Time fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="event_time">Start Time</Label>
              <Input
                id="event_time"
                type="time"
                value={formData.event_time}
                onChange={(e) => setFormData({ ...formData, event_time: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="event_end_time">End Time (optional)</Label>
              <Input
                id="event_end_time"
                type="time"
                value={formData.event_end_time}
                onChange={(e) => setFormData({ ...formData, event_end_time: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>

          <div>
            <Label>Category</Label>
            <div className="flex gap-2 mt-1">
              <Select
                value={formData.category_id || "__none__"}
                onValueChange={(value) =>
                  setFormData({ ...formData, category_id: value === "__none__" ? "" : value })
                }
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select category (optional)">
                    {formData.category_id && formData.category_id !== "__none__" && (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor: categories.find((c) => c.id === formData.category_id)
                              ?.color,
                          }}
                        />
                        {categories.find((c) => c.id === formData.category_id)?.name}
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: cat.color }}
                        />
                        {cat.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowNewCategory(!showNewCategory)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {showNewCategory && (
              <div className="mt-2 p-3 border rounded-md space-y-2 bg-muted/30">
                <Input
                  placeholder="Category name"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Color:</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="w-8 h-8 rounded-md border"
                        style={{ backgroundColor: newCategoryColor }}
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2">
                      <div className="grid grid-cols-5 gap-1">
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`w-6 h-6 rounded-md ${
                              newCategoryColor === color ? "ring-2 ring-primary ring-offset-1" : ""
                            }`}
                            style={{ backgroundColor: color }}
                            onClick={() => setNewCategoryColor(color)}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreateCategory}
                    disabled={!newCategoryName.trim()}
                  >
                    Add
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_daily_task"
              checked={formData.is_daily_task}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, is_daily_task: checked as boolean })
              }
            />
            <Label htmlFor="is_daily_task" className="text-sm">
              Show as a daily task
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_meeting"
              checked={formData.is_meeting}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, is_meeting: checked as boolean })
              }
            />
            <Label htmlFor="is_meeting" className="text-sm">
              Allow attendees to punch in (meeting)
            </Label>
          </div>
          {formData.is_meeting && (
            <p className="text-xs text-muted-foreground pl-6">
              After saving, you can add attendees who will be able to punch in during this event.
            </p>
          )}
        </form>
        <DrawerFooter className="pt-4">
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : "Create Event"}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
