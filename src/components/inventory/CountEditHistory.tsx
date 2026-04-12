import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { History, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CountEditHistoryProps {
  countId: string;
}

interface AuditEntry {
  id: string;
  logged_at: string;
  operation: string;
  user_id: string | null;
  details: Record<string, any> | null;
  user_profile?: { full_name: string } | null;
}

export default function CountEditHistory({ countId }: CountEditHistoryProps) {
  const { data: entries, isLoading } = useQuery({
    queryKey: ["count-edit-history", countId],
    queryFn: async () => {
      // Fetch audit log entries for this count's items (UPDATE operations only — those are edits)
      const { data, error } = await supabase
        .from("inventory_count_audit_log")
        .select("id, logged_at, operation, user_id, details, table_name")
        .eq("count_id", countId)
        .eq("table_name", "inventory_count_items")
        .eq("operation", "UPDATE")
        .order("logged_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("[CountEditHistory] fetch error:", error);
        return [];
      }

      if (!data || data.length === 0) return [];

      // Fetch user profiles for the editors
      const userIds = [...new Set((data as any[]).filter(d => d.user_id).map(d => d.user_id))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        for (const p of profiles || []) {
          profileMap[p.id] = p.full_name || "Unknown";
        }
      }

      // Fetch item names for changed items
      const itemIds = [...new Set((data as any[]).filter(d => d.details?.item_id).map(d => d.details.item_id))];
      let itemMap: Record<string, string> = {};
      if (itemIds.length > 0) {
        const { data: items } = await supabase
          .from("inventory_items")
          .select("id, name")
          .in("id", itemIds);
        for (const item of items || []) {
          itemMap[item.id] = item.name;
        }
      }

      return (data as any[]).map(entry => ({
        ...entry,
        userName: entry.user_id ? (profileMap[entry.user_id] || "Unknown") : "System",
        itemName: entry.details?.item_id ? (itemMap[entry.details.item_id] || "Unknown Item") : "Unknown Item",
      }));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Filter to only show entries where quantity actually changed
  const edits = (entries || []).filter(e => {
    const d = e.details;
    return d && d.old_qty !== undefined && d.new_qty !== undefined && d.old_qty !== d.new_qty;
  });

  if (isLoading || edits.length === 0) return null;

  return (
    <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40">
      <div className="flex items-center gap-2 mb-2">
        <Lock className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
          Post-Submission Edits
        </span>
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-[16px] border-amber-400/60 text-amber-600">
          {edits.length}
        </Badge>
      </div>
      <div className="space-y-1.5">
        {edits.map(edit => (
          <div key={edit.id} className="flex items-start gap-2 text-xs">
            <History className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">{edit.userName}</span>
              {" updated "}
              <span className="font-medium text-foreground">{edit.itemName}</span>
              {" from "}
              <span className="font-mono font-semibold text-destructive">{edit.details.old_qty}</span>
              {" → "}
              <span className="font-mono font-semibold text-emerald-600">{edit.details.new_qty}</span>
              <span className="text-muted-foreground/60 ml-1">
                {format(new Date(edit.logged_at), "MMM d 'at' h:mm a")}
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
