
CREATE TABLE public.inventory_count_item_legs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_item_id UUID NOT NULL REFERENCES public.inventory_count_items(id) ON DELETE CASCADE,
  pack_config_id UUID NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  entered_cases NUMERIC,
  entered_inner_packs NUMERIC,
  entered_units NUMERIC,
  quantity_common NUMERIC,
  pack_quantity_at_count NUMERIC,
  inner_pack_quantity_at_count NUMERIC,
  cost_at_count NUMERIC,
  common_unit_at_count TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (count_item_id, pack_config_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_item_legs TO authenticated;
GRANT ALL ON public.inventory_count_item_legs TO service_role;

ALTER TABLE public.inventory_count_item_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access legs for counts at their locations"
ON public.inventory_count_item_legs
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.inventory_count_items ci
    JOIN public.inventory_counts c ON c.id = ci.count_id
    JOIN public.user_locations ul ON ul.location_id = c.location_id
    WHERE ci.id = inventory_count_item_legs.count_item_id
      AND ul.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.inventory_count_items ci
    JOIN public.inventory_counts c ON c.id = ci.count_id
    JOIN public.user_locations ul ON ul.location_id = c.location_id
    WHERE ci.id = inventory_count_item_legs.count_item_id
      AND ul.user_id = auth.uid()
  )
);

CREATE INDEX idx_inventory_count_item_legs_count_item_id
  ON public.inventory_count_item_legs(count_item_id);

CREATE INDEX idx_inventory_count_item_legs_pack_config_id
  ON public.inventory_count_item_legs(pack_config_id);

CREATE TRIGGER update_inventory_count_item_legs_updated_at
BEFORE UPDATE ON public.inventory_count_item_legs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


ALTER TABLE public.inventory_count_items
  ADD COLUMN quantity_rollup_blocked BOOLEAN DEFAULT false;

ALTER TABLE public.inventory_count_edits
  ADD COLUMN pack_config_id UUID;

ALTER TABLE public.locations
  ADD COLUMN legs_enabled BOOLEAN DEFAULT false;


CREATE OR REPLACE FUNCTION public.save_count_item_with_legs(
  p_count_item_id UUID,
  p_legs JSONB,
  p_freeze_snapshots BOOLEAN DEFAULT false,
  p_rollup_blocked BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default JSONB;
  v_parent_quantity NUMERIC;
  v_parent_cost NUMERIC;
BEGIN
  IF p_legs IS NULL OR jsonb_array_length(p_legs) = 0 THEN
    RAISE EXCEPTION 'save_count_item_with_legs requires at least one leg';
  END IF;

  DELETE FROM public.inventory_count_item_legs
   WHERE count_item_id = p_count_item_id;

  INSERT INTO public.inventory_count_item_legs (
    count_item_id, pack_config_id, is_default,
    entered_cases, entered_inner_packs, entered_units,
    quantity_common,
    pack_quantity_at_count, inner_pack_quantity_at_count,
    cost_at_count, common_unit_at_count
  )
  SELECT
    p_count_item_id,
    (leg->>'pack_config_id')::UUID,
    COALESCE((leg->>'is_default')::BOOLEAN, false),
    NULLIF(leg->>'entered_cases','')::NUMERIC,
    NULLIF(leg->>'entered_inner_packs','')::NUMERIC,
    NULLIF(leg->>'entered_units','')::NUMERIC,
    NULLIF(leg->>'quantity_common','')::NUMERIC,
    CASE WHEN p_freeze_snapshots THEN NULLIF(leg->>'pack_quantity_at_count','')::NUMERIC END,
    CASE WHEN p_freeze_snapshots THEN NULLIF(leg->>'inner_pack_quantity_at_count','')::NUMERIC END,
    CASE WHEN p_freeze_snapshots THEN NULLIF(leg->>'cost_at_count','')::NUMERIC END,
    CASE WHEN p_freeze_snapshots THEN NULLIF(leg->>'common_unit_at_count','') END
  FROM jsonb_array_elements(p_legs) AS leg;

  SELECT COALESCE(SUM(quantity_common), 0),
         CASE WHEN p_freeze_snapshots THEN COALESCE(SUM(cost_at_count), 0) ELSE NULL END
    INTO v_parent_quantity, v_parent_cost
    FROM public.inventory_count_item_legs
   WHERE count_item_id = p_count_item_id;

  SELECT to_jsonb(d)
    INTO v_default
    FROM public.inventory_count_item_legs d
   WHERE d.count_item_id = p_count_item_id
     AND d.is_default = true
   LIMIT 1;

  UPDATE public.inventory_count_items ci
     SET quantity = CASE WHEN p_rollup_blocked THEN NULL ELSE v_parent_quantity END,
         quantity_rollup_blocked = p_rollup_blocked,
         entered_cases       = NULLIF(v_default->>'entered_cases','')::NUMERIC,
         entered_inner_packs = NULLIF(v_default->>'entered_inner_packs','')::NUMERIC,
         entered_units       = NULLIF(v_default->>'entered_units','')::NUMERIC,
         cost_at_count = CASE WHEN p_freeze_snapshots THEN v_parent_cost ELSE ci.cost_at_count END,
         updated_at = now()
   WHERE ci.id = p_count_item_id;

  RETURN jsonb_build_object(
    'count_item_id', p_count_item_id,
    'parent_quantity', v_parent_quantity,
    'rollup_blocked', p_rollup_blocked,
    'frozen', p_freeze_snapshots
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_count_item_with_legs(UUID, JSONB, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_count_item_with_legs(UUID, JSONB, BOOLEAN, BOOLEAN) TO service_role;
