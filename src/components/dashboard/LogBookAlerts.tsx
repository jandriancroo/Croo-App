import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
    <Alert className="border-orange-400/50 bg-orange-50/80 dark:bg-orange-950/50 py-2">
      <AlertCircle className="h-3.5 w-3.5 text-orange-600" />
      <AlertDescription className="text-xs text-orange-800 dark:text-orange-200 space-y-0.5">
        {alerts.slice(0, 5).map((alert: any) => (
          <button
            key={alert.id}
            onClick={() => navigate('/logbook?fromAlert=true')}
            className="block w-full text-left py-0.5 rounded hover:bg-orange-100 dark:hover:bg-orange-900/50 transition-colors"
          >
            <span className="font-medium">{alert.logbook_categories?.name}</span>
            {' • '}
            <span>{alert.profiles?.full_name}</span>
            {' • '}
            <span className="opacity-75">{format(new Date(alert.created_at), 'h:mm a')}</span>
          </button>
        ))}
        {alerts.length > 5 && (
          <Button
            variant="link"
            size="sm"
            onClick={() => navigate('/logbook?fromAlert=true')}
            className="h-auto p-0 text-xs text-orange-600 dark:text-orange-400"
          >
            + {alerts.length - 5} more
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
