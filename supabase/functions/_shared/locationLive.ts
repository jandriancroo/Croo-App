// Switched-off (inactive) locations are skipped by batch jobs.
// Fail-open: if the lookup itself fails, every id is kept so active
// locations never lose their automatic work because of this check.
// deno-lint-ignore no-explicit-any
export async function keepLiveLocationIds(supabase: any, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from("locations")
      .select("id, is_active")
      .in("id", unique);
    if (error || !Array.isArray(data)) return unique;
    const off = new Set(
      (data as Array<{ id: string; is_active: boolean | null }>)
        .filter((r) => r.is_active === false)
        .map((r) => r.id),
    );
    return unique.filter((id) => !off.has(id));
  } catch {
    return unique;
  }
}
