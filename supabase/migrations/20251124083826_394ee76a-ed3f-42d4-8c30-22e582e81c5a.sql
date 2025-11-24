-- Create logbook categories table
CREATE TABLE public.logbook_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create logbook fields table (customizable fields per category)
CREATE TABLE public.logbook_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.logbook_categories(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL, -- 'text', 'textarea', 'number', 'date', 'attachment'
  is_required BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create logbook entries table (one per day per category)
CREATE TABLE public.logbook_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.logbook_categories(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(category_id, entry_date)
);

-- Create logbook entry values table (field values for entries)
CREATE TABLE public.logbook_entry_values (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES public.logbook_entries(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.logbook_fields(id) ON DELETE CASCADE,
  value_text TEXT,
  value_number NUMERIC,
  value_date DATE,
  attachment_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.logbook_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_entry_values ENABLE ROW LEVEL SECURITY;

-- RLS Policies for logbook_categories
CREATE POLICY "Everyone can view active categories" ON public.logbook_categories
  FOR SELECT USING (is_active = true);

CREATE POLICY "Admins can manage categories" ON public.logbook_categories
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for logbook_fields
CREATE POLICY "Everyone can view fields" ON public.logbook_fields
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage fields" ON public.logbook_fields
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for logbook_entries
CREATE POLICY "Everyone can view entries" ON public.logbook_entries
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create entries" ON public.logbook_entries
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins and entry creators can update entries" ON public.logbook_entries
  FOR UPDATE USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role) OR 
    auth.uid() = created_by
  );

-- RLS Policies for logbook_entry_values
CREATE POLICY "Everyone can view entry values" ON public.logbook_entry_values
  FOR SELECT USING (true);

CREATE POLICY "Users can create entry values" ON public.logbook_entry_values
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.logbook_entries
      WHERE id = entry_id AND created_by = auth.uid()
    )
  );

CREATE POLICY "Admins and entry creators can update values" ON public.logbook_entry_values
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.logbook_entries e
      WHERE e.id = entry_id AND (
        has_role(auth.uid(), 'admin'::app_role) OR
        has_role(auth.uid(), 'manager'::app_role) OR
        e.created_by = auth.uid()
      )
    )
  );

-- Insert default categories
INSERT INTO public.logbook_categories (name, display_order) VALUES
  ('Online Refunds', 1),
  ('Cash Drawer', 2),
  ('Incidents', 3),
  ('Maintenance', 4),
  ('Notes', 5);

-- Insert default fields for Online Refunds
INSERT INTO public.logbook_fields (category_id, field_name, field_type, is_required, display_order)
SELECT id, 'Customer Name', 'text', true, 1 FROM public.logbook_categories WHERE name = 'Online Refunds'
UNION ALL
SELECT id, 'Date', 'date', true, 2 FROM public.logbook_categories WHERE name = 'Online Refunds'
UNION ALL
SELECT id, 'Last 4 of CC', 'text', true, 3 FROM public.logbook_categories WHERE name = 'Online Refunds'
UNION ALL
SELECT id, 'Reason', 'textarea', true, 4 FROM public.logbook_categories WHERE name = 'Online Refunds';

-- Create trigger for updated_at
CREATE TRIGGER update_logbook_entries_updated_at
  BEFORE UPDATE ON public.logbook_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_logbook_categories_updated_at
  BEFORE UPDATE ON public.logbook_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();