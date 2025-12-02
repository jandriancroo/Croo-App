
-- Create role notification settings table
CREATE TABLE public.role_notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  notification_type text NOT NULL,
  notification_label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role, notification_type)
);

-- Enable RLS
ALTER TABLE public.role_notification_settings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can manage role notification settings"
  ON public.role_notification_settings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view role notification settings"
  ON public.role_notification_settings FOR SELECT
  USING (true);

-- Seed default settings for all roles and notification types
INSERT INTO public.role_notification_settings (role, notification_type, notification_label, enabled) VALUES
  -- Admin notifications (all enabled)
  ('admin', 'overdue_checklists', 'Overdue Checklists', true),
  ('admin', 'late_arrivals', 'Late Arrivals', true),
  ('admin', 'announcements', 'Announcements', true),
  ('admin', 'chat_messages', 'Chat Messages', true),
  ('admin', 'schedule_updates', 'Schedule Updates', true),
  ('admin', 'shift_approvals', 'Shift Approvals', true),
  ('admin', 'certification_expiring', 'Certification Expiring', true),
  -- Manager notifications (most enabled)
  ('manager', 'overdue_checklists', 'Overdue Checklists', true),
  ('manager', 'late_arrivals', 'Late Arrivals', true),
  ('manager', 'announcements', 'Announcements', true),
  ('manager', 'chat_messages', 'Chat Messages', true),
  ('manager', 'schedule_updates', 'Schedule Updates', true),
  ('manager', 'shift_approvals', 'Shift Approvals', true),
  ('manager', 'certification_expiring', 'Certification Expiring', true),
  -- Team member notifications (limited)
  ('team_member', 'overdue_checklists', 'Overdue Checklists', false),
  ('team_member', 'late_arrivals', 'Late Arrivals', false),
  ('team_member', 'announcements', 'Announcements', true),
  ('team_member', 'chat_messages', 'Chat Messages', true),
  ('team_member', 'schedule_updates', 'Schedule Updates', true),
  ('team_member', 'shift_approvals', 'Shift Approvals', true),
  ('team_member', 'certification_expiring', 'Certification Expiring', true);

-- Add trigger for updated_at
CREATE TRIGGER update_role_notification_settings_updated_at
  BEFORE UPDATE ON public.role_notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
