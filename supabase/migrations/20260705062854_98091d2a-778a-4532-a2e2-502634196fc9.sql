
-- =========================================================================
-- ANNOUNCEMENT FEED — Step 1: Schema
-- =========================================================================

-- ---------- 1. announcement_channels ---------------------------------------
CREATE TABLE public.announcement_channels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT 'megaphone',
  audience_type TEXT NOT NULL DEFAULT 'everyone'
    CHECK (audience_type IN ('everyone','role','position','custom')),
  audience_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (brand_id IS NOT NULL OR location_id IS NOT NULL)
);
CREATE INDEX idx_ann_channels_brand ON public.announcement_channels(brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX idx_ann_channels_location ON public.announcement_channels(location_id) WHERE location_id IS NOT NULL;
CREATE UNIQUE INDEX idx_ann_channels_slug_brand ON public.announcement_channels(brand_id, slug) WHERE brand_id IS NOT NULL AND location_id IS NULL;
CREATE UNIQUE INDEX idx_ann_channels_slug_location ON public.announcement_channels(location_id, slug) WHERE location_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcement_channels TO authenticated;
GRANT ALL ON public.announcement_channels TO service_role;

ALTER TABLE public.announcement_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channels readable by brand/location members"
  ON public.announcement_channels FOR SELECT TO authenticated
  USING (
    (brand_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.brand_members bm
       WHERE bm.brand_id = announcement_channels.brand_id AND bm.user_id = auth.uid()
    ))
    OR (location_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.user_locations ul
       WHERE ul.location_id = announcement_channels.location_id AND ul.user_id = auth.uid()
    ))
    OR public.has_role_or_higher(auth.uid(), 'admin')
  );

CREATE POLICY "Admins manage channels"
  ON public.announcement_channels FOR ALL TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'admin'))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'admin'));

-- ---------- 2. announcement_posts ------------------------------------------
CREATE TABLE public.announcement_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.announcement_channels(id) ON DELETE SET NULL,
  chat_id UUID REFERENCES public.chats(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  pinned BOOLEAN NOT NULL DEFAULT false,
  allow_comments BOOLEAN NOT NULL DEFAULT true,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (brand_id IS NOT NULL OR location_id IS NOT NULL)
);
CREATE INDEX idx_ann_posts_channel_created ON public.announcement_posts(channel_id, created_at DESC);
CREATE INDEX idx_ann_posts_brand_created ON public.announcement_posts(brand_id, created_at DESC) WHERE brand_id IS NOT NULL;
CREATE INDEX idx_ann_posts_location_created ON public.announcement_posts(location_id, created_at DESC) WHERE location_id IS NOT NULL;
CREATE INDEX idx_ann_posts_author ON public.announcement_posts(author_id);
CREATE INDEX idx_ann_posts_pinned ON public.announcement_posts(pinned) WHERE pinned = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcement_posts TO authenticated;
GRANT ALL ON public.announcement_posts TO service_role;

ALTER TABLE public.announcement_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Posts readable by brand/location members"
  ON public.announcement_posts FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL AND (
      (brand_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.brand_members bm
         WHERE bm.brand_id = announcement_posts.brand_id AND bm.user_id = auth.uid()
      ))
      OR (location_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.user_locations ul
         WHERE ul.location_id = announcement_posts.location_id AND ul.user_id = auth.uid()
      ))
      OR public.has_role_or_higher(auth.uid(), 'admin')
    )
  );

CREATE POLICY "Managers+ create posts"
  ON public.announcement_posts FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.has_role_or_higher(auth.uid(), 'manager')
  );

CREATE POLICY "Author or admin update posts"
  ON public.announcement_posts FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.has_role_or_higher(auth.uid(), 'admin'))
  WITH CHECK (author_id = auth.uid() OR public.has_role_or_higher(auth.uid(), 'admin'));

CREATE POLICY "Author or admin delete posts"
  ON public.announcement_posts FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_role_or_higher(auth.uid(), 'admin'));

-- ---------- 3. announcement_reactions --------------------------------------
CREATE TABLE public.announcement_reactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.announcement_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, emoji)
);
CREATE INDEX idx_ann_reactions_post ON public.announcement_reactions(post_id);

GRANT SELECT, INSERT, DELETE ON public.announcement_reactions TO authenticated;
GRANT ALL ON public.announcement_reactions TO service_role;

ALTER TABLE public.announcement_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reactions readable when post readable"
  ON public.announcement_reactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.announcement_posts p WHERE p.id = post_id));

CREATE POLICY "Users add own reactions"
  ON public.announcement_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users remove own reactions"
  ON public.announcement_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------- 4. announcement_comments ---------------------------------------
CREATE TABLE public.announcement_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.announcement_posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES public.announcement_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ann_comments_post_created ON public.announcement_comments(post_id, created_at);
CREATE INDEX idx_ann_comments_parent ON public.announcement_comments(parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX idx_ann_comments_author ON public.announcement_comments(author_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcement_comments TO authenticated;
GRANT ALL ON public.announcement_comments TO service_role;

ALTER TABLE public.announcement_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comments readable when post readable"
  ON public.announcement_comments FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.announcement_posts p WHERE p.id = post_id)
  );

CREATE POLICY "Users create comments on visible posts"
  ON public.announcement_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.announcement_posts p
      WHERE p.id = post_id AND p.allow_comments = true
    )
  );

CREATE POLICY "Author or admin update comments"
  ON public.announcement_comments FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.has_role_or_higher(auth.uid(), 'admin'))
  WITH CHECK (author_id = auth.uid() OR public.has_role_or_higher(auth.uid(), 'admin'));

CREATE POLICY "Author or admin delete comments"
  ON public.announcement_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_role_or_higher(auth.uid(), 'admin'));

-- ---------- 5. announcement_comment_reactions ------------------------------
CREATE TABLE public.announcement_comment_reactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id UUID NOT NULL REFERENCES public.announcement_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji)
);
CREATE INDEX idx_ann_cmt_reactions_comment ON public.announcement_comment_reactions(comment_id);

GRANT SELECT, INSERT, DELETE ON public.announcement_comment_reactions TO authenticated;
GRANT ALL ON public.announcement_comment_reactions TO service_role;

ALTER TABLE public.announcement_comment_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comment reactions readable when comment readable"
  ON public.announcement_comment_reactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.announcement_comments c WHERE c.id = comment_id));

CREATE POLICY "Users add own comment reactions"
  ON public.announcement_comment_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users remove own comment reactions"
  ON public.announcement_comment_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------- 6. extend announcement_reads for post-based reads --------------
ALTER TABLE public.announcement_reads
  ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES public.announcement_posts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_announcement_reads_post ON public.announcement_reads(post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_reads_post_user ON public.announcement_reads(post_id, user_id) WHERE post_id IS NOT NULL;

-- ---------- 7. updated_at triggers -----------------------------------------
CREATE TRIGGER trg_ann_channels_updated_at
  BEFORE UPDATE ON public.announcement_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ann_posts_updated_at
  BEFORE UPDATE ON public.announcement_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ann_comments_updated_at
  BEFORE UPDATE ON public.announcement_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 8. realtime ----------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcement_comment_reactions;
