// The ONE client place for schedule approval. Posting goes through rpc('publish_schedule')
// (via publishSchedule in scheduleActions) or rpc('approve_schedule'); gating is decided from
// location_settings + the user's role + schedule_week_labor_check, mirroring the server.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { publishSchedule, sendWeeklyScheduleEmail } from "@/lib/scheduleActions";

export type ApprovalMode = "direct" | "needs_approval" | "pending" | "changes_requested" | "approver_review";
export type ApprovalSettingsMode = "every_draft" | "over_labor_goal";

export interface ScheduleLaborCheck {
  scheduled_hours: number;
  scheduled_cost: number;
  projected_sales: number | null;
  labor_pct: number | null;
  target_pct: number | null;
  misses_goal: boolean;
  reason: string | null;
  week_over_goal?: boolean;
  days?: { date: string; projected_sales: number | null; target_pct: number | null; scheduled_hours: number; scheduled_cost: number; labor_pct: number | null; over_goal: boolean }[];
  people?: { user_id: string; name: string | null; week_hours: number; over_weekly: boolean; weekly_threshold: number; days_over_daily: { date: string; hours: number }[] }[];
}

export interface ApprovalSettings {
  enabled: boolean;
  roles: string[];
  mode: ApprovalSettingsMode;
}

export const approvalSettingsKey = (locationId?: string | null) => ["schedule-approval-settings", locationId ?? null];
const approvalRowKey = (scheduleId?: string | null) => ["schedule-approval-row", scheduleId ?? null];

const ADMIN_ROLES = ["admin", "org_admin", "super_admin"];

export function useScheduleApprovalSettings(locationId?: string | null) {
  return useQuery({
    queryKey: approvalSettingsKey(locationId),
    enabled: !!locationId,
    staleTime: 60_000,
    queryFn: async (): Promise<ApprovalSettings> => {
      const { data, error } = await supabase
        .from("location_settings")
        .select("schedule_approval_enabled, schedule_approval_roles, schedule_approval_mode")
        .eq("location_id", locationId!)
        .maybeSingle();
      if (error) throw error;
      return {
        enabled: !!data?.schedule_approval_enabled,
        roles: (data?.schedule_approval_roles as string[] | null) ?? ["manager"],
        mode: ((data?.schedule_approval_mode as ApprovalSettingsMode) ?? "every_draft"),
      };
    },
  });
}

/** Admins+ who aren't themselves gated may change the settings (same as the server). */
export function canEditApprovalSettings(role: string | null | undefined, gatedRoles: string[]) {
  return !!role && ADMIN_ROLES.includes(role) && !gatedRoles.includes(role);
}

/** Save via set_schedule_approval_settings; returns { no_approver } so callers can warn. */
export async function saveScheduleApprovalSettings(locationId: string, patch: { enabled?: boolean; roles?: string[]; mode?: ApprovalSettingsMode }) {
  const { data, error } = await supabase.rpc("set_schedule_approval_settings" as any, {
    _location_id: locationId,
    _enabled: patch.enabled ?? null,
    _roles: patch.roles ?? null,
    _mode: patch.mode ?? null,
  });
  if (error) throw error;
  return data as { enabled: boolean; roles: string[]; mode: ApprovalSettingsMode; no_approver: boolean };
}

