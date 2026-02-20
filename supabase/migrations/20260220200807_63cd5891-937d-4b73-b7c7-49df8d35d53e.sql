
-- Drop the logbook trigger that fires daily summary emails on every Drawer/Safe Count save.
-- Daily summaries will now ONLY fire via the 3 AM nightly cron (queue_nightly_emails).
DROP TRIGGER IF EXISTS trigger_logbook_summary_on_drawer_count ON public.logbook_entries;
