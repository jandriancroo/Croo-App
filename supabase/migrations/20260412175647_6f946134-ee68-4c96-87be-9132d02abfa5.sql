-- Kiosk punch clock needs to read these tables without auth session

-- Location settings (timezone, punch clock background)
CREATE POLICY "Anon can read location settings for kiosk"
ON public.location_settings
FOR SELECT
TO anon
USING (true);

-- Scheduled shifts (check if employee has a shift today)
CREATE POLICY "Anon can read scheduled shifts for kiosk"
ON public.scheduled_shifts
FOR SELECT
TO anon
USING (shift_date = CURRENT_DATE OR shift_date = CURRENT_DATE - 1);

-- User roles (needed after PIN verification for role-based filtering)
CREATE POLICY "Anon can read user roles for kiosk"
ON public.user_roles
FOR SELECT
TO anon
USING (true);

-- Labor rules (clock-in restrictions)
CREATE POLICY "Anon can read labor rules for kiosk"
ON public.labor_rules
FOR SELECT
TO anon
USING (true);

-- Location hours (business hours for close time)
CREATE POLICY "Anon can read location hours for kiosk"
ON public.location_hours
FOR SELECT
TO anon
USING (true);

-- Punch clock templates (background customization)
CREATE POLICY "Anon can read punch clock templates for kiosk"
ON public.punch_clock_templates
FOR SELECT
TO anon
USING (true);

-- Schedule events (meeting event check for punch-in override)
CREATE POLICY "Anon can read schedule events for kiosk"
ON public.schedule_events
FOR SELECT
TO anon
USING (true);

-- Event attendees (who's assigned to meetings)
CREATE POLICY "Anon can read event attendees for kiosk"
ON public.event_attendees
FOR SELECT
TO anon
USING (true);