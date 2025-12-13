-- Add columns for AI-extracted audit summary data
ALTER TABLE public.food_safety_audits
ADD COLUMN IF NOT EXISTS visit_score text,
ADD COLUMN IF NOT EXISTS first_priority_items jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS second_priority_items jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS third_priority_items jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS summary_extracted_at timestamp with time zone;