import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { startOfWeek, addDays, format } from "date-fns";

interface ScheduleEvent {
  id: string;
  event_name: string;
  event_time: string;
  day_of_week: number;
  notes: string | null;
  tagged_roles: string[] | null;
  is_recurring: boolean;
}

interface EventRowProps {
  events: ScheduleEvent[];
  scheduleId: string | null;
  isEditable: boolean;
  onUpdate: () => void;
}

export function EventRow({ events, scheduleId, isEditable, onUpdate }: EventRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [formData, setFormData] = useState({
    event_name: "",
    event_time: "08:00",
    day_of_week: 0,
    notes: "",
    tagged_roles: [] as string[],
    is_recurring: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleId) return;

    try {
      if (editingEvent) {
        const { error } = await supabase
          .from("schedule_events")
          .update({
            event_name: formData.event_name,
            event_time: formData.event_time,
            day_of_week: formData.day_of_week,
            notes: formData.notes || null,
            tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
            is_recurring: formData.is_recurring,
          })
          .eq("id", editingEvent.id);

        if (error) throw error;
        toast.success("Event updated");
      } else {
        const { error } = await supabase.from("schedule_events").insert({
          schedule_id: scheduleId,
          event_name: formData.event_name,
          event_time: formData.event_time,
          day_of_week: formData.day_of_week,
          notes: formData.notes || null,
          tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
          is_recurring: formData.is_recurring,
        });

        if (error) throw error;
        toast.success("Event created");
      }

      setDialogOpen(false);
      setEditingEvent(null);
      setFormData({
        event_name: "",
        event_time: "08:00",
        day_of_week: 0,
        notes: "",
        tagged_roles: [],
        is_recurring: true,
      });
      onUpdate();
    } catch (error: any) {
      console.error("Error saving event:", error);
      toast.error("Failed to save event");
    }
  };

  const handleEdit = (event: ScheduleEvent) => {
    setEditingEvent(event);
    setFormData({
      event_name: event.event_name,
      event_time: event.event_time,
      day_of_week: event.day_of_week,
      notes: event.notes || "",
      tagged_roles: event.tagged_roles || [],
      is_recurring: event.is_recurring,
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
      onUpdate();
    } catch (error: any) {
      console.error("Error deleting event:", error);
      toast.error("Failed to delete event");
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "pm" : "am";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes}${ampm}`;
  };

  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-4 pt-4">
        <h3 className="font-semibold">Events</h3>
        {isEditable && (
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setEditingEvent(null);
              setFormData({
                event_name: "",
                event_time: "08:00",
                day_of_week: 0,
                notes: "",
                tagged_roles: [],
                is_recurring: true,
              });
            }
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Event
              </Button>
            </DialogTrigger>
            <DialogContent>
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

                <div className="grid grid-cols-2 gap-4">
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
                    <Label htmlFor="day_of_week">Day</Label>
                    <select
                      id="day_of_week"
                      className="w-full h-10 px-3 rounded-md border border-input bg-background"
                      value={formData.day_of_week}
                      onChange={(e) => setFormData({ ...formData, day_of_week: parseInt(e.target.value) })}
                    >
                      {weekDays.map((day, index) => (
                        <option key={index} value={index}>
                          {format(day, "EEEE")}
                        </option>
                      ))}
                    </select>
                  </div>
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
                    Repeat weekly on this day
                  </label>
                </div>

                <Button type="submit" className="w-full">
                  {editingEvent ? "Update Event" : "Create Event"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-8 gap-0">
        <div className="p-4 border-r border-border bg-muted/30"></div>
        {weekDays.map((day, dayIndex) => {
          const dayEvents = events.filter((e) => e.day_of_week === dayIndex);
          return (
            <div key={dayIndex} className="min-h-[60px] p-2 border-r last:border-r-0 border-border">
              <div className="space-y-1">
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => isEditable && handleEdit(event)}
                    disabled={!isEditable}
                    className="w-full p-2 bg-accent/20 hover:bg-accent/30 rounded text-xs text-left transition-colors disabled:cursor-default"
                  >
                    <div className="font-medium truncate">
                      {formatTime(event.event_time)} {event.event_name}
                      {!event.is_recurring && " (One-time)"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
