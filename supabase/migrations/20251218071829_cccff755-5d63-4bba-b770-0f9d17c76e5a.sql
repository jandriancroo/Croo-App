-- Add brand_admin to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'brand_admin';

-- Create brands table
CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- Create brand_members table
CREATE TABLE public.brand_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand_role text NOT NULL DEFAULT 'member',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(brand_id, user_id)
);

ALTER TABLE public.brand_members ENABLE ROW LEVEL SECURITY;

-- Add brand_id to organizations (nullable for mom & pop shops)
ALTER TABLE public.organizations ADD COLUMN brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL;

-- Helper function: check if user is brand admin for a specific brand
CREATE OR REPLACE FUNCTION public.is_brand_admin(_user_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.brand_members
    WHERE user_id = _user_id 
      AND brand_id = _brand_id 
      AND brand_role = 'admin'
  )
$$;

-- Helper function: check if user has brand access (is brand admin for org's brand)
CREATE OR REPLACE FUNCTION public.has_brand_access(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    JOIN public.brand_members bm ON bm.brand_id = o.brand_id
    WHERE o.id = _organization_id 
      AND bm.user_id = _user_id 
      AND bm.brand_role = 'admin'
  )
$$;

-- Helper: check brand access via location
CREATE OR REPLACE FUNCTION public.has_brand_access_via_location(_user_id uuid, _location_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.locations l
    JOIN public.organizations o ON o.id = l.organization_id
    JOIN public.brand_members bm ON bm.brand_id = o.brand_id
    WHERE l.id = _location_id 
      AND bm.user_id = _user_id 
      AND bm.brand_role = 'admin'
  )
$$;

-- RLS Policies for brands table
CREATE POLICY "Super admins can manage all brands"
ON public.brands FOR ALL
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Brand admins can view their brands"
ON public.brands FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.brand_members
    WHERE brand_id = brands.id AND user_id = auth.uid()
  )
);

-- RLS Policies for brand_members table
CREATE POLICY "Super admins can manage all brand members"
ON public.brand_members FOR ALL
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Brand admins can view members of their brand"
ON public.brand_members FOR SELECT
USING (
  is_brand_admin(auth.uid(), brand_id)
);

-- Update organizations SELECT policy to include brand admins
CREATE POLICY "Brand admins can view orgs in their brand"
ON public.organizations FOR SELECT
USING (
  brand_id IS NOT NULL AND 
  EXISTS (
    SELECT 1 FROM public.brand_members
    WHERE brand_id = organizations.brand_id AND user_id = auth.uid()
  )
);

-- Update locations SELECT policy to include brand admins
CREATE POLICY "Brand admins can view locations in their brand"
ON public.locations FOR SELECT
USING (
  organization_id IS NOT NULL AND
  has_brand_access(auth.uid(), organization_id)
);

-- Trigger for updated_at on brands
CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();