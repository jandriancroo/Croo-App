-- Undo backfill for users created in the last 15 minutes (they're new invites)
UPDATE public.profiles 
SET first_login_at = NULL 
WHERE created_at > NOW() - INTERVAL '15 minutes';