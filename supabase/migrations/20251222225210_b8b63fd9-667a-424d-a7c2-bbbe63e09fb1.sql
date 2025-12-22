-- Fix inconsistent RLS policies to use has_location_access() everywhere

-- daily_tips: currently uses raw user_locations join
DROP POLICY IF EXISTS "Users can view daily tips at their locations" ON public.daily_tips;
CREATE POLICY "Users can view daily tips at their locations"
ON public.daily_tips FOR SELECT
USING (has_location_access(auth.uid(), location_id));

-- labor_rules: currently uses raw user_locations join
DROP POLICY IF EXISTS "Users can view labor rules for their locations" ON public.labor_rules;
CREATE POLICY "Users can view labor rules for their locations"
ON public.labor_rules FOR SELECT
USING (has_location_access(auth.uid(), location_id));

-- location_hours: currently uses raw user_locations join
DROP POLICY IF EXISTS "Users can view location hours for their locations" ON public.location_hours;
CREATE POLICY "Users can view location hours for their locations"
ON public.location_hours FOR SELECT
USING (has_location_access(auth.uid(), location_id));

-- location_settings: currently uses raw user_locations join
DROP POLICY IF EXISTS "Users can view location settings" ON public.location_settings;
CREATE POLICY "Users can view location settings"
ON public.location_settings FOR SELECT
USING (has_location_access(auth.uid(), location_id));

-- holidays: currently uses raw user_locations join
DROP POLICY IF EXISTS "Users can view holidays" ON public.holidays;
CREATE POLICY "Users can view holidays"
ON public.holidays FOR SELECT
USING ((location_id IS NULL) OR has_location_access(auth.uid(), location_id));

-- ovation_location_mappings: currently uses raw user_locations + profiles.role check
DROP POLICY IF EXISTS "Users can view ovation location mappings" ON public.ovation_location_mappings;
CREATE POLICY "Users can view ovation location mappings"
ON public.ovation_location_mappings FOR SELECT
USING (has_location_access(auth.uid(), location_id));