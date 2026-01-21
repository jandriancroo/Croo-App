-- Create rejection email templates table
CREATE TABLE public.rejection_email_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.rejection_email_templates ENABLE ROW LEVEL SECURITY;

-- Create helper function to check if user can manage rejection templates
CREATE OR REPLACE FUNCTION public.can_manage_rejection_templates(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN locations l ON ur.location_id = l.id
        WHERE ur.user_id = _user_id
          AND ur.role IN ('admin', 'org_admin', 'super_admin', 'manager', 'general_manager')
          AND l.organization_id = _organization_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RLS policies
CREATE POLICY "Users can view rejection templates for their org"
ON public.rejection_email_templates
FOR SELECT
USING (
    can_manage_rejection_templates(auth.uid(), organization_id)
);

CREATE POLICY "Users can create rejection templates for their org"
ON public.rejection_email_templates
FOR INSERT
WITH CHECK (
    can_manage_rejection_templates(auth.uid(), organization_id)
);

CREATE POLICY "Users can update rejection templates for their org"
ON public.rejection_email_templates
FOR UPDATE
USING (
    can_manage_rejection_templates(auth.uid(), organization_id)
);

CREATE POLICY "Users can delete rejection templates for their org"
ON public.rejection_email_templates
FOR DELETE
USING (
    can_manage_rejection_templates(auth.uid(), organization_id)
);

-- Create updated_at trigger
CREATE TRIGGER update_rejection_email_templates_updated_at
BEFORE UPDATE ON public.rejection_email_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();