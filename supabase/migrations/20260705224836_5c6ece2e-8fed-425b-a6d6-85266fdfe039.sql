
-- Feed badges: category tags for team feed posts. Tier controls who can apply.
CREATE TABLE IF NOT EXISTS public.feed_badges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('team','manager')),
  color TEXT,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_badges TO authenticated;
GRANT ALL ON public.feed_badges TO service_role;
ALTER TABLE public.feed_badges ENABLE ROW LEVEL SECURITY;

-- Everyone can read badges (needed to display chips + filter)
CREATE POLICY "Anyone authenticated reads badges"
ON public.feed_badges FOR SELECT
TO authenticated
USING (true);

-- Managers and up may create badges (both tiers). Global badges (null loc/brand) only super_admin.
CREATE POLICY "Managers+ create badges"
ON public.feed_badges FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND has_role_or_higher(auth.uid(), 'manager')
  AND (
    (location_id IS NULL AND brand_id IS NULL AND has_role_or_higher(auth.uid(), 'super_admin'))
    OR location_id IS NOT NULL
    OR brand_id IS NOT NULL
  )
);

CREATE POLICY "Managers+ update own badges"
ON public.feed_badges FOR UPDATE
TO authenticated
USING (has_role_or_higher(auth.uid(), 'manager'))
WITH CHECK (has_role_or_higher(auth.uid(), 'manager'));

CREATE POLICY "Admins delete badges"
ON public.feed_badges FOR DELETE
TO authenticated
USING (has_role_or_higher(auth.uid(), 'admin'));

-- Add badge_id + is_announcement to posts
ALTER TABLE public.announcement_posts
  ADD COLUMN IF NOT EXISTS badge_id UUID REFERENCES public.feed_badges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_announcement BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_announcement_posts_badge ON public.announcement_posts(badge_id);

-- Widen INSERT: any location member can post regular (non-announcement, non-pinned) posts.
-- Managers+ retain full announcement/pinning power.
DROP POLICY IF EXISTS "Managers+ create posts" ON public.announcement_posts;
CREATE POLICY "Location members create feed posts"
ON public.announcement_posts FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND (
    -- Manager+ can post anything
    has_role_or_higher(auth.uid(), 'manager')
    OR (
      -- Team members can post plain feed items scoped to a location they belong to
      is_announcement = false
      AND pinned = false
      AND location_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_locations ul
        WHERE ul.location_id = announcement_posts.location_id
          AND ul.user_id = auth.uid()
      )
    )
  )
);

-- Seed the four team-tier global badges. Safe to re-run.
INSERT INTO public.feed_badges (label, tier, color, sort_order)
SELECT v.label, 'team', v.color, v.sort_order
FROM (VALUES
  ('Random',        '#64748B', 10),
  ('Food I Made',   '#F97316', 20),
  ('Shift Swap',    '#F59E0B', 30),
  ('Karen Alert',   '#EF4444', 40)
) AS v(label, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.feed_badges b
  WHERE b.label = v.label AND b.tier = 'team' AND b.location_id IS NULL AND b.brand_id IS NULL
);
