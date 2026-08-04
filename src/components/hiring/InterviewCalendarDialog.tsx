import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';

import { format, parseISO, isSameDay, startOfWeek, endOfWeek } from 'date-fns';
import { Loader2, CalendarDays, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InterviewCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function InterviewCalendarDialog({ 
  open, 
  onOpenChange,
  organizationId
}: InterviewCalendarDialogProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Fetch interviews
  const { data: interviews, isLoading: interviewsLoading } = useQuery({
    queryKey: ['interviews', organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from('job_applications')
        .select('id, full_name, interview_date, interview_time, interview_status, location_id, location:locations(name)')
        .eq('organization_id', organizationId)
        .not('interview_date', 'is', null)
        .in('interview_status', ['pending', 'accepted']);
      
      return data || [];
    },
    enabled: open && !!organizationId,
  });

  // Fetch manager schedules for the week across ALL locations in the org
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  
  const { data: managerShifts, isLoading: shiftsLoading } = useQuery({
    queryKey: ['manager-shifts-org', organizationId, format(weekStart, 'yyyy-MM-dd')],
    queryFn: async () => {
      // Get all locations in this organization
      const { data: orgLocations } = await supabase
        .from('locations')
        .select('id')
        .eq('organization_id', organizationId);

      const locationIds = orgLocations?.map(l => l.id) || [];
      if (!locationIds.length) {
        return [];
      }

      // Get PUBLISHED schedules for these locations in the date range
      const { data: schedules } = await supabase
        .from('schedules')
        .select('id, location_id')
        .in('location_id', locationIds)
        .eq('is_published', true)
        .lte('week_start_date', format(weekEnd, 'yyyy-MM-dd'))
        .gte('week_end_date', format(weekStart, 'yyyy-MM-dd'));

      const scheduleIds = schedules?.map(s => s.id) || [];
      if (!scheduleIds.length) {
        return [];
      }

      // Get shifts for these schedules
      const { data: shifts, error } = await supabase
        .from('scheduled_shifts')
        .select('*')
        .in('schedule_id', scheduleIds)
        .gte('shift_date', format(weekStart, 'yyyy-MM-dd'))
        .lte('shift_date', format(weekEnd, 'yyyy-MM-dd'))
        .eq('is_time_off', false);

      if (error) {
        console.error('Error fetching shifts:', error);
        return [];
      }

      if (!shifts?.length) {
        return [];
      }

      // Get user IDs from shifts
      const shiftUserIds = [...new Set(shifts.map(s => s.user_id).filter(Boolean))];
      
      // Get manager roles for these users
      const { data: managerRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('user_id', shiftUserIds)
        .in('role', ['super_admin', 'admin', 'manager', 'shift_manager', 'shift_manager_in_training']);

      const managerUserIds = new Set(managerRoles?.map(r => r.user_id) || []);
      
      // Get profile data for managers
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', Array.from(managerUserIds));

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      // Filter shifts to only managers and attach profile data
      return shifts
        .filter(shift => managerUserIds.has(shift.user_id))
        .map(shift => ({
          ...shift,
          user: profileMap.get(shift.user_id) || null
        }));
    },
    enabled: open && !!organizationId,
  });

  // Get interviews for selected date
  const selectedDateInterviews = useMemo(() => {
    if (!interviews) return [];
    return interviews.filter(interview => 
      interview.interview_date && isSameDay(parseISO(interview.interview_date), selectedDate)
    );
  }, [interviews, selectedDate]);

  // Get manager shifts for selected date, sorted chronologically by start time
  const selectedDateShifts = useMemo(() => {
    if (!managerShifts) return [];
    return managerShifts
      .filter(shift => isSameDay(parseISO(shift.shift_date), selectedDate))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [managerShifts, selectedDate]);

  // Dates with interviews for calendar highlighting
  const interviewDates = useMemo(() => {
    if (!interviews) return new Set<string>();
    return new Set(interviews.map(i => i.interview_date).filter(Boolean));
  }, [interviews]);

  const formatTime12h = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const hour12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  const isLoading = interviewsLoading || shiftsLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Interview Calendar
          </DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0 overflow-hidden">
            {/* Calendar */}
            <div className="flex-shrink-0">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                className="rounded-md border pointer-events-auto"
                modifiers={{
                  hasInterview: (date) => interviewDates.has(format(date, 'yyyy-MM-dd'))
                }}
                modifiersStyles={{
                  hasInterview: { 
                    backgroundColor: 'hsl(var(--primary) / 0.2)',
                    fontWeight: 'bold'
                  }
                }}
              />
            </div>

            {/* Day Details - scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="space-y-4 pr-2">
                <div className="text-center pb-2 border-b sticky top-0 bg-background z-10">
                  <h3 className="font-semibold text-lg">
                    {format(selectedDate, 'EEEE, MMMM d')}
                  </h3>
                </div>

                {/* Interviews - compact 3-column table */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    Interviews ({selectedDateInterviews.length})
                  </h4>
                  {selectedDateInterviews.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic pl-6">
                      No interviews scheduled
                    </p>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-3 py-1.5 font-medium">Name</th>
                            <th className="text-left px-3 py-1.5 font-medium">Time</th>
                            <th className="text-right px-3 py-1.5 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {selectedDateInterviews.map(interview => (
                            <tr key={interview.id} className="hover:bg-muted/30">
                              <td className="px-3 py-2 font-medium">{interview.full_name}</td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {formatTime12h(interview.interview_time)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Badge 
                                  variant="outline"
                                  className={cn(
                                    "text-xs",
                                    interview.interview_status === 'accepted' 
                                      ? 'bg-green-500/10 text-green-600 border-green-500/30'
                                      : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                                  )}
                                >
                                  {interview.interview_status === 'accepted' ? 'Confirmed' : 'Invite Sent'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Manager Schedules */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    Managers Working ({selectedDateShifts.length})
                  </h4>
                  {selectedDateShifts.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic pl-6">
                      No managers scheduled
                    </p>
                  ) : (
                    <div className="space-y-1 pl-6">
                      {selectedDateShifts.map(shift => {
                        const shiftUser = Array.isArray(shift.user) ? shift.user[0] : shift.user;
                        return (
                          <div key={shift.id} className="flex items-center gap-2 text-sm">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={shiftUser?.profile_photo_url} />
                              <AvatarFallback className="text-[10px]">
                                {shiftUser?.full_name?.charAt(0) || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{shiftUser?.full_name || 'Unknown'}</span>
                            <span className="text-muted-foreground">
                              {formatTime12h(shift.start_time)} - {formatTime12h(shift.end_time)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}