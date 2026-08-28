// Checklist completion alerts component
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { 
  getTodayInTimezone, 
  getDayOfWeekInTimezone, 
  getStartOfTodayInTimezone,
  getEndOfDateStringInTimezone 
} from "@/utils/timezoneUtils";

export function ChecklistCompletionAlerts() {
  const navigate = useNavigate();
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();
  const today = getTodayInTimezone(timezone); // Timezone-aware date string
  
  const { data: alerts = [] } = useQuery({
    queryKey: ['checklist-completion-alerts', today, currentLocation?.id, timezone],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      // Use timezone-aware day of week (Mon=0, Sun=6)
      const currentDay = getDayOfWeekInTimezone(timezone);
      const startOfToday = getStartOfTodayInTimezone(timezone);
      const endOfToday = getEndOfDateStringInTimezone(today, timezone);
      const now = new Date();

      // Get all active checklists for current location
      const { data: checklists, error: checklistsError } = await supabase
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
        .eq('location_id', currentLocation.id);

      if (checklistsError) throw checklistsError;
      if (!checklists || checklists.length === 0) return [];

      // Filter to only checklists relevant for today
      // Overdue alerts ignore archived items entirely — no ping for a pulled task.
      const liveItemsFor = (checklist: any) =>
        (checklist.checklist_items || []).filter((item: any) => !item.deleted_at);

      const relevantChecklists = checklists.filter(checklist => {
        if (checklist.template_type === 'dynamic') {
          // Only include items explicitly assigned to today (null = unassigned, not shown)
          const todayItems = liveItemsFor(checklist).filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          );
          return todayItems.length > 0;
        }
        return checklist.frequency === 'daily';
      });

      // Get submissions for today only (between midnight and end of day)
      const { data: submissions, error: submissionsError } = await supabase
        .from('checklist_submissions')
        .select(`
          id,
          checklist_id,
          submitted_at,
          checklist_responses(id, item_id)
        `)
        .eq('location_id', currentLocation.id)
        .gte('submitted_at', startOfToday.toISOString())
        .lte('submitted_at', endOfToday.toISOString());

      if (submissionsError) throw submissionsError;

      // Calculate completion status for each checklist
      const incompleteAlerts = [];
      for (const checklist of relevantChecklists) {
        // Check if we should show alert based on due_by_time
        if (checklist.due_by_time) {
          const [hours, minutes] = checklist.due_by_time.split(':').map(Number);
          const dueTime = new Date(startOfToday);
          dueTime.setHours(hours, minutes, 0, 0);
          
          // Only show alert if current time is past the due time
          if (now < dueTime) {
            continue; // Skip this checklist, it's not due yet
          }
        }
        
        const checklistSubmissions = submissions?.filter(s => s.checklist_id === checklist.id) || [];
        
        let totalItems = liveItemsFor(checklist).length;
        if (checklist.template_type === 'dynamic') {
          // Only count items explicitly assigned to today (null = unassigned)
          totalItems = liveItemsFor(checklist).filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          ).length;
        }

        // Count unique completed items (not total responses)
        const uniqueItemIds = new Set();
        checklistSubmissions.forEach((sub: any) => {
          sub.checklist_responses?.forEach((response: any) => {
            if (response.item_id) {
              uniqueItemIds.add(response.item_id);
            }
          });
        });
        const totalResponses = uniqueItemIds.size;
        const remainingTasks = totalItems - totalResponses;

        const completionRate = totalItems > 0 ? (totalResponses / totalItems) : 0;
        
        if (completionRate === 0) {
          incompleteAlerts.push({
            id: checklist.id,
            title: checklist.title,
            status: 'incomplete',
            completionRate: 0,
            remainingTasks: totalItems,
          });
        } else if (completionRate < 1) {
          incompleteAlerts.push({
            id: checklist.id,
            title: checklist.title,
            status: 'partial',
            completionRate: Math.round(completionRate * 100),
            remainingTasks,
          });
        }
      }

      return incompleteAlerts;
    },
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  if (alerts.length === 0) return null;

  return (
    <div className="flex items-start gap-3 border border-destructive/50 bg-red-50/80 dark:bg-red-950/50 py-2.5 px-3 rounded-md">
      <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
      <div className="text-sm text-red-800 dark:text-red-200 space-y-1">
        {alerts.slice(0, 5).map((alert: any) => (
          <button
            key={alert.id}
            onClick={() => navigate(`/complete-checklist/${alert.id}`)}
            className="block w-full text-left py-1 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
          >
            <span className="font-medium">{alert.title}</span>
            {' • '}
            {alert.status === 'incomplete' ? (
              <span className="text-red-600 dark:text-red-400">Not Started</span>
            ) : (
              <span className="text-yellow-600 dark:text-yellow-400">
                {alert.remainingTasks} task{alert.remainingTasks === 1 ? '' : 's'} left
              </span>
            )}
          </button>
        ))}
        {alerts.length > 5 && (
          <Button
            variant="link"
            size="sm"
            onClick={() => navigate('/tasks')}
            className="h-auto p-0 text-sm text-red-600 dark:text-red-400"
          >
            + {alerts.length - 5} more
          </Button>
        )}
      </div>
    </div>
  );
}
