-- Add super_admin and org_admin role notification settings
INSERT INTO role_notification_settings (role, notification_type, notification_label, enabled)
VALUES 
  ('super_admin', 'overdue_checklists', 'Overdue Checklists', true),
  ('super_admin', 'late_arrivals', 'Late Arrivals', true),
  ('super_admin', 'schedule_updates', 'Schedule Updates', true),
  ('super_admin', 'shift_approvals', 'Shift Approvals', true),
  ('super_admin', 'certification_expiring', 'Certification Expiring', true),
  ('super_admin', 'announcements', 'Announcements', true),
  ('super_admin', 'chat_messages', 'Chat Messages', true),
  ('org_admin', 'overdue_checklists', 'Overdue Checklists', true),
  ('org_admin', 'late_arrivals', 'Late Arrivals', true),
  ('org_admin', 'schedule_updates', 'Schedule Updates', true),
  ('org_admin', 'shift_approvals', 'Shift Approvals', true),
  ('org_admin', 'certification_expiring', 'Certification Expiring', true),
  ('org_admin', 'announcements', 'Announcements', true),
  ('org_admin', 'chat_messages', 'Chat Messages', true)
ON CONFLICT DO NOTHING;