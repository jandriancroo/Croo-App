import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';
import type { TrackerDisplayMode, TrackerRankMetric } from '@/components/dashboard/AddWidgetDialog';

/**
 * Promo trackers: ONE record per promo (table promo_trackers).
 * Brand promos show at every store in the brand; org contests show only at the
 * org's chosen stores. A store shows at most one promo; brand beats org.
 * All reads/writes go through the RPCs below.
 */

export type PromoOwnerType = 'brand' | 'org';

export interface PromoBorder {
  style: string;
  color?: string | null;
}

export interface PromoTrackerConfig {
  tracker_display_mode?: TrackerDisplayMode;
  tracker_item_refs?: string[];
  tracker_promo_image_url?: string | null;
  tracker_rank_metrics?: TrackerRankMetric[];
  tracker_item_images?: Record<string, string>;
  tracker_start_on_campaign?: boolean;
  tracker_autoplay?: boolean;
  // Decorative border settings stored in the existing promo config.
  tracker_border?: PromoBorder | null;
  tracker_border_winner?: boolean;
  tracker_border_closing?: boolean;
}

export interface PromoTracker {
  id: string;
  owner_type: PromoOwnerType;
  brand_id: string | null;
  organization_id: string | null;
  title: string;
  starts_on: string; // yyyy-MM-dd
  ends_on: string;   // yyyy-MM-dd
  config: PromoTrackerConfig;
  location_ids: string[];
  can_manage: boolean;
}

export const ALL_ITEMS_REF = '__ALL__';

export async function fetchActivePromoTracker(locationId: string): Promise<PromoTracker | null> {
  const { data, error } = await supabase.rpc('get_active_promo_tracker' as any, { _location_id: locationId });
  if (error) throw error;
  return (data as unknown as PromoTracker) ?? null;
}

export async function fetchManageablePromoTrackers(locationId: string): Promise<PromoTracker[]> {
  const { data, error } = await supabase.rpc('list_promo_trackers' as any, { _location_id: locationId });
  if (error) throw error;
  return ((data as unknown as PromoTracker[]) ?? []);
}

export interface SavePromoInput {
  id?: string | null;
  owner_type: PromoOwnerType;
  brand_id?: string | null;
  organization_id?: string | null;
  title: string;
  starts_on: string;
  ends_on: string;
  config: PromoTrackerConfig;
  location_ids?: string[] | null;
}

export async function savePromoTracker(input: SavePromoInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_promo_tracker' as any, {
    _id: input.id ?? null,
    _owner_type: input.owner_type,
    _brand_id: input.brand_id ?? null,
    _organization_id: input.organization_id ?? null,
    _title: input.title,
    _starts_on: input.starts_on,
    _ends_on: input.ends_on,
    _config: input.config as any,
    _location_ids: input.location_ids && input.location_ids.length ? input.location_ids : null,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function endPromoTracker(id: string): Promise<void> {
  const { error } = await supabase.rpc('end_promo_tracker' as any, { _id: id });
  if (error) throw error;
}

/** Remove photo entries for items that are no longer tracked. */
export function pruneItemImages(images: Record<string, string> | undefined, refs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of refs) {
    const url = images?.[ref];
    if (url) out[ref] = url;
  }
  return out;
}

export interface PromoSlide {
  ref: string; // item ref, or ALL_ITEMS_REF for the campaign slide
  label: string;
  imageUrl: string | null;
}

/**
 * Slides in play order. The campaign slide (ALL) comes first only when the
 * builder switch is on AND more than one item is tracked (that's when the
 * existing "All Items" option exists). Photo fallback: dish → campaign → none.
 */
export function buildPromoSlides(config: PromoTrackerConfig): PromoSlide[] {
  const refs = config.tracker_item_refs ?? [];
  const campaign = config.tracker_promo_image_url?.trim() || null;
  const slides: PromoSlide[] = refs.map(ref => ({
    ref,
    label: ref,
    imageUrl: config.tracker_item_images?.[ref]?.trim() || campaign,
  }));
  if (config.tracker_start_on_campaign && refs.length > 1) {
    slides.unshift({ ref: ALL_ITEMS_REF, label: 'All items', imageUrl: campaign });
  }
  return slides;
}

/** "Day 6/21" in the store's timezone; null when dates are missing or today is outside them. */
export function campaignDay(startsOn: string | null | undefined, endsOn: string | null | undefined, tz: string, now: DateTime = DateTime.now()): { day: number; total: number } | null {
  if (!startsOn || !endsOn) return null;
  const start = DateTime.fromFormat(startsOn, 'yyyy-MM-dd', { zone: tz });
  const end = DateTime.fromFormat(endsOn, 'yyyy-MM-dd', { zone: tz });
  if (!start.isValid || !end.isValid || end < start) return null;
  const today = now.setZone(tz).startOf('day');
  const total = Math.round(end.diff(start, 'days').days) + 1;
  const day = Math.round(today.diff(start, 'days').days) + 1;
  if (day < 1 || day > total) return null;
  return { day, total };
}
