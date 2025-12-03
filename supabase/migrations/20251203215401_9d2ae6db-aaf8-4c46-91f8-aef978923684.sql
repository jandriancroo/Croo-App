-- Add new enum values for the updated role hierarchy
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'general_manager';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'shift_manager';