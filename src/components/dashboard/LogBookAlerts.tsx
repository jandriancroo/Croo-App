import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function LogBookAlerts() {
  const navigate = useNavigate();
  
  const { data: alerts = [] } = useQuery({
    queryKey: ['logbook-alerts'],
    queryFn: async () => {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      // Get categories with alerts enabled
      const { data: alertCategories, error: catError } = await supabase
        .from('logbook_categories')
        .select('id, name')
        .eq('alert_enabled', true)
        .eq('is_active', true);

      if (catError) throw catError;
      if (!alertCategories || alertCategories.length === 0) return [];

      // Get recent entries from alert-enabled categories
      const { data: entries, error: entriesError } = await supabase
        .from('logbook_entries')
        .select(`
          id,
          entry_date,
          created_at,
          logbook_categories(name),
          profiles(full_name, profile_photo_url)
        `)
        .in('category_id', alertCategories.map(c => c.id))
        .gte('created_at', twentyFourHoursAgo.toISOString())
        .order('created_at', { ascending: false });

      if (entriesError) throw entriesError;
      return entries || [];
    },
    refetchInterval: 60000, // Refresh every minute
  });

  if (alerts.length === 0) return null;

  return (
    <Alert className="border-orange-500 bg-orange-50 dark:bg-orange-950">
      <AlertCircle className="h-4 w-4 text-orange-600" />
      <AlertTitle className="text-orange-900 dark:text-orange-100 text-sm">
        Recent Log Book Entries ({alerts.length})
      </AlertTitle>
      <AlertDescription className="space-y-1 mt-1">
        <div className="text-xs text-orange-800 dark:text-orange-200 space-y-0.5">
          {alerts.slice(0, 5).map((alert: any) => (
            <button
              key={alert.id}
              onClick={() => navigate(`/logbook?entryId=${alert.id}`)}
              className="block w-full text-left py-0.5 px-1 -mx-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900 transition-colors"
            >
              <span className="font-medium">{alert.logbook_categories?.name}</span>
              {' • '}
              <span>{alert.profiles?.full_name}</span>
              {' • '}
              <span className="text-[10px] opacity-75">{format(new Date(alert.created_at), 'MMM d, h:mm a')}</span>
            </button>
          ))}
          {alerts.length > 5 && (
            <Button
              variant="link"
              size="sm"
              onClick={() => navigate('/logbook')}
              className="h-auto p-0 text-xs text-orange-600 dark:text-orange-400"
            >
              + {alerts.length - 5} more
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
