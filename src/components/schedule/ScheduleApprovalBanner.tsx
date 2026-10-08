import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { CalendarCheck, Clock, MessageSquareWarning, CheckCircle2, ChevronDown, AlertTriangle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useScheduleLaborRules } from "@/hooks/useScheduleLaborRules";
import { laborCheckIssues } from "./laborCheckIssues";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { approvalErrorText, OVER_GOAL_NEEDS_APPROVAL, type useScheduleApproval } from "@/hooks/useScheduleApproval";

type Approval = ReturnType<typeof useScheduleApproval>;

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

/** Above the schedule grid (desktop + phone): approval status for this week. */
export function ScheduleApprovalBanner({ approval, isPublished, onChanged }: { approval: Approval | null | undefined; isPublished: boolean; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const { currentLocation } = useAppLocation();
  const { data: rules } = useScheduleLaborRules(currentLocation?.id);
  if (!approval || isPublished || !approval.settings?.enabled) return null;
  const { mode, laborCheck: lc } = approval;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); onChanged?.(); return true; }
    catch (e) { toast.error(approvalErrorText(e)); return false; }
  };

  if (mode === "approver_review") {
    const ago = approval.requestedAt ? formatDistanceToNow(new Date(approval.requestedAt), { addSuffix: true }) : "";
    return (
      <div className="mx-2 my-2 flex flex-col gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
        <CalendarCheck className="hidden h-4 w-4 shrink-0 text-amber-600 sm:block" />
        <p className="flex-1 text-foreground">
          <span className="font-semibold">{approval.requesterName ?? "A manager"}</span> sent this for approval {ago}
          {lc && <> · labor {pct(lc.labor_pct)} vs {pct(lc.target_pct)} <span className="text-muted-foreground">(before weekly overtime)</span></>}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={approval.busy} onClick={() => { setMsg(""); setOpen(true); }}>Send back with changes</Button>
          <Button size="sm" disabled={approval.busy} onClick={() => act(approval.approve, "Posted. Team notified shortly.")}>Approve &amp; post</Button>
        </div>
        <ApproverIssues issues={laborCheckIssues(lc, { people: true, dailyOt: rules?.daily_overtime_threshold })} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send back with changes</DialogTitle>
              <DialogDescription>Tell {approval.requesterName ?? "the manager"} what to change. They'll get a task and a notification.</DialogDescription>
            </DialogHeader>
            <Textarea value={msg} onChange={(e) => setMsg(e.target.value.slice(0, 500))} rows={4} placeholder="e.g. Cut one closer on Tuesday" />
            <p className="text-right text-xs text-muted-foreground">{msg.length}/500</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!msg.trim() || approval.busy} onClick={async () => { if (await act(() => approval.sendBack(msg.trim()), "Sent back.")) setOpen(false); }}>Send back</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (mode === "pending") {
    return (
      <div className="mx-2 my-2 flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-foreground">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p>Waiting on approval: you can keep editing; the admin approves what's on the schedule when they tap Approve.</p>
      </div>
    );
  }

  if (mode === "changes_requested") {
    return (
      <div className="mx-2 my-2 flex flex-col gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm sm:flex-row sm:items-center">
        <MessageSquareWarning className="hidden h-4 w-4 shrink-0 text-destructive sm:block" />
        <p className="flex-1 text-foreground"><span className="font-semibold text-destructive">Sent back:</span> {approval.message}</p>
        <Button size="sm" disabled={approval.busy} onClick={() => act(approval.submit, "Sent for approval.")}>Resend for approval</Button>
      </div>
    );
  }

  if (mode === "direct" && approval.settings.mode === "over_labor_goal" && lc && !lc.misses_goal) {
    return (
      <div className="mx-2 my-2 flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
        <p>Within labor goal ({pct(lc.labor_pct)} vs {pct(lc.target_pct)}): posting without approval</p>
      </div>
    );
  }
  if (mode === "needs_approval" && approval.settings.mode === "over_labor_goal") {
    return (
      <div className="mx-2 my-2 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <p>{OVER_GOAL_NEEDS_APPROVAL}</p>
      </div>
    );
  }
  return null;
}

/** Read-only, collapsed by default: what the approver should look at. */
function ApproverIssues({ issues }: { issues: string[] }) {
  if (issues.length === 0) {
    return <p className="basis-full text-xs text-muted-foreground">No issues: within labor goal, nobody over overtime.</p>;
  }
  return (
    <Collapsible className="basis-full">
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
        Issues ({issues.length})
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground">
          {issues.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
