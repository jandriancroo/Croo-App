import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { approvalErrorText, laborCheckOverGoal, OVER_GOAL_NEEDS_APPROVAL, type useScheduleApproval } from "@/hooks/useScheduleApproval";
import { laborCheckIssues } from "./laborCheckIssues";

type Approval = ReturnType<typeof useScheduleApproval>;

interface SchedulePostButtonProps {
  approval?: Approval | null;
  /** Direct post (the Schedule page's handleGoLive → rpc('publish_schedule')). */
  onPost?: () => void;
  isPublishing?: boolean;
  /** Refresh the week after Approve & post. */
  onChanged?: () => void;
  className?: string;
  size?: "sm" | "default";
  compact?: boolean;
}

/** The one Post control for an unposted week: Post / Send for approval / Waiting / Resend / Approve & post. */
export function SchedulePostButton({ approval, onPost, isPublishing = false, onChanged, className, size = "default", compact }: SchedulePostButtonProps) {
  const mode = approval?.mode ?? "direct";
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState<{ lines: string[]; go: () => void } | null>(null);
  const busy = isPublishing || !!approval?.busy || checking;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); onChanged?.(); }
    catch (e) { toast.error(approvalErrorText(e)); }
  };

  const isSend = mode === "needs_approval" || mode === "changes_requested";
  const needsGoalApproval = isSend && approval?.settings?.mode === "over_labor_goal";

  /** Fresh labor check first; over goal → confirm. A failed check never blocks. */
  const guarded = async (go: () => void) => {
    if (!approval?.checkLabor) return go();
    setChecking(true);
    const lc = await approval.checkLabor();
    setChecking(false);
    if (!laborCheckOverGoal(lc)) return go();
    setConfirm({ lines: laborCheckIssues(lc), go });
  };

  const dialog = (
    <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Over the labor goal</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {needsGoalApproval && <p>{OVER_GOAL_NEEDS_APPROVAL}</p>}
              <ul className="list-disc space-y-0.5 pl-5 text-foreground">
                {confirm?.lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={() => { const go = confirm?.go; setConfirm(null); go?.(); }}>
            {isSend ? "Send anyway" : "Post anyway"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (mode === "direct") {
    return (
      <>
        <Button size={size} className={className} onClick={() => onPost && guarded(onPost)} disabled={busy}>
          {busy ? (compact ? "..." : checking ? "Checking..." : "Posting...") : "Post"}
        </Button>
        {dialog}
      </>
    );
  }
  if (mode === "pending") {
    return (
      <Button size={size} variant="outline" className={className} disabled>
        {compact ? "Waiting" : "Waiting on approval"}
      </Button>
    );
  }
  if (mode === "approver_review") {
    return (
      <Button size={size} className={className} disabled={busy} onClick={() => act(approval!.approve, "Posted. Team notified shortly.")}>
        {busy ? "..." : compact ? "Approve" : "Approve & post"}
      </Button>
    );
  }
  const resend = mode === "changes_requested";
  return (
    <>
      <Button
        size={size}
        className={cn(className)}
        disabled={busy}
        onClick={() => guarded(() => act(approval!.submit, "Sent for approval."))}
      >
        {busy ? "..." : compact ? (resend ? "Resend" : "Send") : resend ? "Resend for approval" : "Send for approval"}
      </Button>
      {dialog}
    </>
  );
}
