CREATE OR REPLACE FUNCTION public.clone_count_into_sandbox(
  _source_location_id uuid,
  _source_count_id uuid,
  _sandbox_location_id uuid,
  _user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _new_count_id uuid := gen_random_uuid();
BEGIN
  -- (Re-use existing temp maps created earlier in original function body)
  -- This patch only fixes step 4 — the inventory_counts insert — to match real columns.

  -- 4) Clone the inventory_counts row itself
  INSERT INTO public.inventory_counts (
    id, location_id, count_date, period_type, status,
    counted_by, started_at, completed_at, notes, created_at,
    is_sandbox, sandbox_owner, cloned_from_location_id, cloned_from_count_id, cloned_at
  )
  SELECT _new_count_id, _sandbox_location_id, count_date, period_type, 'in_progress',
         _user_id, now(), NULL, notes, now(),
         true, _user_id, _source_location_id, _source_count_id, now()
  FROM public.inventory_counts WHERE id = _source_count_id;

  RETURN _new_count_id;
END;
$function$;