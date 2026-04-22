ALTER TABLE public.user_dashboard_cubes
ADD COLUMN IF NOT EXISTS tracker_scope jsonb NOT NULL DEFAULT '{"type":"location"}'::jsonb,
ADD COLUMN IF NOT EXISTS tracker_display_mode text NOT NULL DEFAULT 'summary',
ADD COLUMN IF NOT EXISTS tracker_item_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS tracker_promo_start date,
ADD COLUMN IF NOT EXISTS tracker_promo_end date,
ADD COLUMN IF NOT EXISTS tracker_location_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS tracker_rank_metrics jsonb NOT NULL DEFAULT '["units","sales","pmix"]'::jsonb;

ALTER TABLE public.user_dashboard_cubes
DROP CONSTRAINT IF EXISTS user_dashboard_cubes_tracker_display_mode_check;

ALTER TABLE public.user_dashboard_cubes
ADD CONSTRAINT user_dashboard_cubes_tracker_display_mode_check
CHECK (tracker_display_mode IN ('summary', 'expandable'));

COMMENT ON COLUMN public.user_dashboard_cubes.tracker_scope IS 'Tracker visibility scope settings for user, role, or location audiences.';
COMMENT ON COLUMN public.user_dashboard_cubes.tracker_display_mode IS 'Tracker dashboard mode: summary shows store numbers and rank; expandable also shows ranking list.';
COMMENT ON COLUMN public.user_dashboard_cubes.tracker_item_refs IS 'POS item references included in the tracker promo group.';
COMMENT ON COLUMN public.user_dashboard_cubes.tracker_promo_start IS 'Promo period start date for tracker totals.';
COMMENT ON COLUMN public.user_dashboard_cubes.tracker_promo_end IS 'Promo period end date for tracker totals.';
COMMENT ON COLUMN public.user_dashboard_cubes.tracker_location_refs IS 'Location references included in the tracker ranking pool.';
COMMENT ON COLUMN public.user_dashboard_cubes.tracker_rank_metrics IS 'Ranking metrics shown by the tracker, such as units, sales, and PMIX.';