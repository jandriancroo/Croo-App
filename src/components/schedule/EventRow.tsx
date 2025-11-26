import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<string | null>(null);
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
            schedule_id: formData.is_recurring ? null : scheduleId,
          })
          .eq("id", editingEvent.id);

        if (error) throw error;
        toast.success("Event updated");
      } else {
        const { error } = await supabase.from("schedule_events").insert({
          schedule_id: formData.is_recurring ? null : scheduleId,
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


  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

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
                <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/20 text-white">
                  <Plus className="h-4 w-4" />
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
        {weekDays.map((day, dayIndex) => {
          const dayEvents = events.filter((e) => e.day_of_week === dayIndex);
          return (
            <div key={dayIndex} className="min-h-[40px] p-1.5 border-r last:border-r-0 border-border/20 bg-[hsl(30,25%,45%)]">
              <div className="space-y-1">
                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="group relative w-full p-1.5 bg-white/10 hover:bg-white/20 rounded text-xs transition-colors"
                  >
                    <button
                      onClick={() => isEditable && handleEdit(event)}
                      disabled={!isEditable}
                      className="w-full text-left disabled:cursor-default"
                    >
                      <div className="font-medium truncate text-white">
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
                ))}
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
