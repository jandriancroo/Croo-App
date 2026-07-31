DROP POLICY IF EXISTS "Authenticated users can insert alerts" ON public.alert_queue;
CREATE POLICY "Users can queue alerts for their locations"
ON public.alert_queue FOR INSERT TO authenticated
WITH CHECK (location_id IS NOT NULL AND public.has_location_access(auth.uid(), location_id));

DROP POLICY IF EXISTS "Anyone can insert applicant push subscriptions" ON public.applicant_push_subscriptions;
DROP POLICY IF EXISTS "Anyone can update applicant push subscriptions" ON public.applicant_push_subscriptions;

CREATE POLICY "Push subscriptions must target a real conversation"
ON public.applicant_push_subscriptions FOR INSERT TO anon, authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.hiring_conversations hc WHERE hc.id = conversation_id));

CREATE POLICY "Push subscriptions update must target a real conversation"
ON public.applicant_push_subscriptions FOR UPDATE TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.hiring_conversations hc WHERE hc.id = conversation_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.hiring_conversations hc WHERE hc.id = conversation_id));