CREATE OR REPLACE FUNCTION public.start_fresh_sandbox_count(_source_location_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _template_count_id uuid;
  _new_count_id uuid;
  _today date := public._location_business_date(_source_location_id);
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_see_admin_locations(auth.uid()) THEN
    RAISE EXCEPTION 'Insufficient privileges';
  END IF;

  SELECT id INTO _template_count_id
  FROM public.inventory_counts
  WHERE location_id = _source_location_id AND coalesce(is_sandbox, false) = false
  ORDER BY count_date DESC, created_at DESC
  LIMIT 1;

  IF _template_count_id IS NULL THEN
    RAISE EXCEPTION 'This store has no counts yet to copy items from';
  END IF;

  _new_count_id := public.clone_count_to_sandbox(_source_location_id, _template_count_id);

  DELETE FROM public.inventory_count_item_legs
   WHERE count_item_id IN (SELECT id FROM public.inventory_count_items WHERE count_id = _new_count_id);
  DELETE FROM public.inventory_count_items WHERE count_id = _new_count_id;

  UPDATE public.inventory_counts
     SET count_date = _today,
         period_end_date = _today,
         notes = 'Fresh practice count',
         is_late_close = false,
         late_close_notes = NULL,
         sales_start_override = NULL,
         sales_end_override = NULL,
         cloned_from_count_id = NULL
   WHERE id = _new_count_id AND is_sandbox = true;

  RETURN _new_count_id;
END;
$function$;