// Keep byte-identical to src/lib/notificationDefaults.ts.
const EMAIL_ON = new Set(['announcements', 'shift_reminders', 'certification_expiring',
  'new_job_application', 'time_off_weekly_digest', 'hiring_interview_response', 'hiring_doc_uploaded']);
export const defaultEmailEnabled = (key: string): boolean => EMAIL_ON.has(key);
export const EMAIL_ALIASES: Record<string, string> = {
  late_arrival: 'late_arrivals', toast_late_clock_in: 'late_arrivals', no_call_no_show: 'late_arrivals',
  certificate_expiry: 'certification_expiring', schedule_published: 'schedule_updates',
  schedule_approval: 'schedule_updates', schedule_approved: 'schedule_updates',
  shift_offer: 'shift_approvals', drawer_count: 'cash_drawer_count', safe_count: 'cash_safe_count',
  bank_deposit: 'cash_bank_deposit', logbook_bank_deposit: 'cash_bank_deposit',
  overdue_checklist: 'overdue_checklists', monthly_checklist: 'overdue_checklists',
};
export const emailSettingsKey = (type: string): string => EMAIL_ALIASES[type] ?? type;
export const EMAIL_FALLBACK_KEYS = new Set(['late_arrivals', 'schedule_updates', 'shift_reminders',
  'shift_approvals', 'announcements', 'employee_write_up', 'read_and_sign',
  'certification_expiring', 'training_approval']);