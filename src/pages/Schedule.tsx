import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Settings, Calendar } from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays } from "date-fns";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { ShiftCard } from "@/components/schedule/ShiftCard";
import { EventRow } from "@/components/schedule/EventRow";
import { EmployeeRow } from "@/components/schedule/EmployeeRow";
import { EditShiftDialog } from "@/components/schedule/EditShiftDialog";
import { ConflictWarningDialog } from "@/components/schedule/ConflictWarningDialog";
import { MobileScheduleView } from "@/components/schedule/MobileScheduleView";
import { LaborTotals } from "@/components/schedule/LaborTotals";
import { LiveStatusBadge } from "@/components/schedule/LiveStatusBadge";
import { DayBreakdownDialog } from "@/components/schedule/DayBreakdownDialog";

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  role?: string;
  hourly_wage?: number;
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
  is_recurring: boolean;
}

interface AvailabilityRequest {
  id: string;
  user_id: string;
  request_type: string;
  time_scope: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
}

export default function Schedule() {
  const navigate = useNavigate();
  const { role, isAdmin, isManager } = useUserRole();
  const isMobile = useIsMobile();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [availabilityRequests, setAvailabilityRequests] = useState<AvailabilityRequest[]>([]);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<any>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [pendingShiftData, setPendingShiftData] = useState<any>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [publishedSnapshot, setPublishedSnapshot] = useState<any>(null);
  const [selectedDayForBreakdown, setSelectedDayForBreakdown] = useState<Date | null>(null);
  const [dayBreakdownOpen, setDayBreakdownOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id || null);
    });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
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

      if (!scheduleData) {
        setLoading(false);
        return;
      }

      setScheduleId(scheduleData.id);
      setIsPublished(scheduleData.is_published || false);
      setPublishedSnapshot(scheduleData.published_snapshot);

      // Parallelize all independent data fetches
      const [
        shiftsResult,
        eventsResult,
        recurringEventsResult,
        profilesResult,
        rolesResult,
        templatesResult,
        availabilityResult
      ] = await Promise.all([
        // Fetch shifts with template data
        supabase
          .from("scheduled_shifts")
          .select(`
            *,
            template:shift_templates(*)
          `)
          .eq("schedule_id", scheduleData.id),
        
        // Fetch events for this schedule
        supabase
          .from("schedule_events")
          .select("*")
          .eq("schedule_id", scheduleData.id),
        
        // Fetch recurring events (not tied to specific schedule)
        supabase
          .from("schedule_events")
          .select("*")
          .eq("is_recurring", true)
          .is("schedule_id", null),
        
        // Fetch all profiles
        supabase
          .from("profiles")
          .select(`
            id, 
            full_name, 
            profile_photo_url,
            hourly_wage
          `)
          .eq("is_active", true),
        
        // Fetch user roles
        supabase
          .from("user_roles")
          .select("user_id, role"),
        
        // Fetch shift templates
        supabase
          .from("shift_templates")
          .select("*"),
        
        // Fetch availability requests
        supabase
          .from("availability_requests")
          .select("*")
          .eq("request_type", "unpaid")
          .in("status", ["pending", "approved"])
          .gte("start_date", format(currentWeekStart, "yyyy-MM-dd"))
          .lte("start_date", format(weekEnd, "yyyy-MM-dd"))
      ]);

      // Handle shifts
      if (shiftsResult.error) throw shiftsResult.error;
      setShifts(shiftsResult.data || []);

      // Handle events - combine schedule-specific and recurring events
      if (eventsResult.error) throw eventsResult.error;
      if (recurringEventsResult.error) throw recurringEventsResult.error;
      
      const scheduleEvents = (eventsResult.data || []).map(event => ({
        ...event,
        tagged_roles: event.tagged_roles as string[] | null,
        is_recurring: event.is_recurring ?? true
      }));
      
      const recurringEvents = (recurringEventsResult.data || []).map(event => ({
        ...event,
        tagged_roles: event.tagged_roles as string[] | null,
        is_recurring: true
      }));
      
      // Merge and deduplicate (schedule-specific events take precedence)
      const allEvents = [...scheduleEvents];
      recurringEvents.forEach(recurEvent => {
        const exists = scheduleEvents.some(e => 
          e.event_name === recurEvent.event_name && 
          e.day_of_week === recurEvent.day_of_week &&
          e.event_time === recurEvent.event_time
        );
        if (!exists) {
          allEvents.push(recurEvent);
        }
      });
      
      setEvents(allEvents);

      // Handle profiles and roles
      if (profilesResult.error) throw profilesResult.error;
      if (rolesResult.error) throw rolesResult.error;

      const profilesWithRoles = (profilesResult.data || []).map(profile => {
        const userRole = rolesResult.data?.find(r => r.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role || 'team_member'
        };
      });

      // Sort by role: admin, manager, team_member
      const roleOrder = { admin: 0, manager: 1, team_member: 2 };
      profilesWithRoles.sort((a, b) => {
        const aOrder = roleOrder[a.role as keyof typeof roleOrder] ?? 3;
        const bOrder = roleOrder[b.role as keyof typeof roleOrder] ?? 3;
        return aOrder - bOrder;
      });

      setProfiles(profilesWithRoles);

      // Handle templates
      if (templatesResult.error) throw templatesResult.error;
      setTemplates(templatesResult.data || []);

      // Handle availability
      if (availabilityResult.error) throw availabilityResult.error;
      setAvailabilityRequests(availabilityResult.data || []);

      // Sync birthday events (non-blocking, happens in background)
      supabase.functions.invoke('sync-birthday-events').catch(err => 
        console.error('Failed to sync birthday events:', err)
      );
    } catch (error: any) {
      console.error("Error fetching schedule data:", error);
      toast.error("Failed to load schedule");
    } finally {
      setLoading(false);
    }
  };

  const checkForConflicts = (userId: string, dayIndex: number, shiftDate: string) => {
    if (userId === "unassigned") return [];

    const employee = profiles.find((p) => p.id === userId);
    if (!employee) return [];

    const conflictingRequests = availabilityRequests.filter((request) => {
      if (request.user_id !== userId) return false;

      const reqDate = new Date(request.start_date);
      const cellDate = new Date(shiftDate);

      if (request.time_scope === "multi_day" && request.end_date) {
        const endDate = new Date(request.end_date);
        return cellDate >= reqDate && cellDate <= endDate;
      }
      return reqDate.toDateString() === cellDate.toDateString();
    });

    return conflictingRequests.map((req) => ({
      employeeName: employee.full_name,
      date: shiftDate,
      requestType: req.request_type,
      timeScope: req.time_scope,
      status: req.status,
      startTime: req.start_time,
      endTime: req.end_time,
    }));
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
    const lastHyphenIndex = overId.lastIndexOf("-");
    const dayIndex = parseInt(overId.substring(lastHyphenIndex + 1));
    const userId = overId.substring(5, lastHyphenIndex);
    const shiftDate = format(weekDays[dayIndex], "yyyy-MM-dd");

    // Check for conflicts
    const detectedConflicts = checkForConflicts(userId, dayIndex, shiftDate);

    if (detectedConflicts.length > 0) {
      // Store pending shift data and show conflict dialog
      setPendingShiftData({
        type: active.data.current?.isTemplate ? "template" : "move",
        active,
        userId,
        dayIndex,
        shiftDate,
      });
      setConflicts(detectedConflicts);
      setConflictDialogOpen(true);
      return;
    }

    // No conflicts, proceed with scheduling
    await executeShiftOperation(active, userId, dayIndex, shiftDate);
  };

  const executeShiftOperation = async (active: any, userId: string, dayIndex: number, shiftDate: string) => {
    try {
      // If schedule is published, unpublish it when making changes
      if (isPublished && scheduleId) {
        await supabase
          .from('schedules')
          .update({ is_published: false })
          .eq('id', scheduleId);
        setIsPublished(false);
      }

      if (active.data?.current?.isTemplate || active.isTemplate) {
        // Dragging from template
        const template = active.data?.current?.template || active.template;
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
        const shift = active.data?.current || active;
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

  const handleConflictConfirm = async () => {
    if (!pendingShiftData) return;

    setConflictDialogOpen(false);
    await executeShiftOperation(
      pendingShiftData.active,
      pendingShiftData.userId,
      pendingShiftData.dayIndex,
      pendingShiftData.shiftDate
    );
    setPendingShiftData(null);
    setConflicts([]);
  };

  const handlePreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  const handleGoLive = async () => {
    if (!scheduleId) return;
    
    setIsPublishing(true);
    try {
      // Get current shifts snapshot
      const { data: currentShifts, error: shiftsError } = await supabase
        .from('scheduled_shifts')
        .select('*')
        .eq('schedule_id', scheduleId);

      if (shiftsError) throw shiftsError;

      // If republishing, detect and notify changes
      if (publishedSnapshot) {
        const changes = detectScheduleChanges(publishedSnapshot, currentShifts || []);
        
        if (changes.length > 0) {
          // Log changes and prepare notifications
          for (const change of changes) {
            await supabase
              .from('schedule_change_log')
              .insert({
                schedule_id: scheduleId,
                user_id: change.user_id,
                change_type: change.type,
                old_shift_data: change.oldShift,
                new_shift_data: change.newShift
              });
          }
          
          toast.success(`Schedule published! ${changes.length} change(s) notified to affected employees.`);
        } else {
          toast.success("Schedule published!");
        }
      } else {
        toast.success("Schedule published! Team members have been notified.");
      }

      // Update schedule with new snapshot
      const { error } = await supabase
        .from('schedules')
        .update({ 
          is_published: true,
          published_snapshot: currentShifts
        })
        .eq('id', scheduleId);

      if (error) throw error;

      setIsPublished(true);
      setPublishedSnapshot(currentShifts);
    } catch (error: any) {
      console.error('Error publishing schedule:', error);
      toast.error("Failed to publish schedule");
    } finally {
      setIsPublishing(false);
    }
  };

  const detectScheduleChanges = (oldShifts: any[], newShifts: any[]) => {
    const changes: any[] = [];
    const oldShiftsMap = new Map(oldShifts.map(s => [s.id, s]));
    const newShiftsMap = new Map(newShifts.map(s => [s.id, s]));

    // Check for removed shifts
    oldShifts.forEach(oldShift => {
      if (!newShiftsMap.has(oldShift.id) && oldShift.user_id) {
        changes.push({
          user_id: oldShift.user_id,
          type: 'removed',
          oldShift: oldShift,
          newShift: null
        });
      }
    });

    // Check for added or changed shifts
    newShifts.forEach(newShift => {
      const oldShift = oldShiftsMap.get(newShift.id);
      
      if (!oldShift && newShift.user_id) {
        // New shift added
        changes.push({
          user_id: newShift.user_id,
          type: 'added',
          oldShift: null,
          newShift: newShift
        });
      } else if (oldShift && newShift.user_id) {
        // Check if time changed
        if (oldShift.start_time !== newShift.start_time || 
            oldShift.end_time !== newShift.end_time) {
          changes.push({
            user_id: newShift.user_id,
            type: 'time_changed',
            oldShift: oldShift,
            newShift: newShift
          });
        }
        // Check if date changed
        else if (oldShift.shift_date !== newShift.shift_date ||
                 oldShift.day_of_week !== newShift.day_of_week) {
          changes.push({
            user_id: newShift.user_id,
            type: 'date_changed',
            oldShift: oldShift,
            newShift: newShift
          });
        }
        // Check if user assignment changed
        else if (oldShift.user_id !== newShift.user_id) {
          if (oldShift.user_id) {
            changes.push({
              user_id: oldShift.user_id,
              type: 'removed',
              oldShift: oldShift,
              newShift: null
            });
          }
          if (newShift.user_id) {
            changes.push({
              user_id: newShift.user_id,
              type: 'added',
              oldShift: null,
              newShift: newShift
            });
          }
        }
      }
    });

    return changes;
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
      {isMobile ? (
        <MobileScheduleView
          currentWeekStart={currentWeekStart}
          shifts={shifts.map(s => ({
            ...s,
            template: templates.find(t => t.id === s.template_id) ? {
              position: templates.find(t => t.id === s.template_id)?.template_name.split(' ').slice(0, -3).join(' ') || null,
              color: templates.find(t => t.id === s.template_id)?.color || null,
            } : undefined,
          }))}
          events={events}
          profiles={profiles}
          onShiftClick={(shift) => setEditingShift(shift)}
          onWeekChange={setCurrentWeekStart}
          onUpdate={fetchScheduleData}
        />
      ) : (
        <div className="space-y-6 pb-32">
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

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/availability")}>
              <Calendar className="h-4 w-4 mr-2" />
              View Availability
            </Button>
            {(isAdmin || isManager) && (
              <>
                {scheduleId && (
                  <LiveStatusBadge
                    isPublished={isPublished}
                    isPublishing={isPublishing}
                    onGoLive={handleGoLive}
                  />
                )}
                <Button variant="outline" onClick={() => navigate("/shift-templates")}>
                  <Settings className="h-4 w-4 mr-2" />
                  Manage Templates
                </Button>
              </>
            )}
          </div>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <Card className="p-6 overflow-x-auto">
            {/* Week Day Headers */}
            <div className="grid grid-cols-8 gap-0 border-b-2 border-border">
              <div className="font-semibold p-4 border-r border-border bg-muted/50"></div>
              {weekDays.map((day, index) => (
                <div 
                  key={index} 
                  className="text-center p-4 border-r last:border-r-0 border-border bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => {
                    setSelectedDayForBreakdown(day);
                    setDayBreakdownOpen(true);
                  }}
                >
                  <div className="font-semibold">{format(day, "EEE")}</div>
                  <div className="text-sm text-muted-foreground">{format(day, "MMM d")}</div>
                </div>
              ))}
            </div>

            {/* Events Section */}
            <div className="border-b border-border">
              <EventRow events={events} scheduleId={scheduleId} isEditable={isAdmin || isManager} onUpdate={fetchScheduleData} />
            </div>

            {/* Shifts by User - Grouped by Role */}
            <div className="divide-y divide-border">
              {['admin', 'manager', 'team_member'].map((roleFilter) => {
                const roleProfiles = profiles.filter(p => p.role === roleFilter);
                if (roleProfiles.length === 0) return null;

                const roleColorClass = roleFilter === 'admin' 
                  ? 'bg-role-admin/5 border-l-4 border-role-admin' 
                  : roleFilter === 'manager'
                  ? 'bg-role-manager/5 border-l-4 border-role-manager'
                  : 'bg-role-team-member/5 border-l-4 border-role-team-member';

                return (
                  <div key={roleFilter} className={`${roleColorClass}`}>
                    <div className="px-4 py-2 font-semibold text-sm uppercase tracking-wide">
                      {roleFilter === 'team_member' ? 'Team Members' : `${roleFilter}s`}
                    </div>
                    {roleProfiles.map((profile) => (
                      <EmployeeRow
                        key={profile.id}
                        profile={profile}
                        shifts={shifts.filter((s) => s.user_id === profile.id)}
                        templates={templates}
                        availabilityRequests={availabilityRequests.filter((r) => r.user_id === profile.id)}
                        currentWeekStart={currentWeekStart}
                        isEditable={isAdmin || isManager}
                        onUpdate={fetchScheduleData}
                        canTakeShifts={isAdmin || isManager}
                        currentUserId={currentUserId || undefined}
                        onEditShift={setEditingShift}
                      />
                    ))}
                  </div>
                );
              })}

              {/* Unassigned Shifts */}
              <EmployeeRow
                profile={{ id: "unassigned", full_name: "Unassigned", profile_photo_url: null }}
                shifts={shifts.filter((s) => s.user_id === null)}
                templates={templates}
                availabilityRequests={[]}
                currentWeekStart={currentWeekStart}
                isEditable={isAdmin || isManager}
                onUpdate={fetchScheduleData}
                canTakeShifts={isAdmin || isManager}
                currentUserId={currentUserId || undefined}
                onEditShift={setEditingShift}
              />
            </div>

            {/* Labor Totals */}
            <LaborTotals
              shifts={shifts}
              profiles={profiles}
              currentWeekStart={currentWeekStart}
            />
          </Card>

          {/* Floating Templates Bar - Bottom */}
          {(isAdmin || isManager) && (
            <div className="fixed bottom-0 left-0 right-0 bg-card border-t-2 border-border shadow-lg z-50">
              <div className="max-w-screen-2xl mx-auto px-6 py-3">
                <div className="space-y-2">
                  {/* Labor Totals Summary */}
                  <LaborTotals
                    shifts={shifts}
                    profiles={profiles}
                    currentWeekStart={currentWeekStart}
                  />
                  
                  {/* Shift Templates */}
                  <div className="flex items-center gap-4 border-t border-border pt-2">
                    <h3 className="font-semibold whitespace-nowrap text-sm">Shift Templates:</h3>
                    {templates.length > 0 ? (
                      <div className="flex gap-2 overflow-x-auto flex-1">
                        {templates.map((template) => (
                          <ShiftCard key={template.id} shift={{ template, isTemplate: true }} />
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-muted-foreground text-sm">No shift templates yet</p>
                        <Button size="sm" onClick={() => navigate("/shift-templates")}>
                          <Plus className="h-4 w-4 mr-2" />
                          Create Template
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DragOverlay>{activeShift ? <ShiftCard shift={activeShift} isDragging /> : null}</DragOverlay>
        </DndContext>

        {editingShift && (
          <EditShiftDialog
            open={!!editingShift}
            onOpenChange={(open) => !open && setEditingShift(null)}
            shift={editingShift}
            profiles={profiles}
            templates={templates}
            onUpdate={fetchScheduleData}
            scheduleId={scheduleId || ""}
            currentWeekStart={currentWeekStart}
            currentUserId={currentUserId || undefined}
            availabilityRequests={availabilityRequests}
          />
        )}

        <ConflictWarningDialog
          open={conflictDialogOpen}
          onOpenChange={setConflictDialogOpen}
          onConfirm={handleConflictConfirm}
          conflicts={conflicts}
        />

        {selectedDayForBreakdown && scheduleId && (
          <DayBreakdownDialog
            open={dayBreakdownOpen}
            onOpenChange={setDayBreakdownOpen}
            date={selectedDayForBreakdown}
            scheduleId={scheduleId}
            shifts={shifts}
            profiles={profiles}
          />
        )}
      </div>
      )}
    </Layout>
  );
}
