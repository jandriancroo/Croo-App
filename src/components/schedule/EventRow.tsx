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
}

interface EventRowProps {
  events: ScheduleEvent[];
  scheduleId: string | null;
  isEditable: boolean;
  onUpdate: () => void;
}

export function EventRow({ events, scheduleId, isEditable, onUpdate }: EventRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    event_name: "",
    event_time: "08:00",
    day_of_week: 0,
    notes: "",
    tagged_roles: [] as string[],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleId) return;

    try {
      const { error } = await supabase.from("schedule_events").insert({
        schedule_id: scheduleId,
        event_name: formData.event_name,
        event_time: formData.event_time,
        day_of_week: formData.day_of_week,
        notes: formData.notes || null,
        tagged_roles: formData.tagged_roles.length > 0 ? formData.tagged_roles : null,
      });

      if (error) throw error;

      toast.success("Event created");
      setDialogOpen(false);
      setFormData({
        event_name: "",
        event_time: "08:00",
        day_of_week: 0,
        notes: "",
        tagged_roles: [],
      });
      onUpdate();
    } catch (error: any) {
      console.error("Error creating event:", error);
      toast.error("Failed to create event");
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
    <div className="border-b pb-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Events</h3>
        {isEditable && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Event
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Event</DialogTitle>
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

                <Button type="submit" className="w-full">
                  Create Event
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-8 gap-4">
        <div></div>
        {weekDays.map((day, dayIndex) => {
          const dayEvents = events.filter((e) => e.day_of_week === dayIndex);
          return (
            <div key={dayIndex} className="min-h-[60px] space-y-1">
              {dayEvents.map((event) => (
                <div key={event.id} className="p-2 bg-primary/10 rounded text-xs">
                  <div className="font-medium">{formatTime(event.event_time)} {event.event_name}</div>
                  {event.notes && <div className="text-muted-foreground text-[10px] truncate">{event.notes}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
