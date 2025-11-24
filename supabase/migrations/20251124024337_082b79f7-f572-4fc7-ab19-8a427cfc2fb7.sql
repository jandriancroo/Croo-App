-- Create availability requests table
CREATE TABLE public.availability_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('paid', 'unpaid')),
  time_scope TEXT NOT NULL CHECK (time_scope IN ('multi_day', 'full_day', 'partial_day')),
  start_date DATE NOT NULL,
  end_date DATE,
  start_time TIME,
  end_time TIME,
  hours_requested DECIMAL(5,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  denial_reason TEXT,
  notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.availability_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own requests
CREATE POLICY "Users can view own availability requests"
ON public.availability_requests
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own requests
CREATE POLICY "Users can create own availability requests"
ON public.availability_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending requests
CREATE POLICY "Users can update own pending requests"
ON public.availability_requests
FOR UPDATE
USING (auth.uid() = user_id AND status = 'pending');

-- Admins can view all requests
CREATE POLICY "Admins can view all availability requests"
ON public.availability_requests
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can update any request (for approval/denial)
CREATE POLICY "Admins can update all availability requests"
ON public.availability_requests
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_availability_requests_updated_at
BEFORE UPDATE ON public.availability_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Create index for faster queries
CREATE INDEX idx_availability_requests_user_id ON public.availability_requests(user_id);
CREATE INDEX idx_availability_requests_status ON public.availability_requests(status);
CREATE INDEX idx_availability_requests_start_date ON public.availability_requests(start_date);