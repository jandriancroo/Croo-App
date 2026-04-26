
-- ============================================
-- STEP 1: Drop 25 unused indexes (zero idx_scan, not unique, not primary)
-- ============================================
DROP INDEX IF EXISTS public.idx_alert_queue_dedup;
DROP INDEX IF EXISTS public.idx_opus_resource_title_trgm;
DROP INDEX IF EXISTS public.idx_recipe_blueprints_r365_name;
DROP INDEX IF EXISTS public.idx_sales_cache_projections;
DROP INDEX IF EXISTS public.idx_vendor_gap_alerts_reported_locations;
DROP INDEX IF EXISTS public.idx_profiles_display_order;
DROP INDEX IF EXISTS public.idx_job_applications_listing;
DROP INDEX IF EXISTS public.idx_staging_brand;
DROP INDEX IF EXISTS public.locations_store_number_idx;
DROP INDEX IF EXISTS public.idx_theo_helpful_feedback_location_date;
DROP INDEX IF EXISTS public.idx_chat_members_pinned;
DROP INDEX IF EXISTS public.idx_applicant_flags_created_at;
DROP INDEX IF EXISTS public.idx_applicant_notes_created_at;
DROP INDEX IF EXISTS public.idx_auto_punch_events_location;
DROP INDEX IF EXISTS public.idx_qr_task_reports_unacknowledged;
DROP INDEX IF EXISTS public.idx_schedule_events_meeting;
DROP INDEX IF EXISTS public.idx_writeup_audit_location;
DROP INDEX IF EXISTS public.idx_locations_vendor_territory;
DROP INDEX IF EXISTS public.idx_logbook_audit_entry_type;
DROP INDEX IF EXISTS public.idx_messages_deleted;
DROP INDEX IF EXISTS public.idx_job_listings_location;
DROP INDEX IF EXISTS public.idx_job_applications_source;
DROP INDEX IF EXISTS public.idx_vendor_sku_health_bid_list_lookup;
DROP INDEX IF EXISTS public.idx_inventory_items_attention;
DROP INDEX IF EXISTS public.idx_email_send_log_created;

-- ============================================
-- STEP 2: Add 4 targeted indexes on hot FK columns
-- ============================================
CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_schedule_id 
  ON public.scheduled_shifts(schedule_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_user_id 
  ON public.scheduled_shifts(user_id);

CREATE INDEX IF NOT EXISTS idx_checklist_responses_submission_id 
  ON public.checklist_responses(submission_id);

CREATE INDEX IF NOT EXISTS idx_logbook_entry_values_entry_id 
  ON public.logbook_entry_values(entry_id);
