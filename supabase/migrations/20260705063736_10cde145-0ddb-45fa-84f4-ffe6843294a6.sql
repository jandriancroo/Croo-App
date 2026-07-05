
UPDATE public.announcement_reads r
SET post_id = p.id
FROM public.announcement_posts p
WHERE p.chat_id = r.chat_id
  AND r.post_id IS NULL;
