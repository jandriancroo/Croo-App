
-- Refresh legacy announcement_posts.media from source messages
-- so file attachments get type='file' with name/mime, images stay type='image'.
UPDATE public.announcement_posts p
SET media = sub.new_media
FROM (
  SELECT p2.id,
    jsonb_agg(
      CASE
        WHEN COALESCE(m.attachment_type,'') LIKE 'image/%'
          THEN jsonb_build_object('type','image','url', m.attachment_url)
        ELSE jsonb_build_object(
          'type','file',
          'url', m.attachment_url,
          'name', regexp_replace(m.attachment_url, '^.*/', ''),
          'mime', COALESCE(m.attachment_type, 'application/octet-stream')
        )
      END
      ORDER BY m.created_at
    ) AS new_media
  FROM public.announcement_posts p2
  JOIN public.messages m
    ON m.chat_id = p2.chat_id
   AND m.attachment_url IS NOT NULL
   AND COALESCE(m.is_deleted_for_everyone, false) = false
  GROUP BY p2.id
) sub
WHERE p.id = sub.id;
