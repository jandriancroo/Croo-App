import type { ScheduleFormValue } from '@/lib/checklistScheduleForm';

export type TemplateType = 'standard' | 'dynamic' | 'training';
export type LegacyFrequency = 'daily' | 'weekly' | 'monthly' | 'single_day';

/** Every checklist-level setting the editor shows. Pages own load/save. */
export interface ChecklistEditorSettings {
  title: string;
  description: string;
  templateType: TemplateType;
  /** Dynamic only (Standard uses `schedule`). */
  frequency: LegacyFrequency;
  scheduledDate: string;
  visibleDaysBeforeMonthEnd: number | null;
  schedule: ScheduleFormValue;
  dueByTime: string;
  lockUntilTime: string;
  lockTimeEnabled: boolean;
  selectedRoles: string[];
  selectedUserIds: string[];
  enableAmPmDivision: boolean;
  positionFilteringEnabled: boolean;
}
