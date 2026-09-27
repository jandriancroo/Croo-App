CREATE OR REPLACE FUNCTION public._us_state_list()
RETURNS TABLE(code text, name text, tz text)
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ VALUES
    ('AL','ALABAMA','America/Chicago'),('AK','ALASKA','America/Anchorage'),('AZ','ARIZONA','America/Phoenix'),
    ('AR','ARKANSAS','America/Chicago'),('CA','CALIFORNIA','America/Los_Angeles'),('CO','COLORADO','America/Denver'),
    ('CT','CONNECTICUT','America/New_York'),('DE','DELAWARE','America/New_York'),('DC','DISTRICT OF COLUMBIA','America/New_York'),
    ('FL','FLORIDA','America/New_York'),('GA','GEORGIA','America/New_York'),('HI','HAWAII','Pacific/Honolulu'),
    ('ID','IDAHO','America/Boise'),('IL','ILLINOIS','America/Chicago'),('IN','INDIANA','America/Indiana/Indianapolis'),
    ('IA','IOWA','America/Chicago'),('KS','KANSAS','America/Chicago'),('KY','KENTUCKY','America/New_York'),
    ('LA','LOUISIANA','America/Chicago'),('ME','MAINE','America/New_York'),('MD','MARYLAND','America/New_York'),
    ('MA','MASSACHUSETTS','America/New_York'),('MI','MICHIGAN','America/Detroit'),('MN','MINNESOTA','America/Chicago'),
    ('MS','MISSISSIPPI','America/Chicago'),('MO','MISSOURI','America/Chicago'),('MT','MONTANA','America/Denver'),
    ('NE','NEBRASKA','America/Chicago'),('NV','NEVADA','America/Los_Angeles'),('NH','NEW HAMPSHIRE','America/New_York'),
    ('NJ','NEW JERSEY','America/New_York'),('NM','NEW MEXICO','America/Denver'),('NY','NEW YORK','America/New_York'),
    ('NC','NORTH CAROLINA','America/New_York'),('ND','NORTH DAKOTA','America/Chicago'),('OH','OHIO','America/New_York'),
    ('OK','OKLAHOMA','America/Chicago'),('OR','OREGON','America/Los_Angeles'),('PA','PENNSYLVANIA','America/New_York'),
    ('RI','RHODE ISLAND','America/New_York'),('SC','SOUTH CAROLINA','America/New_York'),('SD','SOUTH DAKOTA','America/Chicago'),
    ('TN','TENNESSEE','America/Chicago'),('TX','TEXAS','America/Chicago'),('UT','UTAH','America/Denver'),
    ('VT','VERMONT','America/New_York'),('VA','VIRGINIA','America/New_York'),('WA','WASHINGTON','America/Los_Angeles'),
    ('WV','WEST VIRGINIA','America/New_York'),('WI','WISCONSIN','America/Chicago'),('WY','WYOMING','America/Denver')
$$;
REVOKE ALL ON FUNCTION public._us_state_list() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._us_state_list() TO service_role;

CREATE OR REPLACE FUNCTION public.derive_store_region(address text)
RETURNS TABLE(state_code text, timezone text)
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  a text; m text[]; st text; zip text; z3 int; r record;
BEGIN
  IF address IS NULL OR btrim(address) = '' THEN RETURN; END IF;
  a := upper(regexp_replace(address, '[\r\n\t]+', ' ', 'g'));
  a := btrim(regexp_replace(a, '\s+', ' ', 'g'));
  a := regexp_replace(a, '(,|\.|\s)*(USA|UNITED STATES)\s*$', '');

  m := regexp_match(a, '(?:^|[^A-Z])([A-Z]{2})[\s.,]*(\d{5})(?:-\d{4})?\s*$');
  IF m IS NOT NULL AND EXISTS (SELECT 1 FROM public._us_state_list() s WHERE s.code = m[1]) THEN
    st := m[1]; zip := m[2];
  ELSE
    m := regexp_match(a, '(?:^|[^A-Z])([A-Z]{2})\s*$');
    IF m IS NOT NULL AND EXISTS (SELECT 1 FROM public._us_state_list() s WHERE s.code = m[1]) THEN
      st := m[1];
    END IF;
  END IF;
  IF st IS NULL THEN
    FOR r IN SELECT s.code, s.name FROM public._us_state_list() s ORDER BY length(s.name) DESC LOOP
      m := regexp_match(a, '(?:^|[^A-Z])' || r.name || '[\s.,]*(\d{5})?(?:-\d{4})?\s*$');
      IF m IS NOT NULL THEN st := r.code; zip := m[1]; EXIT; END IF;
    END LOOP;
  END IF;
  IF st IS NULL THEN RETURN; END IF;
  IF zip IS NULL THEN
    m := regexp_match(a, '(\d{5})(?:-\d{4})?\s*$');
    IF m IS NOT NULL THEN zip := m[1]; END IF;
  END IF;

  state_code := st;
  SELECT s.tz INTO timezone FROM public._us_state_list() s WHERE s.code = st;
  IF zip IS NOT NULL THEN
    z3 := substr(zip, 1, 3)::int;
    timezone := CASE
      WHEN st = 'IN' AND substr(zip,1,2) IN ('46','47') THEN 'America/Indiana/Indianapolis'
      WHEN st = 'TX' AND z3 BETWEEN 798 AND 799 THEN 'America/Denver'
      WHEN st = 'FL' AND z3 BETWEEN 324 AND 325 THEN 'America/Chicago'
      WHEN st = 'TN' AND (z3 BETWEEN 373 AND 374 OR z3 BETWEEN 376 AND 379) THEN 'America/New_York'
      WHEN st = 'KY' AND z3 BETWEEN 420 AND 424 THEN 'America/Chicago'
      WHEN st = 'MI' AND z3 = 498 THEN 'America/Menominee'
      WHEN st = 'ID' AND z3 BETWEEN 835 AND 838 THEN 'America/Los_Angeles'
      WHEN st = 'OR' AND z3 = 979 THEN 'America/Boise'
      WHEN st = 'ND' AND z3 = 586 THEN 'America/Denver'
      WHEN st = 'SD' AND z3 = 577 THEN 'America/Denver'
      WHEN st = 'NE' AND z3 BETWEEN 690 AND 693 THEN 'America/Denver'
      WHEN st = 'KS' AND z3 = 678 THEN 'America/Denver'
      ELSE timezone END;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.derive_store_region(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derive_store_region(text) TO service_role;