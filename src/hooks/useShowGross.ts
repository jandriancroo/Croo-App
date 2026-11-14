import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SHOW_GROSS_PREF_KEY, localShowGrossKey, readLocalShowGross, readShowGrossPref } from '@/lib/grossSales';

/**
 * Sales Summary "Show gross" toggle. Default OFF (net only).
 * Saved per user in profiles.ui_prefs.show_gross_sales; this device's localStorage is the
 * instant read and the fallback when the profile can't be reached.
 */
export function useShowGross(): [boolean, (next: boolean) => void] {
  const [uid, setUid] = useState<string | null>(null);
  const [show, setShow] = useState<boolean>(() => readLocalShowGross(typeof window !== 'undefined' ? window.localStorage : null, null));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth.user?.id ?? null;
        if (cancelled) return;
        setUid(id);
        setShow(readLocalShowGross(window.localStorage, id));
        if (!id) return;
        const { data } = await supabase.from('profiles').select('ui_prefs').eq('id', id).maybeSingle();
        if (cancelled) return;
        const saved = readShowGrossPref((data as { ui_prefs?: unknown } | null)?.ui_prefs);
        if (saved != null) {
          setShow(saved);
          try { window.localStorage.setItem(localShowGrossKey(id), saved ? '1' : '0'); } catch { /* ignore */ }
        }
      } catch {
        // keep the device value
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((next: boolean) => {
    setShow(next);
    try { window.localStorage.setItem(localShowGrossKey(uid), next ? '1' : '0'); } catch { /* ignore */ }
    if (!uid) return;
    (async () => {
      try {
        const { data } = await supabase.from('profiles').select('ui_prefs').eq('id', uid).maybeSingle();
        const prefs = ((data as { ui_prefs?: unknown } | null)?.ui_prefs ?? {}) as Record<string, unknown>;
        await supabase.from('profiles').update({ ui_prefs: { ...prefs, [SHOW_GROSS_PREF_KEY]: next } as never }).eq('id', uid);
      } catch (e) {
        console.warn('Could not save the gross toggle to the profile:', e);
      }
    })();
  }, [uid]);

  return [show, update];
}
