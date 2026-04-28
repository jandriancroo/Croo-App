UPDATE public.support_tickets
SET status = 'resolved',
    resolved_at = now(),
    resolution_notes = 'Auto-resolved: transient Microsoft B2C outage at 06:30 UTC caused both the standard refresh and ROPC fallback to time out. The keep-alive cron self-healed once B2C recovered — Rowlett''s PFG token has been swapping successfully every 5–15 minutes since (most recent swap at 17:30 UTC, confirmed in pfg_refresh_audit). No manual reconnect needed.',
    updated_at = now()
WHERE ticket_number = 29
  AND status = 'open';