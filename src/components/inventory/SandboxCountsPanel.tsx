import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FlaskConical, Plus, Trash2, Play } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

/**
 * Sandbox Count Panel — super-admin-only scratch counts.
 *
 * Rows are flagged `is_sandbox = true, sandbox_owner = <my user id>` on
 * `inventory_counts`. They are:
 *   - invisible to every other user (enforced by RLS)
 *   - excluded from every aggregation reader (COGS, Variance, period rollups,
 *     org/brand dashboards, validation pack, the regular "recent counts" list)
 *   - never marked as a period that's already been counted
 *
 * Use to safely test counting flows / pack math without touching real data.
 */
interface Props {
  locationId: string;
}

export default function SandboxCountsPanel({ locationId }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isSuperAdmin, loading } = useUserRole();

  const { data: sandboxCounts } = useQuery({
    queryKey: ["sandbox-counts", locationId, user?.id],
    enabled: !!user?.id && isSuperAdmin && !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("id, started_at, completed_at, status, count_date")
        .eq("location_id", locationId)
        .eq("is_sandbox", true)
        .eq("sandbox_owner", user!.id)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("inventory_counts")
        .insert({
          location_id: locationId,
          counted_by: user!.id,
          count_date: today,
          status: "in_progress",
          period_type: null,
          period_end_date: null,
          is_sandbox: true,
          sandbox_owner: user!.id,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sandbox-counts", locationId] });
      navigate(`/inventory/${locationId}/count/${data.id}`);
    },
    onError: (e: any) => toast.error(`Could not start sandbox count: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // CASCADE on inventory_count_items handles children.
      const { error } = await supabase.from("inventory_counts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sandbox-counts", locationId] });
      toast.success("Sandbox count deleted");
    },
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });

  if (loading || !isSuperAdmin) return null;

  return (
    <Card className="border-amber-300 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-950/10 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Sandbox counts <span className="font-normal text-amber-700/80 dark:text-amber-400/70">(super admin only)</span>
            </div>
            <div className="text-xs text-amber-800/80 dark:text-amber-300/70">
              Personal scratch counts. Never roll up into any report, period, or dashboard.
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-amber-400 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          <Plus className="h-4 w-4 mr-1" />
          New sandbox count
        </Button>
      </div>

      {sandboxCounts && sandboxCounts.length > 0 && (
        <div className="divide-y divide-amber-200/60 dark:divide-amber-800/40 rounded-md border border-amber-200 dark:border-amber-800/40 bg-background/60">
          {sandboxCounts.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {format(new Date(c.started_at), "MMM d, yyyy · h:mm a")}
                </div>
                <div className="text-xs text-muted-foreground capitalize">{c.status.replace("_", " ")}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(`/inventory/${locationId}/count/${c.id}`)}
                  title="Open"
                >
                  <Play className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm("Delete this sandbox count? This cannot be undone.")) {
                      deleteMutation.mutate(c.id);
                    }
                  }}
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
