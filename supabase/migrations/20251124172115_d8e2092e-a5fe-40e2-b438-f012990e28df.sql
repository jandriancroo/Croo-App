-- Add address field to locations table
ALTER TABLE public.locations
ADD COLUMN address text,
ADD COLUMN latitude numeric(10, 7),
ADD COLUMN longitude numeric(10, 7);