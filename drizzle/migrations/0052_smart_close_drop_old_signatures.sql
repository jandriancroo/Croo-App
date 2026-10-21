-- Remove the superseded overloads so calls resolve to the 4-arg core / 7-arg predict only.
DROP FUNCTION IF EXISTS public._labor_pace_core(uuid, date, boolean);
DROP FUNCTION IF EXISTS public._labor_close_predict_min(uuid, uuid, int, text, date);