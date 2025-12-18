-- Table to store daily CC tips pulled from QuBeyond
CREATE TABLE public.daily_tips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  tip_date DATE NOT NULL,
  total_cc_tips NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cash_tips NUMERIC(10,2) NOT NULL DEFAULT 0,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(location_id, tip_date)
);

-- Table to store per-employee tip distributions based on hours worked
CREATE TABLE public.tip_distributions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_tip_id UUID NOT NULL REFERENCES public.daily_tips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hours_worked NUMERIC(6,2) NOT NULL DEFAULT 0,
  tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  distribution_type TEXT NOT NULL DEFAULT 'hours_based', -- 'hours_based', 'manual', 'equal'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(daily_tip_id, user_id)
);

-- Enable RLS
ALTER TABLE public.daily_tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_distributions ENABLE ROW LEVEL SECURITY;

-- Policies for daily_tips - managers/admins at location can view/manage
CREATE POLICY "Users can view daily tips at their locations"
ON public.daily_tips
FOR SELECT
USING (
  location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Admins and managers can insert daily tips"
ON public.daily_tips
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.user_locations ul ON ul.user_id = ur.user_id
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('admin', 'manager')
    AND ul.location_id = location_id
  )
);

CREATE POLICY "Admins and managers can update daily tips"
ON public.daily_tips
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.user_locations ul ON ul.user_id = ur.user_id
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('admin', 'manager')
    AND ul.location_id = location_id
  )
);

-- Policies for tip_distributions
CREATE POLICY "Users can view their own tip distributions"
ON public.tip_distributions
FOR SELECT
USING (
  user_id = auth.uid() OR
  daily_tip_id IN (
    SELECT id FROM public.daily_tips dt
    WHERE dt.location_id IN (
      SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'manager')
    )
  )
);

CREATE POLICY "Admins and managers can insert tip distributions"
ON public.tip_distributions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.daily_tips dt
    JOIN public.user_locations ul ON ul.location_id = dt.location_id
    JOIN public.user_roles ur ON ur.user_id = ul.user_id
    WHERE dt.id = daily_tip_id
    AND ul.user_id = auth.uid()
    AND ur.role IN ('admin', 'manager')
  )
);

CREATE POLICY "Admins and managers can update tip distributions"
ON public.tip_distributions
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.daily_tips dt
    JOIN public.user_locations ul ON ul.location_id = dt.location_id
    JOIN public.user_roles ur ON ur.user_id = ul.user_id
    WHERE dt.id = daily_tip_id
    AND ul.user_id = auth.uid()
    AND ur.role IN ('admin', 'manager')
  )
);

-- Indexes for performance
CREATE INDEX idx_daily_tips_location_date ON public.daily_tips(location_id, tip_date);
CREATE INDEX idx_tip_distributions_daily_tip ON public.tip_distributions(daily_tip_id);
CREATE INDEX idx_tip_distributions_user ON public.tip_distributions(user_id);

-- Trigger for updated_at
CREATE TRIGGER update_daily_tips_updated_at
BEFORE UPDATE ON public.daily_tips
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tip_distributions_updated_at
BEFORE UPDATE ON public.tip_distributions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();