export function useScheduleApproval(scheduleId: string | null, locationId: string | null | undefined, isPublished: boolean, shiftsVersion?: unknown) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { role } = useUserRole();
  const [busy, setBusy] = useState(false);
  const settingsQ = useScheduleApprovalSettings(locationId);
  const settings = settingsQ.data;

  const rowQ = useQuery({
    queryKey: approvalRowKey(scheduleId),
    enabled: !!scheduleId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedules")
        .select("approval_status, approval_requested_by, approval_requested_at, approval_decided_by, approval_decided_at, approval_message")
        .eq("id", scheduleId!)
        .maybeSingle();
      if (error) throw error;
      let requesterName: string | null = null;
      if (data?.approval_requested_by) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", data.approval_requested_by).maybeSingle();
        requesterName = p?.full_name ?? null;
      }
      return { ...(data ?? {}), requesterName } as {
        approval_status: "pending" | "changes_requested" | "approved" | null;
        approval_requested_by: string | null;
        approval_requested_at: string | null;
        approval_message: string | null;
        requesterName: string | null;
      };
    },
  });
  const row = rowQ.data;

  const isGated = !!settings?.enabled && !!role && settings.roles.includes(role);
  const isApprover = !!role && ADMIN_ROLES.includes(role) && !isGated;
  const needCheck = !!scheduleId && !isPublished && !!settings?.enabled &&
    (settings.mode === "over_labor_goal" || row?.approval_status === "pending");

  const checkKey = ["schedule-week-labor-check", scheduleId, shiftsVersion];
  const fetchCheck = async () => {
    const { data, error } = await supabase.rpc("schedule_week_labor_check" as any, { _schedule_id: scheduleId });
    if (error) throw error;
    return data as unknown as ScheduleLaborCheck;
  };
  const checkQ = useQuery({ queryKey: checkKey, enabled: needCheck, staleTime: 30_000, queryFn: fetchCheck });

  /** Fresh labor check for the Post confirm (works with approval off). Null on failure: never blocks posting. */
  const checkLabor = useCallback(async (): Promise<ScheduleLaborCheck | null> => {
    if (!scheduleId) return null;
    try { return await qc.fetchQuery({ queryKey: checkKey, queryFn: fetchCheck, staleTime: 0 }); }
    catch (e) { console.warn("schedule_week_labor_check", e); return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, scheduleId, shiftsVersion]);
  const laborCheck = checkQ.data ?? null;

  let mode: ApprovalMode = "direct";
  if (!isPublished && settings?.enabled) {
    if (row?.approval_status === "pending") {
      mode = isApprover && row.approval_requested_by !== user?.id ? "approver_review" : isGated ? "pending" : "direct";
    } else if (isGated) {
      const required = settings.mode === "every_draft" || !laborCheck || laborCheck.misses_goal;
      if (required) mode = row?.approval_status === "changes_requested" ? "changes_requested" : "needs_approval";
    }
  }

  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: approvalRowKey(scheduleId) }),
      qc.invalidateQueries({ queryKey: ["schedule-week-labor-check", scheduleId] }),
      qc.invalidateQueries({ queryKey: ["assigned-temp-tasks"] }),
    ]);
  }, [qc, scheduleId]);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); await refresh(); }
  }, [refresh]);

  const submit = useCallback(() => run(async () => {
    const { error } = await supabase.rpc("submit_schedule_for_approval" as any, { _schedule_id: scheduleId });
    if (error) throw error;
  }), [run, scheduleId]);

  const approve = useCallback(() => run(async () => {
    const { error } = await supabase.rpc("approve_schedule" as any, { _schedule_id: scheduleId });
    if (error) throw error;
    if (scheduleId && locationId) sendWeeklyScheduleEmail(scheduleId, locationId);
  }), [run, scheduleId, locationId]);

  const sendBack = useCallback((message: string) => run(async () => {
    const { error } = await supabase.rpc("send_back_schedule" as any, { _schedule_id: scheduleId, _message: message });
    if (error) throw error;
  }), [run, scheduleId]);

  /** Direct post (mode 'direct'): publish_schedule then the weekly email. */
  const post = useCallback(() => run(async () => {
    if (scheduleId && locationId) await publishSchedule(scheduleId, locationId);
  }), [run, scheduleId, locationId]);

  return {
    loading: settingsQ.isLoading || rowQ.isLoading,
    mode,
    settings,
    laborCheck,
    requesterName: row?.requesterName ?? null,
    requestedAt: row?.approval_requested_at ?? null,
    message: row?.approval_message ?? null,
    busy,
    submit,
    approve,
    sendBack,
    post,
    refresh,
    checkLabor,
  };
}

/** True when the week or any day is over its labor goal. */
export function laborCheckOverGoal(lc: ScheduleLaborCheck | null | undefined): boolean {
  return !!lc && (!!lc.week_over_goal || !!lc.days?.some((d) => d.over_goal));
}

/** The ONE line saying why this week needs approval (over_labor_goal mode); picked from the check's reason. */
export function needsApprovalReason(lc: ScheduleLaborCheck | null | undefined): string {
  const reason = lc?.reason;
  if (reason === "over_goal") return "This week is over the labor goal, so it needs approval before it posts.";
  if (reason === "no_projection" || reason === "zero_sales") return "This week has no sales projection yet, so it needs approval before it posts.";
  if (reason === "no_target") return "This store has no labor goal set, so it needs approval before it posts.";
  return "This week needs approval before it posts.";
}

/** Friendly text for server errors from the approval functions. */
export function approvalErrorText(e: any): string {
  const m = String(e?.message ?? e ?? "");
  if (m.includes("already_decided")) return `Already decided${m.split("already_decided")[1] ?? ""}.`.replace("by ", "by ");
  if (m.includes("no_approver")) return "Nobody at this store can approve schedules yet. Ask your admin.";
  if (m.includes("approval_required")) return "This week needs approval before it can be posted.";
  if (m.includes("already_published")) return "This week is already posted.";
  if (m.includes("cannot_decide_own_request")) return "You can't approve your own request.";
  if (m.includes("not_authorized")) return "You don't have permission to do that.";
  return "Something went wrong. Please try again.";
}
