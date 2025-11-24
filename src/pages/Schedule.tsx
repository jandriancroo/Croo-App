import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Settings } from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays } from "date-fns";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";
import { ShiftCard } from "@/components/schedule/ShiftCard";
import { EventRow } from "@/components/schedule/EventRow";
import { EmployeeRow } from "@/components/schedule/EmployeeRow";

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
}

interface ScheduledShift {
  id: string;
  user_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_time_off: boolean;
  template_id: string | null;
  shift_date: string;
}

interface ScheduleEvent {
  id: string;
  event_name: string;
  event_time: string;
  day_of_week: number;
  notes: string | null;
  tagged_roles: string[] | null;
}

export default function Schedule() {
  const navigate = useNavigate();
  const { role, isAdmin, isManager } = useUserRole();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  useEffect(() => {
    if (role) {
      fetchScheduleData();
    }
  }, [currentWeekStart, role]);

  const fetchScheduleData = async () => {
    setLoading(true);
    try {
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

      // Fetch or create schedule for this week
      let { data: scheduleData, error: scheduleError } = await supabase
        .from("schedules")
        .select("*")
        .eq("week_start_date", format(currentWeekStart, "yyyy-MM-dd"))
        .single();

      if (scheduleError && scheduleError.code === "PGRST116") {
        // Schedule doesn't exist, create it if user can
        if (isAdmin || isManager) {
          const { data: newSchedule, error: createError } = await supabase
            .from("schedules")
            .insert({
              week_start_date: format(currentWeekStart, "yyyy-MM-dd"),
              week_end_date: format(weekEnd, "yyyy-MM-dd"),
            })
            .select()
            .single();

          if (createError) throw createError;
          scheduleData = newSchedule;
        }
      }

      if (scheduleData) {
        setScheduleId(scheduleData.id);

        // Fetch shifts
        const { data: shiftsData, error: shiftsError } = await supabase
          .from("scheduled_shifts")
          .select("*")
          .eq("schedule_id", scheduleData.id);

        if (shiftsError) throw shiftsError;
        setShifts(shiftsData || []);

        // Fetch events
        const { data: eventsData, error: eventsError } = await supabase
          .from("schedule_events")
          .select("*")
          .eq("schedule_id", scheduleData.id);

        if (eventsError) throw eventsError;
        setEvents((eventsData || []).map(event => ({
          ...event,
          tagged_roles: event.tagged_roles as string[] | null
        })));
      }

      // Fetch all profiles
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, profile_photo_url")
        .eq("is_active", true);

      if (profilesError) throw profilesError;
      setProfiles(profilesData || []);

      // Fetch shift templates
      const { data: templatesData, error: templatesError } = await supabase
        .from("shift_templates")
        .select("*");

      if (templatesError) throw templatesError;
      setTemplates(templatesData || []);
    } catch (error: any) {
      console.error("Error fetching schedule data:", error);
      toast.error("Failed to load schedule");
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveShift(active.data.current);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveShift(null);

    if (!over || !scheduleId) return;

    const overId = over.id as string;
    const [, userId, dayOfWeek] = overId.split("-");
    const dayIndex = parseInt(dayOfWeek);

    try {
      if (active.data.current?.isTemplate) {
        // Dragging from template
        const template = active.data.current.template;
        const shiftDate = format(weekDays[dayIndex], "yyyy-MM-dd");

        const { error } = await supabase.from("scheduled_shifts").insert({
          schedule_id: scheduleId,
          template_id: template.id,
          user_id: userId === "unassigned" ? null : userId,
          day_of_week: dayIndex,
          shift_date: shiftDate,
          start_time: template.start_time,
          end_time: template.end_time,
          is_time_off: false,
        });

        if (error) throw error;
        toast.success("Shift added");
        fetchScheduleData();
      } else {
        // Moving existing shift
        const shift = active.data.current.shift;
        const shiftDate = format(weekDays[dayIndex], "yyyy-MM-dd");

        const { error } = await supabase
          .from("scheduled_shifts")
          .update({
            user_id: userId === "unassigned" ? null : userId,
            day_of_week: dayIndex,
            shift_date: shiftDate,
          })
          .eq("id", shift.id);

        if (error) throw error;
        toast.success("Shift moved");
        fetchScheduleData();
      }
    } catch (error: any) {
      console.error("Error handling drop:", error);
      toast.error("Failed to update shift");
    }
  };

  const handlePreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading schedule...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={handlePreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">
              {format(currentWeekStart, "MMM d, yyyy")} - {format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), "MMM d, yyyy")}
            </h1>
            <Button variant="outline" size="icon" onClick={handleNextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {(isAdmin || isManager) && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate("/shift-templates")}>
                <Settings className="h-4 w-4 mr-2" />
                Manage Templates
              </Button>
            </div>
          )}
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <Card className="p-6">
            {/* Week Day Headers */}
            <div className="grid grid-cols-8 gap-4 mb-4">
              <div className="font-semibold"></div>
              {weekDays.map((day, index) => (
                <div key={index} className="text-center">
                  <div className="font-semibold">{format(day, "EEE")}</div>
                  <div className="text-sm text-muted-foreground">{format(day, "MMM d")}</div>
                </div>
              ))}
            </div>

            {/* Events Section */}
            <EventRow events={events} scheduleId={scheduleId} isEditable={isAdmin || isManager} onUpdate={fetchScheduleData} />

            {/* Shifts by User */}
            <div className="space-y-2 mt-6">
              <h3 className="font-semibold text-lg mb-4">Assigned Shifts</h3>
              {profiles.map((profile) => (
                <EmployeeRow
                  key={profile.id}
                  profile={profile}
                  shifts={shifts.filter((s) => s.user_id === profile.id)}
                  templates={templates}
                  isEditable={isAdmin || isManager}
                  onUpdate={fetchScheduleData}
                />
              ))}

              {/* Unassigned Shifts */}
              <EmployeeRow
                profile={{ id: "unassigned", full_name: "Unassigned", profile_photo_url: null }}
                shifts={shifts.filter((s) => s.user_id === null)}
                templates={templates}
                isEditable={isAdmin || isManager}
                onUpdate={fetchScheduleData}
              />
            </div>

            {/* Templates Sidebar */}
            {(isAdmin || isManager) && templates.length > 0 && (
              <div className="mt-6 pt-6 border-t">
                <h3 className="font-semibold mb-4">Shift Templates (Drag to Schedule)</h3>
                <div className="flex flex-wrap gap-2">
                  {templates.map((template) => (
                    <ShiftCard key={template.id} shift={{ template, isTemplate: true }} />
                  ))}
                </div>
              </div>
            )}
          </Card>

          <DragOverlay>{activeShift ? <ShiftCard shift={activeShift} isDragging /> : null}</DragOverlay>
        </DndContext>
      </div>
    </Layout>
  );
}
