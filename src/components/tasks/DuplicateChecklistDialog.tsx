import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { calculateCutoffHour } from "@/utils/timezoneUtils";
import { canGoLiveNow, nextActivationOptions, swapCadence } from "@/utils/checklistVersions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklist: any | null;
}

export function DuplicateChecklistDialog({ open, onOpenChange, checklist }: Props) {
  const { timezone, closeTime } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const businessOpenHour = useMemo(() => {
    const cutoff = calculateCutoffHour(closeTime);
    return cutoff > 0 && cutoff < 12 ? cutoff : 0;
  }, [closeTime]);

  const options = useMemo(
    () => (checklist ? nextActivationOptions(checklist, timezone, businessOpenHour) : []),
    [checklist, timezone, businessOpenHour]
  );

  const cadence = checklist ? swapCadence(checklist) : "daily";
  const allowLiveNow = checklist ? canGoLiveNow(checklist) : false;
  const hasExistingDraft = !!checklist?.__draft;

  const handleDuplicate = async () => {
    if (!checklist) return;
    const selected = choice || (allowLiveNow ? "now" : options[0]?.iso);
    if (!selected) return;
    setSaving(true);
    try {
      const { data: draftId, error } = await supabase.rpc("duplicate_checklist_as_draft", {
        _source_id: checklist.id,
        _activation_at: selected === "now" ? null : selected,
      });
      if (error) throw error;

      if (selected === "now" && draftId) {
        const { error: swapErr } = await supabase.rpc("perform_checklist_swap", { _draft_id: draftId as string });
        if (swapErr) throw swapErr;
        toast.success("New version is live now");
      } else {
        toast.success("Draft created — it goes live automatically");
      }
      queryClient.invalidateQueries({ queryKey: ["user-checklists"] });
      onOpenChange(false);
      setChoice("");
    } catch (err: any) {
      toast.error(err?.message || "Could not duplicate this checklist");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate "{checklist?.title}"</DialogTitle>
          <DialogDescription>
            We'll copy this list — items, days, shifts and who it's for — into a draft. Your crew stays on
            the current one until the switch happens.
            {hasExistingDraft && " This replaces the draft you already have waiting."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Go live</Label>
          <RadioGroup value={choice || (allowLiveNow ? "now" : options[0]?.iso ?? "")} onValueChange={setChoice}>
            {allowLiveNow && (
              <div className="flex items-center gap-2">
                <RadioGroupItem value="now" id="swap-now" />
                <Label htmlFor="swap-now" className="text-sm font-normal">Right now</Label>
              </div>
            )}
            {options.map((o) => (
              <div key={o.iso} className="flex items-center gap-2">
                <RadioGroupItem value={o.iso} id={o.iso} />
                <Label htmlFor={o.iso} className="text-sm font-normal">{o.label}</Label>
              </div>
            ))}
          </RadioGroup>
          <p className="text-[11px] text-muted-foreground">
            {cadence === "weekly"
              ? "Weekly lists can only switch on a Monday at open, so a week's score never splits across two versions."
              : cadence === "monthly"
              ? "Monthly lists can only switch on the 1st, so a month's score never splits across two versions."
              : "Daily lists can switch right away or at the next open."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleDuplicate} disabled={saving}>
            {saving ? "Working…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
