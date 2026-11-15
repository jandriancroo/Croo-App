ALTER TABLE public.sales_cache
 ADD COLUMN discount_amount numeric,
 ADD COLUMN comp_amount numeric,
 ADD COLUMN comp_count numeric,
 ADD COLUMN void_amount numeric,
 ADD COLUMN void_count numeric,
 ADD COLUMN promo_amount numeric,
 ADD COLUMN promo_count numeric,
 ADD COLUMN check_count numeric,
 ADD COLUMN tips_amount numeric;

-- All writers, including old deployments, preserve measured extras against unknown/zero placeholders.
CREATE FUNCTION public.guard_pos_sales_extras() RETURNS trigger LANGUAGE plpgsql SET search_path='public' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.discount_amount IS NULL OR (NEW.discount_amount=0 AND OLD.discount_amount<>0) THEN NEW.discount_amount:=OLD.discount_amount; END IF;
  IF NEW.comp_amount IS NULL OR (NEW.comp_amount=0 AND OLD.comp_amount<>0) THEN NEW.comp_amount:=OLD.comp_amount; END IF;
  IF NEW.comp_count IS NULL OR (NEW.comp_count=0 AND OLD.comp_count<>0) THEN NEW.comp_count:=OLD.comp_count; END IF;
  IF NEW.void_amount IS NULL OR (NEW.void_amount=0 AND OLD.void_amount<>0) THEN NEW.void_amount:=OLD.void_amount; END IF;
  IF NEW.void_count IS NULL OR (NEW.void_count=0 AND OLD.void_count<>0) THEN NEW.void_count:=OLD.void_count; END IF;
  IF NEW.promo_amount IS NULL OR (NEW.promo_amount=0 AND OLD.promo_amount<>0) THEN NEW.promo_amount:=OLD.promo_amount; END IF;
  IF NEW.promo_count IS NULL OR (NEW.promo_count=0 AND OLD.promo_count<>0) THEN NEW.promo_count:=OLD.promo_count; END IF;
  IF NEW.check_count IS NULL OR (NEW.check_count=0 AND OLD.check_count<>0) THEN NEW.check_count:=OLD.check_count; END IF;
  IF NEW.tips_amount IS NULL OR (NEW.tips_amount=0 AND OLD.tips_amount<>0) THEN NEW.tips_amount:=OLD.tips_amount; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sales_cache_pos_extras_guard BEFORE INSERT OR UPDATE ON public.sales_cache FOR EACH ROW EXECUTE FUNCTION public.guard_pos_sales_extras();

CREATE TABLE public.aloha_history_backfill_progress (
 location_id uuid NOT NULL REFERENCES public.locations(id),
 sale_date date NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','complete','retry','blocked')),
 attempts integer NOT NULL DEFAULT 0,
 error text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(location_id,sale_date)
);
GRANT ALL ON public.aloha_history_backfill_progress TO service_role;
REVOKE ALL ON public.aloha_history_backfill_progress FROM PUBLIC,anon,authenticated;
ALTER TABLE public.aloha_history_backfill_progress ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.aloha_history_backfill_progress IS 'One-time manually resumed Aloha actual-sales gaps; no permanent polling job.';

CREATE FUNCTION public.claim_aloha_history_backfill(_location_id uuid) RETURNS SETOF public.aloha_history_backfill_progress
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('aloha-history:'||_location_id::text));
 IF EXISTS(SELECT 1 FROM public.aloha_history_backfill_progress WHERE location_id=_location_id AND (status='blocked' OR (status='running' AND updated_at>now()-interval '10 minutes'))) THEN RETURN; END IF;
 RETURN QUERY UPDATE public.aloha_history_backfill_progress p SET status='running',attempts=p.attempts+1,error=NULL,updated_at=now()
 WHERE (p.location_id,p.sale_date) IN (
 SELECT q.location_id,q.sale_date FROM public.aloha_history_backfill_progress q
 WHERE q.location_id=_location_id AND q.attempts<3 AND (q.status IN ('pending','retry') OR (q.status='running' AND q.updated_at<=now()-interval '10 minutes'))
 ORDER BY q.sale_date DESC LIMIT 5 FOR UPDATE SKIP LOCKED
 ) RETURNING p.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_aloha_history_backfill(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_aloha_history_backfill(uuid) TO service_role;