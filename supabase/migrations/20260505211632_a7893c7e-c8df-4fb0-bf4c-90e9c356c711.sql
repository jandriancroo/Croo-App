
-- =========================================================
-- 1. Table
-- =========================================================
CREATE TABLE public.dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,

  created_by uuid NOT NULL,
  authority_scope text NOT NULL CHECK (authority_scope IN ('self','location','org','brand','app')),

  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,

  audience_roles app_role[] DEFAULT NULL,

  is_active boolean NOT NULL DEFAULT true,
  title text,
  accent_color text DEFAULT '#8B5CF6',
  widget_size text NOT NULL DEFAULT 'small' CHECK (widget_size IN ('small','medium','large')),
  reference_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scope_fk_check CHECK (
    (authority_scope = 'self'     AND location_id IS NOT NULL)
    OR (authority_scope = 'location' AND location_id IS NOT NULL)
    OR (authority_scope = 'org'      AND organization_id IS NOT NULL)
    OR (authority_scope = 'brand'    AND brand_id IS NOT NULL)
    OR (authority_scope = 'app')
  )
);

CREATE INDEX idx_dw_self     ON public.dashboard_widgets(created_by, location_id) WHERE authority_scope = 'self';
CREATE INDEX idx_dw_location ON public.dashboard_widgets(location_id)             WHERE authority_scope = 'location';
CREATE INDEX idx_dw_org      ON public.dashboard_widgets(organization_id)         WHERE authority_scope = 'org';
CREATE INDEX idx_dw_brand    ON public.dashboard_widgets(brand_id)                WHERE authority_scope = 'brand';
CREATE INDEX idx_dw_app      ON public.dashboard_widgets(id)                      WHERE authority_scope = 'app';

CREATE TRIGGER update_dashboard_widgets_updated_at
  BEFORE UPDATE ON public.dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 2. RLS
-- =========================================================
ALTER TABLE public.dashboard_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read visible widgets" ON public.dashboard_widgets
FOR SELECT TO authenticated USING (
  (authority_scope = 'self'
    AND created_by = (SELECT auth.uid()))

  OR (authority_scope = 'location'
    AND public.has_location_access((SELECT auth.uid()), location_id)
    AND (audience_roles IS NULL
      OR (SELECT public.get_user_role((SELECT auth.uid())))::app_role = ANY(audience_roles)))

  OR (authority_scope = 'org'
    AND public.is_org_member((SELECT auth.uid()), organization_id)
    AND (audience_roles IS NULL
      OR (SELECT public.get_user_role((SELECT auth.uid())))::app_role = ANY(audience_roles)))

  OR (authority_scope = 'brand'
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      JOIN public.locations l ON l.organization_id = o.id
      JOIN public.user_locations ul ON ul.location_id = l.id
      WHERE o.brand_id = dashboard_widgets.brand_id
        AND ul.user_id = (SELECT auth.uid())
    )
    AND (audience_roles IS NULL
      OR (SELECT public.get_user_role((SELECT auth.uid())))::app_role = ANY(audience_roles)))

  OR (authority_scope = 'app'
    AND (audience_roles IS NULL
      OR (SELECT public.get_user_role((SELECT auth.uid())))::app_role = ANY(audience_roles)))
);

CREATE POLICY "No direct inserts" ON public.dashboard_widgets
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "No direct updates" ON public.dashboard_widgets
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY "No direct deletes" ON public.dashboard_widgets
  FOR DELETE TO authenticated USING (false);

-- =========================================================
-- 3. Authority helper
-- =========================================================
CREATE OR REPLACE FUNCTION public._validate_widget_authority(
  _uid uuid,
  _scope text,
  _brand_id uuid,
  _org_id uuid,
  _loc_id uuid,
  _created_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _scope = 'self' THEN
    IF _uid != _created_by THEN
      RAISE EXCEPTION 'Cannot edit another user''s personal widget';
    END IF;
  ELSIF _scope = 'location' THEN
    IF NOT public.has_role_or_higher(_uid, 'admin') THEN
      RAISE EXCEPTION 'Must be Admin+ to manage location widgets';
    END IF;
    IF _loc_id IS NOT NULL AND NOT public.has_location_access(_uid, _loc_id) THEN
      RAISE EXCEPTION 'No access to target location';
    END IF;
  ELSIF _scope = 'org' THEN
    IF _org_id IS NOT NULL
      AND NOT public.is_org_admin(_uid, _org_id)
      AND NOT public.is_super_admin(_uid) THEN
      RAISE EXCEPTION 'Must be Org Admin+ to manage org widgets';
    END IF;
  ELSIF _scope = 'brand' THEN
    IF NOT public.is_super_admin(_uid)
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_members
        WHERE user_id = _uid AND brand_id = _brand_id AND brand_role = 'admin'
      ) THEN
      RAISE EXCEPTION 'Must be Brand Admin+ to manage brand widgets';
    END IF;
  ELSIF _scope = 'app' THEN
    IF NOT public.is_super_admin(_uid) THEN
      RAISE EXCEPTION 'Must be Super Admin for app-wide widgets';
    END IF;
  END IF;
