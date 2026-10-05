// THE ONE time_punches insert. Both Quick Punch dialogs and Theo's Confirm call it; it saves exactly the rows handed to it.
import { supabase } from '@/integrations/supabase/client';

export type PunchRow = {
  user_id: string; punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end'; punch_time: string;
  location_id: string | undefined; created_by?: string; notes?: string; shift_id?: string | null;
};

/** Insert the rows (one call). Throws the database error. */
export async function savePunches(rows: PunchRow | PunchRow[]): Promise<void> {
  const { error } = await supabase.from('time_punches').insert(rows as any);
  if (error) throw error;
}

/** Theo only: insert one punch and read back its id and the shift the database attached. */
export async function savePunchReturning(row: PunchRow): Promise<{ id: string; shift_id: string | null; created_at: string }> {
  const { data, error } = await supabase.from('time_punches').insert(row as any).select('id, shift_id, created_at').single();
  if (error) throw error;
  return data as any;
}

/** Theo's Undo: delete exactly one punch by id (the database's manager delete rule applies). */
export async function deletePunch(id: string): Promise<void> {
  const { error } = await supabase.from('time_punches').delete().eq('id', id);
  if (error) throw error;
}

/** Theo's Undo: delete a placeholder shift, only when it is still a placeholder. */
export async function deletePlaceholderShift(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('scheduled_shifts').delete().eq('id', id).eq('is_phantom', true).select('id');
  if (error) return false;
  return (data?.length ?? 0) === 1;
}
