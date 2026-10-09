// Schedule approval settings UI. Reads location_settings via useScheduleApprovalSettings and saves only
// through set_schedule_approval_settings (saveScheduleApprovalSettings). Admins edit; everyone else reads.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { useUserRole } from "@/hooks/useUserRole";
import { useLaborGoals } from "@/hooks/useLaborGoals";
import {
  approvalSettingsKey, canEditApprovalSettings, saveScheduleApprovalSettings, useScheduleApprovalSettings,
  type ApprovalSettingsMode,
} from "@/hooks/useScheduleApproval";

function useApprovalSave(locationId: string) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const save = async (patch: { enabled?: boolean; roles?: string[]; mode?: ApprovalSettingsMode }) => {
    setSaving(true);
    try {
      const res = await saveScheduleApprovalSettings(locationId, patch);
      await qc.invalidateQueries({ queryKey: approvalSettingsKey(locationId) });
      if (res?.enabled && res.no_approver) toast.warning("Saved, but nobody at this store can approve schedules yet.");
      else toast.success("Saved");
    } catch (e: any) {
      toast.error(String(e?.message ?? "").includes("not_authorized") ? "Only admins can change this." : "Couldn't save. Please try again.");
    } finally { setSaving(false); }
  };
  return { save, saving };
}

function summaryText(roles: string[], mode: ApprovalSettingsMode, weekly: number | null) {
  const who = roles.includes("manager") && roles.includes("admin") ? "Managers and admins" : roles.includes("admin") ? "Admins" : "Managers";
  const when = mode === "every_draft" ? "every schedule" : `only when over the labor goal${weekly != null ? ` (${weekly}%)` : ""}`;
  return `${who} need approval · ${when}`;
}

/** Compact bottom card on Schedule Settings: on/off switch, summary, link to Labor Rules. */
export function ScheduleApprovalSettingsCard({ locationId }: { locationId: string }) {
  const { role } = useUserRole();
  const { data: s } = useScheduleApprovalSettings(locationId);
  const goals = useLaborGoals(locationId);
  const { save, saving } = useApprovalSave(locationId);
  if (!s) return null;
  const editable = canEditApprovalSettings(role, s.roles);
  return (
    <Card className="rounded-lg">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="sched-approval" className="text-sm font-medium">Require approval before posting</Label>
          {editable ? (
            <Switch id="sched-approval" checked={s.enabled} disabled={saving} onCheckedChange={(v) => save({ enabled: v })} />
          ) : (
            <span className="text-xs text-muted-foreground">{s.enabled ? "On" : "Off"} · Set by your admin</span>
          )}
        </div>
        {s.enabled && <p className="text-sm text-muted-foreground">{summaryText(s.roles, s.mode, goals.weekly)}</p>}
        <Link to={`/location/${locationId}`} className="text-sm text-primary underline-offset-2 hover:underline">
          Change who and when in Location → Labor Rules
        </Link>
      </CardContent>
    </Card>
  );
}

/** Bottom block of Labor Rules: who needs approval and when. Not part of the wizard or save_labor_rules. */
export function ScheduleApprovalRulesBlock({ locationId }: { locationId: string }) {
  const { role } = useUserRole();
  const { data: s } = useScheduleApprovalSettings(locationId);
  const goals = useLaborGoals(locationId);
  const { save, saving } = useApprovalSave(locationId);
  if (!s) return null;
  const editable = canEditApprovalSettings(role, s.roles);
  const toggleRole = (r: "manager" | "admin", on: boolean) => {
    const next = on ? Array.from(new Set([...s.roles, r])) : s.roles.filter((x) => x !== r);
    if (next.length === 0) { toast.error("Pick at least one role."); return; }
    save({ roles: next });
  };
  const approvers = s.roles.includes("admin") ? "Org Admins" : "Admins + Org Admins";
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><CalendarCheck className="h-4 w-4" /> Schedule approval</h4>
        <Badge variant={s.enabled ? "default" : "outline"} className="text-[10px]">{s.enabled ? "On" : "Off"}</Badge>
      </div>
      {!editable && <p className="text-xs text-muted-foreground">Set by your admin.</p>}
      <div className="space-y-1.5">
        <p className="text-sm">Who needs approval to post:</p>
        <div className="flex gap-4">
          {(["manager", "admin"] as const).map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <Checkbox checked={s.roles.includes(r)} disabled={!editable || saving} onCheckedChange={(v) => toggleRole(r, !!v)} />
              {r === "manager" ? "Managers" : "Admins"}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Approvers: {approvers}</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm">When:</p>
        <RadioGroup value={s.mode} onValueChange={(v) => save({ mode: v as ApprovalSettingsMode })} disabled={!editable || saving}>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="every_draft" /> Every schedule</label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="over_labor_goal" /> Only when the week misses the labor goal{goals.weekly != null ? ` (${goals.weekly}%)` : ""}
          </label>
        </RadioGroup>
        {goals.templateId && (
          <Link to={`/week-template/${goals.templateId}`} className="text-xs text-primary underline-offset-2 hover:underline">
            Change the goal in the Weekly Template
          </Link>
        )}
      </div>
      <Link to="/schedule-settings" className="text-xs text-primary underline-offset-2 hover:underline">
        Turn approval on or off in Schedule Settings
      </Link>
    </div>
  );
}
