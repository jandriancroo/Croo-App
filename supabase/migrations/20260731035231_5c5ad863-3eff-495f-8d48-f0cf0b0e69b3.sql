-- 1. PROFILES: column-level lockdown of PIN + wage data
REVOKE SELECT ON public.profiles FROM authenticated, anon;
GRANT SELECT (
  id, email, full_name, role, created_at, updated_at, profile_photo_url, is_active,
  phone_number, birthday, display_order, croo_cash_balance, appears_on_schedule,
  default_location_id, min_weekly_hours, max_weekly_hours, first_login_at, invited_by,
  all_locations_enabled, app_version, weekly_availability, last_login_at, nickname,
  pin_pending, pin_pending_set_at, pin_pending_set_by
) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Self / admin punch PIN lookup
CREATE OR REPLACE FUNCTION public.get_punch_pin_for_user(_user_id uuid)
RETURNS TABLE(pin_pending text, pin_pending_plaintext text, pin_pending_set_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF auth.uid() <> _user_id AND NOT public.has_role_or_higher(auth.uid(), 'admin') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.pin_pending, p.pin_pending_plaintext, p.pin_pending_set_at
  FROM public.profiles p WHERE p.id = _user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_punch_pin_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_punch_pin_for_user(uuid) TO authenticated, service_role;

-- Admin-only legacy 4-digit PIN lookup
CREATE OR REPLACE FUNCTION public.admin_get_employee_pin(_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pin text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role_or_higher(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  SELECT p.employee_pin INTO v_pin FROM public.profiles p WHERE p.id = _user_id;
  RETURN v_pin;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_employee_pin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_employee_pin(uuid) TO authenticated, service_role;

-- 2. WAGE RPCs: role-gate
CREATE OR REPLACE FUNCTION public.get_current_wages_batch(p_user_ids uuid[], p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(user_id uuid, hourly_wage numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_privileged boolean;
BEGIN
  v_privileged := auth.uid() IS NOT NULL AND public.has_role_or_higher(auth.uid(), 'manager');
  RETURN QUERY
  SELECT
    u.id AS user_id,
    CASE WHEN v_privileged OR u.id = auth.uid() THEN
      COALESCE(
        (SELECT wh.hourly_wage FROM wage_history wh
          WHERE wh.user_id = u.id AND wh.effective_date <= p_date
          ORDER BY wh.effective_date DESC LIMIT 1),
        p.hourly_wage, 15.00)
    ELSE 15.00 END AS hourly_wage
  FROM unnest(p_user_ids) AS u(id)
  LEFT JOIN profiles p ON p.id = u.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_wage(p_user_id uuid, p_date date DEFAULT CURRENT_DATE)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wage numeric;
BEGIN
  IF auth.uid() IS NULL OR (auth.uid() <> p_user_id AND NOT public.has_role_or_higher(auth.uid(), 'manager')) THEN
    RETURN 15.00;
  END IF;
  SELECT hourly_wage INTO v_wage FROM public.wage_history
   WHERE user_id = p_user_id AND effective_date <= p_date
   ORDER BY effective_date DESC LIMIT 1;
  IF v_wage IS NULL THEN
    SELECT hourly_wage INTO v_wage FROM public.profiles WHERE id = p_user_id;
  END IF;
  RETURN COALESCE(v_wage, 15.00);
END;
$$;

-- 3. CHAT MEMBERS: no more self-join into arbitrary chats
DROP POLICY IF EXISTS "Authenticated users can add chat members" ON public.chat_members;
CREATE POLICY "Members creators or admins can add chat members"
ON public.chat_members FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND c.created_by = auth.uid())
  OR public.is_chat_member(auth.uid(), chat_id)
  OR (
    (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'org_admin'::app_role)
      OR public.is_super_admin(auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_id AND public.has_location_access(auth.uid(), c.location_id)
    )
  )
);

-- 4. HIRING MESSAGES: token-verified applicant sends only
DROP POLICY IF EXISTS "Public can send applicant messages" ON public.hiring_messages;

CREATE OR REPLACE FUNCTION public.applicant_send_hiring_message(_token text, _content text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_conv uuid; v_id uuid;
BEGIN
  IF _token IS NULL OR length(trim(_token)) = 0 OR _content IS NULL OR length(trim(_content)) = 0 THEN
    RAISE EXCEPTION 'Invalid request';
  END IF;
  SELECT hc.id INTO v_conv FROM public.hiring_conversations hc WHERE hc.access_token = _token;
  IF v_conv IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;
  INSERT INTO public.hiring_messages (conversation_id, sender_type, sender_id, content)
  VALUES (v_conv, 'applicant', NULL, left(_content, 5000))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.applicant_send_hiring_message(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.applicant_send_hiring_message(text, text) TO anon, authenticated, service_role;

-- 5. USER ROLES: no anonymous blanket read
DROP POLICY IF EXISTS "Anon can read user roles for kiosk" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view all roles" ON public.user_roles;
CREATE POLICY "Users can view own coworker or managed roles"
ON public.user_roles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role_or_higher(auth.uid(), 'manager')
  OR EXISTS (
    SELECT 1 FROM public.user_locations ul1
    JOIN public.user_locations ul2 ON ul1.location_id = ul2.location_id
    WHERE ul1.user_id = auth.uid() AND ul2.user_id = user_roles.user_id
  )
);
REVOKE ALL ON public.user_roles FROM anon;

-- Narrow kiosk role lookup for unauthenticated punch clocks
CREATE OR REPLACE FUNCTION public.punch_clock_get_role(_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = _user_id LIMIT 1), 'team_member');
$$;
REVOKE ALL ON FUNCTION public.punch_clock_get_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.punch_clock_get_role(uuid) TO anon, authenticated, service_role;