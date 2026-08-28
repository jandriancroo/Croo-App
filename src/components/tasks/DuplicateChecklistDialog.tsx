import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { calculateCutoffHour } from "@/utils/timezoneUtils";
import { nextActivationOptions, swapCadence } from "@/utils/checklistVersions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Source list when creating a new draft. */
  checklist: any | null;
  /** Existing pending draft — dialog reschedules or flips it instead of copying. */
  draft?: any | null;
}

export function DuplicateChecklistDialog({ open, onOpenChange, checklist, draft }: Props) {
  const { timezone, closeTime } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const target = draft ?? checklist;
  const draftMode = !!draft;

  const businessOpenHour = useMemo(() => {
    const cutoff = calculateCutoffHour(closeTime);
    return cutoff > 0 && cutoff < 12 ? cutoff : 0;
  }, [closeTime]);

  const options = useMemo(
    () => (target ? nextActivationOptions(target, timezone, businessOpenHour) : []),
    [target, timezone, businessOpenHour]
  );

  useEffect(() => {
    if (open) setChoice(options[0]?.iso ?? "");
  }, [open, options]);

  const cadence = target ? swapCadence(target) : "daily";
  const hasExistingDraft = !draftMode && !!checklist?.__draft;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["user-checklists"] });
    queryClient.invalidateQueries({ queryKey: ["completion-history"] });
  };

  const swapNow = async (draftId: string) => {
    const { error } = await supabase.rpc("perform_checklist_swap", { _draft_id: draftId });
    if (error) throw error;
  };

  // Schedule: draft waits for the picked period open (Monday / the 1st / next open).
  const handleSchedule = async () => {
    if (!target || !choice) return;
    setSaving(true);
    try {
      if (draftMode) {
        const { error } = await supabase
          .from("checklists")
          .update({ activation_at: choice } as any)
          .eq("id", draft.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("duplicate_checklist_as_draft", {
          _source_id: checklist.id,
          _activation_at: choice,
        });
        if (error) throw error;
      }
      toast.success("Scheduled — it swaps itself in automatically");
      refresh();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Could not schedule this version");
    } finally {
      setSaving(false);
    }
  };

  // Live now: same one-transaction swap, immediately, on any list type.
  const handleLiveNow = async () => {
    if (!target) return;
    setSaving(true);
    try {
      if (draftMode) {
        await swapNow(draft.id);
      } else {
        const { data: draftId, error } = await supabase.rpc("duplicate_checklist_as_draft", {
          _source_id: checklist.id,
          _activation_at: null,
        });
        if (error) throw error;
        if (draftId) await swapNow(draftId as string);
      }
      toast.success("New version is live now");
      refresh();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Could not switch this version on");
    } finally {
      setSaving(false);
    }
  };

  const splitWarning =
    cadence === "weekly"
      ? "Going live now splits this week between the old and new version. Scores still add up across both — nothing vanishes or double-counts."
      : cadence === "monthly"
      ? "Going live now splits this month between the old and new version. Scores still add up across both — nothing vanishes or double-counts."
      : "Going live now switches the crew over on their next tap.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {draftMode ? `Schedule "${draft?.title}"` : `Duplicate "${checklist?.title}"`}
          </DialogTitle>
          <DialogDescription>
            {draftMode
              ? "Pick when this draft takes over from the version your crew is on now, or switch it on right away."
              : "We'll copy this list — items, days, shifts and who it's for — into a draft. Your crew stays on the current one until the switch happens."}
            {hasExistingDraft && " This replaces the draft you already have waiting."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Switch over on
          </Label>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a date" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.iso} value={o.iso}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {cadence === "weekly"
              ? "Scheduled switches land on a Monday at open."
              : cadence === "monthly"
              ? "Scheduled switches land on the 1st at open."
              : "Scheduled switches land at the next open."}{" "}
            {splitWarning}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleLiveNow} disabled={saving}>
            Live now
          </Button>
          <Button onClick={handleSchedule} disabled={saving || !choice}>
            {saving ? "Working…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
