import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShiftCard } from "./ShiftCard";
import { addDays, format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { GripVertical, Clock } from "lucide-react";
import { getTodayInPST } from "@/utils/dateUtils";

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
  profile_photo_url: string | null;
  hourly_wage?: number;
  display_order?: number;
  weekly_availability?: WeeklyAvailability | null;
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
  isCompactMode = false
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
    return <div ref={setNodeRef} style={style} className={`grid gap-0 border-b border-dotted border-border/50 relative auto-rows-fr min-w-[700px] ${
      isCompactMode 
        ? 'grid-cols-[80px_repeat(7,1fr)] md:grid-cols-[100px_repeat(7,1fr)] lg:grid-cols-[120px_repeat(7,1fr)] xl:grid-cols-[140px_repeat(7,1fr)]' 
        : 'grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)]'
    }`}>
      <div className={`flex items-center gap-1 p-2 border-r border-border bg-muted/30 overflow-hidden ${isCompactMode ? 'min-h-[44px]' : 'min-h-[80px]'}`}>
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
                <AvatarFallback className="text-sm">{profile.full_name.charAt(0)}</AvatarFallback>
              </Avatar>
            )}
            {!isCompactMode && (
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm font-semibold leading-tight mb-0.5 truncate" title={profile.full_name}>
                  {(() => {
                    const parts = profile.full_name.split(' ');
                    const firstName = parts[0];
                    const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1].charAt(0)}.` : '';
                    return `${firstName}${lastInitial}`;
                  })()}
                </p>
                <p className="text-[10px] md:text-xs text-muted-foreground leading-tight">
                  {calculateTotalHours()} hrs
                </p>
                {canViewAllWages && (
                  <p className="text-[10px] md:text-xs text-muted-foreground leading-tight">
                    ${calculateTotalWages()}
                  </p>
                )}
              </div>
            )}
            {isCompactMode && (
              <p className="text-xs font-medium leading-tight truncate" title={profile.full_name}>
                {(() => {
                  const parts = profile.full_name.split(' ');
                  const firstName = parts[0];
                  const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1].charAt(0)}.` : '';
                  return `${firstName}${lastInitial}`;
                })()}
              </p>
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
  isCompactMode = false
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
}) {
  const dropId = `drop-${userId}-${dayIndex}`;
  const {
    setNodeRef,
    isOver
  } = useDroppable({
    id: dropId
  });
  
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
  
  return <div ref={setNodeRef} style={{
    touchAction: 'none'
  }} className={`${isCompactMode ? 'min-h-[44px] p-1' : 'min-h-[80px] p-1.5'} border-r last:border-r-0 border-border transition-colors ${isOver ? "bg-accent/50" : "hover:bg-muted/30"}`}>
      <div className="space-y-1">
        {/* Weekly Availability Indicator */}
        {hasLimitedAvailability && userId !== "unassigned" && (
          <div className="p-1 bg-blue-500/10 dark:bg-blue-400/10 border border-blue-500/30 dark:border-blue-400/30 border-dashed rounded text-[10px]">
            <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
              <Clock className="h-2.5 w-2.5" />
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
          return <ShiftCard key={shift.id} shift={shift} onDelete={onUpdate} canTakeShift={canTakeShifts} currentUserId={currentUserId} onTakeShift={onUpdate} onEdit={() => onEditShift?.(shift)} isPublished={!isShiftDraft} isCompactMode={isCompactMode} />;
        })}
        {availabilityRequests.map(request => (
          <div key={request.id} className="p-1 bg-muted/30 border-dashed border rounded relative text-[10px]" style={{
            background: "repeating-linear-gradient(45deg, rgba(150,150,150,0.1), rgba(150,150,150,0.1) 10px, transparent 10px, transparent 20px)"
          }}>
            <div className="text-[10px] text-muted-foreground font-medium">
              {request.time_scope === "partial_day" && request.start_time && request.end_time 
                ? `${formatTime12h(request.start_time)} - ${formatTime12h(request.end_time)}` 
                : "Time Off"}
            </div>
            {request.status === "pending" && (
              <div className="text-[9px] font-semibold text-amber-600 dark:text-amber-500 uppercase tracking-wide">
                PENDING
              </div>
            )}
          </div>
        ))}
      </div>
    </div>;
}

export const EmployeeRow = memo(EmployeeRowComponent);