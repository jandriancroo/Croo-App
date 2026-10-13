ALTER TABLE public.theo_ai_usage
  ADD COLUMN IF NOT EXISTS t_pre_ai_ms integer,
  ADD COLUMN IF NOT EXISTS t_round_ms integer[],
  ADD COLUMN IF NOT EXISTS round_count integer,
  ADD COLUMN IF NOT EXISTS cold_start boolean,
  ADD COLUMN IF NOT EXISTS t_total_ms integer;