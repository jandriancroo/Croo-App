-- Create table to track new user signups for alert system
CREATE TABLE IF NOT EXISTS public.user_signup_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  signed_up_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_signup_alerts ENABLE ROW LEVEL SECURITY;

-- Admins and managers can view signup alerts
CREATE POLICY "Admins and managers can view signup alerts"
  ON public.user_signup_alerts
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  );

-- Create trigger function to log new signups
CREATE OR REPLACE FUNCTION public.log_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_signup_alerts (user_id, signed_up_at)
  VALUES (NEW.id, NEW.created_at);
  RETURN NEW;
END;
$$;

-- Create trigger on profiles table for new signups
CREATE TRIGGER on_user_signup
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_user_signup();

-- Create index for better query performance
CREATE INDEX idx_user_signup_alerts_created_at ON public.user_signup_alerts(created_at DESC);