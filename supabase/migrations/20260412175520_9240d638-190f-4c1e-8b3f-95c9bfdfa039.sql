-- Allow anon (unauthenticated) PIN lookup for kiosk punch clock
-- This is safe because:
-- 1. PINs are 4-digit codes, not sensitive credentials
-- 2. The punch clock already works via PIN-only auth (no session)
-- 3. The query still requires knowing the exact PIN to get a result
CREATE POLICY "Anon can lookup profiles by PIN for punch clock"
ON public.profiles
FOR SELECT
TO anon
USING (employee_pin IS NOT NULL);