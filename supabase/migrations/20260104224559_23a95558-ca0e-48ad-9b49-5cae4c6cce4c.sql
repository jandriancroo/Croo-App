-- Create bank_deposits table to track deposits taken to the bank
CREATE TABLE public.bank_deposits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_dollars NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_change NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  days_included INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Create linking table to track which drawer counts are included in each deposit
CREATE TABLE public.bank_deposit_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_deposit_id UUID NOT NULL REFERENCES public.bank_deposits(id) ON DELETE CASCADE,
  logbook_entry_id UUID NOT NULL REFERENCES public.logbook_entries(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(logbook_entry_id) -- Ensures a drawer count can only be in ONE deposit
);

-- Enable RLS
ALTER TABLE public.bank_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_deposit_entries ENABLE ROW LEVEL SECURITY;

-- RLS policies for bank_deposits
CREATE POLICY "Users can view bank deposits at their locations"
ON public.bank_deposits
FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users with shift_manager+ role can create bank deposits"
ON public.bank_deposits
FOR INSERT
WITH CHECK (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'shift_manager')
);

CREATE POLICY "Users with shift_manager+ role can update bank deposits"
ON public.bank_deposits
FOR UPDATE
USING (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'shift_manager')
);

CREATE POLICY "Users with manager+ role can delete bank deposits"
ON public.bank_deposits
FOR DELETE
USING (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'manager')
);

-- RLS policies for bank_deposit_entries
CREATE POLICY "Users can view bank deposit entries at their locations"
ON public.bank_deposit_entries
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bank_deposits bd
    WHERE bd.id = bank_deposit_id
    AND has_location_access(auth.uid(), bd.location_id)
  )
);

CREATE POLICY "Users with shift_manager+ role can create bank deposit entries"
ON public.bank_deposit_entries
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bank_deposits bd
    WHERE bd.id = bank_deposit_id
    AND has_location_access(auth.uid(), bd.location_id)
    AND has_role_or_higher(auth.uid(), 'shift_manager')
  )
);

CREATE POLICY "Users with shift_manager+ role can delete bank deposit entries"
ON public.bank_deposit_entries
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bank_deposits bd
    WHERE bd.id = bank_deposit_id
    AND has_location_access(auth.uid(), bd.location_id)
    AND has_role_or_higher(auth.uid(), 'shift_manager')
  )
);

-- Create indexes for performance
CREATE INDEX idx_bank_deposits_location_id ON public.bank_deposits(location_id);
CREATE INDEX idx_bank_deposits_dates ON public.bank_deposits(start_date, end_date);
CREATE INDEX idx_bank_deposit_entries_deposit_id ON public.bank_deposit_entries(bank_deposit_id);
CREATE INDEX idx_bank_deposit_entries_entry_id ON public.bank_deposit_entries(logbook_entry_id);