-- Heimark reading profile + gap price evidence (Oct 6 2026)

ALTER TABLE public.vendor_invoice_items
  ADD COLUMN IF NOT EXISTS raw_description text,
  ADD COLUMN IF NOT EXISTS pack_size text,
  ADD COLUMN IF NOT EXISTS units_per_case numeric,
  ADD COLUMN IF NOT EXISTS oz_per_unit numeric,
  ADD COLUMN IF NOT EXISTS inner_layout text,
  ADD COLUMN IF NOT EXISTS list_price numeric,
  ADD COLUMN IF NOT EXISTS discount numeric,
  ADD COLUMN IF NOT EXISTS deposit numeric,
  ADD COLUMN IF NOT EXISTS cost_per_case numeric;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS vendor_name_normalized text,
  ADD COLUMN IF NOT EXISTS profile text,
  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS self_checks jsonb;

-- One invoice number = one record per store + vendor (new uploads; legacy rows
-- keep a NULL normalized name until the duplicate cleanup is approved).
CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoices_one_record_per_number
  ON public.vendor_invoices (location_id, vendor_name_normalized, invoice_number)
  WHERE vendor_name_normalized IS NOT NULL AND invoice_number IS NOT NULL;

ALTER TABLE public.vendor_gap_alerts
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS last_seen_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Read-only: for each gap, the price evidence already on file. Pack and price
-- always come from the SAME row (an order line, a price-list row or a checked
-- invoice line). Visible to the same people who can see the brand's gaps.
CREATE OR REPLACE FUNCTION public.get_gap_price_evidence(_brand_id uuid)
RETURNS TABLE(gap_id uuid, kind text, pack_size text, price numeric, source text, ref text, seen_on date, location_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ok AS (
    SELECT 1 WHERE EXISTS (SELECT 1 FROM brand_members bm WHERE bm.brand_id = _brand_id AND bm.user_id = auth.uid())
  ),
  brand_locs AS (
    SELECT array_agg(l.id) ids FROM locations l JOIN organizations o ON o.id = l.organization_id WHERE o.brand_id = _brand_id
  ),
  g AS (
    SELECT a.id, trim(a.item_number) num,
      COALESCE(NULLIF(ARRAY(
        SELECT (x->>'id')::uuid FROM jsonb_array_elements(COALESCE(a.reported_by_locations, '[]'::jsonb)) x
        WHERE (x->>'id') ~ '^[0-9a-fA-F-]{36}$'), '{}'::uuid[]), (SELECT ids FROM brand_locs)) locs
    FROM vendor_gap_alerts a, ok
    WHERE a.brand_id = _brand_id AND a.status IN ('new','ignored','dismissed')
  ),
  pfg_bought AS (
    SELECT DISTINCT ON (g.id) g.id, 'bought'::text kind, i->>'packSize' pack, (i->>'price')::numeric price,
      'PFG order'::text source, o.order_number ref, COALESCE(o.order_date, o.delivery_date) seen_on, o.location_id
    FROM g JOIN pfg_orders o ON o.location_id = ANY(g.locs)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items)='array' THEN o.items ELSE '[]'::jsonb END) i
    WHERE trim(i->>'itemNumber') = g.num AND (i->>'price') ~ '^[0-9]+(\.[0-9]+)?$' AND (i->>'price')::numeric > 0
    ORDER BY g.id, COALESCE(o.order_date, o.delivery_date) DESC NULLS LAST
  ),
  pa_bought AS (
    SELECT DISTINCT ON (g.id) g.id, 'bought'::text, NULL::text, (i->>'price')::numeric,
      'PA order'::text, o.order_number, COALESCE(o.order_date, o.delivery_date), o.location_id
    FROM g JOIN pa_orders o ON o.location_id = ANY(g.locs)
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items)='array' THEN o.items ELSE '[]'::jsonb END) i
    WHERE g.num IN (trim(i->>'item_code'), trim(i->>'master_product_code'), trim(i->>'pa_product_id'))
      AND (i->>'price') ~ '^[0-9]+(\.[0-9]+)?$' AND (i->>'price')::numeric > 0
      AND NOT EXISTS (SELECT 1 FROM pfg_bought pb WHERE pb.id = g.id)
    ORDER BY g.id, COALESCE(o.order_date, o.delivery_date) DESC NULLS LAST
  ),
  inv_bought AS (
    SELECT DISTINCT ON (g.id) g.id, 'invoice'::text, vii.pack_size, vii.cost_per_case,
      'Invoice'::text, vi.invoice_number, COALESCE(vi.delivery_date, vi.invoice_date), vi.location_id
    FROM g JOIN vendor_invoices vi ON vi.location_id = ANY(g.locs)
    JOIN vendor_invoice_items vii ON vii.invoice_id = vi.id
    WHERE trim(vii.item_number) = g.num AND vi.review_status = 'ok' AND vii.cost_per_case > 0
    ORDER BY g.id, COALESCE(vi.delivery_date, vi.invoice_date) DESC NULLS LAST
  ),
  pfg_list AS (
    SELECT DISTINCT ON (g.id) g.id, 'list'::text, b.pack_size, b.unit_price,
      'PFG price list'::text, NULL::text, b.last_seen_at::date, b.location_id
    FROM g JOIN pfg_bid_items b ON b.location_id = ANY(g.locs) AND trim(b.item_number) = g.num
    WHERE b.unit_price > 0
    ORDER BY g.id, b.last_seen_at DESC NULLS LAST
  ),
  pa_list AS (
    SELECT DISTINCT ON (g.id) g.id, 'list'::text, c.pack_size, c.unit_price,
      'PA catalog'::text, NULL::text, c.last_seen_at::date, c.location_id
    FROM g JOIN pa_catalog_items c ON c.location_id = ANY(g.locs)
      AND g.num IN (trim(c.pa_item_id), trim(c.pa_product_id), trim(c.master_product_code))
    WHERE c.unit_price > 0 AND NOT EXISTS (SELECT 1 FROM pfg_list pl WHERE pl.id = g.id)
    ORDER BY g.id, c.last_seen_at DESC NULLS LAST
  )
  SELECT * FROM pfg_bought UNION ALL SELECT * FROM pa_bought UNION ALL SELECT * FROM inv_bought
  UNION ALL SELECT * FROM pfg_list UNION ALL SELECT * FROM pa_list;
$$;

REVOKE ALL ON FUNCTION public.get_gap_price_evidence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gap_price_evidence(uuid) TO authenticated, service_role;