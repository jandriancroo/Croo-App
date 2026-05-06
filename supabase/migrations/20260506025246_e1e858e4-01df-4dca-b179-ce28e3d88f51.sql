-- Personal "hide from my dashboard" toggle for widgets you don't own.
-- Lets admins/org_admins/super_admins create widgets for managers/shift leads
-- without polluting their own dashboard. Doesn't affect any other user.

ALTER TABLE public.dashboard_widgets
  ADD COLUMN IF NOT EXISTS hidden_for_user_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_hidden_for_users
  ON public.dashboard_widgets USING GIN (hidden_for_user_ids);

-- RPC: toggle current user's id in/out of the hidden array.
-- Intentionally bypasses _validate_widget_authority — any user who can SEE
-- the widget (RLS) can hide it from their own dashboard.
CREATE OR REPLACE FUNCTION public.toggle_widget_hidden_for_self(_widget_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _currently_hidden boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT _uid = ANY(hidden_for_user_ids)
    INTO _currently_hidden
    FROM public.dashboard_widgets
   WHERE id = _widget_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Widget not found';
  END IF;

  IF _currently_hidden THEN
    UPDATE public.dashboard_widgets
       SET hidden_for_user_ids = array_remove(hidden_for_user_ids, _uid),
           updated_at = now()
     WHERE id = _widget_id;
    RETURN false;
  ELSE
    UPDATE public.dashboard_widgets
       SET hidden_for_user_ids = array_append(hidden_for_user_ids, _uid),
           updated_at = now()
     WHERE id = _widget_id;
    RETURN true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_widget_hidden_for_self(uuid) TO authenticated;