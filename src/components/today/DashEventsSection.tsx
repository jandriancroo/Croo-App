import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { useUserRole } from '@/hooks/useUserRole';
import { getDayOfWeekInTimezone } from '@/utils/dateUtils';
import { filterEventsByRole } from '@/utils/eventRoleFilter';
import { EventsSection, type SectionEvent } from './EventsSection';

/**
 * Today's schedule events on the mobile Dash (same rows as the mobile schedule).
 * Daily-task events are left out here because they already sit in Quick Tasks.
 */
export function DashEventsSection() {
  const navigate = useNavigate();
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const { role } = useUserRole();
  const dow = getDayOfWeekInTimezone();

  const { data: events = [] } = useQuery({
    queryKey: ['dash-today-events', currentLocation?.id, dow, role],
    enabled: !!currentLocation?.id && !!role,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_events')
        .select('id, event_name, event_time, day_of_week, days_of_week, tagged_roles, is_daily_task')
        .eq('location_id', currentLocation!.id);
      if (error) throw error;
      const today = (data || []).filter((e: any) => !e.is_daily_task && (
        e.days_of_week && e.days_of_week.length > 0 ? e.days_of_week.includes(dow) : e.day_of_week === dow
      )).map((e: any) => ({ ...e, tagged_roles: e.tagged_roles as string[] | null }));
      return (filterEventsByRole(today, role) as SectionEvent[])
        .sort((a, b) => a.event_time.localeCompare(b.event_time));
    },
  });

  const nowHHMM = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  return (
    <EventsSection
      events={events}
      storageKey="croo:dash:events-collapsed"
      nowHHMM={nowHHMM}
      onSelect={() => navigate('/schedule')}
    />
  );
}
