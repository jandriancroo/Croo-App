import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { approvalErrorText, type useScheduleApproval } from "@/hooks/useScheduleApproval";

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
  const busy = isPublishing || !!approval?.busy;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); onChanged?.(); }
    catch (e) { toast.error(approvalErrorText(e)); }
  };

  if (mode === "direct") {
    return (
      <Button size={size} className={className} onClick={onPost} disabled={busy}>
        {busy ? (compact ? "..." : "Posting...") : "Post"}
      </Button>
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
    <Button
      size={size}
      className={cn(className)}
      disabled={busy}
      onClick={() => act(approval!.submit, "Sent for approval.")}
    >
      {busy ? "..." : compact ? (resend ? "Resend" : "Send") : resend ? "Resend for approval" : "Send for approval"}
    </Button>
  );
}
