// Shared item model + save shape for the checklist editor (Create and Edit).
// The save shape (toItemRow) is the exact row Edit wrote before Phase C.
import { referencePhotoFields, getReferencePhotos } from '@/lib/checklistReferencePhotos';
import type { ChecklistLinkRef } from '@/lib/checklistLinks';
import type { PrepRow } from '@/components/checklists/PrepListEditor';

export type EditorItemType =
  | 'text' | 'multiple_choice' | 'image' | 'confirmation' | 'temperature' | 'number'
  | 'section_header' | 'prep_list' | 'manager_approval';

export interface EditorItem {
  /** Client-only stable key for selection and drag; never saved. */
  _key?: string;
  id?: string;
  question: string;
  /** Stored value; may be a legacy spelling (PHOTO, CHECKBOX) until changed. */
  item_type: EditorItemType | string;
  is_required: boolean;
  temperature_alert_enabled?: boolean;
  options?: string[] | { minPhotos?: number } | null;
  reference_image_url?: string | null;
  reference_image_urls?: string[];
  reference_link?: string;
  reference_video_url?: string;
  reference_notes?: string;
  order_index?: number;
  manager_shift?: 'am' | 'pm' | null;
  position?: string | null;
  station_id?: string | null;
  assigned_role?: string | null;
  assigned_user_id?: string | null;
  prep_rows?: PrepRow[];
  link_refs?: ChecklistLinkRef[];
}

let keySeq = 0;
export const newItemKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;
export const withKey = <T extends EditorItem>(it: T): T => (it._key ? it : { ...it, _key: newItemKey() });

export const blankItem = (): EditorItem => ({ _key: newItemKey(), question: '', item_type: 'confirmation', is_required: true });

/** Display type: legacy spellings map to their modern picker value. */
export function displayType(t: string): EditorItemType {
  if (t === 'PHOTO' || t === 'photo') return 'image';
  if (t === 'CHECKBOX' || t === 'checkbox') return 'confirmation';
  return t as EditorItemType;
}

/** Photo and Temp Photo carry a "photos required" count. */
export const hasPhotoCount = (t: string) => t === 'image' || t === 'temperature';

export function minPhotos(item: Pick<EditorItem, 'item_type' | 'options'>): number {
  if (!hasPhotoCount(item.item_type)) return 1;
  const o = item.options;
  const n = o && typeof o === 'object' && !Array.isArray(o) ? Number(o.minPhotos) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Number of reference photo slots shown: photos required for Photo/Temp, else 1. */
export const referenceSlotCount = (item: Pick<EditorItem, 'item_type' | 'options'>) => minPhotos(item);

/** Reference photos that would be dropped if the slot count became `slots`. */
export function photosDroppedAt(item: EditorItem, slots: number): number {
  return Math.max(0, getReferencePhotos(item).length - slots);
}

/** Set the reference photo list, keeping slot 1 mirrored in the old column. */
export function setReferencePhotos(item: EditorItem, urls: string[]): EditorItem {
  const clean = urls.filter((u) => typeof u === 'string' && u.trim() !== '');
  return { ...item, reference_image_urls: clean, reference_image_url: clean[0] ?? null };
}

/** DB shape of one item (without checklist_id). Unchanged from the pre-Phase-C Edit save. */
export function toItemRow(item: EditorItem, orderIndex: number, amPm: boolean, posFilter: boolean) {
  const dbItemType = item.item_type;
  return {
    question: item.question,
    item_type: dbItemType as any,
    is_required: item.is_required,
    requires_temperature_validation: dbItemType === 'temperature',
    temperature_alert_enabled: dbItemType === 'temperature' ? (item.temperature_alert_enabled || false) : false,
    options: (item.item_type === 'multiple_choice' ? item.options : (item.item_type === 'image' || item.item_type === 'temperature') ? item.options : null) as any,
    ...referencePhotoFields(item),
    reference_link: item.reference_link || null,
    reference_video_url: item.reference_video_url || null,
    reference_notes: item.reference_notes || null,
    order_index: orderIndex,
    manager_shift: amPm ? (item.manager_shift || null) : null,
    position: posFilter ? (item.position || null) : null,
    station_id: posFilter ? (item.station_id || null) : null,
    assigned_role: posFilter ? ((item.assigned_role as any) || null) : null,
    assigned_user_id: posFilter ? (item.assigned_user_id || null) : null,
    link_refs: (item.link_refs ?? []) as any,
  };
}

/** Drag reorder. A section header moves with its whole block (until the next header). */
export function moveChecklistItems<T extends { item_type: string }>(items: T[], oldIndex: number, newIndex: number): T[] {
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return items;
  if (items[oldIndex].item_type !== 'section_header') {
    const next = [...items];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    return next;
  }
  let blockEnd = items.length;
  for (let i = oldIndex + 1; i < items.length; i++) {
    if (items[i].item_type === 'section_header') { blockEnd = i; break; }
  }
  if (newIndex > oldIndex && newIndex < blockEnd) return items;
  const block = items.slice(oldIndex, blockEnd);
  const rest = [...items.slice(0, oldIndex), ...items.slice(blockEnd)];
  let insertAt = rest.indexOf(items[newIndex]);
  if (insertAt < 0) insertAt = rest.length;
  if (oldIndex < newIndex) insertAt += 1;
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}

/** Copy of a task for Duplicate: no saved ids, fresh key. */
export function duplicateItem(item: EditorItem): EditorItem {
  const { id: _id, ...rest } = item;
  return {
    ...rest,
    _key: newItemKey(),
    prep_rows: item.prep_rows?.map(({ id: _rid, ...r }) => ({ ...r } as PrepRow)),
    reference_image_urls: [...getReferencePhotos(item)],
  };
}
