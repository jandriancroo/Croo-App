import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves the brand_id for a given location via location → organization → brand chain.
 * Returns null if the chain is broken.
 */
export async function resolveBrandId(locationId: string): Promise<string | null> {
  const { data: loc } = await supabase
    .from("locations")
    .select("organization_id")
    .eq("id", locationId)
    .maybeSingle();
  if (!loc?.organization_id) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("brand_id")
    .eq("id", loc.organization_id)
    .maybeSingle();
  return org?.brand_id || null;
}

/**
 * Fetches blueprints for a location using inheritance merge:
 * brand-level blueprints are the base catalog, and local blueprints layer on top.
 * Local wins on id conflicts, but local prep recipes do not hide the brand catalog.
 */
export async function fetchBlueprintsForLocation(
  locationId: string,
  selectFields: string = "id, name, category, yield_qty, yield_unit, source, catalog_section"
) {
  const brandId = await resolveBrandId(locationId);

  const [localRes, brandRes] = await Promise.all([
    supabase
      .from("recipe_blueprints" as any)
      .select(selectFields)
      .eq("location_id", locationId)
      .eq("is_active", true)
      .order("name"),
    brandId
      ? supabase
          .from("recipe_blueprints" as any)
          .select(selectFields)
          .eq("brand_id", brandId)
          .is("location_id", null)
          .eq("is_active", true)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (localRes.error) throw localRes.error;
  if (brandRes.error) throw brandRes.error;

  const merged = new Map<string, Record<string, any>>();
  const brandBlueprints = ((brandRes.data || []) as unknown) as Array<Record<string, any>>;
  const localBlueprints = ((localRes.data || []) as unknown) as Array<Record<string, any>>;

  for (const bp of brandBlueprints) {
    merged.set(String(bp.id), bp);
  }
  for (const bp of localBlueprints) {
    merged.set(String(bp.id), bp);
  }

  return Array.from(merged.values());
}
