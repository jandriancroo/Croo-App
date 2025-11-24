-- Create enum for roles
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'team_member');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL DEFAULT 'team_member',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, role)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Helper function to get user's highest role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS public.app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY 
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'manager' THEN 2
      WHEN 'team_member' THEN 3
    END
  LIMIT 1
$$;

-- RLS Policies for user_roles
CREATE POLICY "Users can view all roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can manage roles"
  ON public.user_roles
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Update checklists RLS to only allow admins to create/edit
DROP POLICY IF EXISTS "Authenticated users can create checklists" ON public.checklists;
DROP POLICY IF EXISTS "Users can update their own checklists" ON public.checklists;

CREATE POLICY "Only admins can create checklists"
  ON public.checklists
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update checklists"
  ON public.checklists
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Update checklist_items RLS
DROP POLICY IF EXISTS "Users can manage items for their checklists" ON public.checklist_items;

CREATE POLICY "Only admins can manage checklist items"
  ON public.checklist_items
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger to assign default role to new users
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'team_member');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();