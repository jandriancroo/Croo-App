UPDATE public.labor_rules SET state_code = 'WI', rule_name = 'Wisconsin'
 WHERE id = '7909d8ec-16e9-4e35-8986-c4b160d2a6c8' AND location_id = '0d1477e5-791d-42f4-9245-ad8b2e75c41c' AND state_code = 'US';
UPDATE public.location_settings SET timezone = 'America/Chicago'
 WHERE location_id = '0d1477e5-791d-42f4-9245-ad8b2e75c41c' AND timezone = 'America/Los_Angeles';