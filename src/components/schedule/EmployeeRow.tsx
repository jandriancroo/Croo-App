import { useDroppable } from "@dnd-kit/core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShiftCard } from "./ShiftCard";
import { addDays } from "date-fns";

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  hourly_wage?: number;
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
  onEditShift 
}: EmployeeRowProps) {
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

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

  return (
    <div className="grid grid-cols-8 gap-0 border-b border-dotted border-border/50">
      <div className="flex flex-col justify-center gap-1 p-4 border-r border-border bg-muted/30">
        {profile.id !== "unassigned" ? (
          <>
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={profile.profile_photo_url || undefined} />
                <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{profile.full_name}</span>
            </div>
            <div className="text-xs text-muted-foreground ml-10">
              {calculateTotalHours()} hrs
            </div>
            <div className="text-xs font-semibold text-primary ml-10">
              ${calculateTotalWages()}
            </div>
          </>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">Unassigned</span>
        )}
      </div>

      {weekDays.map((day, dayIndex) => {
        const dayShifts = shifts.filter((s) => s.day_of_week === dayIndex);
        const dayAvailability = availabilityRequests.filter((r) => {
          const reqDate = new Date(r.start_date);
          const cellDate = day;
          
          if (r.time_scope === "multi_day" && r.end_date) {
            const endDate = new Date(r.end_date);
            return cellDate >= reqDate && cellDate <= endDate;
          }
          return reqDate.toDateString() === cellDate.toDateString();
        });
        
        return (
          <DayCell 
            key={dayIndex} 
            userId={profile.id} 
            dayIndex={dayIndex} 
            shifts={dayShifts}
            availabilityRequests={dayAvailability}
            onUpdate={onUpdate}
            canTakeShifts={canTakeShifts}
            currentUserId={currentUserId}
            onEditShift={onEditShift}
          />
        );
      })}
    </div>
  );
}

function DayCell({ 
  userId, 
  dayIndex, 
  shifts,
  availabilityRequests,
  onUpdate, 
  canTakeShifts, 
  currentUserId,
  onEditShift 
}: { 
  userId: string; 
  dayIndex: number; 
  shifts: any[];
  availabilityRequests: any[];
  onUpdate: () => void;
  canTakeShifts?: boolean;
  currentUserId?: string;
  onEditShift?: (shift: any) => void;
}) {
  const dropId = `drop-${userId}-${dayIndex}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
  });

  return (
    <div 
      ref={setNodeRef} 
      className={`min-h-[80px] p-2 border-r last:border-r-0 border-border transition-colors ${
        isOver ? "bg-accent/50" : "hover:bg-muted/30"
      }`}
    >
      <div className="space-y-1">
        {shifts.map((shift) => (
          <ShiftCard 
            key={shift.id} 
            shift={shift} 
            onDelete={onUpdate}
            canTakeShift={canTakeShifts}
            currentUserId={currentUserId}
            onTakeShift={onUpdate}
            onEdit={() => onEditShift?.(shift)}
          />
        ))}
        {availabilityRequests.map((request) => (
          <div 
            key={request.id}
            className="p-2 bg-muted/30 border-dashed border-2 rounded relative"
            style={{
              background: "repeating-linear-gradient(45deg, rgba(150,150,150,0.1), rgba(150,150,150,0.1) 10px, transparent 10px, transparent 20px)",
            }}
          >
            <div className="text-xs text-muted-foreground font-medium">
              {request.time_scope === "partial_day" && request.start_time && request.end_time
                ? `${request.start_time} - ${request.end_time}`
                : "Time Off"}
            </div>
            <div className="text-xs text-muted-foreground">
              {request.status === "pending" ? "Pending" : "Approved"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
