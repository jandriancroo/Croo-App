ALTER TABLE public.punch_clock_templates ALTER COLUMN start_at DROP NOT NULL;
ALTER TABLE public.punch_clock_templates ALTER COLUMN end_at DROP NOT NULL;

UPDATE public.punch_clock_templates
SET start_at = NULL,
    end_at = NULL
WHERE start_at <= '2000-01-01T23:59:59Z'::timestamptz
   OR end_at >= '2099-01-01T00:00:00Z'::timestamptz;