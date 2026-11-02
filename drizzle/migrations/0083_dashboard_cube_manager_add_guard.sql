-- Rollback: restore the eight backed-up rows through a reviewed service-only data change; restore the previous create_dashboard_widget definition to undo the add gate.
LOCK TABLE public.dashboard_widgets IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.dashboard_widgets_bak_20261101 AS
SELECT * FROM public.dashboard_widgets w
WHERE w.widget_type IN ('data','data-3d') AND (
  (w.authority_scope = 'org' AND w.audience_roles = ARRAY['shift_manager']::app_role[]
   AND w.id IN ('852fcf73-2686-4a6d-9134-0f3ac0655a9a','9838fbb4-88e4-420f-a97e-165d8dcee936','c4982065-de7f-4c32-ab38-52125d2fea42','7b8a2011-4c18-4d01-a896-68bac8cd94f7'))
  OR
  (w.authority_scope = 'self'
   AND w.id IN ('d9ad73a4-aa52-4515-8967-82843542153c','90b3df95-ad3c-4693-9588-87f6f04c1b25','32ab6435-54d6-4f8f-8245-b8903e35ee6c','c1e1a063-1c6b-4cf8-aac4-6c5894b0e26c')
   AND public.get_user_role(w.created_by)::text IN ('shift_manager','shift_manager_in_training','scheduling_manager','team_member')));
GRANT ALL ON public.dashboard_widgets_bak_20261101 TO service_role;
REVOKE ALL ON public.dashboard_widgets_bak_20261101 FROM PUBLIC, anon, authenticated;
ALTER TABLE public.dashboard_widgets_bak_20261101 ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.dashboard_widgets_bak_20261101) <> 8 THEN
    RAISE EXCEPTION 'Expected exactly 8 cube backup rows';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_dashboard_widget(_widget_type text, _config jsonb, _authority_scope text, _brand_id uuid DEFAULT NULL::uuid, _organization_id uuid DEFAULT NULL::uuid, _location_id uuid DEFAULT NULL::uuid, _audience_roles app_role[] DEFAULT NULL::app_role[], _title text DEFAULT NULL::text, _accent_color text DEFAULT '#8B5CF6'::text, _widget_size text DEFAULT 'small'::text, _display_order integer DEFAULT 0, _reference_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _widget_type IN ('data', 'data-3d') AND NOT COALESCE(public.has_role_or_higher(_uid, 'manager'), false) THEN
    RAISE EXCEPTION 'Only managers and above can add dashboard cubes.' USING ERRCODE = '42501';
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
$function$;

-- Data changes are executed separately through the data tool, in one guarded transaction.
-- This one-time service-only operation verifies the backup still matches every target before deleting.
CREATE FUNCTION public.remove_dashboard_cubes_20261101() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _backed_up integer; _deleted integer; _preview_ids uuid[];
BEGIN
  LOCK TABLE public.dashboard_widgets IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.dashboard_widgets_bak_20261101 IN SHARE MODE;
  SELECT array_agg(w.id ORDER BY w.id) INTO _preview_ids
  FROM public.dashboard_widgets w
  WHERE w.widget_type IN ('data','data-3d') AND (
    (w.authority_scope = 'org' AND w.audience_roles = ARRAY['shift_manager']::app_role[]
     AND w.id IN ('852fcf73-2686-4a6d-9134-0f3ac0655a9a','9838fbb4-88e4-420f-a97e-165d8dcee936','c4982065-de7f-4c32-ab38-52125d2fea42','7b8a2011-4c18-4d01-a896-68bac8cd94f7'))
    OR
    (w.authority_scope = 'self'
     AND w.id IN ('d9ad73a4-aa52-4515-8967-82843542153c','90b3df95-ad3c-4693-9588-87f6f04c1b25','32ab6435-54d6-4f8f-8245-b8903e35ee6c','c1e1a063-1c6b-4cf8-aac4-6c5894b0e26c')
     AND public.get_user_role(w.created_by)::text IN ('shift_manager','shift_manager_in_training','scheduling_manager','team_member')));
  IF _preview_ids IS DISTINCT FROM ARRAY(SELECT x::uuid FROM unnest(ARRAY['852fcf73-2686-4a6d-9134-0f3ac0655a9a','9838fbb4-88e4-420f-a97e-165d8dcee936','c4982065-de7f-4c32-ab38-52125d2fea42','7b8a2011-4c18-4d01-a896-68bac8cd94f7','d9ad73a4-aa52-4515-8967-82843542153c','90b3df95-ad3c-4693-9588-87f6f04c1b25','32ab6435-54d6-4f8f-8245-b8903e35ee6c','c1e1a063-1c6b-4cf8-aac4-6c5894b0e26c']) x ORDER BY x::uuid) THEN
    RAISE EXCEPTION 'Cube preview does not match exactly the 8 approved IDs';
  END IF;
  SELECT count(*) INTO _backed_up FROM public.dashboard_widgets_bak_20261101;
  IF _backed_up <> 8 OR EXISTS (
    SELECT 1 FROM public.dashboard_widgets_bak_20261101 b
    FULL JOIN (SELECT * FROM public.dashboard_widgets WHERE id = ANY(_preview_ids)) w USING (id)
    WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(w)
  ) THEN RAISE EXCEPTION 'Expected exactly 8 unchanged backup rows'; END IF;
  DELETE FROM public.dashboard_widgets w
  WHERE w.widget_type IN ('data','data-3d') AND (
    (w.authority_scope = 'org' AND w.audience_roles = ARRAY['shift_manager']::app_role[]
     AND w.id IN ('852fcf73-2686-4a6d-9134-0f3ac0655a9a','9838fbb4-88e4-420f-a97e-165d8dcee936','c4982065-de7f-4c32-ab38-52125d2fea42','7b8a2011-4c18-4d01-a896-68bac8cd94f7'))
    OR
    (w.authority_scope = 'self'
     AND w.id IN ('d9ad73a4-aa52-4515-8967-82843542153c','90b3df95-ad3c-4693-9588-87f6f04c1b25','32ab6435-54d6-4f8f-8245-b8903e35ee6c','c1e1a063-1c6b-4cf8-aac4-6c5894b0e26c')
     AND public.get_user_role(w.created_by)::text IN ('shift_manager','shift_manager_in_training','scheduling_manager','team_member')));
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  IF _backed_up <> 8 OR _deleted <> 8 THEN
    RAISE EXCEPTION 'Expected 8 backed up and 8 deleted, got % and %', _backed_up, _deleted;
  END IF;
  RETURN jsonb_build_object('backed_up', _backed_up, 'deleted', _deleted);
END $$;
REVOKE ALL ON FUNCTION public.remove_dashboard_cubes_20261101() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_dashboard_cubes_20261101() TO service_role;