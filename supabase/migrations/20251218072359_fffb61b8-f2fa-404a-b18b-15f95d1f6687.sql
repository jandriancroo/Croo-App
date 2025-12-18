-- Add fbc (Franchise Business Consultant) to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fbc';