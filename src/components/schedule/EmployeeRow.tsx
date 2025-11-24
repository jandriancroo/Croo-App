import { useDroppable } from "@dnd-kit/core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShiftCard } from "./ShiftCard";
import { startOfWeek, addDays } from "date-fns";

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface EmployeeRowProps {
  profile: Profile;
  shifts: any[];
  templates: any[];
  isEditable: boolean;
  onUpdate: () => void;
  canTakeShifts?: boolean;
  currentUserId?: string;
}

export function EmployeeRow({ profile, shifts, templates, isEditable, onUpdate, canTakeShifts, currentUserId }: EmployeeRowProps) {
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  return (
    <div className="grid grid-cols-8 gap-0">
      <div className="flex items-center gap-2 p-4 border-r border-border bg-muted/30">
        {profile.id !== "unassigned" ? (
          <>
            <Avatar className="h-8 w-8">
              <AvatarImage src={profile.profile_photo_url || undefined} />
              <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium truncate">{profile.full_name}</span>
          </>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">Unassigned</span>
        )}
      </div>

      {weekDays.map((day, dayIndex) => {
        const dayShifts = shifts.filter((s) => s.day_of_week === dayIndex);
        return (
          <DayCell 
            key={dayIndex} 
            userId={profile.id} 
            dayIndex={dayIndex} 
            shifts={dayShifts} 
            onUpdate={onUpdate}
            canTakeShifts={canTakeShifts}
            currentUserId={currentUserId}
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
  onUpdate, 
  canTakeShifts, 
  currentUserId 
}: { 
  userId: string; 
  dayIndex: number; 
  shifts: any[]; 
  onUpdate: () => void;
  canTakeShifts?: boolean;
  currentUserId?: string;
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
          />
        ))}
      </div>
    </div>
  );
}
