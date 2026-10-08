import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export type RestoreTarget = 'original' | 'start_of_today';
export interface RestorePreview { shifts_affected: number; people: number; skipped_past: number; skipped_punched: number }

const FRIENDLY: Record<string, string> = {
  week_is_live: 'This week is live. Edit and tap Update; to revert, withdraw the week first.',
  no_original: "No original yet: this week hasn't been posted.",
  nothing_to_restore: 'Nothing to restore. The schedule already matches.',
  nothing_to_undo: 'Nothing to undo.',
  changed_since: 'That shift was changed again since. Undo the newer change first or edit it by hand.',
  cannot_undo: "Can't undo: it touches a day that's already worked or a shift with punches.",
};

export function friendlyScheduleError(e: any): string {
  const msg = String(e?.message || e || '');
  const key = Object.keys(FRIENDLY).find((k) => msg.includes(k));
  return key ? FRIENDLY[key] : msg || 'Something went wrong';
}

/**
 * The one client path to schedule Undo / Revert (rpc undo_schedule_change / restore_schedule).
 * `version` is anything that changes when shifts change (e.g. the shifts array) so the preview refreshes.
 */
export function useScheduleRestore(scheduleId: string | null | undefined, opts: { version?: unknown; onChanged?: () => void } = {}) {
  const qc = useQueryClient();

  const undoQ = useQuery({
    queryKey: ['schedule-undo', scheduleId],
    enabled: !!scheduleId,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('undo_schedule_change', { _schedule_id: scheduleId!, _dry_run: true });
      if (error) return null;
      return (data as { description: string } | null) ?? null;
    },
  });

  useEffect(() => {
    if (scheduleId) qc.invalidateQueries({ queryKey: ['schedule-undo', scheduleId] });
  }, [opts.version, scheduleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const after = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['schedule-undo', scheduleId] }),
      qc.invalidateQueries({ queryKey: ['schedule-history', scheduleId] }),
    ]);
    opts.onChanged?.();
  };

  const undo = async (): Promise<boolean> => {
    if (!scheduleId) return false;
    const { data, error } = await supabase.rpc('undo_schedule_change', { _schedule_id: scheduleId, _dry_run: false });
    if (error) { toast.error(friendlyScheduleError(error)); await after(); return false; }
    toast.success(`Undid: ${(data as any)?.description ?? 'last change'}`);
    await after();
    return true;
  };

  /** Dry run; returns null and toasts when there's nothing to do. */
  const restorePreview = async (target: RestoreTarget): Promise<RestorePreview | null> => {
    if (!scheduleId) return null;
    const { data, error } = await supabase.rpc('restore_schedule', { _schedule_id: scheduleId, _target: target, _dry_run: true });
    if (error) { toast.error(friendlyScheduleError(error)); return null; }
    return data as unknown as RestorePreview;
  };

  const restore = async (target: RestoreTarget): Promise<boolean> => {
    if (!scheduleId) return false;
    const { data, error } = await supabase.rpc('restore_schedule', { _schedule_id: scheduleId, _target: target, _dry_run: false });
    if (error) { toast.error(friendlyScheduleError(error)); return false; }
    const r = data as unknown as RestorePreview;
    toast.success(`Reverted ${r.shifts_affected} shift${r.shifts_affected === 1 ? '' : 's'}`);
    await after();
    return true;
  };

  return { undoPreview: undoQ.data ?? null, undo, restorePreview, restore };
}
