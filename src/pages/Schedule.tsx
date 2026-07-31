import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { lazyWithRetry } from "@/utils/lazyWithRetry";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScheduleData } from "@/hooks/useScheduleData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Settings, Calendar, Copy, Trash2, Wrench, ChevronDown, AlertTriangle, Sparkles, History, Minimize2, Maximize2, Printer } from "lucide-react";
import { exportScheduleToPrint } from "@/utils/exportSchedulePrint";
import { Badge } from "@/components/ui/badge";
import { DateNavigator } from "@/components/ui/date-navigator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { format, endOfWeek, addWeeks } from "date-fns";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ShiftCard } from "@/components/schedule/ShiftCard";
import { EventRow } from "@/components/schedule/EventRow";
import { EmployeeRow } from "@/components/schedule/EmployeeRow";
const EditShiftDialog = lazyWithRetry(() => import("@/components/schedule/EditShiftDialog").then(m => ({ default: m.EditShiftDialog })));
import { ConflictWarningDialog } from "@/components/schedule/ConflictWarningDialog";
import { MobileScheduleView } from "@/components/schedule/MobileScheduleView";
const MobileShiftDialog = lazyWithRetry(() => import("@/components/schedule/MobileShiftDialog").then(m => ({ default: m.MobileShiftDialog })));
import { LaborTotals } from "@/components/schedule/LaborTotals";
import { LiveStatusBadge } from "@/components/schedule/LiveStatusBadge";
import { DayBreakdownDialog } from "@/components/schedule/DayBreakdownDialog";
import { AutoScheduleWizard } from "@/components/schedule/AutoScheduleWizard";
import { ChangeTrackingDialog } from "@/components/schedule/ChangeTrackingDialog";
import { UpdatePreviewSheet } from "@/components/schedule/UpdatePreviewSheet";
import { useLocationStations } from "@/hooks/useLocationStations";
import { useUserStationAssignments } from "@/hooks/useUserStationAssignments";
// StationAssignChip removed — station assignment moved into SmartTap popover
import { StationGroupSection } from "@/components/schedule/StationGroupSection";

