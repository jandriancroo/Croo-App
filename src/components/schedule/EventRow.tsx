import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { startOfWeek, addDays, format } from "date-fns";
import { formatTime12Hour } from "@/lib/utils";
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
  category?: EventCategory | null;
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

export function EventRow({ events, scheduleId, isEditable, onUpdate, locationId }: EventRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<string | null>(null);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(PRESET_COLORS[0]);
  const [showNewCategory, setShowNewCategory] = useState(false);
  
  const [formData, setFormData] = useState({
    event_name: "",
    event_time: "08:00",
    selected_days: [0] as number[],
    notes: "",
    tagged_roles: [] as string[],
    is_recurring: true,
    category_id: "" as string,
    is_daily_task: false,
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
    if (formData.selected_days.length === 0) {
      toast.error("Please select at least one day");
      return;
    }

    try {
      if (editingEvent) {
        // Update existing event - for multi-day, update the first day and create others
        const primaryDay = formData.selected_days[0];
        const { error } = await supabase
          .from("schedule_events")
          .update({
            event_name: formData.event_name,
            event_time: formData.event_time,
            day_of_week: primaryDay,
            days_of_week: formData.selected_days.length > 1 ? formData.selected_days : null,
            notes: formData.notes || null,
            tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
            is_recurring: formData.is_recurring,
            schedule_id: formData.is_recurring ? null : scheduleId,
            category_id: formData.category_id || null,
            is_daily_task: formData.is_daily_task,
            location_id: locationId,
          })
          .eq("id", editingEvent.id);

        if (error) throw error;
        toast.success("Event updated");
      } else {
        // Create new event(s) - one for each selected day, or one with days_of_week array
        if (formData.selected_days.length === 1) {
          // Single day event
          const { error } = await supabase.from("schedule_events").insert({
            schedule_id: formData.is_recurring ? null : scheduleId,
            event_name: formData.event_name,
            event_time: formData.event_time,
            day_of_week: formData.selected_days[0],
            days_of_week: null,
            notes: formData.notes || null,
            tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
            is_recurring: formData.is_recurring,
            category_id: formData.category_id || null,
            is_daily_task: formData.is_daily_task,
            location_id: locationId,
          });

          if (error) throw error;
        } else {
          // Multi-day event - create one record with days_of_week array
          const { error } = await supabase.from("schedule_events").insert({
            schedule_id: formData.is_recurring ? null : scheduleId,
            event_name: formData.event_name,
            event_time: formData.event_time,
            day_of_week: formData.selected_days[0], // Primary day for backward compat
            days_of_week: formData.selected_days,
            notes: formData.notes || null,
            tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
            is_recurring: formData.is_recurring,
            category_id: formData.category_id || null,
            is_daily_task: formData.is_daily_task,
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
      selected_days: [0],
      notes: "",
      tagged_roles: [],
      is_recurring: true,
      category_id: "",
      is_daily_task: false,
    });
    setShowNewCategory(false);
    setNewCategoryName("");
  };

  const handleEdit = (event: ScheduleEvent) => {
    setEditingEvent(event);
    const selectedDays = event.days_of_week && event.days_of_week.length > 0 
      ? event.days_of_week 
      : [event.day_of_week];
    
    setFormData({
      event_name: event.event_name,
      event_time: event.event_time,
      selected_days: selectedDays,
      notes: event.notes || "",
      tagged_roles: event.tagged_roles || [],
      is_recurring: event.is_recurring,
      category_id: event.category_id || "",
      is_daily_task: event.is_daily_task || false,
    });
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

  const toggleDay = (dayIndex: number) => {
    const newDays = formData.selected_days.includes(dayIndex)
      ? formData.selected_days.filter(d => d !== dayIndex)
      : [...formData.selected_days, dayIndex].sort((a, b) => a - b);
    setFormData({ ...formData, selected_days: newDays });
  };

  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  // Get events for a specific day, including multi-day events
  const getEventsForDay = (dayIndex: number) => {
    return events.filter((e) => {
      if (e.days_of_week && e.days_of_week.length > 0) {
        return e.days_of_week.includes(dayIndex);
      }
      return e.day_of_week === dayIndex;
    });
  };

  const getCategoryColor = (event: ScheduleEvent) => {
    if (event.category_id) {
      const category = categories.find(c => c.id === event.category_id);
      return category?.color || null;
    }
    return null;
  };

  return (
    <div>
      <div className="grid grid-cols-8 gap-0 bg-[hsl(30,25%,45%)]">
        <div className="flex items-center gap-2 px-4 py-2 border-r border-border/20">
          <h3 className="font-semibold text-white text-sm">Events</h3>
          {isEditable && (
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingEvent(null);
                resetForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/20 text-white">
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

                <div>
                  <Label htmlFor="event_time">Time</Label>
                  <Input
                    id="event_time"
                    type="time"
                    value={formData.event_time}
                    onChange={(e) => setFormData({ ...formData, event_time: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label>Days of Week</Label>
                  <div className="grid grid-cols-7 gap-1 mt-2">
                    {weekDays.map((day, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => toggleDay(index)}
                        className={`p-2 text-xs rounded-md border transition-colors ${
                          formData.selected_days.includes(index)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:bg-muted"
                        }`}
                      >
                        {format(day, "EEE")}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Select multiple days for recurring events on multiple weekdays
                  </p>
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
                    {["admin", "manager", "team_member"].map((role) => (
                      <div key={role} className="flex items-center space-x-2">
                        <Checkbox
                          id={`role-${role}`}
                          checked={formData.tagged_roles.includes(role)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setFormData({
                                ...formData,
                                tagged_roles: [...formData.tagged_roles, role],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                tagged_roles: formData.tagged_roles.filter((r) => r !== role),
                              });
                            }
                          }}
                        />
                        <label htmlFor={`role-${role}`} className="text-sm capitalize cursor-pointer">
                          {role.replace("_", " ")}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_recurring"
                    checked={formData.is_recurring}
                    onCheckedChange={(checked) => 
                      setFormData({ ...formData, is_recurring: checked as boolean })
                    }
                  />
                  <label htmlFor="is_recurring" className="text-sm cursor-pointer">
                    Repeat weekly on selected days
                  </label>
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

                <Button type="submit" className="w-full">
                  {editingEvent ? "Update Event" : "Create Event"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
        </div>
        {weekDays.map((day, dayIndex) => {
          const dayEvents = getEventsForDay(dayIndex);
          return (
            <div key={dayIndex} className="min-h-[40px] p-1.5 border-r last:border-r-0 border-border/20 bg-[hsl(30,25%,45%)]">
              <div className="space-y-1">
                {dayEvents.map((event) => {
                  const categoryColor = getCategoryColor(event);
                  return (
                    <div
                      key={`${event.id}-${dayIndex}`}
                      className="group relative w-full p-1.5 rounded text-xs transition-colors"
                      style={{
                        backgroundColor: categoryColor ? `${categoryColor}30` : "rgba(255,255,255,0.1)",
                        borderLeft: categoryColor ? `3px solid ${categoryColor}` : undefined,
                      }}
                    >
                      <button
                        onClick={() => isEditable && handleEdit(event)}
                        disabled={!isEditable}
                        className="w-full text-left disabled:cursor-default hover:bg-white/10 rounded transition-colors"
                      >
                        <div className="font-medium truncate text-white flex items-center gap-1">
                          {event.is_daily_task && (
                            <span className="text-[10px] bg-accent/50 px-1 rounded">Task</span>
                          )}
                          {formatTime12Hour(event.event_time)} {event.event_name}
                          {!event.is_recurring && " (One-time)"}
                        </div>
                      </button>
                      {isEditable && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(event.id);
                          }}
                          className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/30 rounded transition-opacity"
                          title="Delete event"
                        >
                          <Trash2 className="h-3 w-3 text-white" />
                        </button>
                      )}
                    </div>
                  );
                })}
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
    </div>
  );
}
