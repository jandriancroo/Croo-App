
-- Fix: Remove overly permissive policy (service role bypasses RLS anyway)
DROP POLICY IF EXISTS "Service role can manage kds_cache" ON public.kds_cache;
