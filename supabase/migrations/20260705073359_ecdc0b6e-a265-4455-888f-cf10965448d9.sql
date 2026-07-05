
CREATE OR REPLACE FUNCTION public.soft_delete_announcement_post(_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _author uuid;
BEGIN
  SELECT author_id INTO _author FROM public.announcement_posts WHERE id = _post_id;
  IF _author IS NULL THEN
    RAISE EXCEPTION 'Post not found';
  END IF;
  IF _author <> auth.uid() AND NOT public.has_role_or_higher(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not allowed to delete this post';
  END IF;
  UPDATE public.announcement_posts
     SET deleted_at = now()
   WHERE id = _post_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_announcement_post(uuid) TO authenticated;
