import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTeamSalesVisibility } from '@/hooks/useTeamSalesVisibility';
import { ScheduleToolsPanel } from './ScheduleToolsPanel';

interface Profile {
  id: string;
  full_name: string;
  hourly_wage?: number;
}

interface ScheduledShift {
  id: string;
  user_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  shift_date: string;
}

interface LaborTotalsProps {
  shifts: ScheduledShift[];
  profiles: Profile[];
  currentWeekStart: Date;
  scheduleId?: string | null;
  isEditable?: boolean;
}

export function LaborTotals({
  shifts,
  profiles,
  currentWeekStart,
  scheduleId,
  isEditable = false
}: LaborTotalsProps) {
  const { canSeeSales } = useTeamSalesVisibility();
  const [isToolsOpen, setIsToolsOpen] = useState(false);

  // Only show labor totals to users who can view sales/labor
  if (!canSeeSales) {
    return null;
  }

  return (
    <>
      {/* Floating trigger button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsToolsOpen(true)}
        className="gap-1.5"
      >
        <BarChart3 className="h-4 w-4" />
        <span>Schedule Tools</span>
      </Button>

      {/* Side panel */}
      <ScheduleToolsPanel
        shifts={shifts}
        profiles={profiles}
        currentWeekStart={currentWeekStart}
        scheduleId={scheduleId}
        isEditable={isEditable}
        open={isToolsOpen}
        onOpenChange={setIsToolsOpen}
      />
    </>
  );
}
