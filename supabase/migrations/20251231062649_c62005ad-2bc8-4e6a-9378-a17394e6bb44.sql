-- Backfill first_login_at for existing active users
-- Set it to their created_at date since they were already using the app
UPDATE public.profiles 
SET first_login_at = created_at 
WHERE first_login_at IS NULL 
  AND is_active = true;