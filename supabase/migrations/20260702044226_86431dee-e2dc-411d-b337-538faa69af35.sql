INSERT INTO public.organizations (id, name, slug, brand_id)
VALUES ('9a5c1e00-0000-4000-8000-000000000001', 'Lite QA Org', 'lite-qa-org', '5f805404-cc7b-454b-a994-fe5901c32e6a')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.locations (id, name, organization_id, address, inventory_mode, is_active, store_number)
VALUES (
  '9a5c1e00-0000-4000-8000-000000000002',
  'Lite QA — Smoke Test',
  '9a5c1e00-0000-4000-8000-000000000001',
  '100 Test St, Reno, NV 89501',
  'lite',
  true,
  'QA-LITE-01'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.location_settings (location_id, timezone, hours_open, hours_close)
VALUES ('9a5c1e00-0000-4000-8000-000000000002', 'America/Los_Angeles', '10:00', '22:00')
ON CONFLICT (location_id) DO NOTHING;