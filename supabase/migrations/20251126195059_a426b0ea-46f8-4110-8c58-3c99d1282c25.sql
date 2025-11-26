-- Add temperature validation columns to checklist_responses
ALTER TABLE public.checklist_responses
ADD COLUMN extracted_temperature numeric,
ADD COLUMN temperature_valid boolean,
ADD COLUMN temperature_validated_at timestamp with time zone;