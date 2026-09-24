GRANT EXECUTE ON FUNCTION public.get_applications_by_email(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.applicant_get_hiring_chat(_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF _token IS NULL OR length(trim(_token)) = 0 OR length(_token) > 200 THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'id', hc.id,
    'application_id', hc.application_id,
    'location_id', ja.location_id,
    'application', jsonb_build_object(
      'full_name', ja.full_name,
      'organization', jsonb_build_object('name', o.name, 'logo_url', o.logo_url)
    ),
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'sender_type', m.sender_type, 'sender_id', m.sender_id,
        'content', m.content, 'created_at', m.created_at,
        'sender', CASE WHEN p.id IS NULL THEN NULL
                  ELSE jsonb_build_object('full_name', p.full_name, 'profile_photo_url', p.profile_photo_url) END
      ) ORDER BY m.created_at)
      FROM public.hiring_messages m
      LEFT JOIN public.profiles p ON p.id = m.sender_id
      WHERE m.conversation_id = hc.id
    ), '[]'::jsonb)
  ) INTO v
  FROM public.hiring_conversations hc
  JOIN public.job_applications ja ON ja.id = hc.application_id
  LEFT JOIN public.organizations o ON o.id = ja.organization_id
  WHERE hc.access_token = _token;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.applicant_get_hiring_chat(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.applicant_get_hiring_chat(text) TO anon, authenticated, service_role;