-- Create function for updating updated_at timestamp if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create table for storing projected daily sales for schedules
CREATE TABLE IF NOT EXISTS public.schedule_projected_sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  projected_sales NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(schedule_id, day_of_week)
);

-- Enable RLS
ALTER TABLE public.schedule_projected_sales ENABLE ROW LEVEL SECURITY;

-- Policy for admins and managers to manage projected sales
CREATE POLICY "Admins and managers can manage projected sales"
  ON public.schedule_projected_sales
  FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  );

-- Policy for users to view projected sales
CREATE POLICY "Users can view projected sales"
  ON public.schedule_projected_sales
  FOR SELECT
  USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_schedule_projected_sales_updated_at
  BEFORE UPDATE ON public.schedule_projected_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();