import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function ChecklistCompletionAlerts() {
  const navigate = useNavigate();
  const today = new Date().toDateString(); // Gets current date as string
  
  const { data: alerts = [] } = useQuery({
    queryKey: ['checklist-completion-alerts', today], // Include date in key to reset at midnight
    queryFn: async () => {
      const currentDay = new Date().getDay();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const now = new Date();

      // Get all active checklists
      const { data: checklists, error: checklistsError } = await supabase
        .from('checklists')
        .select(`
          id,
          title,
          frequency,
          template_type,
          due_by_time,
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true);

      if (checklistsError) throw checklistsError;
      if (!checklists || checklists.length === 0) return [];

      // Filter to only checklists relevant for today
      const relevantChecklists = checklists.filter(checklist => {
        if (checklist.template_type === 'dynamic') {
          const todayItems = checklist.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          );
          return todayItems && todayItems.length > 0;
        }
        return checklist.frequency === 'daily';
      });

      // Get submissions for today only (between midnight and end of day)
      const endOfToday = new Date(startOfToday);
      endOfToday.setHours(23, 59, 59, 999);

      const { data: submissions, error: submissionsError } = await supabase
        .from('checklist_submissions')
        .select(`
          id,
          checklist_id,
          submitted_at,
          checklist_responses(id)
        `)
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
        
        let totalItems = checklist.checklist_items?.length || 0;
        if (checklist.template_type === 'dynamic') {
          totalItems = checklist.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          ).length || 0;
        }

        const totalResponses = checklistSubmissions.reduce((sum, sub: any) => 
          sum + (sub.checklist_responses?.length || 0), 0
        );

        const completionRate = totalItems > 0 ? (totalResponses / totalItems) : 0;
        
        if (completionRate === 0) {
          incompleteAlerts.push({
            id: checklist.id,
            title: checklist.title,
            status: 'incomplete',
            completionRate: 0,
          });
        } else if (completionRate < 1) {
          incompleteAlerts.push({
            id: checklist.id,
            title: checklist.title,
            status: 'partial',
            completionRate: Math.round(completionRate * 100),
          });
        }
      }

      return incompleteAlerts;
    },
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  if (alerts.length === 0) return null;

  const incompleteCount = alerts.filter(a => a.status === 'incomplete').length;
  const partialCount = alerts.filter(a => a.status === 'partial').length;

  return (
    <Alert className="border-destructive bg-red-50 dark:bg-red-950">
      <AlertTriangle className="h-4 w-4 text-destructive" />
      <AlertTitle className="text-red-900 dark:text-red-100 text-sm font-semibold">
        Checklist Completion Issues ({alerts.length})
      </AlertTitle>
      <AlertDescription className="space-y-1 mt-1">
        <div className="text-xs text-red-800 dark:text-red-200 space-y-0.5">
          {alerts.slice(0, 5).map((alert: any) => (
            <button
              key={alert.id}
              onClick={() => navigate(`/complete-checklist/${alert.id}`)}
              className="block w-full text-left py-0.5 px-1 -mx-1 rounded hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
            >
              <span className="font-semibold">{alert.title}</span>
              {' • '}
              {alert.status === 'incomplete' ? (
                <span className="text-red-600 dark:text-red-400 font-medium">Not Started</span>
              ) : (
                <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                  {alert.completionRate}% Complete
                </span>
              )}
            </button>
          ))}
          {alerts.length > 5 && (
            <Button
              variant="link"
              size="sm"
              onClick={() => navigate('/tasks')}
              className="h-auto p-0 text-xs text-red-600 dark:text-red-400 font-medium"
            >
              + {alerts.length - 5} more
            </Button>
          )}
        </div>
        <div className="text-[10px] text-red-700 dark:text-red-300 mt-1 pt-1 border-t border-red-300 dark:border-red-700">
          {incompleteCount > 0 && <span>{incompleteCount} incomplete</span>}
          {incompleteCount > 0 && partialCount > 0 && <span> • </span>}
          {partialCount > 0 && <span>{partialCount} partial</span>}
        </div>
      </AlertDescription>
    </Alert>
  );
}
