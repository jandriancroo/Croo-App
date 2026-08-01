import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SchedulePreferences {
  /** null = auto (compact on tablet widths) */
  compactView: boolean | null;
  /** Drag-and-drop templates bar. Default OFF for all users. */
  dragDropEnabled: boolean;
}

const CACHE_KEY = "schedule-prefs-cache";
const DEFAULTS: SchedulePreferences = { compactView: null, dragDropEnabled: false };

function readCache(): SchedulePreferences {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      compactView: typeof parsed.compactView === "boolean" ? parsed.compactView : null,
      dragDropEnabled: !!parsed.dragDropEnabled,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Per-USER Schedule view preferences, persisted in the backend
 * (`user_schedule_preferences`) so they follow the user across devices.
 * localStorage is only an instant-hydration cache.
 */
export function useSchedulePreferences() {
  const [prefs, setPrefs] = useState<SchedulePreferences>(readCache);

  const { data } = useQuery({
    queryKey: ["schedule-preferences"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SchedulePreferences | null> => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return null;
      const { data: row, error } = await supabase
        .from("user_schedule_preferences")
        .select("compact_view, drag_drop_enabled")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;
      if (!row) return DEFAULTS;
      return {
        compactView: typeof row.compact_view === "boolean" ? row.compact_view : null,
        dragDropEnabled: !!row.drag_drop_enabled,
      };
    },
  });

  useEffect(() => {
    if (!data) return;
    setPrefs(data);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {}
  }, [data]);

  const save = useCallback(async (patch: Partial<SchedulePreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;

    const payload: { user_id: string; compact_view?: boolean | null; drag_drop_enabled?: boolean } = { user_id: uid };
    if ("compactView" in patch) payload.compact_view = patch.compactView ?? null;
    if ("dragDropEnabled" in patch) payload.drag_drop_enabled = !!patch.dragDropEnabled;

    await supabase
      .from("user_schedule_preferences")
      .upsert(payload as any, { onConflict: "user_id" });
  }, []);

  return {
    compactView: prefs.compactView,
    dragDropEnabled: prefs.dragDropEnabled,
    setCompactView: (v: boolean) => save({ compactView: v }),
    setDragDropEnabled: (v: boolean) => save({ dragDropEnabled: v }),
  };
}