export default function Schedule() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const data = useScheduleData();
  const {
    currentWeekStart, setCurrentWeekStart, weekDays, holidays, blackoutDates, locationSettings,
    isPublishing, currentUserId, scheduleId, isPublished, publishedSnapshot, shifts, lastWeekShifts,
    events, profiles, templates, availabilityRequests, lastStatusChangedByName, lastStatusAction,
    loading, hasPendingChanges, pendingChangesCount, canViewAllWages, isAdmin, isManager, currentLocation,
    fetchScheduleData, checkForConflicts, executeShiftOperation, handleClearSchedule,
    handleCopySchedule, handlePreviousWeek, handleNextWeek, handleGoLive, handleUpdate,
    handleWithdrawSchedule, handleRoleChange, handleDragReorder, handleSmartTap,
    getWeekLabel, isCurrentWeek, queryClient, scheduleQueryKey, getTodayInTimezone,
    lastStatusChangedAt,
  } = data;

  // Local UI state
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const stickyHeaderScrollRef = useRef<HTMLDivElement>(null);
  const scheduleBodyRef = useRef<HTMLDivElement>(null);
  const [navbarHeight, setNavbarHeight] = useState(52);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [editingShift, setEditingShift] = useState<any>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [pendingShiftData, setPendingShiftData] = useState<any>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [selectedDayForBreakdown, setSelectedDayForBreakdown] = useState<Date | null>(null);
  const [dayBreakdownOpen, setDayBreakdownOpen] = useState(false);
  const [clearScheduleDialogOpen, setClearScheduleDialogOpen] = useState(false);
  const [copyScheduleDialogOpen, setCopyScheduleDialogOpen] = useState(false);
  const [weeksToAdd, setWeeksToAdd] = useState(1);
  const [isCreatingShift, setIsCreatingShift] = useState(false);
  const [newShiftPreset, setNewShiftPreset] = useState<{ userId: string; dayIndex: number; shiftDate: string } | null>(null);
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false);
  const [changeTrackingOpen, setChangeTrackingOpen] = useState(false);
  const [updatePreviewOpen, setUpdatePreviewOpen] = useState(false);
  const requestUpdate = () => setUpdatePreviewOpen(true);
  const confirmUpdate = async () => {
    await handleUpdate();
    setUpdatePreviewOpen(false);
  };
  const [roleChangeDialogOpen, setRoleChangeDialogOpen] = useState(false);
  const [pendingRoleChange, setPendingRoleChange] = useState<{ userId: string; userName: string; newRole: string } | null>(null);
  const [currentWeekWarningOpen, setCurrentWeekWarningOpen] = useState(false);
  const [pendingEditAction, setPendingEditAction] = useState<(() => void) | null>(null);
  const [isCompactModeManual, setIsCompactModeManual] = useState<boolean | null>(null);
  
  // Auto-compact on tablet (< 1024px), but allow manual override
  const isTablet = typeof window !== 'undefined' && window.innerWidth < 1024;
  const isCompactMode = isCompactModeManual !== null ? isCompactModeManual : isTablet;
  const setIsCompactMode = (val: boolean) => setIsCompactModeManual(val);
  const [hideTemplatesBar, setHideTemplatesBar] = useState(() => localStorage.getItem('schedule-hide-templates') === 'true');

  // Stations (Phase 2) — group schedule by Station → Role when enabled
  const { data: liveStationSettings } = useQuery({
    queryKey: ['schedule-stations-enabled', currentLocation?.id],
    enabled: !!currentLocation?.id,
    staleTime: 10_000,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_settings')
        .select('stations_enabled')
        .eq('location_id', currentLocation!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const stationsEnabled = liveStationSettings?.stations_enabled ?? !!(locationSettings as any)?.stations_enabled;
  const { stations } = useLocationStations(currentLocation?.id);
  const { assignments: stationAssignments, assign: assignUserStation } =
    useUserStationAssignments(currentLocation?.id);
  const useStationGrouping = stationsEnabled && stations.length > 0;

  // Measure actual navbar height for sticky offset
  useEffect(() => {
    const measureHeader = () => {
      const headers = document.querySelectorAll('header');
      for (const header of headers) {
        if (header.offsetHeight > 0 && getComputedStyle(header).position === 'sticky') {
          setNavbarHeight(header.getBoundingClientRect().height);
          break;
        }
      }
    };
    measureHeader();
    window.addEventListener('resize', measureHeader);
    return () => window.removeEventListener('resize', measureHeader);
  }, []);

  const emptySensors = useMemo(() => [], []);
  const activeSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  const isTeamMemberDesktopView = !isMobile && !isAdmin && !isManager;
  const filteredProfiles = isTeamMemberDesktopView && currentUserId ? profiles.filter(p => p.id === currentUserId) : profiles;
  const filteredShifts = isTeamMemberDesktopView && currentUserId ? shifts.filter(s => s.user_id === currentUserId) : shifts;

  // Wrapper to show warning when editing current week
  const wrapEditAction = (action: () => void) => {
    if (isCurrentWeek() && isPublished) {
      setPendingEditAction(() => action);
      setCurrentWeekWarningOpen(true);
    } else {
      action();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveShift(event.active.data.current);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveShift(null);
    if (!over) return;

    const isEmployeeDrag = profiles.some(p => p.id === active.id);
    if (isEmployeeDrag) {
      // Employee row drags only reorder within the same section now.
      // Role changes happen exclusively on the User Management page.
      if (active.id !== over.id) {
        const result = await handleDragReorder(active.id as string, over.id as string);
        if (result?.type === 'role_change') {
          // Intentionally ignored — roles are managed in User Management.
        }
      }
      return;
    }

    if (!scheduleId) return;
    const overId = over.id as string;
    const lastHyphenIndex = overId.lastIndexOf("-");
    const dayIndex = parseInt(overId.substring(lastHyphenIndex + 1));
    const userId = overId.substring(5, lastHyphenIndex);
    const shiftDate = format(weekDays[dayIndex], "yyyy-MM-dd");

    if (userId === "unassigned") {
      toast.error("Shifts must be assigned to an employee");
      return;
    }

    const detectedConflicts = checkForConflicts(userId, dayIndex, shiftDate);
    if (detectedConflicts.length > 0) {
      setPendingShiftData({ type: active.data.current?.isTemplate ? "template" : "move", active, userId, dayIndex, shiftDate });
      setConflicts(detectedConflicts);
      setConflictDialogOpen(true);
      return;
    }

    if (isCurrentWeek() && isPublished) {
      setPendingEditAction(() => () => executeShiftOperation(active, userId, dayIndex, shiftDate));
      setCurrentWeekWarningOpen(true);
    } else {
      await executeShiftOperation(active, userId, dayIndex, shiftDate);
    }
  };

  const handleConflictConfirm = async () => {
    if (!pendingShiftData) return;
    setConflictDialogOpen(false);
    await executeShiftOperation(pendingShiftData.active, pendingShiftData.userId, pendingShiftData.dayIndex, pendingShiftData.shiftDate);
    setPendingShiftData(null);
    setConflicts([]);
  };

  const onSmartTap = async (userId: string, dayIndex: number, shiftDate: string, template: any) => {
    const result = await handleSmartTap(userId, dayIndex, shiftDate, template);
    if (!result) return;
    if (result.type === 'conflict') {
      setPendingShiftData({ type: "template", active: result.fakeActive, userId: result.userId, dayIndex: result.dayIndex, shiftDate: result.shiftDate });
      setConflicts(result.conflicts);
      setConflictDialogOpen(true);
    } else if (result.type === 'current_week_warning') {
      setPendingEditAction(() => result.action);
      setCurrentWeekWarningOpen(true);
    }
  };

  const onNewShiftFromCell = (userId: string, dayIndex: number, shiftDate: string) => {
    wrapEditAction(() => {
      setNewShiftPreset({ userId, dayIndex, shiftDate });
      setIsCreatingShift(true);
    });
  };

  const handlePrintSchedule = () => {
    const printProfiles = profiles.map((p: any) => ({ id: p.id, fullName: p.full_name, role: p.role }));
    const printShifts = shifts.map((s: any) => {
      const dayIdx = (new Date(s.shift_date).getDay() + 6) % 7;
      return { userId: s.user_id || "", dayIndex: dayIdx, startTime: s.start_time, endTime: s.end_time, isTimeOff: s.is_time_off, templateName: s.template?.template_name, templateColor: s.template?.color };
    });
    const printEvents = events.map((e: any) => ({ dayIndex: e.day_of_week, name: e.event_name, time: e.event_time }));
    exportScheduleToPrint({ locationName: currentLocation?.name || "Schedule", weekStart: currentWeekStart, profiles: printProfiles, shifts: printShifts, events: printEvents });
  };



  return (
    <Layout>
      {isMobile ? (
        <MobileScheduleView
          currentWeekStart={currentWeekStart}
          shifts={shifts.map(s => ({
            ...s,
            template_id: s.template_id,
            breaks: (s as any).breaks,
            template: templates.find(t => t.id === s.template_id) ? {
              position: templates.find(t => t.id === s.template_id)?.template_name.split(' ').slice(0, -3).join(' ') || null,
              color: templates.find(t => t.id === s.template_id)?.color || null,
            } : undefined,
          }))}
          events={events}
          profiles={profiles}
          onShiftClick={(shift) => setEditingShift(shift)}
          onWeekChange={(newWeek) => {
            queryClient.invalidateQueries({ queryKey: ['schedule', currentLocation?.id, format(newWeek, 'yyyy-MM-dd')] });
            setCurrentWeekStart(newWeek);
          }}
          onUpdate={fetchScheduleData}
          isPublished={isPublished}
          publishedSnapshot={publishedSnapshot}
          scheduleId={scheduleId}
          templates={templates}
          onGoLive={handleGoLive}
          onSendUpdate={requestUpdate}
          isPublishing={isPublishing}
          hasPendingChanges={hasPendingChanges}
          isLoading={loading}
          locationSettings={locationSettings}
          availabilityRequests={availabilityRequests}
          lastWeekShifts={lastWeekShifts}
        />
      ) : (
        <div className="pb-56">
        <DndContext
          sensors={activeSensors}
          onDragStart={isTeamMemberDesktopView ? undefined : handleDragStart}
          onDragEnd={isTeamMemberDesktopView ? undefined : handleDragEnd}
          collisionDetection={closestCenter}
        >
          <div className="relative">
            {/* Sticky floating header */}
            <div
              ref={stickyHeaderRef}
              className="sticky z-30 bg-card rounded-xl shadow-[0_8px_30px_-4px_hsl(var(--foreground)/0.15)] border border-border overflow-hidden"
              style={{ top: `${navbarHeight}px` }}
            >
            {/* Header toolbar */}
            <div className="flex items-center gap-2 md:gap-3 px-3 py-1.5 md:px-4 md:py-2 border-b border-border">
              <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0 overflow-hidden">
                <DateNavigator
                  onPrev={handlePreviousWeek}
                  onNext={handleNextWeek}
                  label={`${format(currentWeekStart, "MMM d")} - ${format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), "MMM d")}`}
                  leftAlignOnDesktop
                />
                <Badge variant={getWeekLabel().variant} className="whitespace-nowrap hidden lg:flex">
                  {getWeekLabel().label}
                </Badge>
              </div>
              {(isAdmin || isManager) && (
                <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setAutoScheduleOpen(true)} className="gap-1.5 md:gap-2">
                    <Sparkles className="h-4 w-4" /><span className="hidden lg:inline">Croo AI</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon"><Wrench className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-background z-[60]">
                      <DropdownMenuItem
                        onSelect={(e) => { e.preventDefault(); setIsCompactMode(!isCompactMode); }}
                        className="cursor-pointer flex items-center justify-between gap-3"
                      >
                        <span>Compact View</span>
                        <Switch checked={isCompactMode} onCheckedChange={(v) => setIsCompactMode(!!v)} className="scale-75" />
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          const next = !hideTemplatesBar;
                          setHideTemplatesBar(next);
                          localStorage.setItem('schedule-hide-templates', String(next));
                        }}
                        className="cursor-pointer flex items-center justify-between gap-3"
                      >
                        <span>Drag and Drop UI</span>
                        <Switch
                          checked={!hideTemplatesBar}
                          onCheckedChange={(v) => {
                            const next = !v;
                            setHideTemplatesBar(next);
                            localStorage.setItem('schedule-hide-templates', String(next));
                          }}
                          className="scale-75"
                        />
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate("/availability")} className="gap-2 cursor-pointer">
                        <Calendar className="h-4 w-4" />View Availability
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate("/schedule-templates")} className="gap-2 cursor-pointer">
                        <Settings className="h-4 w-4" />Manage Templates
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setCopyScheduleDialogOpen(true)} className="gap-2 cursor-pointer">
                        <Copy className="h-4 w-4" />Copy Schedule to Future Week
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setChangeTrackingOpen(true)} className="gap-2 cursor-pointer">
                        <History className="h-4 w-4" />Change Tracking
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => wrapEditAction(() => setClearScheduleDialogOpen(true))} className="gap-2 cursor-pointer text-destructive">
                        <Trash2 className="h-4 w-4" />Clear Schedule
                      </DropdownMenuItem>
                      {isPublished && (
                        <DropdownMenuItem onClick={() => setWithdrawDialogOpen(true)} className="gap-2 cursor-pointer text-destructive">
                          <AlertTriangle className="h-4 w-4" />Withdraw Schedule
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {scheduleId && (
                    <LiveStatusBadge
                      isPublished={isPublished}
                      isPublishing={isPublishing}
                      hasPendingChanges={hasPendingChanges}
                      pendingCount={pendingChangesCount}
                      onGoLive={handleGoLive}
                      onUpdate={requestUpdate}
                      lastStatusChangedAt={lastStatusChangedAt}
                      lastStatusChangedByName={lastStatusChangedByName}
                      lastStatusAction={lastStatusAction}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Team member view-only badge */}
            {isTeamMemberDesktopView && (
              <div className="bg-muted/50 px-4 py-2 text-center border-b border-border">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium">View Only</span> — Showing your shifts for this week
                </p>
              </div>
            )}

            {/* Day headers + Events */}
            <div
              ref={stickyHeaderScrollRef}
              className="overflow-x-auto scrollbar-none"
              onScroll={(e) => {
                if (scheduleBodyRef.current && scheduleBodyRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
                  scheduleBodyRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
            <div className="grid grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)] gap-0 border-b-2 border-border min-w-[700px]">
              <div className="font-semibold p-2 border-r border-border bg-muted/50 text-xs"></div>
              {weekDays.map((day, index) => {
                const dayString = format(day, "yyyy-MM-dd");
                const dayHolidays = holidays.filter(h => h.holiday_date === dayString);
                const isBlackout = blackoutDates.includes(dayString);
                const isToday = dayString === getTodayInTimezone();

                return (
                  <div
                    key={index}
                    className={`text-center ${isCompactMode ? 'py-1 px-0.5' : 'p-2'} border-r last:border-r-0 border-border ${isToday ? 'bg-primary text-primary-foreground' : 'bg-muted/50'} ${(isAdmin || isManager) ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                    onClick={() => {
                      if (isAdmin || isManager) {
                        setSelectedDayForBreakdown(day);
                        setDayBreakdownOpen(true);
                      }
                    }}
                  >
                    <div className={`font-semibold ${isCompactMode ? 'text-xs' : 'text-sm'}`}>{format(day, "EEE")}</div>
                    <div className={`${isCompactMode ? 'text-[10px]' : 'text-xs'} ${isToday ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{format(day, "M/d")}</div>
                    {!isCompactMode && dayHolidays.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {dayHolidays.map(holiday => (
                          <div key={holiday.id} className="text-[10px] text-primary font-medium leading-tight">
                            {holiday.holiday_type === 'birthday'
                              ? `🎂 ${holiday.holiday_name.replace(/🎂\s*/, '').split(' ')[0]}'s B-Day`
                              : holiday.holiday_name}
                          </div>
                        ))}
                      </div>
                    )}
                    {!isCompactMode && isBlackout && (
                      <div className="mt-1 text-[10px] text-destructive font-medium leading-tight">🚫 Blackout</div>
                    )}
                  </div>
                );
              })}
            </div>

            {!isCompactMode && (
            <div className="border-b border-border">
              <EventRow events={events} scheduleId={scheduleId} isEditable={isAdmin || isManager} onUpdate={fetchScheduleData} locationId={currentLocation?.id} />
            </div>
            )}
            </div>
            </div>

            {/* Schedule grid content */}
            <div
              ref={scheduleBodyRef}
              className="overflow-x-auto bg-card rounded-xl border border-border shadow-md mt-1"
              onScroll={(e) => {
                if (stickyHeaderScrollRef.current && stickyHeaderScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
                  stickyHeaderScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
            >
            <div className="divide-y divide-border">
              {isTeamMemberDesktopView ? (
                filteredProfiles.length > 0 ? (
                  filteredProfiles.map((profile) => (
                    <EmployeeRow
                       key={profile.id}
                       profile={profile}
                       shifts={filteredShifts.filter((s) => s.user_id === profile.id)}
                       templates={templates}
                       availabilityRequests={availabilityRequests.filter((r) => r.user_id === profile.id)}
                       currentWeekStart={currentWeekStart}
                       isEditable={false}
                       onUpdate={fetchScheduleData}
                       canTakeShifts={false}
                       currentUserId={currentUserId || undefined}
                       onEditShift={() => {}}
                       isDraggable={false}
                       isPublished={isPublished}
                       publishedSnapshot={publishedSnapshot}
                       canViewAllWages={canViewAllWages}
                       isCompactMode={isCompactMode}
                       holidays={holidays}
                     />
                  ))
                ) : (
                  <div className="p-8 text-center text-muted-foreground">No shifts scheduled for you this week</div>
                )
              ) : (
                (() => {
                  const ROLE_ORDER = ['super_admin', 'org_admin', 'admin', 'manager', 'shift_manager', 'team_member'];
                  const roleLabels: Record<string, string> = {
                    super_admin: 'Super Admins', org_admin: 'Org Admins', admin: 'Admins',
                    manager: 'Managers', shift_manager: 'Shift Managers', team_member: 'Team Members'
                  };
                  const calcHours = (list: typeof shifts) => list.reduce((total, shift) => {
                    const [sh, sm] = shift.start_time.split(':').map(Number);
                    const [eh, em] = shift.end_time.split(':').map(Number);
                    let mins = (eh * 60 + em) - (sh * 60 + sm);
                    if (mins < 0) mins += 24 * 60;
                    const h = mins / 60;
                    return total + (h > 5 ? h - 0.5 : h);
                  }, 0);

                  const renderRoleBlock = (scopedProfiles: typeof profiles) => (
                    <>
                      {ROLE_ORDER.map((roleFilter) => {
                        const roleProfiles = scopedProfiles.filter(p => p.role === roleFilter);
                        if (roleProfiles.length === 0) return null;
                        const roleColorClass = ['super_admin', 'org_admin', 'admin'].includes(roleFilter)
                          ? 'bg-role-admin/5 border-l-4 border-role-admin'
                          : ['shift_manager', 'manager'].includes(roleFilter)
                          ? 'bg-role-manager/5 border-l-4 border-role-manager'
                          : 'bg-role-team-member/5 border-l-4 border-role-team-member';
                        const roleShifts = shifts.filter(s => roleProfiles.some(p => p.id === s.user_id));
                        const roleTotalHours = calcHours(roleShifts);
                        return (
                          <Collapsible key={roleFilter} defaultOpen={true}>
                            <div className={`${roleColorClass}`}>
                              <CollapsibleTrigger asChild>
                                <button className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer">
                                  <div className="flex items-center gap-2">
                                    <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]>svg]:rotate-180" />
                                    <span className="font-semibold text-sm uppercase tracking-wide">{roleLabels[roleFilter] || roleFilter}</span>
                                    <span className="text-xs text-muted-foreground font-normal normal-case">({roleProfiles.length} {roleProfiles.length === 1 ? 'employee' : 'employees'})</span>
                                  </div>
                                  <span className="text-xs text-muted-foreground font-medium">{roleTotalHours.toFixed(1)} hrs</span>
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <SortableContext items={roleProfiles.map(p => p.id)} strategy={verticalListSortingStrategy}>
                                  {roleProfiles.map((profile) => (
                                    <div key={profile.id} className="relative">
                                      <EmployeeRow
                                        profile={profile}
                                        shifts={shifts.filter((s) => s.user_id === profile.id)}
                                        templates={templates}
                                        availabilityRequests={availabilityRequests.filter((r) => r.user_id === profile.id)}
                                        currentWeekStart={currentWeekStart}
                                        isEditable={isAdmin || isManager}
                                        onUpdate={fetchScheduleData}
                                        canTakeShifts={isAdmin || isManager}
                                        currentUserId={currentUserId || undefined}
                                        onEditShift={(shift) => wrapEditAction(() => setEditingShift(shift))}
                                        isDraggable={isAdmin || isManager}
                                        isPublished={isPublished}
                                        publishedSnapshot={publishedSnapshot}
                                        canViewAllWages={canViewAllWages}
                                        isCompactMode={isCompactMode}
                                        holidays={holidays}
                                        allShifts={lastWeekShifts}
                                        onSmartTap={onSmartTap}
                                        onNewShift={onNewShiftFromCell}
                                        stations={useStationGrouping ? stations : undefined}
                                        currentStationId={stationAssignments[profile.id] ?? null}
                                        onAssignStation={(isAdmin || isManager) ? assignUserStation : undefined}
                                      />
                                    </div>
                                  ))}

                                </SortableContext>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        );
                      })}
                    </>
                  );

                  if (!useStationGrouping) {
                    return <>{renderRoleBlock(profiles)}</>;
                  }

                  // Stations mode: outer = stations + Unassigned, inner = flat
                  // list sorted by role. Role appears as a badge on the row,
                  // NOT as a nested grouping (that doubled up with stations).
                  const roleRank = (r?: string | null) => {
                    const i = ROLE_ORDER.indexOf((r ?? 'team_member') as string);
                    return i === -1 ? ROLE_ORDER.length : i;
                  };
                  const sortByRole = (list: typeof profiles) =>
                    [...list].sort((a: any, b: any) => roleRank(a.role) - roleRank(b.role));
                  const stationSections = [
                    ...stations.map(s => ({ station: s, profilesIn: sortByRole(profiles.filter(p => stationAssignments[p.id] === s.id)) })),
                    { station: null as any, profilesIn: sortByRole(profiles.filter(p => !stationAssignments[p.id])) },
                  ];
                  return (
                    <>
                      {stationSections.map(({ station, profilesIn }) => {
                        const stationShifts = shifts.filter(s => profilesIn.some(p => p.id === s.user_id));
                        return (
                          <StationGroupSection
                            key={station?.id ?? 'unassigned'}
                            station={station}
                            employeeCount={profilesIn.length}
                            totalHours={calcHours(stationShifts)}
                            onDropUser={(userId) => assignUserStation(userId, station?.id ?? null)}
                          >
                            <SortableContext items={profilesIn.map(p => p.id)} strategy={verticalListSortingStrategy}>
                              {profilesIn.map((profile: any) => (
                                <div key={profile.id} className="relative">
                                  <EmployeeRow
                                    profile={profile}
                                    roleBadge={undefined}
                                    shifts={shifts.filter((s) => s.user_id === profile.id)}
                                    templates={templates}
                                    availabilityRequests={availabilityRequests.filter((r) => r.user_id === profile.id)}
                                    currentWeekStart={currentWeekStart}
                                    isEditable={isAdmin || isManager}
                                    onUpdate={fetchScheduleData}
                                    canTakeShifts={isAdmin || isManager}
                                    currentUserId={currentUserId || undefined}
                                    onEditShift={(shift) => wrapEditAction(() => setEditingShift(shift))}
                                    isDraggable={isAdmin || isManager}
                                    isPublished={isPublished}
                                    publishedSnapshot={publishedSnapshot}
                                    canViewAllWages={canViewAllWages}
                                    isCompactMode={isCompactMode}
                                    holidays={holidays}
                                    allShifts={lastWeekShifts}
                                    onSmartTap={onSmartTap}
                                        onNewShift={onNewShiftFromCell}
                                    stations={stations}
                                    currentStationId={stationAssignments[profile.id] ?? null}
                                    onAssignStation={(isAdmin || isManager) ? assignUserStation : undefined}
                                  />
                                </div>
                              ))}

                            </SortableContext>
                          </StationGroupSection>
                        );
                      })}
                    </>
                  );
                })()
              )}
            </div>
            </div>
          </div>

          {/* Visual Key Legend */}
          <div className="flex items-center gap-4 px-2 py-1.5 text-[10px] text-muted-foreground">
            <span className="font-medium">Key:</span>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-4 rounded border-2 border-dashed border-muted-foreground/60 opacity-70 bg-muted/50" />
              <span>Draft</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-4 rounded ring-2 ring-amber-500 ring-offset-1 bg-primary relative overflow-hidden">
                <div className="absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.2) 4px, rgba(0,0,0,0.2) 8px)` }} />
              </div>
              <span>Time-Off Conflict</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-4 rounded bg-muted/30 border border-dashed border-muted-foreground/30" style={{ background: "repeating-linear-gradient(45deg, rgba(150,150,150,0.1), rgba(150,150,150,0.1) 4px, transparent 4px, transparent 8px)" }} />
              <span>Time Off</span>
            </div>
            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={handlePrintSchedule} className="h-7 gap-1.5 text-xs">
                <Printer className="h-3.5 w-3.5" />Print
              </Button>
            </div>
          </div>


          {/* Floating Templates Bar */}
           {(isAdmin || isManager) && (
            <div className="fixed bottom-0 left-0 right-0 z-50 overflow-visible">
              <div className="container max-w-7xl mx-auto px-4 overflow-visible">
                <LaborTotals shifts={shifts} profiles={profiles} currentWeekStart={currentWeekStart} scheduleId={scheduleId} isEditable={isAdmin || isManager} />
              </div>
              {!hideTemplatesBar && (
              <div className="bg-card border-t border-border" style={{ touchAction: 'none' }}>
                <div className="container max-w-7xl mx-auto px-4 py-2 max-h-[35vh] overflow-y-auto overflow-x-auto" style={{ touchAction: 'none' }}>
                  <div className="flex items-start gap-3">
                    <span className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap pt-1 text-muted-foreground">
                      Templates
                    </span>
                    {templates.length > 0 ? (
                      <div className={`flex ${isCompactMode ? 'gap-1 flex-nowrap overflow-x-auto pb-1 pr-4' : 'gap-2 flex-wrap'} flex-1 min-w-0`}>
                        {templates.map((template) => (
                          <ShiftCard key={template.id} shift={{ template, isTemplate: true }} isCompactMode={isCompactMode} />
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-muted-foreground text-xs">No templates</p>
                        <Button size="sm" onClick={() => navigate("/shift-templates")} className="h-6 text-xs px-2">
                          <Plus className="h-3 w-3 mr-1" />Create
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}

            </div>
          )}

          {!isTeamMemberDesktopView && (
            <DragOverlay>{activeShift ? <ShiftCard shift={activeShift} isDragging /> : null}</DragOverlay>
          )}
        </DndContext>

        {/* Dialogs */}
        {(isAdmin || isManager) && editingShift && (() => {
          const snapshotShift = publishedSnapshot?.find((s: any) => s.id === editingShift.id);
          const isShiftModified = snapshotShift && (
            snapshotShift.start_time !== editingShift.start_time || snapshotShift.end_time !== editingShift.end_time ||
            snapshotShift.user_id !== editingShift.user_id || snapshotShift.shift_date !== editingShift.shift_date ||
            snapshotShift.template_id !== editingShift.template_id
          );
          const isShiftPublished = isPublished && snapshotShift && !isShiftModified;

          return (
            <Suspense fallback={null}>
              <EditShiftDialog
                open={!!editingShift} onOpenChange={(open) => !open && setEditingShift(null)}
                shift={editingShift} profiles={profiles} templates={templates}
                onUpdate={fetchScheduleData} scheduleId={scheduleId || ""}
                currentWeekStart={currentWeekStart} currentUserId={currentUserId || undefined}
                availabilityRequests={availabilityRequests} isAdmin={isAdmin}
                isShiftPublished={isShiftPublished}
              />
            </Suspense>
          );
        })()}

        {(isAdmin || isManager) && (
          <ConflictWarningDialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen} onConfirm={handleConflictConfirm} conflicts={conflicts} />
        )}

        {(isAdmin || isManager) && selectedDayForBreakdown && scheduleId && (
          <DayBreakdownDialog open={dayBreakdownOpen} onOpenChange={setDayBreakdownOpen} date={selectedDayForBreakdown} scheduleId={scheduleId} shifts={shifts} profiles={profiles} locationSettings={locationSettings} stations={useStationGrouping ? stations : undefined} stationAssignments={useStationGrouping ? stationAssignments : undefined} />
        )}

        {(isAdmin || isManager) && isCreatingShift && (
          <Suspense fallback={null}>
            <MobileShiftDialog
              open={isCreatingShift} onOpenChange={(open) => { setIsCreatingShift(open); if (!open) setNewShiftPreset(null); }}
              shift={{ id: '', user_id: newShiftPreset?.userId ?? null, day_of_week: newShiftPreset?.dayIndex ?? 0, start_time: '09:00', end_time: '17:00', shift_date: newShiftPreset?.shiftDate || format(currentWeekStart, 'yyyy-MM-dd') }}
              profiles={profiles} isAdmin={isAdmin || isManager}
              onShiftUpdated={fetchScheduleData} isCreating={true}
              scheduleId={scheduleId} templates={templates} locationId={currentLocation?.id}
              currentWeekStart={currentWeekStart}
            />
          </Suspense>
        )}


        {(isAdmin || isManager) && (
          <AlertDialog open={clearScheduleDialogOpen} onOpenChange={setClearScheduleDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear Schedule</AlertDialogTitle>
                <AlertDialogDescription>This will remove all shifts from the current week's schedule. This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { handleClearSchedule(); setClearScheduleDialogOpen(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Clear Schedule</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {(isAdmin || isManager) && (
          <AlertDialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-5 w-5" />Withdraw Schedule</AlertDialogTitle>
                <AlertDialogDescription>This will unpublish the schedule for this week. Team members will no longer see their shifts until you publish again.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { handleWithdrawSchedule(); setWithdrawDialogOpen(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Withdraw Schedule</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {(isAdmin || isManager) && (
          <Dialog open={copyScheduleDialogOpen} onOpenChange={setCopyScheduleDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Copy Schedule to Future Week</DialogTitle>
                <DialogDescription>Copy all shifts from this week to a future week. The schedule will remain unpublished.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="weeks">Weeks from now</Label>
                  <Input id="weeks" type="number" min="1" value={weeksToAdd} onChange={(e) => setWeeksToAdd(parseInt(e.target.value) || 1)} />
                  <p className="text-sm text-muted-foreground">Target week: {format(addWeeks(currentWeekStart, weeksToAdd), "MMM d, yyyy")} - {format(endOfWeek(addWeeks(currentWeekStart, weeksToAdd), { weekStartsOn: 1 }), "MMM d, yyyy")}</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCopyScheduleDialogOpen(false)}>Cancel</Button>
                <Button onClick={() => { handleCopySchedule(weeksToAdd); setCopyScheduleDialogOpen(false); setWeeksToAdd(1); }}>Copy Schedule</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <AlertDialog open={roleChangeDialogOpen} onOpenChange={setRoleChangeDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change User Role?</AlertDialogTitle>
              <AlertDialogDescription>
                Would you like to change {pendingRoleChange?.userName}'s role to {
                  pendingRoleChange?.newRole === 'team_member' ? 'Team Member'
                  : pendingRoleChange?.newRole === 'shift_manager' ? 'Shift Manager'
                  : pendingRoleChange?.newRole === 'manager' ? 'Manager'
                  : pendingRoleChange?.newRole
                }?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingRoleChange(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                if (pendingRoleChange) handleRoleChange(pendingRoleChange.userId, pendingRoleChange.newRole, pendingRoleChange.userName);
                setPendingRoleChange(null);
                setRoleChangeDialogOpen(false);
              }}>Change Role</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={currentWeekWarningOpen} onOpenChange={setCurrentWeekWarningOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-amber-600"><AlertTriangle className="h-5 w-5" />Editing Active Schedule</AlertDialogTitle>
              <AlertDialogDescription>You're about to edit the <strong>current week's schedule</strong> which is already live. Changes will affect employees who may already be working or have planned their week based on this schedule.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setPendingEditAction(null); setCurrentWeekWarningOpen(false); }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (pendingEditAction) pendingEditAction(); setPendingEditAction(null); setCurrentWeekWarningOpen(false); }} className="bg-amber-600 text-white hover:bg-amber-700">Edit Anyway</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      )}

      {currentLocation && (
        <AutoScheduleWizard open={autoScheduleOpen} onOpenChange={setAutoScheduleOpen} currentWeekStart={currentWeekStart} locationId={currentLocation.id} scheduleId={scheduleId} onScheduleGenerated={() => fetchScheduleData(false)} />
      )}

      <ChangeTrackingDialog open={changeTrackingOpen} onOpenChange={setChangeTrackingOpen} scheduleId={scheduleId} weekStartDate={currentWeekStart} isPublished={isPublished} />
      <UpdatePreviewSheet
        open={updatePreviewOpen}
        onOpenChange={setUpdatePreviewOpen}
        publishedSnapshot={publishedSnapshot || []}
        currentShifts={shifts || []}
        profiles={profiles || []}
        onConfirm={confirmUpdate}
        isSending={isPublishing}
      />
    </Layout>
  );
}
