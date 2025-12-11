import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { format, parseISO, isSameDay, startOfWeek, endOfWeek, addDays } from 'date-fns';
import { Loader2, CalendarDays, Users, Clock, UserCircle } from 'lucide-react';
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
  const { currentLocation } = useLocation();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Fetch interviews
  const { data: interviews, isLoading: interviewsLoading } = useQuery({
    queryKey: ['interviews', organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from('job_applications')
        .select('id, full_name, interview_date, interview_time, interview_status, location:locations(name)')
        .eq('organization_id', organizationId)
        .not('interview_date', 'is', null)
        .in('interview_status', ['pending', 'accepted']);
      
      return data || [];
    },
    enabled: open && !!organizationId,
  });

  // Fetch manager schedules for the week
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
  
  const { data: managerShifts, isLoading: shiftsLoading } = useQuery({
    queryKey: ['manager-shifts', currentLocation?.id, format(weekStart, 'yyyy-MM-dd')],
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      // Get managers at this location (manager roles and above)
      const { data: managers } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['super_admin', 'admin', 'general_manager', 'shift_manager']);

      // Get users at this location
      const { data: locationUsers } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);

      const locationUserIds = new Set(locationUsers?.map(u => u.user_id) || []);
      
      // Include super_admins regardless of location assignment
      const superAdminIds = new Set(managers?.filter(m => m.role === 'super_admin').map(m => m.user_id) || []);
      
      const managerIds = managers
        ?.filter(m => locationUserIds.has(m.user_id) || superAdminIds.has(m.user_id))
        .map(m => m.user_id) || [];

      if (!managerIds.length) return [];

      // Get schedules for this location in the date range
      const { data: schedules } = await supabase
        .from('schedules')
        .select('id')
        .eq('location_id', currentLocation.id)
        .gte('week_end_date', format(weekStart, 'yyyy-MM-dd'))
        .lte('week_start_date', format(weekEnd, 'yyyy-MM-dd'));

      const scheduleIds = schedules?.map(s => s.id) || [];
      if (!scheduleIds.length) return [];

      // Get shifts for managers at this location's schedules
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select(`
          *,
          user:profiles(id, full_name, profile_photo_url)
        `)
        .in('user_id', managerIds)
        .in('schedule_id', scheduleIds)
        .gte('shift_date', format(weekStart, 'yyyy-MM-dd'))
        .lte('shift_date', format(weekEnd, 'yyyy-MM-dd'))
        .eq('is_time_off', false);

      return shifts || [];
    },
    enabled: open && !!currentLocation?.id,
  });

  // Get interviews for selected date
  const selectedDateInterviews = useMemo(() => {
    if (!interviews) return [];
    return interviews.filter(interview => 
      interview.interview_date && isSameDay(parseISO(interview.interview_date), selectedDate)
    );
  }, [interviews, selectedDate]);

  // Get manager shifts for selected date
  const selectedDateShifts = useMemo(() => {
    if (!managerShifts) return [];
    return managerShifts.filter(shift => 
      isSameDay(parseISO(shift.shift_date), selectedDate)
    );
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
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
          <div className="flex flex-col md:flex-row gap-4 flex-1 overflow-hidden">
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

            {/* Day Details */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-4 pr-4">
                <div className="text-center pb-2 border-b">
                  <h3 className="font-semibold text-lg">
                    {format(selectedDate, 'EEEE, MMMM d')}
                  </h3>
                </div>

                {/* Interviews */}
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
                    selectedDateInterviews.map(interview => (
                      <Card key={interview.id} className="bg-primary/5 border-primary/20">
                        <CardContent className="py-2 px-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{interview.full_name}</p>
                              <p className="text-sm text-muted-foreground">
                                {formatTime12h(interview.interview_time)}
                              </p>
                            </div>
                            <Badge 
                              className={cn(
                                interview.interview_status === 'accepted' 
                                  ? 'bg-green-500/20 text-green-700 dark:text-green-300'
                                  : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                              )}
                            >
                              {interview.interview_status}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))
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
                    selectedDateShifts.map(shift => {
                      const shiftUser = Array.isArray(shift.user) ? shift.user[0] : shift.user;
                      return (
                        <Card key={shift.id} className="bg-muted/50">
                          <CardContent className="py-2 px-3">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={shiftUser?.profile_photo_url} />
                                <AvatarFallback>
                                  <UserCircle className="h-5 w-5" />
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1">
                                <p className="font-medium text-sm">
                                  {shiftUser?.full_name || 'Unknown'}
                                </p>
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatTime12h(shift.start_time)} - {formatTime12h(shift.end_time)}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}