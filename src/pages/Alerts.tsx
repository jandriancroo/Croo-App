import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, AlertTriangle, Radio, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useNavigate } from "react-router-dom";
import { formatTime12Hour } from "@/lib/utils";

export default function Alerts() {
  const navigate = useNavigate();

  const { data: logbookAlerts = [] } = useQuery({
    queryKey: ['all-logbook-alerts'],
    queryFn: async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: alertCategories } = await supabase
        .from('logbook_categories')
        .select('id')
        .eq('alert_enabled', true)
        .eq('is_active', true);

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
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      return entries?.map(e => ({ ...e, type: 'logbook' })) || [];
    },
  });

  const { data: punchClockAlerts = [] } = useQuery({
    queryKey: ['punch-clock-alerts'],
    queryFn: async () => {
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
          profiles(full_name, profile_photo_url)
        `)
        .gte('shift_date', format(sevenDaysAgo, 'yyyy-MM-dd'))
        .lte('shift_date', format(new Date(), 'yyyy-MM-dd'))
        .not('user_id', 'is', null);

      if (!shifts) return [];

      // Get all time punches for these shifts
      const { data: punches } = await supabase
        .from('time_punches')
        .select('shift_id, punch_time, punch_type')
        .in('shift_id', shifts.map(s => s.id))
        .eq('punch_type', 'clock_in');

      const alerts = [];
      const now = new Date();

      for (const shift of shifts) {
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
  });

  const { data: checklistAlerts = [] } = useQuery({
    queryKey: ['all-checklist-alerts'],
    queryFn: async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: checklists } = await supabase
        .from('checklists')
        .select(`
          id,
          title,
          frequency,
          template_type,
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true);

      if (!checklists) return [];

      const { data: submissions } = await supabase
        .from('checklist_submissions')
        .select(`
          id,
          checklist_id,
          submitted_at,
          checklist_responses(id)
        `)
        .gte('submitted_at', sevenDaysAgo.toISOString())
        .order('submitted_at', { ascending: false });

      const alerts = [];
      const dailyChecklists = checklists.filter(c => 
        c.frequency === 'daily' || c.template_type === 'dynamic'
      );

      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        const dayOfWeek = date.getDay();

        for (const checklist of dailyChecklists) {
          let totalItems = checklist.checklist_items?.length || 0;
          if (checklist.template_type === 'dynamic') {
            totalItems = checklist.checklist_items?.filter((item: any) => 
              item.days_of_week && item.days_of_week.includes(dayOfWeek)
            ).length || 0;
          }

          if (totalItems === 0) continue;

          const daySubmissions = submissions?.filter(s => {
            const subDate = new Date(s.submitted_at);
            return s.checklist_id === checklist.id && 
              subDate >= date && 
              subDate < new Date(date.getTime() + 24 * 60 * 60 * 1000);
          }) || [];

          const totalResponses = daySubmissions.reduce((sum, sub: any) => 
            sum + (sub.checklist_responses?.length || 0), 0
          );

          const completionRate = totalItems > 0 ? (totalResponses / totalItems) : 0;
          
          if (completionRate < 1) {
            alerts.push({
              id: `${checklist.id}-${date.toISOString()}`,
              checklist_id: checklist.id,
              title: checklist.title,
              date: date.toISOString(),
              status: completionRate === 0 ? 'incomplete' : 'partial',
              completionRate: Math.round(completionRate * 100),
              type: 'checklist',
            });
          }
        }
      }

      return alerts;
    },
  });

  const allAlerts = [
    ...logbookAlerts,
    ...checklistAlerts,
    ...punchClockAlerts,
  ].sort((a, b) => {
    const dateA = new Date(a.created_at || a.date || a.shift_date);
    const dateB = new Date(b.created_at || b.date || b.shift_date);
    return dateB.getTime() - dateA.getTime();
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Radio className="h-8 w-8 text-destructive" />
            <div className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full animate-pulse" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Alert Feed</h1>
            <p className="text-muted-foreground">Live monitoring of all system alerts</p>
          </div>
        </div>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="w-full flex flex-wrap gap-2 h-auto md:grid md:grid-cols-4 p-1">
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
          </TabsList>

          <TabsContent value="all" className="space-y-3 mt-4">
            {allAlerts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No alerts in the last 7 days
                </CardContent>
              </Card>
            ) : (
              allAlerts.map((alert: any) => (
                <Card 
                  key={alert.id}
                  className={`cursor-pointer hover:shadow-md transition-shadow ${
                    alert.type === 'logbook' 
                      ? 'border-l-4 border-l-orange-500' 
                      : alert.type === 'punch_clock'
                      ? 'border-l-4 border-l-blue-500'
                      : 'border-l-4 border-l-destructive'
                  }`}
                  onClick={() => navigate(
                    alert.type === 'logbook' ? '/logbook' 
                    : alert.type === 'punch_clock' ? '/payroll-review'
                    : '/tasks'
                  )}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        {alert.type === 'logbook' ? (
                          <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5" />
                        ) : alert.type === 'punch_clock' ? (
                          <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                        )}
                        <div>
                          <CardTitle className="text-base">
                            {alert.type === 'logbook' 
                              ? alert.logbook_categories?.name 
                              : alert.type === 'punch_clock'
                              ? `${alert.status === 'missing' ? 'Missed Punch' : 'Late Punch'} - ${alert.profile?.full_name}`
                              : alert.title}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {alert.type === 'punch_clock' 
                              ? `${format(parseISO(alert.shift_date), 'MMM d, yyyy')} • Shift: ${formatTime12Hour(alert.shift_start_time)}`
                              : format(new Date(alert.created_at || alert.date), 'MMM d, yyyy • h:mm a')}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant={
                        alert.type === 'logbook' ? 'secondary' 
                        : alert.type === 'punch_clock' ? 'outline'
                        : 'destructive'
                      }>
                        {alert.type === 'logbook' ? 'Log' 
                         : alert.type === 'punch_clock' ? 'Punch Clock'
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
                  {alert.type === 'punch_clock' && (
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-2">
                        {alert.status === 'missing' ? (
                          <Badge variant="destructive" className="text-xs">No Punch Recorded</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs border-blue-500 text-blue-700">
                            {alert.minutes_late} minutes late
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  )}
                  {alert.type === 'checklist' && (
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-2">
                        {alert.status === 'incomplete' ? (
                          <Badge variant="destructive" className="text-xs">Not Started</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-700">
                            {alert.completionRate}% Complete
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))
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
              punchClockAlerts.map((alert: any) => (
                <Card 
                  key={alert.id}
                  className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-blue-500"
                  onClick={() => navigate('/payroll-review')}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <Clock className="h-5 w-5 text-blue-600 mt-0.5" />
                        <div>
                          <CardTitle className="text-base">
                            {alert.status === 'missing' ? 'Missed Punch' : 'Late Punch'} - {alert.profile?.full_name}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {format(parseISO(alert.shift_date), 'MMM d, yyyy')} • Shift Start: {formatTime12Hour(alert.shift_start_time)}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant="outline" className="border-blue-500">Punch Clock</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={alert.profile?.profile_photo_url || ''} />
                          <AvatarFallback className="text-xs">
                            {alert.profile?.full_name?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-muted-foreground">
                          {alert.profile?.full_name}
                        </span>
                      </div>
                      {alert.status === 'missing' ? (
                        <Badge variant="destructive" className="text-xs">No Punch</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-blue-500 text-blue-700">
                          {alert.minutes_late} min late
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="logbook" className="space-y-3 mt-4">
            {logbookAlerts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No log alerts in the last 7 days
                </CardContent>
              </Card>
            ) : (
              logbookAlerts.map((alert: any) => (
                <Card 
                  key={alert.id}
                  className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-orange-500"
                  onClick={() => navigate('/logbook')}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-orange-600 mt-0.5" />
                        <div>
                          <CardTitle className="text-base">
                            {alert.logbook_categories?.name}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {format(new Date(alert.created_at), 'MMM d, yyyy • h:mm a')}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant="secondary">Log</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={alert.profiles?.profile_photo_url || ''} />
                        <AvatarFallback className="text-xs">
                          {alert.profiles?.full_name?.charAt(0) || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-muted-foreground">
                        {alert.profiles?.full_name}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))
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
              checklistAlerts.map((alert: any) => (
                <Card 
                  key={alert.id}
                  className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-destructive"
                  onClick={() => navigate('/tasks')}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                        <div>
                          <CardTitle className="text-base">
                            {alert.title}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {format(new Date(alert.date), 'MMM d, yyyy')}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant="destructive">Checklist</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-2">
                      {alert.status === 'incomplete' ? (
                        <Badge variant="destructive" className="text-xs">Not Started</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-700">
                          {alert.completionRate}% Complete
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
