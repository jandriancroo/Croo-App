UPDATE public.vendor_gap_alerts
SET status = 'resolved', resolved_at = now()
WHERE id = 'fa34d989-b6d2-4b2b-a5ed-f91ac6dad545';