
-- PERFORMANCE INDEXES (safe, IF NOT EXISTS)

-- Sales & labor cache
CREATE INDEX IF NOT EXISTS idx_sales_cache_location_date ON public.sales_cache (location_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_labor_cache_location_date ON public.labor_cache (location_id, labor_date);
CREATE INDEX IF NOT EXISTS idx_labor_cache_location_date_source ON public.labor_cache (location_id, labor_date, source);

-- Time punches
CREATE INDEX IF NOT EXISTS idx_time_punches_location_time ON public.time_punches (location_id, punch_time);
CREATE INDEX IF NOT EXISTS idx_time_punches_user_time ON public.time_punches (user_id, punch_time);
CREATE INDEX IF NOT EXISTS idx_time_punches_location_user ON public.time_punches (location_id, user_id);

-- Checklists
CREATE INDEX IF NOT EXISTS idx_checklist_submissions_checklist_location ON public.checklist_submissions (checklist_id, location_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_checklist_responses_submission ON public.checklist_responses (submission_id);
CREATE INDEX IF NOT EXISTS idx_checklist_responses_item ON public.checklist_responses (item_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON public.checklist_items (checklist_id);

-- Queues
CREATE INDEX IF NOT EXISTS idx_alert_queue_dedup ON public.alert_queue (dedup_key);
CREATE INDEX IF NOT EXISTS idx_alert_queue_unsent ON public.alert_queue (push_sent, created_at) WHERE push_sent = false;
CREATE INDEX IF NOT EXISTS idx_maintenance_queue_pending ON public.maintenance_queue (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_email_queue_pending ON public.email_queue (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_email_queue_type_location_date ON public.email_queue (email_type, location_id, target_date);

-- Logbook
CREATE INDEX IF NOT EXISTS idx_logbook_entries_location_date ON public.logbook_entries (location_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_logbook_entries_category_date ON public.logbook_entries (category_id, entry_date);

-- Alarm tasks
CREATE INDEX IF NOT EXISTS idx_temporary_tasks_alarm ON public.temporary_tasks (location_id, task_style, is_active) WHERE task_style = 'alarm' AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_alarm_completions_task_interval ON public.alarm_task_completions (task_id, interval_key);

-- User lookups
CREATE INDEX IF NOT EXISTS idx_user_locations_user ON public.user_locations (user_id);
CREATE INDEX IF NOT EXISTS idx_user_locations_location ON public.user_locations (location_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles (role);

-- Messages & chat
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON public.messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON public.chat_members (user_id);

-- Availability
CREATE INDEX IF NOT EXISTS idx_availability_requests_user_status ON public.availability_requests (user_id, status);
CREATE INDEX IF NOT EXISTS idx_availability_requests_location ON public.availability_requests (location_id, start_date);

-- Wages & tips
CREATE INDEX IF NOT EXISTS idx_wage_history_user_date ON public.wage_history (user_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_tips_location_date ON public.daily_tips (location_id, tip_date);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_user_notification_settings_user_location ON public.user_notification_settings (user_id, location_id);

-- Certs & writeups
CREATE INDEX IF NOT EXISTS idx_certifications_user ON public.certifications (user_id);
CREATE INDEX IF NOT EXISTS idx_certifications_expiration ON public.certifications (expiration_date) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_employee_writeups_employee ON public.employee_writeups (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_writeups_location ON public.employee_writeups (location_id);

-- Location hours
CREATE INDEX IF NOT EXISTS idx_location_hours_location_day ON public.location_hours (location_id, day_of_week);
