import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Copy, ShieldCheck, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

/**
 * Read-only display of a user's new 6-digit punch PIN, shown next to their
 * legacy 4-digit PIN inside EmployeeProfileDialog. Visible to anyone allowed
 * to read the profile row (admins via RLS, or the user themself).
 */
export function EmployeeNewPinField({ userId }: { userId: string }) {
  const [revealed, setRevealed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["employee-new-pin", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_punch_pin_for_user", {
        _user_id: userId,
      });
      if (error) throw error;
      return ((data as any[])?.[0] ?? null) as {
        pin_pending: string | null;
        pin_pending_plaintext: string | null;
        pin_pending_set_at: string | null;
      } | null;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });

  const hasPin = !!data?.pin_pending;
  const pinPlain = (data as any)?.pin_pending_plaintext as string | null;
  const setAt = data?.pin_pending_set_at as string | null;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        New 6-digit PIN
      </Label>

      {isLoading ? (
        <div className="h-10 rounded-md border bg-muted/40 animate-pulse" />
      ) : !hasPin ? (
        <div className="h-10 px-3 flex items-center justify-center rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 text-xs text-amber-700 dark:text-amber-400 font-medium">
          Not set yet
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-10 text-center font-mono text-base tracking-[0.4em] flex items-center justify-center rounded-md border bg-background">
            {revealed && pinPlain ? pinPlain : "••••••"}
          </div>
          {pinPlain ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
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
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
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
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {hasPin && setAt ? (
          <>
            <Clock className="h-3 w-3" />
            Set {formatDistanceToNow(new Date(setAt), { addSuffix: true })}
          </>
        ) : (
          "Used at the punch clock after flip night"
        )}
      </p>
    </div>
  );
}
