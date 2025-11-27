-- Create table to track multiple shift claims
CREATE TABLE IF NOT EXISTS public.shift_offer_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_offer_id uuid NOT NULL REFERENCES public.shift_offers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(shift_offer_id, user_id)
);

-- Enable RLS
ALTER TABLE public.shift_offer_claims ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to create claims
CREATE POLICY "Users can create shift claims"
ON public.shift_offer_claims
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Allow everyone to view claims
CREATE POLICY "Anyone can view shift claims"
ON public.shift_offer_claims
FOR SELECT
TO authenticated
USING (true);

-- Allow admins to delete claims (for deny action)
CREATE POLICY "Admins can delete shift claims"
ON public.shift_offer_claims
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'::app_role
  )
);