import { supabase } from "@/integrations/supabase/client";

/**
 * POS-neutral live sales refresh.
 *
 * Finds whichever sales system a store actually uses, asks it to refresh today,
 * then reads the normalized result back out of the shared sales cache. Screens
 * never need to know which vendor a brand runs on.
 */
const POS_FUNCTIONS: Record<string, string> = {
  qubeyond: "fetch-qubeyond-sales",
  clover: "clover-sync",
  aloha: "aloha-sync",
};

export async function getActivePosType(locationId: string): Promise<string | null> {
  const { data } = await supabase
    .from("location_integrations")
    .select("integration_type")
    .eq("location_id", locationId)
    .eq("is_active", true)
    .in("integration_type", Object.keys(POS_FUNCTIONS));

  const found = (data || []).map((r: { integration_type: string }) => r.integration_type);
  // Deterministic preference order when a store has more than one active.
  for (const key of ["qubeyond", "clover", "aloha"]) {
    if (found.includes(key)) return key;
  }
  return null;
}

function todayInTimezone(timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Refreshes today's sales through the store's own sales system and returns
 * today's net sales, or null when nothing usable came back.
 */
export async function refreshLiveSalesForToday(
  locationId: string,
  timezone = "America/Los_Angeles"
): Promise<number | null> {
  const posType = await getActivePosType(locationId);
  if (!posType) return null;

  const fnName = POS_FUNCTIONS[posType];

  if (posType === "qubeyond") {
    const { data, error } = await supabase.functions.invoke(fnName, {
      body: { locationId },
    });
    if (!error && data && typeof data.daily === "number" && data.daily > 0) {
      return data.daily;
    }
  } else {
    const { error } = await supabase.functions.invoke(fnName, {
      body: { action: "sync_today", locationId },
    });
    if (error) return null;
  }

  const { data: cached } = await supabase
    .from("sales_cache")
    .select("net_sales")
    .eq("location_id", locationId)
    .eq("sale_date", todayInTimezone(timezone))
    .maybeSingle();

  const net = Number(cached?.net_sales ?? 0);
  return net > 0 ? net : null;
}
