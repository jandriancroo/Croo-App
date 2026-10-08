UPDATE public.labor_rules SET second_meal_waiver_max_hours = NULL, field_sources = field_sources - 'second_meal_waiver_max_hours'
 WHERE (field_sources->'second_meal_waiver_max_hours'->>'source') = 'migration';
UPDATE public.labor_rule_presets SET second_meal_waiver_max_hours = NULL WHERE state_code = 'CA';
REVOKE EXECUTE ON FUNCTION public.effective_labor_rules(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.effective_labor_rules(uuid) TO service_role;