END;
$$;

-- =========================================================
-- 4. Create RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.create_dashboard_widget(
  _widget_type text,
  _config jsonb,
  _authority_scope text,
  _brand_id uuid DEFAULT NULL,
  _organization_id uuid DEFAULT NULL,
  _location_id uuid DEFAULT NULL,
  _audience_roles app_role[] DEFAULT NULL,
  _title text DEFAULT NULL,
  _accent_color text DEFAULT '#8B5CF6',
  _widget_size text DEFAULT 'small',
  _display_order integer DEFAULT 0,
  _reference_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public._validate_widget_authority(_uid, _authority_scope, _brand_id, _organization_id, _location_id, _uid);

  INSERT INTO public.dashboard_widgets (
    widget_type, config, display_order, created_by, authority_scope,
    brand_id, organization_id, location_id, audience_roles,
    title, accent_color, widget_size, reference_id
  ) VALUES (
    _widget_type, _config, _display_order, _uid, _authority_scope,
    _brand_id, _organization_id, _location_id, _audience_roles,
    _title, _accent_color, _widget_size, _reference_id
  ) RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$$;

-- =========================================================
-- 5. Update RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_dashboard_widget(
  _widget_id uuid,
  _widget_type text DEFAULT NULL,
  _config jsonb DEFAULT NULL,
  _authority_scope text DEFAULT NULL,
  _brand_id uuid DEFAULT NULL,
  _organization_id uuid DEFAULT NULL,
  _location_id uuid DEFAULT NULL,
  _audience_roles app_role[] DEFAULT NULL,
  _title text DEFAULT NULL,
  _accent_color text DEFAULT NULL,
  _widget_size text DEFAULT NULL,
  _display_order integer DEFAULT NULL,
  _reference_id uuid DEFAULT NULL,
  _is_active boolean DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.dashboard_widgets%ROWTYPE;
  _new_scope text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _existing FROM public.dashboard_widgets WHERE id = _widget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Widget not found';
  END IF;

  _new_scope := COALESCE(_authority_scope, _existing.authority_scope);

  PERFORM public._validate_widget_authority(
    _uid, _existing.authority_scope,
    _existing.brand_id, _existing.organization_id, _existing.location_id, _existing.created_by
  );

  IF _authority_scope IS NOT NULL AND _authority_scope <> _existing.authority_scope THEN
    PERFORM public._validate_widget_authority(
      _uid, _authority_scope,
      _brand_id, _organization_id, _location_id, _existing.created_by
    );
  END IF;

  UPDATE public.dashboard_widgets SET
    widget_type     = COALESCE(_widget_type, widget_type),
    config          = COALESCE(_config, config),
    authority_scope = _new_scope,
    brand_id        = CASE WHEN _authority_scope IS NOT NULL THEN _brand_id ELSE brand_id END,
    organization_id = CASE WHEN _authority_scope IS NOT NULL THEN _organization_id ELSE organization_id END,
    location_id     = CASE WHEN _authority_scope IS NOT NULL THEN _location_id ELSE location_id END,
    audience_roles  = CASE WHEN _audience_roles IS NOT NULL THEN _audience_roles ELSE audience_roles END,
    title           = COALESCE(_title, title),
    accent_color    = COALESCE(_accent_color, accent_color),
    widget_size     = COALESCE(_widget_size, widget_size),
    display_order   = COALESCE(_display_order, display_order),
    reference_id    = COALESCE(_reference_id, reference_id),
    is_active       = COALESCE(_is_active, is_active),
    updated_at      = now()
  WHERE id = _widget_id;
END;
$$;

-- =========================================================
-- 6. Delete RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.delete_dashboard_widget(_widget_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.dashboard_widgets%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _existing FROM public.dashboard_widgets WHERE id = _widget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Widget not found';
  END IF;

  PERFORM public._validate_widget_authority(
    _uid, _existing.authority_scope,
    _existing.brand_id, _existing.organization_id, _existing.location_id, _existing.created_by
  );

  DELETE FROM public.dashboard_widgets WHERE id = _widget_id;
END;
$$;

-- =========================================================
-- 7. Backfill: role_dashboard_cubes -> org-scoped widgets
-- =========================================================
INSERT INTO public.dashboard_widgets (
  widget_type, config, authority_scope, organization_id,
  audience_roles, created_by, title, accent_color, widget_size, display_order
)
SELECT
  COALESCE(elem->>'cubeType', elem->>'cube_type', elem->>'type', 'data') AS widget_type,
  elem AS config,
  'org' AS authority_scope,
  rdc.organization_id,
  ARRAY[rdc.role::app_role] AS audience_roles,
  COALESCE(
    rdc.created_by,
    (SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'super_admin' LIMIT 1)
  ) AS created_by,
  elem->>'title' AS title,
  COALESCE(elem->>'accentColor', '#8B5CF6') AS accent_color,
  COALESCE(elem->>'size', 'small') AS widget_size,
  (ordinality - 1)::int AS display_order
FROM public.role_dashboard_cubes rdc,
LATERAL jsonb_array_elements(rdc.cubes) WITH ORDINALITY AS t(elem, ordinality)
WHERE jsonb_typeof(rdc.cubes) = 'array'
  AND COALESCE(
    rdc.created_by,
    (SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'super_admin' LIMIT 1)
  ) IS NOT NULL;

-- =========================================================
-- 8. Backfill: personal admin widgets from user_dashboard_cubes
--    (one row per admin's personal cube; tracker fan-outs handled in step 9)
-- =========================================================
INSERT INTO public.dashboard_widgets (
  widget_type, config, authority_scope, location_id,
  created_by, title, accent_color, widget_size, display_order, reference_id
)
SELECT
  udc.cube_type AS widget_type,
  jsonb_build_object(
    'metrics', udc.metrics,
    'face_metrics', udc.face_metrics,
    'face_titles', udc.face_titles,
    'num_faces', udc.num_faces,
    'tracker_scope', udc.tracker_scope,
    'tracker_display_mode', udc.tracker_display_mode,
    'tracker_item_refs', udc.tracker_item_refs,
    'tracker_promo_start', udc.tracker_promo_start,
    'tracker_promo_end', udc.tracker_promo_end,
    'tracker_location_refs', udc.tracker_location_refs,
    'tracker_rank_metrics', udc.tracker_rank_metrics,
    'tracker_promo_image_url', udc.tracker_promo_image_url
  ) AS config,
  'self' AS authority_scope,
  udc.location_id,
  udc.user_id AS created_by,
  udc.title,
  COALESCE(udc.accent_color, '#8B5CF6') AS accent_color,
  COALESCE(udc.widget_size, 'small') AS widget_size,
  COALESCE(udc.display_order, 0) AS display_order,
  udc.reference_id
FROM public.user_dashboard_cubes udc
WHERE udc.cube_type IS DISTINCT FROM 'tracker'
   OR udc.user_id IN (
     SELECT ur.user_id FROM public.user_roles ur
     WHERE ur.role IN ('admin','org_admin','brand_admin','super_admin')
   );

-- =========================================================
-- 9. Backfill: collapse fanned-out tracker publishes into one
--    location-scoped widget per (title, location).
-- =========================================================
INSERT INTO public.dashboard_widgets (
  widget_type, config, authority_scope, location_id,
  audience_roles, created_by, title, accent_color, widget_size, display_order
)
SELECT DISTINCT ON (udc.title, udc.location_id)
  'tracker' AS widget_type,
  jsonb_build_object(
    'metrics', udc.metrics,
    'face_metrics', udc.face_metrics,
    'face_titles', udc.face_titles,
    'num_faces', udc.num_faces,
    'tracker_scope', udc.tracker_scope,
    'tracker_display_mode', udc.tracker_display_mode,
    'tracker_item_refs', udc.tracker_item_refs,
    'tracker_promo_start', udc.tracker_promo_start,
    'tracker_promo_end', udc.tracker_promo_end,
    'tracker_location_refs', udc.tracker_location_refs,
    'tracker_rank_metrics', udc.tracker_rank_metrics,
    'tracker_promo_image_url', udc.tracker_promo_image_url
  ) AS config,
  'location' AS authority_scope,
  udc.location_id,
  NULL::app_role[] AS audience_roles,
  COALESCE(
    (SELECT ur.user_id FROM public.user_roles ur
      WHERE ur.role IN ('admin','org_admin','brand_admin','super_admin') LIMIT 1),
    udc.user_id
  ) AS created_by,
  udc.title,
  COALESCE(udc.accent_color, '#8B5CF6') AS accent_color,
  COALESCE(udc.widget_size, 'small') AS widget_size,
  0 AS display_order
FROM public.user_dashboard_cubes udc
WHERE udc.cube_type = 'tracker'
  AND udc.user_id NOT IN (
    SELECT ur.user_id FROM public.user_roles ur
    WHERE ur.role IN ('admin','org_admin','brand_admin','super_admin')
  )
  AND udc.title IS NOT NULL
ORDER BY udc.title, udc.location_id, udc.created_at ASC;
