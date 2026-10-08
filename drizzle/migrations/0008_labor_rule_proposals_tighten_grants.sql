REVOKE ALL ON public.labor_rule_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.labor_rule_proposals TO authenticated;
GRANT ALL ON public.labor_rule_proposals TO service_role;