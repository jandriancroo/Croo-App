import { memo, useState, useMemo } from "react";
import { getDisplayName } from "@/utils/displayName";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShiftCard } from "./ShiftCard";
import { SmartTapPopover } from "./SmartTapPopover";
import { addDays, format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { GripVertical, Clock, CalendarOff, AlertCircle, CakeSlice } from "lucide-react";
import { getTodayInPST } from "@/utils/dateUtils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DayAvailability {
  available: boolean;
  start?: string;
  end?: string;
}

interface WeeklyAvailability {
  monday?: DayAvailability;
  tuesday?: DayAvailability;
  wednesday?: DayAvailability;
  thursday?: DayAvailability;
  friday?: DayAvailability;
  saturday?: DayAvailability;
  sunday?: DayAvailability;
}

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
  hourly_wage?: number;
  display_order?: number;
  weekly_availability?: WeeklyAvailability | null;
}
interface Holiday {
  id: string;
  holiday_name: string;
  holiday_date: string;
  holiday_type: string;
  user_id?: string | null;
  location_id?: string | null;
}

interface EmployeeRowProps {
  profile: Profile;
  shifts: any[];
  templates: any[];
  availabilityRequests: any[];
  currentWeekStart: Date;
  isEditable: boolean;
  onUpdate: () => void;
  canTakeShifts?: boolean;
  currentUserId?: string;
  onEditShift?: (shift: any) => void;
  isDraggable?: boolean;
  isPublished?: boolean;
  publishedSnapshot?: any[];
  canViewAllWages?: boolean;
  isCompactMode?: boolean;
  holidays?: Holiday[];
  allShifts?: any[];
  onSmartTap?: (userId: string, dayIndex: number, shiftDate: string, template: any) => void;
  onNewShift?: (userId: string, dayIndex: number, shiftDate: string) => void;
  /** Optional small badge shown next to the name (e.g. "Manager"). */
  roleBadge?: string;
  /** Stations enabled at the location (passed to SmartTap popover). */
  stations?: { id: string; name: string; color?: string | null }[];
  currentStationId?: string | null;
  onAssignStation?: (userId: string, stationId: string | null) => void;
}


