
-- Create job_listings table
CREATE TABLE public.job_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  template_id UUID REFERENCES public.job_application_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  pay_min NUMERIC,
  pay_max NUMERIC,
  pay_type TEXT NOT NULL DEFAULT 'hourly',
  status TEXT NOT NULL DEFAULT 'draft',
  syndication_enabled BOOLEAN NOT NULL DEFAULT false,
  slug TEXT NOT NULL,
  posted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, slug)
);

-- Create indexes
CREATE INDEX idx_job_listings_org ON public.job_listings(organization_id);
CREATE INDEX idx_job_listings_location ON public.job_listings(location_id);
CREATE INDEX idx_job_listings_status ON public.job_listings(status);
CREATE INDEX idx_job_listings_syndication ON public.job_listings(syndication_enabled, status) WHERE syndication_enabled = true AND status = 'active';

-- Enable RLS
ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;

-- RLS policies for job_listings
CREATE POLICY "Org members can view job listings"
  ON public.job_listings FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can create job listings"
  ON public.job_listings FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_org_admin(auth.uid(), organization_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.user_locations ul ON ul.user_id = ur.user_id
      JOIN public.locations l ON l.id = ul.location_id
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'manager', 'general_manager')
        AND l.organization_id = organization_id
    )
  );

CREATE POLICY "Admins can update job listings"
  ON public.job_listings FOR UPDATE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_org_admin(auth.uid(), organization_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.user_locations ul ON ul.user_id = ur.user_id
      JOIN public.locations l ON l.id = ul.location_id
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'manager', 'general_manager')
        AND l.organization_id = organization_id
    )
  );

CREATE POLICY "Admins can delete job listings"
  ON public.job_listings FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_org_admin(auth.uid(), organization_id)
  );

-- Public read for active listings (for XML feed / public pages)
CREATE POLICY "Public can view active listings"
  ON public.job_listings FOR SELECT TO anon
  USING (status = 'active' AND posted_at <= now() AND (expires_at IS NULL OR expires_at > now()));

-- Create job_syndication_logs table
CREATE TABLE public.job_syndication_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_listing_id UUID NOT NULL REFERENCES public.job_listings(id) ON DELETE CASCADE,
  board_name TEXT NOT NULL,
  feed_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_crawled_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_listing_id, board_name)
);

ALTER TABLE public.job_syndication_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view syndication logs"
  ON public.job_syndication_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.job_listings jl
      WHERE jl.id = job_listing_id
        AND public.is_org_member(auth.uid(), jl.organization_id)
    )
  );

CREATE POLICY "Admins can manage syndication logs"
  ON public.job_syndication_logs FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.job_listings jl
      WHERE jl.id = job_listing_id
        AND (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), jl.organization_id))
    )
  );

-- Add source tracking to job_applications
ALTER TABLE public.job_applications 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS job_listing_id UUID REFERENCES public.job_listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_applications_source ON public.job_applications(source);
CREATE INDEX IF NOT EXISTS idx_job_applications_listing ON public.job_applications(job_listing_id);

-- Updated_at triggers
CREATE TRIGGER update_job_listings_updated_at
  BEFORE UPDATE ON public.job_listings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_job_syndication_logs_updated_at
  BEFORE UPDATE ON public.job_syndication_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
