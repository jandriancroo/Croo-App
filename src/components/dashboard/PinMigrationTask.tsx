import React, { useState } from "react";
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
import { pinDue, type QuickExtraRow } from "@/lib/quickTasks/extraRows";

/**
 * Quick Task — "Set your new 6-digit PIN"
 * Shows when the signed-in user has no pin_pending yet. Hashes server-side
 * via the set_pending_punch_pin RPC. Operational punch flow is untouched.
 */
export function usePinMigrationRow(): { rows: QuickExtraRow[]; overlay: React.ReactNode } {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["pin-migration-status", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("pin_pending, pin_pending_set_at, created_at")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  const due = pinDue(profile?.created_at);
  const rows: QuickExtraRow[] = profile && !profile.pin_pending
    ? [{ key: "pin-migration", title: "Set your new PIN", icon: ShieldCheck, wash: "red", overdue: due.overdue, dueLabel: due.label, onSelect: () => setOpen(true) }]
    : [];

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
  return { rows, overlay };
}
