import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ShieldCheck, Loader2, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { differenceInDays } from "date-fns";

/**
 * Quick Task — "Set your new 6-digit PIN"
 * Shows when the signed-in user has no pin_pending yet. Hashes server-side
 * via the set_pending_punch_pin RPC. Operational punch flow is untouched.
 */
export function PinMigrationTask() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["pin-migration-status", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("pin_pending, pin_pending_plaintext, pin_pending_set_at, created_at")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  if (!profile) return null;

  // ✅ Already set — show a quiet reminder card with reveal of their own PIN
  if (profile.pin_pending) {
    const pinPlain = (profile as any).pin_pending_plaintext as string | null;
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-emerald-500/80 to-emerald-500" />
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            Your new 6-digit punch PIN is set
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            You'll start using this PIN at the punch clock on flip night. Tap
            below to view it if you forget — it disappears after the migration.
          </p>
          {pinPlain ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-center font-mono text-lg tracking-[0.4em] py-2 rounded-md border bg-background">
                {revealed ? pinPlain : "••••••"}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setRevealed((r) => !r)}
                aria-label={revealed ? "Hide PIN" : "Reveal PIN"}
              >
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              PIN was set before reveal was available. Ask your manager to reset
              it if you forget.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Age the card based on days since this task started being shown.
  // Use account created_at as a proxy until we track first-seen.
  const ageDays = profile.created_at
    ? differenceInDays(new Date(), new Date(profile.created_at))
    : 0;
  const escalation: "normal" | "amber" | "red" =
    ageDays >= 15 ? "red" : ageDays >= 8 ? "amber" : "normal";

  const accentClasses = {
    normal: "border-primary/50 bg-primary/5",
    amber: "border-amber-500/60 bg-amber-500/10",
    red: "border-destructive/60 bg-destructive/10",
  }[escalation];

  const stripClasses = {
    normal: "from-primary via-primary/80 to-primary",
    amber: "from-amber-500 via-amber-500/80 to-amber-500",
    red: "from-destructive via-destructive/80 to-destructive",
  }[escalation];

  const handleSubmit = async () => {
    if (pin !== confirm) {
      toast.error("PINs don't match. Try again.");
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      toast.error("PIN must be exactly 6 digits.");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("set_pending_punch_pin", {
        p_pin: pin,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) {
        toast.error(result.error || "Couldn't save PIN.");
        return;
      }
      toast.success("New 6-digit PIN saved", {
        description: "You'll start using it on the next system update.",
      });
      setOpen(false);
      setPin("");
      setConfirm("");
      qc.invalidateQueries({ queryKey: ["pin-migration-status", user?.id] });
      qc.invalidateQueries({ queryKey: ["pin-migration-health"] });
    } catch (err: any) {
      toast.error(err?.message || "Couldn't save PIN.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card className={`${accentClasses} relative overflow-hidden`}>
        <div
          className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${stripClasses}`}
        />
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="relative">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <Lock className="h-2.5 w-2.5 text-primary absolute -bottom-0.5 -right-0.5" />
              </div>
              Set your new 6-digit punch PIN
            </CardTitle>
            {escalation !== "normal" && (
              <Badge
                variant="outline"
                className={
                  escalation === "red"
                    ? "border-destructive/50 text-destructive text-[10px]"
                    : "border-amber-500/50 text-amber-700 dark:text-amber-400 text-[10px]"
                }
              >
                {escalation === "red" ? "Required" : "Due soon"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            We're upgrading punch security from 4 → 6 digits. Pick your new PIN
            now — you'll keep using your current 4-digit one at the punch clock
            until the system flips over.
          </p>
          <Button
            className="w-full"
            onClick={() => setOpen(true)}
            variant={escalation === "red" ? "destructive" : "default"}
          >
            Set my 6-digit PIN
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set your new 6-digit PIN</DialogTitle>
            <DialogDescription>
              Pick something only you know. Avoid obvious patterns like 123456
              or 000000. You'll use this at the punch clock after flip night.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-pin">New 6-digit PIN</Label>
              <Input
                id="new-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="••••••"
                className="text-center tracking-[0.4em] font-mono text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-pin">Confirm PIN</Label>
              <Input
                id="confirm-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={confirm}
                onChange={(e) =>
                  setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="••••••"
                className="text-center tracking-[0.4em] font-mono text-lg"
              />
            </div>

            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Stored hashed. Never sent back to your device after this moment.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Later
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || pin.length !== 6 || confirm.length !== 6}
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
