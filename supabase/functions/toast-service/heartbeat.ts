// Builds one toast_robot_status row from a runner heartbeat.
// Alert ladders (alert_stage, labor_alert_stage) are reset only by toast-watchdog from real data,
// so a "polling" heartbeat while labor reads fail can't clear an alert.
export const MAX_FULL_LOGINS = 4;

export function heartbeatRow(id: string, prev: any, body: { state: string; message?: string | null; runId?: string | null; fullLogin?: boolean }, today: string, now: string) {
  const count = prev.full_logins_date === today ? (prev.full_logins_count ?? 0) : 0;
  const capped = !!body.fullLogin && count >= MAX_FULL_LOGINS;
  return {
    count,
    capped,
    row: {
      location_id: id,
      state: capped ? "login_capped" : body.state,
      message: body.message ?? null,
      run_id: body.runId ?? prev.run_id ?? null,
      heartbeat_at: now,
      full_logins_date: today,
      full_logins_count: body.fullLogin && count < MAX_FULL_LOGINS ? count + 1 : count,
      updated_at: now,
    },
  };
}
