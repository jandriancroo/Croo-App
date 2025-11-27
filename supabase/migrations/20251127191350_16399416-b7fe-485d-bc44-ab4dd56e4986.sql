-- Add croo_cash_balance to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS croo_cash_balance integer NOT NULL DEFAULT 0;

-- Create croo_cash_transactions table for transaction history
CREATE TABLE IF NOT EXISTS public.croo_cash_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('offer_shift', 'take_shift')),
  shift_offer_id uuid REFERENCES public.shift_offers(id) ON DELETE SET NULL,
  shift_date date NOT NULL,
  is_weekend boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text
);

-- Enable RLS on croo_cash_transactions
ALTER TABLE public.croo_cash_transactions ENABLE ROW LEVEL SECURITY;

-- Create policies for croo_cash_transactions
CREATE POLICY "Users can view their own transactions"
  ON public.croo_cash_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all transactions"
  ON public.croo_cash_transactions
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can create transactions"
  ON public.croo_cash_transactions
  FOR INSERT
  WITH CHECK (true);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_croo_cash_transactions_user_id ON public.croo_cash_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_croo_cash_transactions_created_at ON public.croo_cash_transactions(created_at DESC);