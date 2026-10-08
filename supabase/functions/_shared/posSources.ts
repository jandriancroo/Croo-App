// _shared/posSources.ts
// The ONE server-side list of sales systems (POS). Order = priority when a
// store somehow has more than one active. Client mirror: src/lib/pos/liveSales.ts.

export const POS_SOURCES = ["qubeyond", "toast", "clover", "aloha"] as const;
export type PosSource = (typeof POS_SOURCES)[number];

// Which sales system this store actually runs on, or null if none is active.
// Never fall back to a vendor name when this returns null.
export async function getActivePosSource(supabase: any, locationId: string): Promise<PosSource | null> {
  try {
    const { data } = await supabase
      .from("location_integrations")
      .select("integration_type")
      .eq("location_id", locationId)
      .eq("is_active", true)
      .in("integration_type", POS_SOURCES as unknown as string[]);
    const found = (data ?? []).map((r: any) => r.integration_type as string);
    for (const key of POS_SOURCES) {
      if (found.includes(key)) return key;
    }
  } catch {
    // fall through
  }
  return null;
}