function EmployeeRowComponent({
  profile,
  shifts,
  templates,
  availabilityRequests,
  currentWeekStart,
  isEditable,
  onUpdate,
  canTakeShifts,
  currentUserId,
  onEditShift,
  isDraggable = false,
  isPublished = true,
  publishedSnapshot,
  canViewAllWages = false,
  isCompactMode = false,
  holidays = [],
  allShifts = [],
  onSmartTap,
  onNewShift,
  roleBadge,
  stations,
  currentStationId,
  onAssignStation,
}: EmployeeRowProps) {

  const navigate = useNavigate();
  const weekDays = Array.from({
    length: 7
  }, (_, i) => addDays(currentWeekStart, i));
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: profile.id,
    disabled: !isDraggable || profile.id === "unassigned"
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };
  const calculateTotalHours = () => {
    let totalHours = 0;
    shifts.forEach(shift => {
      const [startHour, startMin] = shift.start_time.split(':').map(Number);
      const [endHour, endMin] = shift.end_time.split(':').map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;
      let shiftMinutes = endMinutes - startMinutes;

      // If shift crosses midnight
      if (shiftMinutes < 0) {
        shiftMinutes += 24 * 60;
      }
      const shiftHours = shiftMinutes / 60;

      // Deduct 30 min for shifts over 5 hours
      if (shiftHours > 5) {
        totalHours += shiftHours - 0.5;
      } else {
        totalHours += shiftHours;
      }
    });
    return totalHours.toFixed(1);
  };
  const calculateTotalWages = () => {
    const hours = parseFloat(calculateTotalHours());
    const wage = profile.hourly_wage ?? 15.00;
    return (hours * wage).toFixed(2);
  };

  // Compute the last 3 unique template IDs this employee worked LAST WEEK
  // allShifts already contains only last week's shifts (pre-filtered in Schedule.tsx)
  const recentTemplateIds = useMemo(() => {
    const employeeShifts = allShifts
      .filter(s => s.user_id === profile.id && s.template_id)
      .sort((a: any, b: any) => (b.shift_date || '').localeCompare(a.shift_date || ''));
    
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of employeeShifts) {
      if (!seen.has(s.template_id)) {
        seen.add(s.template_id);
        result.push(s.template_id);
        if (result.length >= 3) break;
      }
    }
    return result;
  }, [allShifts, profile.id]);
    return <div ref={setNodeRef} style={style} className={`grid gap-0 border-b border-dotted border-border/50 relative auto-rows-fr min-w-[700px] grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)]`}>
      <div className={`flex items-center gap-1 border-r border-border bg-muted/30 overflow-hidden ${isCompactMode ? 'min-h-[26px] px-1 py-0.5' : 'min-h-[60px] p-2'}`}>
        {/* Drag Handle inside employee card */}
        {isDraggable && profile.id !== "unassigned" && (
          <div {...attributes} {...listeners} className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
            <GripVertical className="h-4 w-4" />
          </div>
        )}
        {profile.id !== "unassigned" ? <div onClick={() => navigate('/users', {
        state: {
          viewUserId: profile.id
        }
      })} className={`flex items-center cursor-pointer hover:bg-accent/50 rounded p-1 transition-colors flex-1 min-w-0 ${isCompactMode ? 'gap-1' : 'gap-2'}`}>
            {!isCompactMode && (
              <Avatar className="flex-shrink-0 hidden lg:flex h-10 w-10">
                <AvatarImage src={profile.profile_photo_url || undefined} />
                <AvatarFallback className="text-sm">{getDisplayName(profile.full_name, profile.nickname).charAt(0)}</AvatarFallback>
              </Avatar>
            )}
            {!isCompactMode && (
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm font-semibold leading-tight truncate mb-0.5" title={getDisplayName(profile.full_name, profile.nickname)}>
                  {(() => {
                    const displayName = getDisplayName(profile.full_name, profile.nickname);
                    const parts = displayName.split(' ');
                    const firstName = parts[0];
                    const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1].charAt(0)}.` : '';
                    return `${firstName}${lastInitial}`;
                  })()}
                </p>
                <div className="flex flex-col gap-0.5 min-w-0">
                  {roleBadge && (
                    <span className="px-1.5 py-0 rounded-full text-[9px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground border border-border whitespace-nowrap self-start max-w-full truncate">
                      {roleBadge}
                    </span>
                  )}
                  <p className="text-[10px] md:text-xs text-muted-foreground leading-tight truncate">
                    {calculateTotalHours()} hrs{canViewAllWages && <> · ${calculateTotalWages()}</>}
                  </p>
                </div>
              </div>
            )}
            {isCompactMode && (
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <p className="text-xs md:text-sm font-semibold leading-tight truncate flex-1 min-w-0" title={getDisplayName(profile.full_name, profile.nickname)}>
                  {(() => {
                    const displayName = getDisplayName(profile.full_name, profile.nickname);
                    const parts = displayName.split(' ');
                    const firstName = parts[0];
                    const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1].charAt(0)}.` : '';
                    return `${firstName}${lastInitial}`;
                  })()}
                </p>
                {roleBadge && (
                  <span className="px-1 py-0 rounded-full text-[9px] font-semibold uppercase bg-muted text-muted-foreground border border-border whitespace-nowrap flex-shrink-0">
                    {roleBadge}
                  </span>
                )}
              </div>
            )}
          </div> : <span className="text-sm font-medium text-muted-foreground">Unassigned</span>}
      </div>

      {weekDays.map((day, dayIndex) => {
      const cellDateStr = format(day, "yyyy-MM-dd");
      const isToday = cellDateStr === getTodayInPST();
      // Filter by shift_date (source of truth) instead of day_of_week which can be inconsistent
      const dayShifts = shifts.filter(s => s.shift_date === cellDateStr);
      const dayAvailability = availabilityRequests.filter(r => {
        // Compare date strings directly to avoid timezone issues
        if (r.time_scope === "multi_day" && r.end_date) {
          return cellDateStr >= r.start_date && cellDateStr <= r.end_date;
        }
        return r.start_date === cellDateStr;
      });
      
      // Get weekly availability for this day
      const dayNames: (keyof WeeklyAvailability)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const dayName = dayNames[dayIndex];
      const weeklyAvailabilityForDay = profile.weekly_availability?.[dayName];
      
      // Check if this employee has a birthday on this day
      const hasBirthday = holidays.some(h => h.holiday_type === 'birthday' && h.user_id === profile.id && h.holiday_date === cellDateStr);
      
       return <DayCell 
         key={dayIndex} 
         userId={profile.id} 
         dayIndex={dayIndex} 
         shifts={dayShifts} 
         availabilityRequests={dayAvailability} 
         weeklyAvailability={weeklyAvailabilityForDay}
         onUpdate={onUpdate} 
         canTakeShifts={canTakeShifts} 
         currentUserId={currentUserId} 
         onEditShift={onEditShift} 
         isPublished={isPublished} 
         publishedSnapshot={publishedSnapshot}
         isToday={isToday}
         isCompactMode={isCompactMode}
         hasBirthday={hasBirthday}
         profileName={getDisplayName(profile.full_name, profile.nickname)}
         templates={templates}
         recentTemplateIds={recentTemplateIds}
         onSmartTap={onSmartTap}
         onNewShift={onNewShift}
         cellDateStr={cellDateStr}
         stations={stations}
         currentStationId={currentStationId}
         onAssignStation={onAssignStation ? (sid) => onAssignStation(profile.id, sid) : undefined}
       />;

    })}
    </div>;
}
function DayCell({
  userId,
  dayIndex,
  shifts,
  availabilityRequests,
  weeklyAvailability,
  onUpdate,
  canTakeShifts,
  currentUserId,
  onEditShift,
  isPublished,
  publishedSnapshot,
  isToday = false,
  isCompactMode = false,
  hasBirthday = false,
  profileName = "",
  templates = [],
  recentTemplateIds = [],
  onSmartTap,
  onNewShift,
  cellDateStr = "",
  stations,
  currentStationId,
  onAssignStation,
}: {
  userId: string;
  dayIndex: number;
  shifts: any[];
  availabilityRequests: any[];
  weeklyAvailability?: DayAvailability;
  onUpdate: () => void;
  canTakeShifts?: boolean;
  currentUserId?: string;
  onEditShift?: (shift: any) => void;
  isPublished?: boolean;
  publishedSnapshot?: any[];
  isToday?: boolean;
  isCompactMode?: boolean;
  hasBirthday?: boolean;
  profileName?: string;
  templates?: any[];
  recentTemplateIds?: string[];
  onSmartTap?: (userId: string, dayIndex: number, shiftDate: string, template: any) => void;
  onNewShift?: (userId: string, dayIndex: number, shiftDate: string) => void;
  cellDateStr?: string;
  stations?: { id: string; name: string; color?: string | null }[];
  currentStationId?: string | null;
  onAssignStation?: (stationId: string | null) => void;
}) {

  const dropId = `drop-${userId}-${dayIndex}`;
  const {
    setNodeRef,
    isOver
  } = useDroppable({
    id: dropId
  });
  
  const [smartTapOpen, setSmartTapOpen] = useState(false);
  const hasStationPicker = !!(stations && stations.length > 0 && onAssignStation && userId !== "unassigned");
  const canSmartTap = (!!onSmartTap || !!onNewShift) && (templates.length > 0 || hasStationPicker || !!onNewShift) && shifts.length === 0 && userId !== "unassigned";

  
  const formatTime12h = (time: string) => {
    const parts = time.split(":");
    const hour = parseInt(parts[0]);
    const minutes = parts[1];
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };
  
  // Check if employee has limited availability on this day
  const hasLimitedAvailability = weeklyAvailability && (
    weeklyAvailability.available === false || 
    (weeklyAvailability.available && (weeklyAvailability.start || weeklyAvailability.end))
  );

  // Helper to normalize time to HH:MM format for comparison
  const normalizeTime = (time: string) => time?.substring(0, 5) || "";

  // Helper to check if a shift conflicts with weekly availability
  const shiftConflictsWithAvailability = (shift: any) => {
    if (!hasLimitedAvailability || !weeklyAvailability) return false;
    
    // If completely unavailable, any shift conflicts
    if (weeklyAvailability.available === false) return true;
    
    // Normalize times to HH:MM for consistent comparison
    const shiftStart = normalizeTime(shift.start_time);
    const shiftEnd = normalizeTime(shift.end_time);
    const availStart = normalizeTime(weeklyAvailability.start || "");
    const availEnd = normalizeTime(weeklyAvailability.end || "");
    
    // If availability has start time (e.g., "available after 5pm")
    // Conflict only if shift starts BEFORE the availability window opens
    if (availStart && shiftStart < availStart) {
      return true;
    }
    
    // If availability has end time (e.g., "available until 9pm")
    // Conflict only if shift ends AFTER the availability window closes
    if (availEnd && shiftEnd > availEnd) {
      return true;
    }
    
    return false;
  };

  // Check if any shift covers the availability restriction
  const availabilityCoveredByShift = shifts.length > 0 && shifts.some(shift => shiftConflictsWithAvailability(shift));
  
  const handleSmartTapSelect = (template: any) => {
    setSmartTapOpen(false);
    onSmartTap?.(userId, dayIndex, cellDateStr, template);
  };

  const handleNewShift = () => {
    setSmartTapOpen(false);
    onNewShift?.(userId, dayIndex, cellDateStr);
  };

  return <div ref={setNodeRef} style={{
    touchAction: 'none'
  }} className={`${isCompactMode ? 'min-h-[26px]' : 'min-h-[60px] p-1.5'} border-r last:border-r-0 border-border transition-colors ${isOver ? "bg-accent/50" : "hover:bg-muted/30"} flex items-stretch overflow-hidden ${canSmartTap ? 'cursor-pointer' : ''}`}>
    <SmartTapPopover
      open={smartTapOpen}
      onOpenChange={setSmartTapOpen}
      templates={templates}
      recentTemplateIds={recentTemplateIds}
      onSelectTemplate={handleSmartTapSelect}
      isCompactMode={isCompactMode}
      stations={hasStationPicker ? stations : undefined}
      currentStationId={currentStationId ?? null}
      onSelectStation={hasStationPicker ? onAssignStation : undefined}
      onNewShift={onNewShift ? handleNewShift : undefined}
    >

      <div 
        className={`${isCompactMode ? 'flex flex-col w-full' : 'flex flex-col w-full gap-1 justify-center'}`}
        onClick={canSmartTap ? () => setSmartTapOpen(true) : undefined}
      >
        {/* Birthday Indicator */}
        {hasBirthday && (
          <div className={`${isCompactMode ? 'flex-1 min-h-[26px] flex items-center justify-center border-0 rounded-none' : 'p-1 border border-dashed border-amber-400/50 rounded flex-1 min-h-[46px] flex items-center justify-center'} bg-amber-50 dark:bg-amber-950/30 text-[10px]`}>
            <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
              <CakeSlice className="h-3 w-3" />
              <span>{profileName.split(' ')[0]}'s B-Day</span>
            </div>
          </div>
        )}
        {/* Weekly Availability Indicator - only show if NOT covered by a conflicting shift */}
        {hasLimitedAvailability && userId !== "unassigned" && !availabilityCoveredByShift && (
          <Popover>
            <PopoverTrigger asChild>
              <div 
                className={`${isCompactMode ? 'flex-1 min-h-[26px] flex flex-col justify-center items-center border-0 rounded-none' : 'p-1 border border-dashed border-muted-foreground/30 rounded flex-1 min-h-[55px] flex flex-col justify-center items-center'} bg-muted/50 text-[10px] cursor-pointer hover:bg-muted/70 transition-colors`}
                style={{
                  background: isCompactMode 
                    ? "repeating-linear-gradient(45deg, rgba(150,150,150,0.15), rgba(150,150,150,0.15) 10px, rgba(150,150,150,0.05) 10px, rgba(150,150,150,0.05) 20px)"
                    : "repeating-linear-gradient(45deg, rgba(150,150,150,0.1), rgba(150,150,150,0.1) 10px, transparent 10px, transparent 20px)"
                }}
              >
                <div className="flex items-center gap-1 text-muted-foreground font-medium text-center">
                  {!isCompactMode && <Clock className="h-2.5 w-2.5" />}
                  {weeklyAvailability?.available === false 
                    ? "Unavailable" 
                    : weeklyAvailability?.start && weeklyAvailability?.end
                      ? `${formatTime12h(weeklyAvailability.start)} - ${formatTime12h(weeklyAvailability.end)}`
                      : weeklyAvailability?.start
                        ? `After ${formatTime12h(weeklyAvailability.start)}`
                        : weeklyAvailability?.end
                          ? `Until ${formatTime12h(weeklyAvailability.end)}`
                          : "Limited"
                  }
                </div>
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" side="top">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Weekly Availability
                </div>
                <div className="text-sm text-muted-foreground">
                  {weeklyAvailability?.available === false 
                    ? "Unavailable all day"
                    : weeklyAvailability?.start && weeklyAvailability?.end
                      ? `Can only work ${formatTime12h(weeklyAvailability.start)} - ${formatTime12h(weeklyAvailability.end)}`
                      : weeklyAvailability?.start
                        ? `Available after ${formatTime12h(weeklyAvailability.start)}`
                        : weeklyAvailability?.end
                          ? `Available until ${formatTime12h(weeklyAvailability.end)}`
                          : "Limited availability"
                  }
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
        
        {shifts.map(shift => {
          // A shift is a draft (unpublished) if:
          // 1. Schedule was never published (!isPublished), OR
          // 2. Schedule is published but this shift is NEW (not in snapshot), OR
          // 3. Schedule is published but this shift was MODIFIED since last publish
          const snapshotShift = publishedSnapshot?.find((s: any) => s.id === shift.id);
          const isNewShiftAfterPublish = isPublished && publishedSnapshot && publishedSnapshot.length > 0 && !snapshotShift;
          const isShiftModified = snapshotShift && (
            snapshotShift.user_id !== shift.user_id ||
            snapshotShift.start_time !== shift.start_time ||
            snapshotShift.end_time !== shift.end_time ||
            snapshotShift.template_id !== shift.template_id ||
            snapshotShift.shift_date !== shift.shift_date ||
            snapshotShift.day_of_week !== shift.day_of_week
          );
          // Shift is a draft if schedule never published, or if it's new/modified after publish
          const isShiftDraft = !isPublished || isNewShiftAfterPublish || isShiftModified;
          
          // Check if shift overlaps with any time-off request
          const conflictingTimeOff = availabilityRequests.filter(request => {
            // Full day time-off always conflicts
            if (request.time_scope !== "partial_day") return true;
            // Partial day: check time overlap
            if (request.start_time && request.end_time) {
              const shiftStart = shift.start_time;
              const shiftEnd = shift.end_time;
              const reqStart = request.start_time;
              const reqEnd = request.end_time;
              return shiftStart < reqEnd && shiftEnd > reqStart;
            }
            return true;
          });
          const hasTimeOffConflict = conflictingTimeOff.length > 0;
          
          // Also check weekly availability conflict
          const hasAvailabilityConflict = shiftConflictsWithAvailability(shift);
          
          return <ShiftCard key={shift.id} shift={shift} onDelete={onUpdate} onEdit={() => onEditShift?.(shift)} isPublished={!isShiftDraft} isCompactMode={isCompactMode} hasTimeOffConflict={hasTimeOffConflict || hasAvailabilityConflict} conflictingTimeOff={conflictingTimeOff} />;
        })}
        {/* Only show time-off requests that don't have a conflicting shift covering them */}
        {availabilityRequests.filter(request => {
          // Check if any shift covers this time-off request
          const isCoveredByShift = shifts.some(shift => {
            if (request.time_scope !== "partial_day") return true; // Full day requests are always covered if there's any shift
            if (request.start_time && request.end_time) {
              const shiftStart = shift.start_time;
              const shiftEnd = shift.end_time;
              const reqStart = request.start_time;
              const reqEnd = request.end_time;
              return shiftStart < reqEnd && shiftEnd > reqStart;
            }
            return true;
          });
          // Only show if NOT covered by any shift
          return !isCoveredByShift;
        }).map(request => (
          <Popover key={request.id}>
            <PopoverTrigger asChild>
              <div 
                className={`${isCompactMode ? 'flex-1 min-h-[22px] flex flex-col justify-center items-center border-0 rounded-none' : 'p-1 border-dashed border rounded flex-1 min-h-[55px] flex flex-col justify-center items-center'} bg-muted/50 relative text-[10px] cursor-pointer hover:bg-muted/70 transition-colors`}
                style={{
                  background: isCompactMode 
                    ? "repeating-linear-gradient(45deg, rgba(150,150,150,0.15), rgba(150,150,150,0.15) 10px, rgba(150,150,150,0.05) 10px, rgba(150,150,150,0.05) 20px)"
                    : "repeating-linear-gradient(45deg, rgba(150,150,150,0.1), rgba(150,150,150,0.1) 10px, transparent 10px, transparent 20px)"
                }}
              >
                <div className={`text-[10px] text-muted-foreground font-medium ${isCompactMode ? 'text-center' : ''}`}>
                  {request.time_scope === "partial_day" && request.start_time && request.end_time 
                    ? `${formatTime12h(request.start_time)} - ${formatTime12h(request.end_time)}` 
                    : "Time Off"}
                </div>
                {!isCompactMode && request.status === "pending" && (
                  <div className="text-[9px] font-semibold text-amber-600 dark:text-amber-500 uppercase tracking-wide">
                    PENDING
                  </div>
                )}
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" side="top">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CalendarOff className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {request.request_type === "time_off" ? "Time Off Request" : "Availability Request"}
                  </span>
                  {request.status === "pending" && (
                    <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      Pending
                    </span>
                  )}
                  {request.status === "approved" && (
                    <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      Approved
                    </span>
                  )}
                </div>
                
                <div className="text-sm space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {request.time_scope === "partial_day" && request.start_time && request.end_time 
                      ? `${formatTime12h(request.start_time)} - ${formatTime12h(request.end_time)}`
                      : request.time_scope === "multi_day" && request.end_date
                        ? `${format(new Date(request.start_date + 'T12:00:00'), 'MMM d')} - ${format(new Date(request.end_date + 'T12:00:00'), 'MMM d')}`
                        : "Full day"
                    }
                  </div>
                </div>

                {request.notes && (
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-start gap-2 text-sm">
                      <AlertCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <span className="text-muted-foreground">{request.notes}</span>
                    </div>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        ))}
      </div>
    </SmartTapPopover>
    </div>;
}

export const EmployeeRow = memo(EmployeeRowComponent);