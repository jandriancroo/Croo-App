ALTER TABLE public.toast_employee_mappings DROP CONSTRAINT IF EXISTS toast_employee_mappings_match_method_check;
ALTER TABLE public.toast_employee_mappings
  ADD CONSTRAINT toast_employee_mappings_match_method_check CHECK (match_method = ANY (ARRAY['auto'::text, 'manual'::text, 'unmatched'::text]));
-- Rows that never matched were tagged 'auto'; mark them honestly so they get re-tried.
UPDATE public.toast_employee_mappings SET match_method = 'unmatched' WHERE croo_user_id IS NULL AND match_method = 'auto';