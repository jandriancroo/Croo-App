import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Bell,
  KeyRound,
  Loader2,
  CheckCircle2,
  Copy,
  Users,
} from "lucide-react";
import { toast } from "sonner";

type RowUser = {
  id: string;
  full_name: string | null;
  pin_pending: string | null;
  pin_pending_plaintext: string | null;
  pin_pending_set_at: string | null;
  location_ids: string[];
  location_names: string[];
};

const ALL = "__all__";

/**
 * Super-admin PIN Migration Health Panel.
 * Flat global list of users still missing a 6-digit PIN, with a location
 * dropdown filter, Nudge, and Set on behalf actions.
 */
export function PinMigrationHealthPanel() {
  const qc = useQueryClient();
  const [locationFilter, setLocationFilter] = useState<string>(ALL);
  const [setOnBehalfFor, setSetOnBehalfFor] = useState<RowUser | null>(null);
  const [generatedPin, setGeneratedPin] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nudging, setNudging] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["pin-migration-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pin_migration_health");
      if (error) throw error;
      return (data || []) as RowUser[];
    },
    staleTime: 30 * 1000,
  });

  const { total, migrated, pending, locations, filteredPending, filteredSet } = useMemo(() => {
    const total = users.length;
    const migrated = users.filter((u) => !!u.pin_pending).length;
    const pending = users.filter((u) => !u.pin_pending);
    const set = users.filter((u) => !!u.pin_pending);

    const locMap = new Map<string, string>();
    for (const u of users) {
      const ids = u.location_ids || [];
      const names = u.location_names || [];
      ids.forEach((id, i) => {
        if (id) locMap.set(id, names[i] || "Unknown");
      });
    }
    const locations = Array.from(locMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const byLoc = (u: RowUser) =>
      locationFilter === ALL || (u.location_ids || []).includes(locationFilter);

    return {
      total,
      migrated,
      pending,
      locations,
      filteredPending: pending.filter(byLoc),
      filteredSet: set.filter(byLoc),
    };
  }, [users, locationFilter]);

  const pct = total > 0 ? Math.round((migrated / total) * 100) : 0;

  const handleNudge = async (userId: string) => {
    setNudging(userId);
    try {
      const { data, error } = await supabase.rpc("log_pin_nudge", {
        p_target_user_id: userId,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) {
        toast.error(result.error || "Couldn't nudge.");
        return;
      }
      toast.success("Nudge logged");
    } catch (err: any) {
      toast.error(err?.message || "Couldn't nudge.");
    } finally {
      setNudging(null);
    }
  };

  const generatePin = () => {
    const banned = new Set([
      "000000","111111","222222","333333","444444","555555",
      "666666","777777","888888","999999",
      "123456","654321","012345","543210","121212","123123","112233",
    ]);
    let pin = "";
    for (let i = 0; i < 50; i++) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      pin = String(arr[0] % 1_000_000).padStart(6, "0");
      if (!banned.has(pin)) break;
    }
    setGeneratedPin(pin);
  };

  const handleSetOnBehalf = async () => {
    if (!setOnBehalfFor || !generatedPin) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("admin_set_pending_punch_pin", {
        p_target_user_id: setOnBehalfFor.id,
        p_pin: generatedPin,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) {
        toast.error(result.error || "Couldn't set PIN.");
        return;
      }
      toast.success(`PIN set for ${setOnBehalfFor.full_name || "user"}`);
      qc.invalidateQueries({ queryKey: ["pin-migration-health"] });
    } catch (err: any) {
      toast.error(err?.message || "Couldn't set PIN.");
    } finally {
      setSubmitting(false);
    }
  };

  const closeSetOnBehalf = () => {
    setSetOnBehalfFor(null);
    setGeneratedPin(null);
  };

  if (isLoading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allDone = pending.length === 0 && total > 0;

  return (
    <>
      <div className="space-y-4">
        {/* Header / summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Users who still need to set their new 6-digit punch PIN. Flip
              night unlocks at 100%.
            </p>
            <Badge variant={allDone ? "default" : "outline"} className="shrink-0">
              {migrated} / {total}
            </Badge>
          </div>
          <Progress value={pct} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{pct}% migrated</span>
            <span>{pending.length} pending org-wide</span>
          </div>
        </div>

        {allDone ? (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-3 py-2">
            <CheckCircle2 className="h-4 w-4" />
            All users migrated. Flip night is ready when you are.
          </div>
        ) : (
          <>
            {/* Location filter */}
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">
                Location
              </Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    All locations ({pending.length})
                  </SelectItem>
                  {locations.map((l) => {
                    const count = pending.filter((u) =>
                      (u.location_ids || []).includes(l.id)
                    ).length;
                    return (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} ({count})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Flat list */}
            {filteredPending.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-md px-3 py-4 justify-center">
                <Users className="h-4 w-4" />
                No pending users at this location.
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredPending.map((u) => {
                  const locNames = (u.location_names || []).join(", ");
                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-card"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {u.full_name || "(no name)"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {locNames || "Unassigned"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleNudge(u.id)}
                          disabled={nudging === u.id}
                          className="gap-1.5"
                        >
                          {nudging === u.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Bell className="h-3.5 w-3.5" />
                          )}
                          <span className="hidden sm:inline">Nudge</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSetOnBehalfFor(u);
                            setGeneratedPin(null);
                          }}
                          className="gap-1.5"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Set on behalf</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={!!setOnBehalfFor} onOpenChange={(o) => !o && closeSetOnBehalf()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Set PIN for {setOnBehalfFor?.full_name || "user"}
            </DialogTitle>
            <DialogDescription>
              Generate a temporary 6-digit PIN. It's shown to you once below —
              text or hand it to the user. After this dialog closes the PIN is
              hashed at rest and not retrievable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!generatedPin ? (
              <Button onClick={generatePin} className="w-full">
                Generate PIN
              </Button>
            ) : (
              <div className="space-y-2">
                <Label>Generated PIN</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={generatedPin}
                    className="text-center tracking-[0.4em] font-mono text-lg"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedPin);
                      toast.success("Copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Share via your normal secure channel. This action is logged
                  in the audit trail.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeSetOnBehalf} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSetOnBehalf}
              disabled={!generatedPin || submitting}
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save PIN for user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
