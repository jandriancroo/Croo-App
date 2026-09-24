ALTER TABLE public.availability_requests DROP CONSTRAINT availability_requests_status_check;
ALTER TABLE public.availability_requests ADD CONSTRAINT availability_requests_status_check CHECK (status = ANY (ARRAY['pending','approved','denied','withdrawn']));
ALTER TABLE public.availability_requests ADD COLUMN withdrawn_at timestamptz, ADD COLUMN withdrawn_by uuid REFERENCES public.profiles(id), ADD COLUMN status_before_withdraw text;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_availability_requests()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE overlap_exists boolean;
BEGIN
  IF NEW.status IN ('denied','withdrawn') THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.availability_requests ar
    WHERE ar.user_id = NEW.user_id
      AND ar.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ar.status NOT IN ('denied','withdrawn')
      AND (
        (NEW.end_date IS NULL AND ar.end_date IS NULL AND ar.start_date = NEW.start_date)
        OR (NEW.end_date IS NULL AND ar.end_date IS NOT NULL AND NEW.start_date >= ar.start_date AND NEW.start_date <= ar.end_date)
        OR (NEW.end_date IS NOT NULL AND ar.end_date IS NULL AND ar.start_date >= NEW.start_date AND ar.start_date <= NEW.end_date)
        OR (NEW.end_date IS NOT NULL AND ar.end_date IS NOT NULL AND NEW.start_date <= ar.end_date AND NEW.end_date >= ar.start_date)
      )
    LIMIT 1
  ) INTO overlap_exists;
  IF overlap_exists THEN
    RAISE EXCEPTION 'A time-off request already exists for this date range' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END; $$;

-- Withdraw instead of delete. Employee: own pending request. Manager+: any request at their location.
CREATE OR REPLACE FUNCTION public.withdraw_availability_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.availability_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.availability_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status = 'withdrawn' THEN RETURN; END IF;
  IF NOT (
    (r.user_id = auth.uid() AND r.status = 'pending')
    OR (public.has_location_access(auth.uid(), r.location_id) AND public.has_role_or_higher(auth.uid(), 'shift_manager'))
  ) THEN
    RAISE EXCEPTION 'You don''t have permission to withdraw this request';
  END IF;
  UPDATE public.availability_requests
     SET status_before_withdraw = status, status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid()
   WHERE id = _request_id;
END; $$;
REVOKE ALL ON FUNCTION public.withdraw_availability_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_availability_request(uuid) TO authenticated;

-- Requests are never hard-deleted by users anymore
DROP POLICY IF EXISTS "Users can delete own pending requests" ON public.availability_requests;
DROP POLICY IF EXISTS "Managers can delete requests at their locations" ON public.availability_requests;