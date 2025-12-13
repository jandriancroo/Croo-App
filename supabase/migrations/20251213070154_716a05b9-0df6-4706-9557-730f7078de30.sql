-- Add columns to track which priority items have been corrected
ALTER TABLE public.food_safety_audits
ADD COLUMN first_priority_corrected integer[] DEFAULT '{}',
ADD COLUMN second_priority_corrected integer[] DEFAULT '{}',
ADD COLUMN third_priority_corrected integer[] DEFAULT '{}';