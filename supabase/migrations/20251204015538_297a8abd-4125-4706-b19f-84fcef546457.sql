-- Add field to control when monthly checklists become visible
ALTER TABLE public.checklists 
ADD COLUMN visible_days_before_month_end integer DEFAULT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN public.checklists.visible_days_before_month_end IS 'For monthly checklists: number of days before month end when checklist becomes visible (e.g., 7 = last 7 days of month)';