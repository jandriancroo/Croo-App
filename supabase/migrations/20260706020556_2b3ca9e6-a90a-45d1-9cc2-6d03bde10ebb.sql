DROP INDEX IF EXISTS public.idx_announcement_reads_post_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_reads_post_user
ON public.announcement_reads(post_id, user_id)
WHERE post_id IS NOT NULL;