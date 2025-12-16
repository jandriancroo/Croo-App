-- Add contact_phone and total_price to catering_orders
ALTER TABLE public.catering_orders 
ADD COLUMN contact_phone text,
ADD COLUMN total_price numeric;

-- Add options column to logbook_fields for radio/dropdown choices
ALTER TABLE public.logbook_fields
ADD COLUMN IF NOT EXISTS options jsonb;