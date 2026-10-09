import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppLocation } from "@/contexts/LocationContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const MIN = 1;
const MAX = 20;
const DEFAULT = 3;

/** Per-store "short-staffed" number used by the Availability Insights email. */
export function ShortStaffedThresholdSetting() {
  const { currentLocation } = useAppLocation();
  const locationId = currentLocation?.id ?? null;
  const qc = useQueryClient();
  const key = ["short-staffed-threshold", locationId];

  const { data: saved } = useQuery({
    queryKey: key,
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_settings")
        .select("short_staffed_threshold")
        .eq("location_id", locationId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.short_staffed_threshold as number | undefined) ?? DEFAULT;
    },
  });

  const [value, setValue] = useState(String(DEFAULT));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (saved != null) setValue(String(saved)); }, [saved]);

  const n = Number(value);
  const valid = Number.isInteger(n) && n >= MIN && n <= MAX;
  const dirty = valid && n !== saved;

  const save = async () => {
    if (!locationId || !valid) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_short_staffed_threshold", { _location_id: locationId, _threshold: n });
    setSaving(false);
    if (error) { toast.error("Couldn't save the short-staffed alert"); return; }
    qc.setQueryData(key, n);
    toast.success("Short-staffed alert saved");
  };

  if (!locationId) return null;

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Short-staffed alert:</span>
        <span className="text-muted-foreground">flag a day when</span>
        <Input
          type="number"
          inputMode="numeric"
          min={MIN}
          max={MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 w-16 text-center"
          aria-label="People out before a day is flagged"
        />
        <span className="text-muted-foreground">or more people are out</span>
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {!valid && <p className="mt-2 text-xs text-destructive">Pick a number from {MIN} to {MAX}.</p>}
      <p className="mt-2 text-xs text-muted-foreground">Used by the Availability Insights email for this store.</p>
    </Card>
  );
}
