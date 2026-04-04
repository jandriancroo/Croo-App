-- Set all existing profiles to true so the global flag never blocks anyone
UPDATE public.profiles SET appears_on_schedule = true WHERE appears_on_schedule = false;

-- Change the default to true so new profiles are always visible
ALTER TABLE public.profiles ALTER COLUMN appears_on_schedule SET DEFAULT true;