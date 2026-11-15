alter function public._validate_widget_authority set search_path = public, pg_temp;
revoke execute on function public._validate_widget_authority from public, anon, authenticated;