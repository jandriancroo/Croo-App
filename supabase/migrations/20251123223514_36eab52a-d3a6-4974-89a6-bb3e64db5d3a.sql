-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'staff',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Create checklists table
CREATE TABLE public.checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active checklists"
  ON public.checklists FOR SELECT
  USING (is_active = true);

CREATE POLICY "Authenticated users can create checklists"
  ON public.checklists FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own checklists"
  ON public.checklists FOR UPDATE
  USING (auth.uid() = created_by);

-- Create checklist_items table
CREATE TABLE public.checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('text', 'multiple_choice', 'image')),
  options JSONB, -- For multiple choice options
  order_index INTEGER NOT NULL,
  is_required BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view checklist items"
  ON public.checklist_items FOR SELECT
  USING (true);

CREATE POLICY "Users can manage items for their checklists"
  ON public.checklist_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.checklists 
      WHERE id = checklist_id AND created_by = auth.uid()
    )
  );

-- Create checklist_submissions table
CREATE TABLE public.checklist_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

ALTER TABLE public.checklist_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all submissions"
  ON public.checklist_submissions FOR SELECT
  USING (true);

CREATE POLICY "Users can create submissions"
  ON public.checklist_submissions FOR INSERT
  WITH CHECK (auth.uid() = submitted_by);

-- Create checklist_responses table
CREATE TABLE public.checklist_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.checklist_submissions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.checklist_items(id) ON DELETE CASCADE,
  response_text TEXT,
  response_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.checklist_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view responses for submissions"
  ON public.checklist_responses FOR SELECT
  USING (true);

CREATE POLICY "Users can create responses"
  ON public.checklist_responses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.checklist_submissions 
      WHERE id = submission_id AND submitted_by = auth.uid()
    )
  );

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_checklists_updated_at
  BEFORE UPDATE ON public.checklists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Create storage bucket for checklist images
INSERT INTO storage.buckets (id, name, public)
VALUES ('checklist-images', 'checklist-images', true);

-- Storage policies
CREATE POLICY "Anyone can view checklist images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'checklist-images');

CREATE POLICY "Authenticated users can upload images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'checklist-images' AND
    auth.uid() IS NOT NULL
  );