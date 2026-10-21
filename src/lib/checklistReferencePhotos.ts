// Reference photos for a checklist item. The list (reference_image_urls) is the
// source of truth; reference_image_url is kept equal to slot 1 for older readers.

type RefPhotoItem = {
  reference_image_url?: string | null;
  reference_image_urls?: string[] | null;
};

const clean = (list: unknown): string[] =>
  Array.isArray(list) ? list.filter((u): u is string => typeof u === 'string' && u.trim() !== '') : [];

/** An item's reference photos: the list, falling back to the old single column. */
export function getReferencePhotos(item: RefPhotoItem | null | undefined): string[] {
  if (!item) return [];
  const list = clean(item.reference_image_urls);
  if (list.length > 0) return list;
  const single = item.reference_image_url?.trim();
  return single ? [single] : [];
}

/** First reference photo, or null. */
export function getPrimaryReferencePhoto(item: RefPhotoItem | null | undefined): string | null {
  return getReferencePhotos(item)[0] ?? null;
}

/**
 * Both columns for a save or copy. Screens that still edit only the single
 * photo change slot 1; slots 2 and up are always carried along.
 */
export function referencePhotoFields(item: RefPhotoItem): {
  reference_image_url: string | null;
  reference_image_urls: string[];
} {
  const list = clean(item.reference_image_urls);
  const single = item.reference_image_url?.trim() || null;
  if (single) {
    if (list.length === 0) list.push(single);
    else list[0] = single;
  } else if (list.length > 0 && 'reference_image_url' in item) {
    // Slot 1 was removed by a single-photo editor.
    list.shift();
  }
  return { reference_image_url: list[0] ?? null, reference_image_urls: list };
}
