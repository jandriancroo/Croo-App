/**
 * Inventory gate — single source of truth for blocking inventory writes
 * at locations whose `inventory_enabled` flag is false.
 *
 * Mirrors the DB trigger `trg_inventory_counts_enforce_enabled`, but applied
 * earlier in the request lifecycle so sync layers (PFG, PA, deploy, pack
 * config seeder, pack selection backfill) skip disabled stores cleanly
 * instead of hitting a 500 from the trigger.
 */

/**
 * Fallback belt for the `locations.is_test_location` flag.
 *
 * The flag is the source of truth — mark a fake/QA store with
 * `is_test_location = true` and every gate below skips it. This id list stays
 * as a transition safety net so no store loses protection if the flag is ever
 * cleared by accident. Do NOT add new test stores here; set the flag instead.
 */
export const EXCLUDED_LOCATION_IDS: string[] = [
  "150cfede-666a-4b5f-ae01-5bfb7bb39635", // Sandbox #7777 (Beaumont) — test store
  "40a872fb-57b2-409d-947d-70e48948297d", // Sandbox (inactive clone target)
  "9a5c1e00-0000-4000-8000-000000000002", // Lite QA — Smoke Test (QA-LITE-01)
];

export function isExcludedLocation(locationId: string | null | undefined): boolean {
  return !!locationId && EXCLUDED_LOCATION_IDS.includes(locationId);
}

export interface InventoryGateResult {
  enabled: boolean;
  locationId: string;
  name: string | null;
}

/** Returns true when the location's inventory_enabled is explicitly true. */
export async function isInventoryEnabled(
  supabase: any,
  locationId: string | null | undefined,
): Promise<InventoryGateResult> {
  if (!locationId) return { enabled: false, locationId: "", name: null };
  if (isExcludedLocation(locationId)) {
    return { enabled: false, locationId, name: "excluded_location" };
  }
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, inventory_enabled")
    .eq("id", locationId)
    .maybeSingle();
  if (error || !data) return { enabled: false, locationId, name: null };
  return {
    enabled: data.inventory_enabled === true,
    locationId,
    name: data.name ?? null,
  };
}

/** Returns the subset of locationIds whose inventory_enabled is true. */
export async function filterEnabledLocations(
  supabase: any,
  locationIds: string[],
): Promise<Set<string>> {
  const candidates = (locationIds || []).filter((id) => !isExcludedLocation(id));
  if (candidates.length === 0) return new Set();
  const { data } = await supabase
    .from("locations")
    .select("id")
    .eq("inventory_enabled", true)
    .in("id", candidates);
  return new Set((data || []).map((r: any) => r.id));
}

/** Standard skip response — 200 with explicit skip reason. */
export function inventoryDisabledResponse(
  gate: InventoryGateResult,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      skipped: "inventory_disabled",
      locationId: gate.locationId,
      name: gate.name,
      message: `Inventory not enabled for location ${gate.name ?? gate.locationId}`,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
