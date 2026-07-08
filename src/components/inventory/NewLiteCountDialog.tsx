import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarDays, History, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { DateTime } from "luxon";
import HistoricalCountEntryDialog from "@/components/inventory/HistoricalCountEntryDialog";
import { useUserRole } from "@/hooks/useUserRole";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locationId: string;
  timezone: string;
}

/**
 * NewLiteCountDialog — lets the user pick which count to start.
 *
 * Options:
 *  - This week (Sun–Sat in the location's tz): creates/resumes the current
 *    weekly draft, mirroring the previous "New Count" button behavior.
 *  - Historical count (admin+ only): opens the past-period backfill flow.
 */
export default function NewLiteCountDialog({
  open,
  onOpenChange,
  locationId,
  timezone,
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useUserRole();
  const [showHistorical, setShowHistorical] = useState(false);

  const now = DateTime.now().setZone(timezone);
  const dow = now.weekday % 7; // Luxon: 1=Mon..7=Sun; convert so Sun=0
  const sunday = now.minus({ days: dow }).startOf("day");
  const saturday = sunday.plus({ days: 6 });
  const period_start = sunday.toFormat("yyyy-MM-dd");
  const period_end = saturday.toFormat("yyyy-MM-dd");
  const weekLabel = `${sunday.toFormat("LLL d")} – ${saturday.toFormat("LLL d")}`;

  const startWeekly = useMutation({
    mutationFn: async () => {
      const { data: existing } = await supabase
        .from("lite_inventory_counts" as any)
        .select("id, status")
        .eq("location_id", locationId)
        .eq("period_end", period_end)
        .maybeSingle();
      if (existing) return existing as any;

      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("lite_inventory_counts" as any)
        .insert({
          location_id: locationId,
          period_start,
          period_end,
          created_by: userData.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as any;
    },
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["lite-counts", locationId] });
      onOpenChange(false);
      navigate(`/inventory/${locationId}/count/${row.id}`);
    },
    onError: (err: any) => {
      toast.error("Couldn't start count", { description: err?.message });
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start a new count</DialogTitle>
            <DialogDescription>
              Pick the period this count is for.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 pt-1">
            <button
              onClick={() => startWeekly.mutate()}
              disabled={startWeekly.isPending}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-border hover:bg-muted/40 text-left transition-colors disabled:opacity-60"
            >
              <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                {startWeekly.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarDays className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">This week</div>
                <div className="text-[11px] text-muted-foreground">
                  {weekLabel} · resumes draft if one exists
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>

            {isAdmin && (
              <button
                onClick={() => {
                  onOpenChange(false);
                  setShowHistorical(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-border hover:bg-muted/40 text-left transition-colors"
              >
                <div className="h-9 w-9 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <History className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Historical Count</div>
                  <div className="text-[11px] text-muted-foreground">
                    Enter a past period to seed Genius with prior-system data
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <HistoricalCountEntryDialog
        open={showHistorical}
        onOpenChange={setShowHistorical}
        locationId={locationId}
      />
    </>
  );
}
