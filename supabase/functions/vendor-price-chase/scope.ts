// Row scope for the item load: always one store; a single-template publish
// narrows to that template's rows only.
export function scopeItemQuery<Q extends { eq: (col: string, val: string) => Q }>(
  q: Q,
  locationId: string,
  templateId: string | null,
): Q {
  const scoped = q.eq("location_id", locationId);
  return templateId ? scoped.eq("brand_item_id", templateId) : scoped;
}
