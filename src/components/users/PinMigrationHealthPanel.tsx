import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { ShieldCheck, ChevronDown, Bell, KeyRound, Loader2, CheckCircle2, Copy } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type RowUser = {
  id: string;
  full_name: string | null;
  pin_pending: string | null;
  pin_pending_set_at: string | null;
  pin_pending_set_by: string | null;
  user_locations: { location_id: string; locations: { id: string; name: string } | null }[];
};

/**
 * Super-admin only panel. Shows migration progress across all users the
 * super-admin can see, grouped by location, with Nudge + Set on behalf actions.
 */
export function PinMigrationHealthPanel() {
  const qc = useQueryClient();
  const [setOnBehalfFor, setSetOnBehalfFor] = useState<RowUser | null>(null);
  const [generatedPin, setGeneratedPin] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nudging, setNudging] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["pin-migration-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(`
          id, full_name, pin_pending, pin_pending_set_at, pin_pending_set_by,
          user_locations(location_id, locations(id, name))
        `)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as RowUser[];
    },
    staleTime: 30 * 1000,
  });

  const { total, migrated, pending, pendingByLocation } = useMemo(() => {
    const total = users.length;
    const migrated = users.filter((u) => !!u.pin_pending).length;
    const pending = users.filter((u) => !u.pin_pending);

    const byLoc: Record<string, { name: string; users: RowUser[] }> = {};
    for (const u of pending) {
      const locs = u.user_locations || [];
      if (locs.length === 0) {
        byLoc["__unassigned__"] ??= { name: "Unassigned", users: [] };
        byLoc["__unassigned__"].users.push(u);
        continue;
      }
      for (const ul of locs) {
        const id = ul.locations?.id ?? ul.location_id;
        const name = ul.locations?.name ?? "Unknown location";
        byLoc[id] ??= { name, users: [] };
        if (!byLoc[id].users.find((x) => x.id === u.id)) {
          byLoc[id].users.push(u);
        }
      }
    }
    const sorted = Object.entries(byLoc).sort((a, b) =>
      a[1].name.localeCompare(b[1].name)
    );
    return { total, migrated, pending, pendingByLocation: sorted };
  }, [users]);

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
      toast.success("Nudge sent");
    } catch (err: any) {
      toast.error(err?.message || "Couldn't nudge.");
    } finally {
      setNudging(null);
    }
  };

  const generatePin = () => {
    // 6 random digits, avoid the obvious banned set the server also rejects.
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
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const allDone = pending.length === 0 && total > 0;

  return (
    <>
      <Card className="border-primary/30">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                PIN Migration Health
              </CardTitle>
              <CardDescription>
                Tracks which users have set their new 6-digit punch PIN. Flip
                night unlocks once this hits 100%.
              </CardDescription>
            </div>
            <Badge variant={allDone ? "default" : "outline"} className="shrink-0">
              {migrated} / {total} complete
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Progress value={pct} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{pct}% migrated</span>
              <span>{pending.length} pending</span>
            </div>
          </div>

          {allDone ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-3 py-2">
              <CheckCircle2 className="h-4 w-4" />
              All users migrated. Flip night is ready when you are.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingByLocation.map(([locId, group]) => (
                <Collapsible key={locId} defaultOpen>
                  <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 hover:bg-muted text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <ChevronDown className="h-4 w-4" />
                      {group.name}
                    </span>
                    <Badge variant="outline">{group.users.length}</Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2 space-y-1">
                    {group.users.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border bg-card"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {u.full_name || "(no name)"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            No 6-digit PIN set yet
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
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                  Share via your normal secure channel (text, in person). This
                  action is logged in the audit trail.
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
