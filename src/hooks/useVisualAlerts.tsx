import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type VisualAlertType = "quick_task" | "overdue_checklist";

export interface VisualAlert {
  id: string;
  user_id: string;
  alert_type: VisualAlertType;
  ref_id: string;
  notification_id: string;
  title: string;
  body: string | null;
  location_id: string | null;
  created_at: string;
}

/**
 * Subscribes to the current user's unseen Visual Alerts queue.
 * Returns alerts ordered oldest → newest (top card = newest).
 */
export function useVisualAlerts() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<VisualAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setAlerts([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("visual_alert_queue")
      .select("id,user_id,alert_type,ref_id,notification_id,title,body,location_id,created_at")
      .eq("user_id", user.id)
      .is("seen_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(20);

    if (!error && data) setAlerts(data as VisualAlert[]);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: new alerts arrive while the app is open
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`visual-alerts-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "visual_alert_queue",
          filter: `user_id=eq.${user.id}`,
        },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refresh]);

  const markSeen = useCallback(
    async (id: string) => {
      // Optimistic remove
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      await supabase
        .from("visual_alert_queue")
        .update({ seen_at: new Date().toISOString() })
        .eq("id", id);
    },
    []
  );

  return { alerts, loading, markSeen, refresh };
}
