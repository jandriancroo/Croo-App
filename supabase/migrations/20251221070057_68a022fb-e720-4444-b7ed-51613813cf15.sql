-- Drop the constraint that only allows one token per platform per user
-- This was causing Mac Safari to overwrite iPhone PWA tokens since both are 'web' platform
ALTER TABLE push_notification_tokens DROP CONSTRAINT IF EXISTS push_notification_tokens_user_id_platform_key;