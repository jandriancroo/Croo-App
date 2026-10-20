-- On-track band back to ±0.5 point (owner decision). One constant.
CREATE OR REPLACE FUNCTION public._labor_pace_on_track_band()
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$ SELECT 0.5::numeric $$;