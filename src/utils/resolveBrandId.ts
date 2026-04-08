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
 * Fetches blueprints for a location. If the location has no local blueprints,
 * falls back to brand-level blueprints via the location → org → brand chain.
 */
export async function fetchBlueprintsForLocation(
  locationId: string,
  selectFields: string = "id, name, category, yield_qty, yield_unit, source, catalog_section"
) {
  // Try location-specific first
  const { data: localData, error: localErr } = await supabase
    .from("recipe_blueprints" as any)
    .select(selectFields)
    .eq("location_id", locationId)
    .eq("is_active", true)
    .order("name");
  if (localErr) throw localErr;
  if (localData && localData.length > 0) return localData;

  // Fallback to brand-level blueprints
  const brandId = await resolveBrandId(locationId);
  if (!brandId) return [];

  const { data: brandData, error: brandErr } = await supabase
    .from("recipe_blueprints" as any)
    .select(selectFields)
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .order("name");
  if (brandErr) throw brandErr;
  return brandData || [];
}
