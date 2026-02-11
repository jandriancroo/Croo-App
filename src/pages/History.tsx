import { useState, useMemo } from 'react';
import { format, startOfDay, endOfDay } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { History as HistoryIcon, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useQuery } from '@tanstack/react-query';
import { HistoryTimelineView, HistoryTimelineItem } from '@/components/history/HistoryTimelineView';

interface Submission {
  id: string;
  submitted_at: string;
  submitted_by: string;
  notes: string | null;
  checklists: {
    id: string;
    title: string;
    frequency: string;
  };
  profiles: {
    full_name: string | null;
    email: string;
    profile_photo_url: string | null;
  };
}

interface CompletedTask {
  id: string;
  title: string;
  description: string | null;
  completed_at: string;
  completed_by: string;
  accent_color: string | null;
  task_style: string | null;
  completer_name: string | null;
  completer_email: string | null;
  completer_photo: string | null;
}

interface AlarmCompletion {
  id: string;
  task_title: string;
  accent_color: string | null;
  completed_at: string;
  completed_by: string;
  completer_name: string | null;
  completer_email: string | null;
  completer_photo: string | null;
}

export default function History() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const navigate = useNavigate();
  const { currentLocation } = useAppLocation();

  const dateStart = startOfDay(selectedDate).toISOString();
  const dateEnd = endOfDay(selectedDate).toISOString();

  // Fetch submissions for the selected date
  const { data: submissions = [], isLoading: loadingSubmissions } = useQuery({
    queryKey: ['history-submissions', currentLocation?.id, format(selectedDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_submissions')
        .select(`
          id,
          submitted_at,
          submitted_by,
          notes,
          checklists (id, title, frequency),
          profiles (full_name, email, profile_photo_url)
        `)
        .eq('location_id', currentLocation?.id)
        .gte('submitted_at', dateStart)
        .lte('submitted_at', dateEnd)
        .order('submitted_at', { ascending: false });

      if (error) throw error;
      return (data || []) as Submission[];
    },
    enabled: !!currentLocation?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Fetch completed tasks for the selected date
  const { data: completedTasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ['history-tasks', currentLocation?.id, format(selectedDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('temporary_tasks')
        .select(`
          id,
          title,
          description,
          completed_at,
          completed_by,
          accent_color,
          task_style
        `)
        .eq('location_id', currentLocation?.id)
        .not('completed_at', 'is', null)
        .gte('completed_at', dateStart)
        .lte('completed_at', dateEnd)
        .order('completed_at', { ascending: false });

      if (error) throw error;

      // Fetch completer profiles in parallel
      const completedByIds = [...new Set((data || []).map(t => t.completed_by).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      
      if (completedByIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, profile_photo_url')
          .in('id', completedByIds);
        
        profilesMap = (profiles || []).reduce((acc, p) => {
          acc[p.id] = p;
          return acc;
        }, {} as Record<string, any>);
      }

      return (data || []).map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        completed_at: t.completed_at!,
        completed_by: t.completed_by!,
        accent_color: t.accent_color,
        task_style: t.task_style,
        completer_name: profilesMap[t.completed_by!]?.full_name || null,
        completer_email: profilesMap[t.completed_by!]?.email || null,
        completer_photo: profilesMap[t.completed_by!]?.profile_photo_url || null,
      })) as CompletedTask[];
    },
    enabled: !!currentLocation?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Fetch alarm task completions for the selected date
  const { data: alarmCompletions = [], isLoading: loadingAlarms } = useQuery({
    queryKey: ['history-alarms', currentLocation?.id, format(selectedDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      // Get alarm tasks for this location
      const { data: alarmTasks, error: tasksError } = await supabase
        .from('temporary_tasks')
        .select('id, title, accent_color')
        .eq('location_id', currentLocation?.id)
        .eq('task_style', 'alarm')
        .eq('is_recurring', true);

      if (tasksError) throw tasksError;
      if (!alarmTasks || alarmTasks.length === 0) return [];

      const taskIds = alarmTasks.map(t => t.id);
      const taskMap = alarmTasks.reduce((acc, t) => { acc[t.id] = t; return acc; }, {} as Record<string, any>);

      // Fetch completions for these alarm tasks on the selected date
      const { data: completions, error: compError } = await supabase
        .from('alarm_task_completions')
        .select('id, task_id, completed_at, completed_by')
        .in('task_id', taskIds)
        .gte('completed_at', dateStart)
        .lte('completed_at', dateEnd)
        .order('completed_at', { ascending: false });

      if (compError) throw compError;
      if (!completions || completions.length === 0) return [];

      // Fetch completer profiles
      const completedByIds = [...new Set(completions.map(c => c.completed_by).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      if (completedByIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, profile_photo_url')
          .in('id', completedByIds);
        profilesMap = (profiles || []).reduce((acc, p) => { acc[p.id] = p; return acc; }, {} as Record<string, any>);
      }

      return completions.map(c => ({
        id: c.id,
        task_title: taskMap[c.task_id]?.title || 'Alarm Task',
        accent_color: taskMap[c.task_id]?.accent_color || null,
        completed_at: c.completed_at,
        completed_by: c.completed_by!,
        completer_name: profilesMap[c.completed_by!]?.full_name || null,
        completer_email: profilesMap[c.completed_by!]?.email || null,
        completer_photo: profilesMap[c.completed_by!]?.profile_photo_url || null,
      })) as AlarmCompletion[];
    },
    enabled: !!currentLocation?.id,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const loading = loadingSubmissions || loadingTasks || loadingAlarms;

  // Transform data into timeline items
  const timelineItems: HistoryTimelineItem[] = useMemo(() => {
    const items: HistoryTimelineItem[] = [];

    // Add checklist submissions
    submissions.forEach(s => {
      const completedAt = new Date(s.submitted_at);
      items.push({
        id: `checklist-${s.id}`,
        type: 'checklist',
        title: s.checklists.title,
        frequency: s.checklists.frequency,
        contributors: [{
          name: s.profiles.full_name || s.profiles.email.split('@')[0],
          photoUrl: s.profiles.profile_photo_url,
          completedAt: format(completedAt, 'h:mm a'),
          itemsCompleted: 1,
        }],
        finalCompletedAt: format(completedAt, 'h:mm a'),
        completionLevel: 100,
        notes: s.notes,
        onView: () => navigate(`/submission/${s.id}`),
      });
    });

    // Add completed tasks
    completedTasks.forEach(t => {
      const completedAt = new Date(t.completed_at);
      const isAlarm = t.task_style === 'alarm';
      
      items.push({
        id: `task-${t.id}`,
        type: isAlarm ? 'alarm' : 'task',
        title: t.title,
        accentColor: t.accent_color || undefined,
        contributors: [{
          name: t.completer_name || t.completer_email?.split('@')[0] || 'Unknown',
          photoUrl: t.completer_photo,
          completedAt: format(completedAt, 'h:mm a'),
          itemsCompleted: 1,
        }],
        finalCompletedAt: format(completedAt, 'h:mm a'),
        completionLevel: 100,
      });
    });

    // Add alarm task completions
    alarmCompletions.forEach(a => {
      const completedAt = new Date(a.completed_at);
      items.push({
        id: `alarm-${a.id}`,
        type: 'alarm',
        title: a.task_title,
        accentColor: a.accent_color || undefined,
        contributors: [{
          name: a.completer_name || a.completer_email?.split('@')[0] || 'Unknown',
          photoUrl: a.completer_photo,
          completedAt: format(completedAt, 'h:mm a'),
          itemsCompleted: 1,
        }],
        finalCompletedAt: format(completedAt, 'h:mm a'),
        completionLevel: 100,
      });
    });

    return items;
  }, [submissions, completedTasks, alarmCompletions, navigate]);

  return (
    <Layout>
      <div className="space-y-4 pb-20">
        {/* Header with tabs */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">History</h2>
            <p className="text-muted-foreground text-sm">View completed tasks and checklists</p>
          </div>
        </div>

        {/* Tab selector */}
        <Tabs defaultValue="view" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="view" className="gap-2">
              <HistoryIcon className="h-4 w-4" />
              View History
            </TabsTrigger>
            <TabsTrigger 
              value="edit" 
              className="gap-2"
              onClick={() => navigate('/tasks')}
            >
              <Pencil className="h-4 w-4" />
              Edit Tasks
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Timeline View */}
        <HistoryTimelineView
          items={timelineItems}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          isLoading={loading}
        />
      </div>
    </Layout>
  );
}
