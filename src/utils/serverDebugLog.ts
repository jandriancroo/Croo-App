import { supabase } from '@/integrations/supabase/client';

/**
 * Fire-and-forget server-side debug log. Writes to public.client_debug_logs
 * so we can query issues (multi-photo uploads, autosave failures, etc.)
 * without needing access to the user's browser console.
 *
 * Rows auto-purge after 7 days via purge_old_client_debug_logs().
 */
export function serverDebugLog(
  tag: string,
  fields: {
    userId?: string | null;
    locationId?: string | null;
    submissionId?: string | null;
    itemId?: string | null;
    payload?: Record<string, any>;
  } = {}
): void {
  try {
    void supabase
      .from('client_debug_logs')
      .insert({
        tag,
        user_id: fields.userId ?? null,
        location_id: fields.locationId ?? null,
        submission_id: fields.submissionId ?? null,
        item_id: fields.itemId ?? null,
        payload: fields.payload ?? null,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
      .then(({ error }) => {
        if (error) console.warn('[serverDebugLog] insert failed', error.message);
      });
  } catch (e) {
    // Never let logging break the app
    console.warn('[serverDebugLog] threw', e);
  }
}
