-- Temp-photo reader: log unclear photos (rejected with a retake tip) and
-- disagreements settled by the third tie-break read.
-- Rollback: restore the old list (delete rows with the new reasons first).
ALTER TABLE public.temperature_read_issues DROP CONSTRAINT IF EXISTS temperature_read_issues_reason_check;
ALTER TABLE public.temperature_read_issues ADD CONSTRAINT temperature_read_issues_reason_check
  CHECK (reason IN ('read_failed','reads_disagree','one_read_failed','function_error','unclear','tiebreak_confirmed'));
