import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";

/**
 * Invisible component that syncs OPUS library into Theo's brain on dashboard load.
 * Also acts as a session heartbeat to keep the OPUS cookie warm.
 * Renders nothing — pure side-effect.
 */
export function OpusBackgroundSync() {
  const { currentLocation } = useAppLocation();
  const syncTriggered = useRef(false);

  useEffect(() => {
    if (!currentLocation?.id || syncTriggered.current) return;
    syncTriggered.current = true;

    const syncOpus = async () => {
      try {
        const { data: integration } = await supabase
          .from("location_integrations")
          .select("id")
          .eq("location_id", currentLocation.id)
          .eq("integration_type", "opus")
          .eq("is_active", true)
          .maybeSingle();

        if (!integration) return;

        await supabase.functions.invoke("opus-service", {
          body: { action: "fetch_library", location_id: currentLocation.id },
        });
        console.log("[OPUS] Background library sync completed");
      } catch (e) {
        console.warn("[OPUS] Background sync failed (non-fatal):", e);
      }
    };

    const timer = setTimeout(syncOpus, 3000);
    return () => clearTimeout(timer);
  }, [currentLocation?.id]);

  return null;
}
