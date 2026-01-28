-- Add column to track which rejection email template was sent
ALTER TABLE public.job_applications 
ADD COLUMN rejection_template_id uuid REFERENCES public.rejection_email_templates(id);

-- Add column to track when rejection email was sent
ALTER TABLE public.job_applications 
ADD COLUMN rejection_email_sent_at timestamptz;

-- Create index for efficient filtering/sorting
CREATE INDEX idx_job_applications_rejection_template ON public.job_applications(rejection_template_id) WHERE rejection_template_id IS NOT NULL;