import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DateTime } from "luxon";
import LiteCountSession from "@/components/inventory/LiteCountSession";
import DeleteCountDialog from "@/components/inventory/DeleteCountDialog";

interface LiteCount {
  id: string;
  location_id: string;
  period_start: string;
  period_end: string;
  status: string;
  submitted_at: string | null;
}

/**
 * Lite inventory count page. Renders under the same route as the Brand count
 * page (`/inventory/:locationId/count/:countId`) — the parent InventoryCount
 * page branches on inventory_mode and mounts this instead.
 *
 * No AvT tab (theoretical usage is out of Lite scope), no delivery
 * reconciliation, no edit-history sidecar. Just count → submit.
 */
export default function LiteInventoryCountPage() {
  const { locationId, countId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);

  const { data: count, isLoading } = useQuery({
    queryKey: ["lite-count", countId],
    enabled: !!countId,
    queryFn: async (): Promise<LiteCount | null> => {
      const { data, error } = await supabase
        .from("lite_inventory_counts" as any)
        .select("id, location_id, period_start, period_end, status, submitted_at")
        .eq("id", countId!)
        .maybeSingle();
      if (error) throw error;
      return (data as any) || null;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("lite_inventory_counts" as any)
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          submitted_by: userData.user?.id ?? null,
        })
        .eq("id", countId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lite-count", countId] });
      qc.invalidateQueries({ queryKey: ["lite-counts", locationId] });
      toast.success("Count submitted");
      navigate(`/inventory/${locationId}`);
    },
    onError: (err: any) => {
      toast.error("Couldn't submit", { description: err?.message });
    },
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("lite_inventory_counts" as any)
        .delete()
        .eq("id", countId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lite-counts", locationId] });
      toast.success("Count deleted");
      navigate(`/inventory/${locationId}`);
    },
    onError: (err: any) => {
      toast.error("Couldn't delete", { description: err?.message });
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!count) {
    return (
      <Layout>
        <div className="p-6 max-w-2xl mx-auto space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/inventory/${locationId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="text-center py-10 text-muted-foreground text-sm">Count not found</div>
        </div>
      </Layout>
    );
  }

  const submitted = count.status === "submitted";
  const label = `${DateTime.fromFormat(count.period_start, "yyyy-MM-dd").toFormat("LLL d")} – ${DateTime.fromFormat(count.period_end, "yyyy-MM-dd").toFormat("LLL d, yyyy")}`;

  return (
    <Layout>
      <div className="space-y-4 md:max-w-3xl md:mx-auto md:p-6 p-4">
        <div className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/inventory/${locationId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <Badge variant={submitted ? "default" : "secondary"}>
            {submitted ? "Submitted" : "Draft"}
          </Badge>
        </div>

        <div>
          <h1 className="text-xl font-bold">{label}</h1>
          <p className="text-xs text-muted-foreground">Weekly count</p>
        </div>

        {!submitted && (
          <div className="flex gap-2">
            <Button
              className="flex-1 gap-2"
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Submit Count
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowDelete(true)}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Delete count"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}

        <LiteCountSession
          countId={countId!}
          locationId={locationId!}
          readOnly={submitted}
        />
      </div>

      <DeleteCountDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        onConfirm={() => del.mutate()}
        isDeleting={del.isPending}
        countPeriod={label}
      />
    </Layout>
  );
}
