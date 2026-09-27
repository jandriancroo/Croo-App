-- Package A step 2: data fixes 1-6 (snapshots saved in step 0)
UPDATE public.location_integrations SET credentials = credentials || '{"pull_labor":true}'::jsonb
 WHERE id = '004abcba-ddee-47ee-b441-3b0ecb2bd04f';
UPDATE public.location_integrations SET credentials = credentials || '{"pull_labor":false}'::jsonb
 WHERE id = 'df005fd5-5797-4e32-944a-0bdeb0d20d8e';
INSERT INTO public.labor_rules (location_id, rule_name, state_code, overtime_multiplier, double_time_multiplier,
  meal_break_hours, meal_break_duration, rest_break_hours, rest_break_duration, daily_overtime_threshold,
  daily_double_time_threshold, weekly_overtime_threshold, auto_punch_out_time, pay_period_type, pay_period_start_date,
  allow_unscheduled_clock_in, allow_early_clock_in, early_clock_in_minutes, reporting_time_enabled,
  reporting_time_min_hours, reporting_time_max_hours, unpaid_break_min_minutes)
SELECT 'f8b6e4fd-1c3e-4de4-8020-482426629249', 'Nevada', 'NV', overtime_multiplier, double_time_multiplier,
  meal_break_hours, meal_break_duration, rest_break_hours, rest_break_duration, daily_overtime_threshold,
  daily_double_time_threshold, weekly_overtime_threshold, NULL, pay_period_type, pay_period_start_date,
  allow_unscheduled_clock_in, allow_early_clock_in, early_clock_in_minutes, reporting_time_enabled,
  reporting_time_min_hours, reporting_time_max_hours, unpaid_break_min_minutes
FROM public.labor_rules WHERE id = '61a19677-1f81-42a6-90b0-b30ddfda886f'
  AND NOT EXISTS (SELECT 1 FROM public.labor_rules WHERE location_id = 'f8b6e4fd-1c3e-4de4-8020-482426629249');
UPDATE public.labor_rules SET state_code = 'WI', rule_name = 'Wisconsin'
 WHERE location_id = '7909d8ec-16e9-4e35-8986-c4b160d2a6c8' AND state_code = 'US';
UPDATE public.location_settings SET timezone = 'America/Chicago'
 WHERE location_id = '7909d8ec-16e9-4e35-8986-c4b160d2a6c8' AND timezone = 'America/Los_Angeles';
UPDATE public.labor_rules SET meal_break_hours = 5, meal_break_duration = 30
 WHERE location_id = '01a87b8b-fb29-4734-8d1b-4a47307f843c' AND meal_break_hours IS NULL;
UPDATE public.labor_rules SET auto_clock_out_after_close_min = 180, auto_punch_out_time = NULL
 WHERE location_id IN ('12c977c7-1786-4131-90f5-1eef3f96e2c6','d667741f-6d4c-433e-bb22-307e817ea7f1');