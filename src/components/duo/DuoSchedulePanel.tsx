// Duo open mode, right panel: the phone Schedule view with its own data hook.
// Mirrors the mobile branch of pages/Schedule.tsx so both panels stay in sync
// with the real Schedule page. Rendered only when html.duo-open is set.
import { useMemo } from 'react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { MobileScheduleView } from '@/components/schedule/MobileScheduleView';
import { useScheduleData } from '@/hooks/useScheduleData';
import { useScheduleApproval } from '@/hooks/useScheduleApproval';

export function DuoSchedulePanel() {
  const queryClient = useQueryClient();
  const data = useScheduleData();
  const {
    currentWeekStart, setCurrentWeekStart, shifts, events, profiles, templates,
    isPublished, publishedSnapshot, scheduleId, isPublishing, hasPendingChanges,
    loading, locationSettings, availabilityRequests, lastWeekShifts,
    fetchScheduleData, handleGoLive, currentLocation,
  } = data;

  const shiftsSig = useMemo(
    () => shifts.map((s: any) => `${s.id}${s.user_id}${s.start_time}${s.end_time}${s.is_time_off ? 1 : 0}`).join('|'),
    [shifts],
  );
  const approval = useScheduleApproval(scheduleId, currentLocation?.id, isPublished, shiftsSig);

  return (
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
      onRestored={() => fetchScheduleData(false)}
      approval={approval}
      onApprovalChanged={() => fetchScheduleData(false)}
      isPublishing={isPublishing}
      hasPendingChanges={hasPendingChanges}
      isLoading={loading}
      locationSettings={locationSettings}
      availabilityRequests={availabilityRequests}
      lastWeekShifts={lastWeekShifts}
    />
  );
}
