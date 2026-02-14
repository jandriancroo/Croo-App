-- Secure remaining public access issues

-- 1. SHIFT_TEMPLATES
DROP POLICY IF EXISTS "Anyone can view shift templates" ON public.shift_templates;
CREATE POLICY "Users can view shift templates for their locations"
  ON public.shift_templates
  FOR SELECT
  TO authenticated
  USING (has_location_access(auth.uid(), location_id));

-- 2. SCHEDULE_EVENTS
DROP POLICY IF EXISTS "Anyone can view schedule events" ON public.schedule_events;
CREATE POLICY "Users can view events at their locations"
  ON public.schedule_events
  FOR SELECT
  TO authenticated
  USING (has_location_access(auth.uid(), location_id));

-- 3. SHIFT_OFFERS
DROP POLICY IF EXISTS "Anyone can view shift offers" ON public.shift_offers;
CREATE POLICY "Users can view shift offers at their locations"
  ON public.shift_offers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scheduled_shifts ss
      JOIN schedules s ON s.id = ss.schedule_id
      WHERE ss.id = shift_offers.shift_id
        AND has_location_access(auth.uid(), s.location_id)
    )
  );

-- 4. GAME_HIGH_SCORES
DROP POLICY IF EXISTS "Anyone can view game high scores" ON public.game_high_scores;
CREATE POLICY "Users can view own game high scores"
  ON public.game_high_scores
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Managers can view team game scores"
  ON public.game_high_scores
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_locations ul
      WHERE ul.user_id = auth.uid()
        AND ul.location_id IN (
          SELECT location_id FROM user_locations 
          WHERE user_id = game_high_scores.user_id
        )
    )
  );

-- 5. HIRING_CONVERSATIONS
DROP POLICY IF EXISTS "Anyone can view hiring conversations" ON public.hiring_conversations;
CREATE POLICY "Staff can view conversations for their organization"
  ON public.hiring_conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM job_applications ja
      WHERE ja.id = hiring_conversations.application_id
        AND (
          can_manage_org_applications(auth.uid(), ja.organization_id)
          OR has_location_access(auth.uid(), ja.location_id)
        )
    )
  );