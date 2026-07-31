import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShieldCheck,
  Eye,
  EyeOff,
  Copy,
  Loader2,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Self-service punch PIN card for MyProfile.
 * Only ever shows / changes the signed-in user's own PIN.
 */
export function MyPunchPinCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [revealed, setRevealed] = useState(false);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-punch-pin", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase.rpc("get_punch_pin_for_user", {
        _user_id: user.id,
      });
      if (error) throw error;
      return (data as any[])?.[0] ?? null;
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  const hasPin = !!profile?.pin_pending;
  const pinPlain = (profile as any)?.pin_pending_plaintext as string | null;

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
      toast.success(hasPin ? "PIN updated" : "PIN saved");
      setOpen(false);
      setPin("");
      setConfirm("");
      setRevealed(false);
      qc.invalidateQueries({ queryKey: ["my-punch-pin", user?.id] });
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            New 6-digit punch PIN
          </CardTitle>
          <CardDescription>
            You'll start using this at the punch clock on flip night. Only you
            can see or change it here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : !hasPin ? (
            <Button onClick={() => setOpen(true)} className="w-full">
              <KeyRound className="h-4 w-4 mr-2" />
              Set my 6-digit PIN
            </Button>
          ) : (
            <>
              <Label className="text-xs text-muted-foreground">Your PIN</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 text-center font-mono text-lg tracking-[0.4em] py-2 rounded-md border bg-background">
                  {revealed && pinPlain ? pinPlain : "••••••"}
                </div>
                {pinPlain ? (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setRevealed((r) => !r)}
                      aria-label={revealed ? "Hide" : "Reveal"}
                    >
                      {revealed ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    {revealed && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard.writeText(pinPlain);
                          toast.success("Copied");
                        }}
                        aria-label="Copy"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                ) : null}
              </div>
              {!pinPlain && (
                <p className="text-xs text-muted-foreground italic">
                  Set before reveal was available — change it below to view.
                </p>
              )}
              <Button
                variant="outline"
                onClick={() => setOpen(true)}
                className="w-full"
              >
                Change PIN
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {hasPin ? "Change your 6-digit PIN" : "Set your 6-digit PIN"}
            </DialogTitle>
            <DialogDescription>
              Pick something only you know. Avoid obvious patterns like 123456
              or 000000.
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
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
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
