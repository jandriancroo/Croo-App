-- Move BMoe from Sierra Foods Group's Reno to Nevada Foods Group's Reno
-- (his email is @nevadafoodsgroup.com but membership was on the wrong duplicate Reno)
DELETE FROM public.user_locations
WHERE user_id = '50b01020-4d36-4599-8d2d-0760625d458a'
  AND location_id = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d';

INSERT INTO public.user_locations (user_id, location_id)
VALUES ('50b01020-4d36-4599-8d2d-0760625d458a', '32379593-8255-427b-8ebf-96502f69ca8f')
ON CONFLICT DO NOTHING;