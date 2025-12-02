import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShiftCard } from "./ShiftCard";
import { addDays } from "date-fns";
import { useNavigate } from "react-router-dom";
import { GripVertical } from "lucide-react";
interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  hourly_wage?: number;
  display_order?: number;
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
}
export function EmployeeRow({
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
  publishedSnapshot
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
    const wage = profile.hourly_wage || 15.00;
    return (hours * wage).toFixed(2);
  };
  return <div ref={setNodeRef} style={style} className="grid grid-cols-8 gap-0 border-b border-dotted border-border/50 relative">
      {/* Drag Handle in Left Margin */}
      {isDraggable && profile.id !== "unassigned" && <div {...attributes} {...listeners} className="absolute -left-6 top-0 bottom-0 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground z-20">
          <GripVertical className="h-5 w-5" />
        </div>}
      
      <div className="flex items-center gap-3 p-3 border-r border-border bg-muted/30 min-h-[70px]">
        {profile.id !== "unassigned" ? <div onClick={() => navigate('/users', {
        state: {
          viewUserId: profile.id
        }
      })} className="flex items-center gap-3 cursor-pointer hover:bg-accent/50 rounded p-2 transition-colors flex-1 min-w-0 px-0 py-[6px]">
            <Avatar className="h-12 w-12 flex-shrink-0">
              <AvatarImage src={profile.profile_photo_url || undefined} />
              <AvatarFallback className="text-base">{profile.full_name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold leading-tight mb-1">{profile.full_name}</p>
              <p className="text-sm text-muted-foreground leading-tight">
                {calculateTotalHours()} hrs • ${calculateTotalWages()}
              </p>
            </div>
          </div> : <span className="text-sm font-medium text-muted-foreground">Unassigned</span>}
      </div>

      {weekDays.map((day, dayIndex) => {
      const dayShifts = shifts.filter(s => s.day_of_week === dayIndex);
      const dayAvailability = availabilityRequests.filter(r => {
        const reqDate = new Date(r.start_date);
        const cellDate = day;
        if (r.time_scope === "multi_day" && r.end_date) {
          const endDate = new Date(r.end_date);
          return cellDate >= reqDate && cellDate <= endDate;
        }
        return reqDate.toDateString() === cellDate.toDateString();
      });
      return <DayCell key={dayIndex} userId={profile.id} dayIndex={dayIndex} shifts={dayShifts} availabilityRequests={dayAvailability} onUpdate={onUpdate} canTakeShifts={canTakeShifts} currentUserId={currentUserId} onEditShift={onEditShift} isPublished={isPublished} publishedSnapshot={publishedSnapshot} />;
    })}
    </div>;
}
function DayCell({
  userId,
  dayIndex,
  shifts,
  availabilityRequests,
  onUpdate,
  canTakeShifts,
  currentUserId,
  onEditShift,
  isPublished,
  publishedSnapshot
}: {
  userId: string;
  dayIndex: number;
  shifts: any[];
  availabilityRequests: any[];
  onUpdate: () => void;
  canTakeShifts?: boolean;
  currentUserId?: string;
  onEditShift?: (shift: any) => void;
  isPublished?: boolean;
  publishedSnapshot?: any[];
}) {
  const dropId = `drop-${userId}-${dayIndex}`;
  const {
    setNodeRef,
    isOver
  } = useDroppable({
    id: dropId
  });
  return <div ref={setNodeRef} style={{
    touchAction: 'none'
  }} className={`min-h-[70px] p-2 border-r last:border-r-0 border-border transition-colors ${isOver ? "bg-accent/50" : "hover:bg-muted/30"}`}>
      <div className="space-y-1">
        {shifts.map(shift => {
          // A shift is a draft if schedule is unpublished AND shift wasn't in the published snapshot
          const isShiftDraft = !isPublished && (!publishedSnapshot || !publishedSnapshot.some((s: any) => s.id === shift.id));
          return <ShiftCard key={shift.id} shift={shift} onDelete={onUpdate} canTakeShift={canTakeShifts} currentUserId={currentUserId} onTakeShift={onUpdate} onEdit={() => onEditShift?.(shift)} isPublished={!isShiftDraft} />;
        })}
        {availabilityRequests.map(request => <div key={request.id} className="p-1 bg-muted/30 border-dashed border rounded relative text-[10px]" style={{
        background: "repeating-linear-gradient(45deg, rgba(150,150,150,0.1), rgba(150,150,150,0.1) 10px, transparent 10px, transparent 20px)"
      }}>
            <div className="text-[10px] text-muted-foreground font-medium">
              {request.time_scope === "partial_day" && request.start_time && request.end_time ? `${request.start_time} - ${request.end_time}` : "Time Off"}
            </div>
          </div>)}
      </div>
    </div>;
}