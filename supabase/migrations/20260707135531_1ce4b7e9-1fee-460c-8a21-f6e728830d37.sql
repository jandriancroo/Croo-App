
CREATE TABLE public.notified_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  location_id UUID,
  organization_id UUID,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.notified_subscriptions TO authenticated;
GRANT ALL ON public.notified_subscriptions TO service_role;
ALTER TABLE public.notified_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin can view notified subs" ON public.notified_subscriptions FOR SELECT USING (public.has_role(auth.uid(), 'super_admin'::app_role));
