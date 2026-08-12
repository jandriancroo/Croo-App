CREATE TABLE public.watch_devices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_kind text NOT NULL DEFAULT 'watch',
  label text NOT NULL DEFAULT 'Apple Watch',
  token_hash text NOT NULL UNIQUE,
  token_hint text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_watch_devices_location ON public.watch_devices(location_id);
CREATE INDEX idx_watch_devices_org ON public.watch_devices(organization_id);

GRANT SELECT ON public.watch_devices TO authenticated;
GRANT ALL ON public.watch_devices TO service_role;

ALTER TABLE public.watch_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can view watch devices"
ON public.watch_devices FOR SELECT TO authenticated
USING (
  public.is_org_admin(auth.uid(), organization_id)
  OR public.is_super_admin(auth.uid())
);