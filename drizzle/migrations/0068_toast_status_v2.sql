CREATE TABLE public.toast_status_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token_hash text UNIQUE NOT NULL,
 scope text NOT NULL CHECK (scope IN ('studio','mini','publish')),
 label text,
 location_id uuid NOT NULL REFERENCES public.locations(id),
 revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz DEFAULT now(),
 last_used_at timestamptz
);
GRANT ALL ON public.toast_status_tokens TO service_role;
ALTER TABLE public.toast_status_tokens ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.toast_status_restart_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 location_id uuid NOT NULL,
 requested_by_token uuid REFERENCES public.toast_status_tokens(id),
 requested_at timestamptz DEFAULT now(),
 acked_at timestamptz,
 ack_note text
);
GRANT ALL ON public.toast_status_restart_requests TO service_role;
ALTER TABLE public.toast_status_restart_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX toast_status_restart_location_time ON public.toast_status_restart_requests(location_id, requested_at DESC);
CREATE TABLE public.app_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 app text NOT NULL DEFAULT 'toast-status',
 version text NOT NULL,
 download_url text NOT NULL,
 sha256 text NOT NULL,
 notes text,
 created_at timestamptz DEFAULT now(),
 UNIQUE(app,version)
);
GRANT SELECT ON public.app_releases TO anon, authenticated;
GRANT ALL ON public.app_releases TO service_role;
ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_releases_public_metadata ON public.app_releases FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY toast_status_releases_public_read ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'toast-status-releases');
CREATE OR REPLACE FUNCTION public.toast_status_request_restart(_location_id uuid, _token_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _now timestamptz := now(); _recent timestamptz; _id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('toast-status-restart:' || _location_id::text, 0));
 IF NOT EXISTS (SELECT 1 FROM public.toast_status_tokens WHERE id = _token_id AND location_id = _location_id AND scope = 'studio' AND NOT revoked) THEN
  RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
 END IF;
 IF EXISTS (SELECT 1 FROM public.toast_status_restart_requests WHERE location_id = _location_id AND acked_at IS NULL AND requested_at > _now - interval '15 minutes') THEN
  RETURN jsonb_build_object('ok',true,'status','already_pending');
 END IF;
 SELECT max(requested_at) INTO _recent FROM public.toast_status_restart_requests WHERE location_id = _location_id AND requested_at > _now - interval '5 minutes';
 IF _recent IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'status','rate_limited','retry_after_s',ceil(extract(epoch FROM (_recent + interval '5 minutes' - _now)))::integer);
 END IF;
 INSERT INTO public.toast_status_restart_requests(location_id,requested_by_token,requested_at) VALUES (_location_id,_token_id,_now) RETURNING id INTO _id;
 RETURN jsonb_build_object('ok',true,'status','requested','id',_id);
END;
$$;
REVOKE ALL ON FUNCTION public.toast_status_request_restart(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toast_status_request_restart(uuid,uuid) TO service_role;