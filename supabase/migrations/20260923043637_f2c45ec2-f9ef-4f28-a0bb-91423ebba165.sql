CREATE OR REPLACE FUNCTION public.get_live_labor_totals(_location_id uuid, _date date)
 RETURNS TABLE(hours numeric, cost numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce(
    public._labor_totals_authorized(_location_id)
    or coalesce(
      auth.uid() is not null
      and public.punch_device_location(auth.uid()) = _location_id,
      false
    ),
    false
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query select * from public._labor_totals_for_date(_location_id, _date, true);
end;
$function$;

REVOKE ALL ON FUNCTION public.get_live_labor_totals(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_labor_totals(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_live_labor_totals(uuid, date) TO authenticated;