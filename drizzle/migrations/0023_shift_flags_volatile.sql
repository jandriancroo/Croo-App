ALTER FUNCTION public.shift_flags(uuid, date, date) VOLATILE;
ALTER FUNCTION public.preview_shift_flags(uuid, date, date, jsonb) VOLATILE;
ALTER FUNCTION public._shift_flags(uuid, date, date) VOLATILE;
ALTER FUNCTION public._shift_flags_with_rules(uuid, date, date, jsonb) VOLATILE;
ALTER FUNCTION public.pay_period_open_issues(uuid) VOLATILE;
ALTER FUNCTION public._pay_period_open_issues(date, date, uuid) VOLATILE;