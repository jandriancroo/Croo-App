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
 * Hard, named exclusions — never touched by vendor syncs / seeders regardless
 * of the `inventory_enabled` flag. Sandbox store #7777 lives here because it
 * is a test store whose flag is intentionally left on for UI work.
 */
export const EXCLUDED_LOCATION_IDS: string[] = [
  "150cfede-666a-4b5f-ae01-5bfb7bb39635", // Sandbox #7777 (Beaumont) — test store
  "40a872fb-57b2-409d-947d-70e48948297d", // Sandbox (inactive clone target)
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
  if (!locationIds || locationIds.length === 0) return new Set();
  const { data } = await supabase
    .from("locations")
    .select("id")
    .eq("inventory_enabled", true)
    .in("id", locationIds);
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
