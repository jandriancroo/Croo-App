
CREATE OR REPLACE FUNCTION public.get_tracker_ranking(
  _location_id uuid,
  _scope text,
  _location_refs uuid[],
  _start_date date,
  _end_date date
)
RETURNS TABLE (
  location_id uuid,
  location_name text,
  sale_date date,
  net_sales numeric,
  product_mix jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _brand_id uuid;
  _org_id uuid;
  _pool uuid[];
  _is_member boolean;
BEGIN
  -- Verify caller is a member of the calling location (security boundary)
  SELECT EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = _location_id
  ) INTO _is_member;
  IF NOT _is_member THEN
    RETURN;
  END IF;

  IF _location_refs IS NOT NULL AND array_length(_location_refs, 1) > 0 THEN
    _pool := _location_refs;
  ELSIF _scope = 'brand' THEN
    SELECT l.organization_id INTO _org_id FROM public.locations l WHERE l.id = _location_id;
    SELECT o.brand_id INTO _brand_id FROM public.organizations o WHERE o.id = _org_id;
    IF _brand_id IS NULL THEN
      SELECT array_agg(l.id) INTO _pool
        FROM public.locations l WHERE l.organization_id = _org_id AND l.is_active = true;
    ELSE
      SELECT array_agg(l.id) INTO _pool
        FROM public.locations l
        JOIN public.organizations o ON o.id = l.organization_id
        WHERE o.brand_id = _brand_id AND l.is_active = true;
    END IF;
  ELSE
    SELECT l.organization_id INTO _org_id FROM public.locations l WHERE l.id = _location_id;
    SELECT array_agg(l.id) INTO _pool
      FROM public.locations l WHERE l.organization_id = _org_id AND l.is_active = true;
  END IF;

  RETURN QUERY
  SELECT l.id, l.name, sc.sale_date, sc.net_sales, sc.product_mix
  FROM public.locations l
  LEFT JOIN public.sales_cache sc
    ON sc.location_id = l.id
   AND sc.sale_date BETWEEN _start_date AND _end_date
   AND sc.product_mix IS NOT NULL
  WHERE l.id = ANY(_pool);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tracker_ranking(uuid, text, uuid[], date, date) TO authenticated;
