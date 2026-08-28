import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, AlertTriangle, Radio, Clock, UserPlus, Bug } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatTime12Hour } from "@/lib/utils";
import { useLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { getDateDayOfWeekInTimezone } from "@/utils/dateUtils";
import { PageTitle } from "@/components/PageTitle";
import { useUserRole } from "@/hooks/useUserRole";
import { CreateTicketDialog } from "@/components/support/CreateTicketDialog";
import { Button } from "@/components/ui/button";

export default function Alerts() {
  const navigate = useNavigate();
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();
  const { isSuperAdmin } = useUserRole();
  const [showCreateTicket, setShowCreateTicket] = useState(false);

  const { data: logbookAlerts = [] } = useQuery({
    queryKey: ['all-logbook-alerts', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: alertCategories } = await supabase
        .from('logbook_categories')
        .select('id')
        .eq('alert_enabled', true)
        .eq('is_active', true)
        .eq('location_id', currentLocation.id);

      if (!alertCategories || alertCategories.length === 0) return [];

      const { data: entries } = await supabase
        .from('logbook_entries')
        .select(`
          id,
          entry_date,
          created_at,
          logbook_categories(name),
          profiles(full_name, profile_photo_url)
        `)
        .in('category_id', alertCategories.map(c => c.id))
        .eq('location_id', currentLocation.id)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      return entries?.map(e => ({ ...e, type: 'logbook' })) || [];
    },
    enabled: !!currentLocation?.id,
  });

  const { data: punchClockAlerts = [] } = useQuery({
    queryKey: ['punch-clock-alerts', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Get all scheduled shifts from the last 7 days
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select(`
          id,
          shift_date,
          start_time,
          user_id,
          schedule_id,
          profiles(full_name, profile_photo_url)
        `)
        .gte('shift_date', format(sevenDaysAgo, 'yyyy-MM-dd'))
        .lte('shift_date', format(new Date(), 'yyyy-MM-dd'))
        .not('user_id', 'is', null);

      if (!shifts || shifts.length === 0) return [];

      // Filter shifts by location via schedules
      const { data: schedules } = await supabase
        .from('schedules')
        .select('id')
        .eq('location_id', currentLocation.id);

      const scheduleIds = new Set(schedules?.map(s => s.id) || []);
      const locationShifts = shifts.filter(s => s.schedule_id && scheduleIds.has(s.schedule_id));

      if (locationShifts.length === 0) return [];

      // Get all time punches for these shifts
      const { data: punches } = await supabase
        .from('time_punches')
        .select('shift_id, punch_time, punch_type')
        .in('shift_id', locationShifts.map(s => s.id))
        .eq('punch_type', 'clock_in');

      const alerts = [];
      const now = new Date();

      for (const shift of locationShifts) {
        const shiftDateTime = parseISO(`${shift.shift_date}T${shift.start_time}`);
        const tenMinutesAfterStart = new Date(shiftDateTime.getTime() + 10 * 60 * 1000);
        
        // Only consider shifts that have already started + 10 minutes
        if (tenMinutesAfterStart > now) continue;

        // Check if there's a punch for this shift
        const punch = punches?.find(p => p.shift_id === shift.id);

        if (!punch) {
          // No punch at all - missed punch
          alerts.push({
            id: `missing-${shift.id}`,
            shift_id: shift.id,
            shift_date: shift.shift_date,
            shift_start_time: shift.start_time,
            status: 'missing',
            profile: shift.profiles,
            type: 'punch_clock',
          });
        } else {
          // Check if late (more than 10 minutes after start)
          const punchTime = new Date(punch.punch_time);
          if (punchTime > tenMinutesAfterStart) {
            const minutesLate = Math.floor((punchTime.getTime() - shiftDateTime.getTime()) / (1000 * 60));
            alerts.push({
              id: `late-${shift.id}`,
              shift_id: shift.id,
              shift_date: shift.shift_date,
              shift_start_time: shift.start_time,
              punch_time: punch.punch_time,
              minutes_late: minutesLate,
              status: 'late',
              profile: shift.profiles,
              type: 'punch_clock',
            });
          }
        }
      }

      return alerts;
    },
    enabled: !!currentLocation?.id,
  });

  const { data: checklistAlerts = [] } = useQuery({
    queryKey: ['all-checklist-alerts', currentLocation?.id, timezone],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Fetch all data upfront in parallel
      const [checklistsResult, submissionsResult, shiftsResult, userRolesResult, profilesResult] = await Promise.all([
        supabase
          .from('checklists')
          .select(`
            id,
            title,
            frequency,
            template_type,
            due_by_time,
            checklist_items(id, days_of_week, deleted_at)
          `)
          .eq('is_active', true)
          .neq('template_type', 'training')
          .eq('location_id', currentLocation.id),
        
        supabase
          .from('checklist_submissions')
          .select(`
            id,
            checklist_id,
            submitted_at,
            checklist_responses(id, item_id)
          `)
          .eq('location_id', currentLocation.id)
          .gte('submitted_at', sevenDaysAgo.toISOString())
          .order('submitted_at', { ascending: false }),
        
        // Get all shifts for the last 7 days for manager lookup
        supabase
          .from('scheduled_shifts')
          .select('user_id, start_time, end_time, shift_date')
          .gte('shift_date', format(sevenDaysAgo, 'yyyy-MM-dd'))
          .lte('shift_date', format(new Date(), 'yyyy-MM-dd')),
        
        // Get all admin/manager roles
        supabase
          .from('user_roles')
          .select('user_id, role')
          .in('role', ['admin', 'manager', 'shift_manager', 'shift_manager_in_training']),
        
        // Get all profiles
        supabase
          .from('profiles')
          .select('id, full_name')
      ]);

      const checklists = checklistsResult.data || [];
      const submissions = submissionsResult.data || [];
      const shifts = shiftsResult.data || [];
      const userRoles = userRolesResult.data || [];
      const profiles = profilesResult.data || [];

      if (checklists.length === 0) return [];

      // Create lookup maps for faster access
      const managerUserIds = new Set(userRoles.map(ur => ur.user_id));
      const profileMap = new Map(profiles.map(p => [p.id, p.full_name]));

      // Use a Map to deduplicate alerts by checklist_id + date string
      const alertsMap = new Map<string, any>();
      
      const dailyChecklists = checklists.filter(c => 
        c.frequency === 'daily' || c.template_type === 'dynamic'
      );
      const now = new Date();

      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        // Use timezone-aware day of week (Mon=0, Sun=6)
        const dayOfWeek = getDateDayOfWeekInTimezone(date, timezone);
        const isToday = i === 0;
        const dateStr = format(date, 'yyyy-MM-dd');

        for (const checklist of dailyChecklists) {
          // Create unique key for deduplication
          const alertKey = `${checklist.id}-${dateStr}`;
          
          // Skip if we already have this alert
          if (alertsMap.has(alertKey)) continue;

          // Check if checklist is due based on due_by_time
          if (checklist.due_by_time) {
            const [hours, minutes] = checklist.due_by_time.split(':').map(Number);
            const dueTime = new Date(date);
            dueTime.setHours(hours, minutes, 0, 0);
            
            // For today: only show alert if current time is past due time
            if (isToday && now < dueTime) {
              continue;
            }
          }

          // Overdue pings never fire for an archived (pulled) task.
          const liveItems = (checklist.checklist_items || []).filter((item: any) => !item.deleted_at);
          let totalItems = liveItems.length;
          if (checklist.template_type === 'dynamic') {
            totalItems = liveItems.filter((item: any) => 
              item.days_of_week && item.days_of_week.includes(dayOfWeek)
            ).length;
          }

          if (totalItems === 0) continue;

          // Filter submissions for this checklist and day
          const dayStart = date.getTime();
          const dayEnd = dayStart + 24 * 60 * 60 * 1000;
          
          const daySubmissions = submissions.filter(s => {
            const subTime = new Date(s.submitted_at).getTime();
            return s.checklist_id === checklist.id && subTime >= dayStart && subTime < dayEnd;
          });

          // Count unique completed items
          const uniqueItemIds = new Set<string>();
          daySubmissions.forEach((sub: any) => {
            sub.checklist_responses?.forEach((response: any) => {
              if (response.item_id) {
                uniqueItemIds.add(response.item_id);
              }
            });
          });
          const totalResponses = uniqueItemIds.size;

          const completionRate = totalItems > 0 ? (totalResponses / totalItems) : 0;
          
          if (completionRate < 1) {
            // Set alert time to the due time if available
            let alertTime = new Date(date);
            if (checklist.due_by_time) {
              const [hours, minutes] = checklist.due_by_time.split(':').map(Number);
              alertTime.setHours(hours, minutes, 0, 0);
            }
            
            // Find managers scheduled during this checklist's due time (using pre-fetched data)
            const managerNames: string[] = [];
            if (checklist.due_by_time) {
              const [hours, minutes] = checklist.due_by_time.split(':').map(Number);
              const dueTimeMinutes = hours * 60 + minutes;

              const dayShifts = shifts.filter(s => s.shift_date === dateStr);
              
              for (const shift of dayShifts) {
                if (!shift.user_id || !managerUserIds.has(shift.user_id)) continue;
                
                const [startH, startM] = shift.start_time.split(':').map(Number);
                const [endH, endM] = shift.end_time.split(':').map(Number);
                const startMinutes = startH * 60 + startM;
                const endMinutes = endH * 60 + endM;
                
                if (startMinutes <= dueTimeMinutes && endMinutes >= dueTimeMinutes) {
                  const fullName = profileMap.get(shift.user_id);
                  if (fullName) {
                    const firstName = fullName.split(' ')[0];
                    if (!managerNames.includes(firstName)) {
                      managerNames.push(firstName);
                    }
                  }
                }
              }
            }
            
            alertsMap.set(alertKey, {
              id: alertKey,
              checklist_id: checklist.id,
              title: checklist.title,
              date: alertTime.toISOString(),
              status: completionRate === 0 ? 'incomplete' : 'partial',
              completionRate: Math.round(completionRate * 100),
              type: 'checklist',
              managerNames: managerNames.length > 0 ? managerNames : undefined,
            });
          }
        }
      }

      return Array.from(alertsMap.values());
    },
    enabled: !!currentLocation?.id,
  });

  const { data: signupAlerts = [] } = useQuery({
    queryKey: ['user-signup-alerts'],
    queryFn: async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: signups } = await supabase
        .from('user_signup_alerts')
        .select(`
          id,
          signed_up_at,
          created_at,
          profiles(full_name, profile_photo_url, email)
        `)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      return signups?.map(s => ({ ...s, type: 'signup' })) || [];
    },
  });

  const allAlerts = [
    ...logbookAlerts,
    ...checklistAlerts,
    ...punchClockAlerts,
    ...signupAlerts,
  ].sort((a, b) => {
    const dateA = new Date(a.created_at || a.date || a.shift_date);
    const dateB = new Date(b.created_at || b.date || b.shift_date);
    return dateB.getTime() - dateA.getTime();
  });

  const renderAlert = (alert: any) => (
    <Card 
      key={alert.id}
      className={`cursor-pointer hover:shadow-md transition-shadow ${
        alert.type === 'logbook' 
          ? 'border-l-4 border-l-orange-500' 
          : alert.type === 'punch_clock'
          ? 'border-l-4 border-l-blue-500'
          : alert.type === 'signup'
          ? 'border-l-4 border-l-green-500'
          : 'border-l-4 border-l-destructive'
      }`}
      onClick={() => navigate(
        alert.type === 'logbook' ? '/logbook' 
        : alert.type === 'punch_clock' ? '/payroll-review'
        : alert.type === 'signup' ? '/users'
        : `/complete-checklist/${alert.checklist_id}`
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            {alert.type === 'logbook' ? (
              <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5" />
            ) : alert.type === 'punch_clock' ? (
              <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
            ) : alert.type === 'signup' ? (
              <UserPlus className="h-5 w-5 text-green-600 mt-0.5" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            )}
            <div>
              <CardTitle className="text-base">
                {alert.type === 'logbook' 
                  ? alert.logbook_categories?.name 
                  : alert.type === 'punch_clock'
                  ? `${alert.status === 'missing' ? 'Missed Punch' : 'Late Punch'} - ${alert.profile?.full_name}`
                  : alert.type === 'signup'
                  ? `New User Joined - ${alert.profiles?.full_name}`
                  : alert.title}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                {alert.type === 'punch_clock' 
                  ? `${format(parseISO(alert.shift_date), 'MMM d, yyyy')} • Shift: ${formatTime12Hour(alert.shift_start_time)}`
                  : format(new Date(alert.created_at || alert.date), 'MMM d, yyyy • h:mm a')}
                {alert.managerNames && alert.managerNames.length > 0 && (
                  <span className="text-muted-foreground"> • {alert.managerNames.join(', ')}</span>
                )}
              </CardDescription>
            </div>
          </div>
          <Badge variant={
            alert.type === 'logbook' ? 'secondary' 
            : alert.type === 'punch_clock' ? 'outline'
            : alert.type === 'signup' ? 'default'
            : 'destructive'
          }>
            {alert.type === 'logbook' ? 'Log' 
             : alert.type === 'punch_clock' ? 'Punch Clock'
             : alert.type === 'signup' ? 'New User'
             : 'Checklist'}
          </Badge>
        </div>
      </CardHeader>
      {alert.type === 'logbook' && alert.profiles && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={alert.profiles.profile_photo_url || ''} />
              <AvatarFallback className="text-xs">
                {alert.profiles.full_name?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-muted-foreground">
              {alert.profiles.full_name}
            </span>
          </div>
        </CardContent>
      )}
      {alert.type === 'signup' && alert.profiles && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarImage src={alert.profiles.profile_photo_url || ''} />
              <AvatarFallback>
                {alert.profiles.full_name?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{alert.profiles.full_name}</span>
              <span className="text-xs text-muted-foreground">{alert.profiles.email}</span>
            </div>
          </div>
        </CardContent>
      )}
      {alert.type === 'punch_clock' && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={alert.profile?.profile_photo_url || ''} />
              <AvatarFallback className="text-xs">
                {alert.profile?.full_name?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-muted-foreground">
              {alert.status === 'late' 
                ? `Clocked in ${alert.minutes_late} min late`
                : 'No clock-in recorded'}
            </span>
          </div>
        </CardContent>
      )}
      {alert.type === 'checklist' && (
        <CardContent className="pt-0">
          <Badge 
            variant={alert.status === 'incomplete' ? 'destructive' : 'secondary'}
            className="text-xs"
          >
            {alert.status === 'incomplete' ? 'Not Started' : `${alert.completionRate}% Complete`}
          </Badge>
        </CardContent>
      )}
    </Card>
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Radio className="h-8 w-8 text-destructive" />
              <div className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full animate-pulse" />
            </div>
            <div>
              <PageTitle color="red">Alert Feed</PageTitle>
              <p className="text-muted-foreground">Live monitoring of all system alerts</p>
            </div>
          </div>
          {isSuperAdmin && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowCreateTicket(true)}>
              <Bug className="h-4 w-4" />
              Report Bug
            </Button>
          )}
        </div>

        {isSuperAdmin && (
          <CreateTicketDialog open={showCreateTicket} onOpenChange={setShowCreateTicket} />
        )}

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="w-full flex flex-wrap gap-2 h-auto md:grid md:grid-cols-5 p-1">
            <TabsTrigger value="all" className="flex-1 min-w-[100px]">
              All ({allAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="punch" className="flex-1 min-w-[100px]">
              Punch Clock ({punchClockAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="logbook" className="flex-1 min-w-[100px]">
              Log ({logbookAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="checklists" className="flex-1 min-w-[100px]">
              Checklists ({checklistAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="signups" className="flex-1 min-w-[100px]">
              New Users ({signupAlerts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-3 mt-4">
            {allAlerts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No alerts in the last 7 days
                </CardContent>
              </Card>
            ) : (
              allAlerts.map(renderAlert)
            )}
          </TabsContent>

          <TabsContent value="punch" className="space-y-3 mt-4">
            {punchClockAlerts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No punch clock alerts in the last 7 days
                </CardContent>
              </Card>
            ) : (
              punchClockAlerts.map(renderAlert)
            )}
          </TabsContent>

          <TabsContent value="logbook" className="space-y-3 mt-4">
            {logbookAlerts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No logbook alerts in the last 7 days
                </CardContent>
              </Card>
            ) : (
              logbookAlerts.map(renderAlert)
            )}
          </TabsContent>

          <TabsContent value="checklists" className="space-y-3 mt-4">
            {checklistAlerts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No checklist alerts in the last 7 days
                </CardContent>
              </Card>
            ) : (
              checklistAlerts.map(renderAlert)
            )}
          </TabsContent>

          <TabsContent value="signups" className="space-y-3 mt-4">
            {signupAlerts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No new user signups in the last 7 days
                </CardContent>
              </Card>
            ) : (
              signupAlerts.map(renderAlert)
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
