import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, History } from "lucide-react";
import { toast } from "sonner";
import { DateTime } from "luxon";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locationId: string;
}

/**
 * Historical count backfill — lets an admin enter a past count period so
 * new locations can seed usage/Genius data from prior-system records.
 * Creates a draft `lite_inventory_counts` row (is_backfill=true) and
 * jumps into the normal count session; user enters quantities + submits.
 */
export default function HistoricalCountEntryDialog({
  open,
  onOpenChange,
  locationId,
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = DateTime.now().toFormat("yyyy-MM-dd");
  const lastWeekStart = DateTime.now().minus({ days: 13 }).toFormat("yyyy-MM-dd");
  const lastWeekEnd = DateTime.now().minus({ days: 7 }).toFormat("yyyy-MM-dd");

  const [periodStart, setPeriodStart] = useState(lastWeekStart);
  const [periodEnd, setPeriodEnd] = useState(lastWeekEnd);

  const create = useMutation({
    mutationFn: async () => {
      if (periodStart > periodEnd) throw new Error("Start date must be before end date");
      if (periodEnd > today) throw new Error("End date can't be in the future");

      // Reuse existing count for this period if it exists.
      const { data: existing } = await supabase
        .from("lite_inventory_counts" as any)
        .select("id")
        .eq("location_id", locationId)
        .eq("period_end", periodEnd)
        .maybeSingle();
      if (existing) return existing as any;

      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("lite_inventory_counts" as any)
        .insert({
          location_id: locationId,
          period_start: periodStart,
          period_end: periodEnd,
          created_by: userData.user?.id ?? null,
          is_backfill: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as any;
    },
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["lite-counts", locationId] });
      onOpenChange(false);
      toast.success("Backfill count created");
      navigate(`/inventory/${locationId}/count/${row.id}`);
    },
    onError: (e: any) => {
      toast.error("Couldn't create count", { description: e?.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Enter historical count
          </DialogTitle>
          <DialogDescription>
            Add a past count period so Genius has enough history to coach ordering.
            You'll enter the closing quantities on the next screen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ps" className="text-xs">Period start</Label>
            <Input
              id="ps"
              type="date"
              value={periodStart}
              max={today}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pe" className="text-xs">Period end (count date)</Label>
            <Input
              id="pe"
              type="date"
              value={periodEnd}
              max={today}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            This count will be flagged as a backfill entry and included in usage math
            once you submit it.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
