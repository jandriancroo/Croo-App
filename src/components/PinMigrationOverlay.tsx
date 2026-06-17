import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Lock, Loader2, KeyRound, Sparkles } from "lucide-react";
import { toast } from "sonner";

/**
 * Full-screen onboarding overlay shown to any signed-in user who has not yet
 * chosen their new 6-digit punch PIN. Dismissible with "Remind me later"
 * (sessionStorage) but reappears next app open until completed.
 */
export default function PinMigrationOverlay() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deferred, setDeferred] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem("pin_migration_deferred") === "1";
    } catch {
      return false;
    }
  });

  const { data: profile, isLoading } = useQuery({
    queryKey: ["pin-migration-overlay", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("pin_pending")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  // Reset defer state when user changes
  useEffect(() => {
    setDeferred(false);
    try {
      sessionStorage.removeItem("pin_migration_deferred");
    } catch {}
  }, [user?.id]);

  if (!user?.id) return null;
  if (isLoading || !profile) return null;
  if (profile.pin_pending) return null;
  if (deferred) return null;

  const handleDefer = () => {
    try {
      sessionStorage.setItem("pin_migration_deferred", "1");
    } catch {}
    setDeferred(true);
  };

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
        description: "You'll start using it on flip night.",
      });
      setPin("");
      setConfirm("");
      qc.invalidateQueries({ queryKey: ["pin-migration-overlay", user?.id] });
      qc.invalidateQueries({ queryKey: ["pin-migration-status", user?.id] });
      qc.invalidateQueries({ queryKey: ["my-punch-pin", user?.id] });
      qc.invalidateQueries({ queryKey: ["pin-migration-health"] });
    } catch (err: any) {
      toast.error(err?.message || "Couldn't save PIN.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-md p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md mx-auto my-auto">
        <div className="relative rounded-2xl border border-primary/30 bg-card shadow-2xl overflow-hidden">
          {/* Top accent strip */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-primary/70 to-primary" />

          <div className="p-6 pt-8 space-y-5">
            {/* Header */}
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                <div className="relative h-16 w-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                  <Lock className="h-4 w-4 text-primary absolute bottom-1.5 right-1.5" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                    One quick step
                  </span>
                </div>
                <h2 className="text-xl font-bold text-foreground">
                  Pick your new 6-digit punch PIN
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We're upgrading punch security from 4 → 6 digits. Choose your
                  new PIN now — you'll keep using your current 4-digit one at
                  the clock until flip night.
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="overlay-new-pin" className="text-xs">
                  New 6-digit PIN
                </Label>
                <Input
                  id="overlay-new-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="••••••"
                  className="text-center tracking-[0.5em] font-mono text-xl h-12"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overlay-confirm-pin" className="text-xs">
                  Confirm PIN
                </Label>
                <Input
                  id="overlay-confirm-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={confirm}
                  onChange={(e) =>
                    setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="••••••"
                  className="text-center tracking-[0.5em] font-mono text-xl h-12"
                />
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 justify-center">
                <Lock className="h-3 w-3" />
                Avoid obvious patterns like 123456 or 000000.
              </p>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-1">
              <Button
                onClick={handleSubmit}
                disabled={
                  submitting || pin.length !== 6 || confirm.length !== 6
                }
                className="w-full h-11"
                size="lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4 mr-2" />
                    Save my new PIN
                  </>
                )}
              </Button>
              <Button
                onClick={handleDefer}
                disabled={submitting}
                variant="ghost"
                className="w-full text-xs text-muted-foreground"
              >
                Remind me later
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
