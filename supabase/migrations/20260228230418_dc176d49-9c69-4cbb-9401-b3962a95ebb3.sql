CREATE OR REPLACE FUNCTION public.get_current_wages_batch(p_user_ids uuid[], p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(user_id uuid, hourly_wage numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id AS user_id,
    COALESCE(
      (SELECT wh.hourly_wage 
       FROM wage_history wh 
       WHERE wh.user_id = u.id 
         AND wh.effective_date <= p_date 
       ORDER BY wh.effective_date DESC 
       LIMIT 1),
      p.hourly_wage,
      15.00
    ) AS hourly_wage
  FROM unnest(p_user_ids) AS u(id)
  LEFT JOIN profiles p ON p.id = u.id;
END;
$$;