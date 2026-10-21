import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  DEFAULT_SECTION_ORDER, getSectionOrder, saveSectionOrder, type SectionKey,
} from '@/components/dashboard/EditDashboardDialog';

const PREF_KEY = 'dash_section_order';

/** Save the section order to this device AND the user's profile so it follows them everywhere. */
export async function persistSectionOrder(locationId: string, order: SectionKey[]) {
  saveSectionOrder(locationId, order);
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    const { data } = await supabase.from('profiles').select('ui_prefs').eq('id', uid).maybeSingle();
    const prefs = ((data as any)?.ui_prefs ?? {}) as Record<string, any>;
    const orders = { ...(prefs[PREF_KEY] ?? {}), [locationId]: order };
    await supabase.from('profiles').update({ ui_prefs: { ...prefs, [PREF_KEY]: orders } } as any).eq('id', uid);
  } catch (e) {
    console.error('Could not save dashboard layout to profile:', e);
  }
}

/**
 * Section order for a location: instant local read, then the saved per-user value from the
 * profile wins. If the profile has nothing yet but this device does, the device value is
 * pushed up so the layout follows the user to other devices.
 */
export function useSectionOrder(locationId: string | undefined): SectionKey[] {
  const [order, setOrder] = useState<SectionKey[]>(() =>
    locationId ? getSectionOrder(locationId) : DEFAULT_SECTION_ORDER
  );

  useEffect(() => {
    if (!locationId) { setOrder(DEFAULT_SECTION_ORDER); return; }
    setOrder(getSectionOrder(locationId));
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid || cancelled) return;
        const { data } = await supabase.from('profiles').select('ui_prefs').eq('id', uid).maybeSingle();
        if (cancelled) return;
        const server = (data as any)?.ui_prefs?.[PREF_KEY]?.[locationId];
        if (Array.isArray(server) && server.length) {
          saveSectionOrder(locationId, server);
          setOrder(getSectionOrder(locationId));
        } else {
          const local = localStorage.getItem(`dashboard-section-order-${locationId}`);
          if (local) persistSectionOrder(locationId, JSON.parse(local));
        }
      } catch (e) {
        console.error('Could not load dashboard layout from profile:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [locationId]);

  return order;
}
