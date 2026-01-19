import { supabase } from '@/integrations/supabase/client';

/**
 * Recalculates labor cache for a specific date at a location.
 * Call this after editing, adding, or deleting punches to keep labor_cache in sync.
 */
export async function recalculateLaborForDate(
  locationId: string,
  date: string // YYYY-MM-DD format
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[laborCacheUtils] Triggering labor recalculation for', date, 'at location', locationId);
    
    const { data, error } = await supabase.functions.invoke('backfill-punch-labor', {
      body: {
        locationId,
        targetDate: date,
      },
    });

    if (error) {
      console.error('[laborCacheUtils] Failed to recalculate labor:', error);
      return { success: false, error: error.message };
    }

    console.log('[laborCacheUtils] Labor recalculated for', date, data);
    return { success: true };
  } catch (err) {
    console.error('[laborCacheUtils] Exception recalculating labor:', err);
    return { success: false, error: String(err) };
  }
}
