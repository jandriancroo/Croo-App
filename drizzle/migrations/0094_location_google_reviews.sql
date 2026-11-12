-- Google reviews for stores that are not on Ovation: the store's overall
-- Google rating, review count and Google's 5 most recent reviews (Places API
-- New only returns 5). One row per store, overwritten on every refresh.
--
-- Writes: server only (google-reviews-service with the service role). No
-- client can insert, update or delete. Rows are added by hand for now; this
-- migration adds none.
-- Reads: signed-in users with access to the store (has_location_access).
-- The app reads through get_location_google_reviews(), which also hides the
-- row when the store has an Ovation mapping, so Ovation always wins.
-- The Places API key lives only in the edge secret GOOGLE_PLACES_API_KEY.
--
-- Cost: each hourly run (8 AM-10 PM ET) asks Google for rating +
-- userRatingCount only (Place Details Pro). The reviews (Enterprise + Atmosphere) are pulled only when the
-- count changed, no reviews are stored yet, or the last full pull is over
-- 7 days old (keeps cached Google content fresh).

CREATE TABLE IF NOT EXISTS public.location_google_reviews (
  location_id uuid PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  place_id text NOT NULL CHECK (length(btrim(place_id)) > 0),
  active boolean NOT NULL DEFAULT true,
  rating numeric(2,1),
  user_rating_count integer,
  reviews jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reviews) = 'array'),
  google_maps_uri text,
  fetched_at timestamptz,          -- last successful check of any kind
  last_full_fetch_at timestamptz,  -- last pull that included the reviews
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.location_google_reviews IS
  'Google rating + 5 most recent reviews per store (Places API New). Written only by google-reviews-service (service role); read by store staff.';

ALTER TABLE public.location_google_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.location_google_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.location_google_reviews TO authenticated;
GRANT ALL ON public.location_google_reviews TO service_role;

DROP POLICY IF EXISTS "Store staff can read Google reviews" ON public.location_google_reviews;
CREATE POLICY "Store staff can read Google reviews"
  ON public.location_google_reviews
  FOR SELECT
  TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE OR REPLACE FUNCTION public._touch_location_google_reviews()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public._touch_location_google_reviews() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_touch_location_google_reviews ON public.location_google_reviews;
CREATE TRIGGER trg_touch_location_google_reviews
  BEFORE UPDATE ON public.location_google_reviews
  FOR EACH ROW EXECUTE FUNCTION public._touch_location_google_reviews();

-- What the app reads. Nothing comes back when the caller can't see the store,
-- the row is inactive or has never been fetched, or the store uses Ovation.
CREATE OR REPLACE FUNCTION public.get_location_google_reviews(_location_id uuid)
RETURNS TABLE (
  location_id uuid,
  rating numeric,
  user_rating_count integer,
  reviews jsonb,
  google_maps_uri text,
  fetched_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.location_id, g.rating, g.user_rating_count, g.reviews, g.google_maps_uri, g.fetched_at
    FROM public.location_google_reviews g
   WHERE g.location_id = _location_id
     AND g.active
     AND g.rating IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND public.has_location_access(auth.uid(), _location_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.ovation_location_mappings m WHERE m.location_id = _location_id
     );
$$;

REVOKE EXECUTE ON FUNCTION public.get_location_google_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_location_google_reviews(uuid) TO authenticated;

-- When the refresh should run: every hour from 8 AM through 10 PM Eastern
-- (Georgetown, DC business hours), and only when at least one active row
-- exists. Each run is the cheap count check; reviews are pulled only when the
-- count changed (or the 7-day freshness pull is due).
CREATE OR REPLACE FUNCTION public._google_reviews_refresh_due(_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.location_google_reviews WHERE active)
     AND extract(hour FROM (_now AT TIME ZONE 'America/New_York')) BETWEEN 8 AND 22;
$$;

REVOKE EXECUTE ON FUNCTION public._google_reviews_refresh_due(timestamptz) FROM PUBLIC, anon, authenticated;

-- pg_cron runs in UTC, so the job wakes every hour and the guard above
-- (America/New_York, DST-safe) decides. Off-hours wakes make no HTTP call.
-- The edge function also returns quietly when GOOGLE_PLACES_API_KEY is unset.
DO $$
DECLARE v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'google-reviews-refresh' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'google-reviews-refresh',
  '17 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/google-reviews-service',
    headers := public.cron_edge_headers(),
    body := '{"action":"refresh"}'::jsonb,
    timeout_milliseconds := 30000
  )
  WHERE public._google_reviews_refresh_due();
  $job$
);
