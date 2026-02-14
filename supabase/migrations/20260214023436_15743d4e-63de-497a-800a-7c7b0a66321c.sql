
DROP VIEW IF EXISTS public.applicant_current_flags;

CREATE VIEW public.applicant_current_flags WITH (security_invoker = true) AS
SELECT DISTINCT ON (application_id) 
  application_id,
  flag_color,
  reason,
  set_by,
  created_at
FROM applicant_flags
ORDER BY application_id, created_at DESC;
