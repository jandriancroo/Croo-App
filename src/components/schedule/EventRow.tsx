import { memo, useState, useEffect } from "react";
import { parseDateStringInTimezone } from "@/utils/timezoneUtils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Plus, ClipboardCheck, CalendarIcon, Trash2, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { startOfWeek, addDays, format } from "date-fns";
import { MeetingAttendeeManager } from "./MeetingAttendeeManager";
import { formatTime12Hour, cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

interface ScheduleEvent {
  id: string;
  event_name: string;
  event_time: string;
  day_of_week: number;
  days_of_week?: number[] | null;
  notes: string | null;
  tagged_roles: string[] | null;
  is_recurring: boolean;
  category_id?: string | null;
  is_daily_task?: boolean;
  category?: { name: string; color: string } | null;
  event_categories?: { name: string; color: string } | null;
}

interface EventCategory {
  id: string;
  name: string;
  color: string;
}

interface EventRowProps {
  events: ScheduleEvent[];
  scheduleId: string | null;
  isEditable: boolean;
  onUpdate: () => void;
  locationId?: string;
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

function EventRowComponent({ events, scheduleId, isEditable, onUpdate, locationId }: EventRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<string | null>(null);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(PRESET_COLORS[0]);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [eventMode, setEventMode] = useState<"one-time" | "recurring">("one-time");
  
  const [formData, setFormData] = useState({
    event_name: "",
    event_time: "08:00",
    event_end_time: "" as string,
    event_date: null as Date | null,
    selected_days: [0] as number[],
    notes: "",
    tagged_roles: [] as string[],
    category_id: "" as string,
    is_daily_task: false,
    is_meeting: false,
  });

  useEffect(() => {
    if (locationId) {
      fetchCategories();
    }
  }, [locationId]);

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
    if (!scheduleId || !locationId) return;

    try {
      if (editingEvent) {
        // Update existing event
        if (eventMode === "one-time") {
          // One-time event update
          if (!formData.event_date) {
            toast.error("Please select a date");
            return;
          }
          const eventDateStr = format(formData.event_date, "yyyy-MM-dd");
          const dayOfWeek = (formData.event_date.getDay() + 6) % 7; // Convert to Monday=0 format
          
          const { error } = await supabase
            .from("schedule_events")
            .update({
              event_name: formData.event_name,
              event_time: formData.event_time,
              event_end_time: formData.event_end_time || null,
              day_of_week: dayOfWeek,
              days_of_week: null,
              notes: formData.notes || null,
              tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
              is_recurring: false,
              schedule_id: scheduleId,
              category_id: formData.category_id || null,
              is_daily_task: formData.is_daily_task,
              is_meeting: formData.is_meeting,
              location_id: locationId,
              event_date: eventDateStr,
            })
            .eq("id", editingEvent.id);

          if (error) throw error;
        } else {
          // Recurring event update
          const dbDays = formData.selected_days.map(uiIndexToDbIndex);
          const primaryDay = dbDays[0];
          const { error } = await supabase
            .from("schedule_events")
            .update({
              event_name: formData.event_name,
              event_time: formData.event_time,
              event_end_time: formData.event_end_time || null,
              day_of_week: primaryDay,
              days_of_week: dbDays.length > 1 ? dbDays : null,
              notes: formData.notes || null,
              tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
              is_recurring: true,
              schedule_id: null,
              category_id: formData.category_id || null,
              is_daily_task: formData.is_daily_task,
              is_meeting: formData.is_meeting,
              location_id: locationId,
              event_date: null,
            })
            .eq("id", editingEvent.id);

          if (error) throw error;
        }
        toast.success("Event updated");
      } else {
        // Create new event
        if (eventMode === "one-time") {
          // One-time event with specific date
          if (!formData.event_date) {
            toast.error("Please select a date");
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
          if (formData.selected_days.length === 0) {
            toast.error("Please select at least one day");
            return;
          }
          
          const dbDays = formData.selected_days.map(uiIndexToDbIndex);

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
      }

      setDialogOpen(false);
      setEditingEvent(null);
      resetForm();
      onUpdate();
    } catch (error: any) {
      console.error("Error saving event:", error);
      toast.error("Failed to save event");
    }
  };

  const resetForm = () => {
    setFormData({
      event_name: "",
      event_time: "08:00",
      event_end_time: "",
      event_date: new Date(),
      selected_days: [0],
      notes: "",
      tagged_roles: [],
      category_id: "",
      is_daily_task: false,
      is_meeting: false,
    });
    setEventMode("one-time");
    setShowNewCategory(false);
    setNewCategoryName("");
  };

  const handleEdit = (event: ScheduleEvent) => {
    setEditingEvent(event);
    // Convert DB indices to UI indices when loading for edit
    const dbDays = event.days_of_week && event.days_of_week.length > 0 
      ? event.days_of_week 
      : [event.day_of_week];
    const uiDays = dbDays.map(dbIndexToUiIndex);
    
    setFormData({
      event_name: event.event_name,
      event_time: event.event_time,
      event_end_time: (event as any).event_end_time || "",
      event_date: (event as any).event_date ? parseDateStringInTimezone((event as any).event_date) : null,
      selected_days: uiDays,
      notes: event.notes || "",
      tagged_roles: event.tagged_roles || [],
      category_id: event.category_id || "",
      is_daily_task: event.is_daily_task || false,
      is_meeting: (event as any).is_meeting || false,
    });
    setEventMode(event.is_recurring ? "recurring" : "one-time");
    setDialogOpen(true);
  };

  const handleDelete = async (eventId: string) => {
    try {
      const { error } = await supabase
        .from("schedule_events")
        .delete()
        .eq("id", eventId);

      if (error) throw error;
      toast.success("Event deleted");
      setDeleteDialogOpen(false);
      setEventToDelete(null);
      onUpdate();
    } catch (error: any) {
      console.error("Error deleting event:", error);
      toast.error("Failed to delete event");
    }
  };

  const confirmDelete = (eventId: string) => {
    setEventToDelete(eventId);
    setDeleteDialogOpen(true);
  };

  // UI and DB both use Monday=0, Sun=6 - no conversion needed
  const uiIndexToDbIndex = (uiIndex: number): number => uiIndex;
  
  // UI and DB both use Monday=0, Sun=6 - no conversion needed
  const dbIndexToUiIndex = (dbIndex: number): number => dbIndex;

  const toggleDay = (dayIndex: number) => {
    const newDays = formData.selected_days.includes(dayIndex)
      ? formData.selected_days.filter(d => d !== dayIndex)
      : [...formData.selected_days, dayIndex].sort((a, b) => a - b);
    setFormData({ ...formData, selected_days: newDays });
  };

  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  // Get events for a specific day, including multi-day events, sorted by time
  // dayIndex here is the UI index (Mon=0, Tue=1, ..., Sun=6), so convert to DB format for comparison
  const getEventsForDay = (dayIndex: number) => {
    const dbIndex = uiIndexToDbIndex(dayIndex);
    return events
      .filter((e) => {
        if (e.days_of_week && e.days_of_week.length > 0) {
          return e.days_of_week.includes(dbIndex);
        }
        return e.day_of_week === dbIndex;
      })
      .sort((a, b) => a.event_time.localeCompare(b.event_time));
  };

  const getCategoryColor = (event: ScheduleEvent) => {
    if (event.category_id) {
      const category = categories.find(c => c.id === event.category_id);
      return category?.color || null;
    }
    return null;
  };

  return (
    <>
      <div className="grid grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)] gap-0 bg-muted/40 min-w-[700px]">
        <div className="flex items-center gap-2 px-4 py-2 border-r border-border/45">
          <h3 className="font-semibold text-foreground text-sm">Events</h3>
          {isEditable && (
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingEvent(null);
                resetForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-foreground/10 text-muted-foreground">
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingEvent ? "Edit Event" : "Create Event"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
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
                    <Popover>
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
                          onSelect={(date) => setFormData({ ...formData, event_date: date || null })}
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
                    <p className="text-xs text-muted-foreground mt-1">
                      Select multiple days for recurring events on multiple weekdays
                    </p>
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
                    />
                  </div>
                </div>

                <div>
                  <Label>Category</Label>
                  <div className="flex gap-2 mt-1">
                    <Select
                      value={formData.category_id || "__none__"}
                      onValueChange={(value) => setFormData({ ...formData, category_id: value === "__none__" ? "" : value })}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select category (optional)">
                          {formData.category_id && formData.category_id !== "__none__" && (
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: categories.find(c => c.id === formData.category_id)?.color }}
                              />
                              {categories.find(c => c.id === formData.category_id)?.name}
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
                                  className={`w-6 h-6 rounded-md ${newCategoryColor === color ? "ring-2 ring-primary ring-offset-1" : ""}`}
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
                    placeholder="Additional details..."
                  />
                </div>

                <div>
                  <Label>Tag Roles (optional)</Label>
                  <div className="space-y-2 mt-2">
                    {[
                      { value: "admin", label: "Admin" },
                      { value: "manager", label: "Manager" },
                      { value: "shift_manager", label: "Shift Manager" },
                      { value: "team_member", label: "Team Member" },
                    ].map((role) => (
                      <div key={role.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`role-${role.value}`}
                          checked={formData.tagged_roles.includes(role.value)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setFormData({
                                ...formData,
                                tagged_roles: [...formData.tagged_roles, role.value],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                tagged_roles: formData.tagged_roles.filter((r) => r !== role.value),
                              });
                            }
                          }}
                        />
                        <label htmlFor={`role-${role.value}`} className="text-sm cursor-pointer">
                          {role.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-2 p-3 bg-accent/10 rounded-md border border-accent/20">
                  <Checkbox
                    id="is_daily_task"
                    checked={formData.is_daily_task}
                    onCheckedChange={(checked) => 
                      setFormData({ ...formData, is_daily_task: checked as boolean })
                    }
                  />
                  <div>
                    <label htmlFor="is_daily_task" className="text-sm cursor-pointer font-medium">
                      Add as Daily Task
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Shows a task card on the dashboard for quick completion
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 p-3 bg-blue-500/10 rounded-md border border-blue-500/20">
                  <Checkbox
                    id="is_meeting"
                    checked={formData.is_meeting}
                    onCheckedChange={(checked) => 
                      setFormData({ ...formData, is_meeting: checked as boolean })
                    }
                  />
                  <div>
                    <label htmlFor="is_meeting" className="text-sm cursor-pointer font-medium">
                      Allow Punch-In (Meeting)
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Attendees can punch in during this event, even without a scheduled shift
                    </p>
                  </div>
                </div>

                {editingEvent && formData.is_meeting && (
                  <MeetingAttendeeManager
                    eventId={editingEvent.id}
                    eventName={formData.event_name}
                    locationId={locationId || ""}
                  />
                )}

                <div className="flex gap-2">
                  {editingEvent && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      onClick={() => {
                        setDialogOpen(false);
                        confirmDelete(editingEvent.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button type="submit" className="flex-1">
                    {editingEvent ? "Update Event" : "Create Event"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
        </div>
        {weekDays.map((day, dayIndex) => {
          const dayEvents = getEventsForDay(dayIndex);
          const hasMultiple = dayEvents.length > 1;
          const visibleEvents = isExpanded ? dayEvents : dayEvents.slice(0, 1);
          const hiddenCount = dayEvents.length - 1;
          
          return (
            <div key={dayIndex} className="min-h-[40px] p-1.5 border-r last:border-r-0 border-border/45 bg-muted/40 overflow-hidden">
              <div className="space-y-1">
                {visibleEvents.map((event) => {
                  const categoryColor = getCategoryColor(event) || '#6366f1';
                  return (
                    <div
                      key={`${event.id}-${dayIndex}`}
                      onClick={() => isEditable && handleEdit(event)}
                      className={`w-full overflow-hidden rounded-lg text-[10px] md:text-[11px] transition-colors flex items-center gap-1 px-1.5 py-1 ${
                        isEditable ? 'cursor-pointer hover:brightness-110' : ''
                      }`}
                      style={{
                        backgroundColor: `${categoryColor}15`,
                      }}
                    >
                      <div 
                        className="w-[3px] self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: categoryColor }}
                      />
                      {event.is_daily_task ? (
                        <ClipboardCheck className="h-3 w-3 flex-shrink-0" style={{ color: categoryColor }} />
                      ) : (
                        <CalendarDays className="h-3 w-3 flex-shrink-0" style={{ color: categoryColor }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-foreground font-medium">
                          <span className="truncate">{event.event_name}</span>
                          {!isExpanded && hasMultiple && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded(true);
                              }}
                              className="ml-auto px-1 py-0.5 bg-foreground/10 hover:bg-foreground/20 rounded text-[9px] font-semibold flex-shrink-0 transition-colors"
                            >
                              +{hiddenCount}
                            </button>
                          )}
                        </div>
                        <div className="text-white/70 text-[10px]">
                          {formatTime12Hour(event.event_time)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {isExpanded && dayEvents.length > 1 && (
                  <button
                    onClick={() => setIsExpanded(false)}
                    className="w-full text-[9px] text-white/60 hover:text-white/80 py-0.5 transition-colors"
                  >
                    collapse
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this event. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => eventToDelete && handleDelete(eventToDelete)}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const EventRow = memo(EventRowComponent);
