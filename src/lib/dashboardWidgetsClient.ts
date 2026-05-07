import { supabase } from '@/integrations/supabase/client';

/**
 * Unified Dashboard Widgets — write API (Phase 2).
 *
 * All writes against `dashboard_widgets` MUST go through these RPCs.
 * Direct table inserts/updates/deletes are blocked by RLS.
 *
 * The `config` JSONB stores everything that doesn't have a top-level column
 * (metrics, face_metrics, tracker fields, etc.). Top-level columns:
 *   widget_type, title, accent_color, widget_size, display_order,
 *   authority_scope, brand_id, organization_id, location_id, audience_roles,
 *   reference_id, is_active.
 */

export type AuthorityScope = 'self' | 'location' | 'org' | 'brand' | 'app';

export interface CreateWidgetInput {
  widget_type: string;
  config: Record<string, any>;
  authority_scope: AuthorityScope;
  brand_id?: string | null;
  organization_id?: string | null;
  location_id?: string | null;
  audience_roles?: string[] | null;
  title?: string | null;
  accent_color?: string;
  widget_size?: 'small' | 'medium' | 'large';
  display_order?: number;
  reference_id?: string | null;
}

export interface UpdateWidgetInput {
  widget_id: string;
  widget_type?: string;
  config?: Record<string, any>;
  authority_scope?: AuthorityScope;
  brand_id?: string | null;
  organization_id?: string | null;
  location_id?: string | null;
  audience_roles?: string[] | null;
  title?: string | null;
  accent_color?: string | null;
  widget_size?: 'small' | 'medium' | 'large' | null;
  display_order?: number | null;
  reference_id?: string | null;
  is_active?: boolean | null;
}

export async function createDashboardWidget(input: CreateWidgetInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_dashboard_widget', {
    _widget_type: input.widget_type,
    _config: input.config,
    _authority_scope: input.authority_scope,
    _brand_id: input.brand_id ?? null,
    _organization_id: input.organization_id ?? null,
    _location_id: input.location_id ?? null,
    _audience_roles: (input.audience_roles ?? null) as any,
    _title: input.title ?? null,
    _accent_color: input.accent_color ?? '#8B5CF6',
    _widget_size: input.widget_size ?? 'small',
    _display_order: input.display_order ?? 0,
    _reference_id: input.reference_id ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateDashboardWidget(input: UpdateWidgetInput): Promise<void> {
  const { error } = await supabase.rpc('update_dashboard_widget', {
    _widget_id: input.widget_id,
    _widget_type: input.widget_type ?? null,
    _config: (input.config ?? null) as any,
    _authority_scope: input.authority_scope ?? null,
    _brand_id: input.brand_id ?? null,
    _organization_id: input.organization_id ?? null,
    _location_id: input.location_id ?? null,
    _audience_roles: (input.audience_roles ?? null) as any,
    _title: input.title ?? null,
    _accent_color: input.accent_color ?? null,
    _widget_size: input.widget_size ?? null,
    _display_order: input.display_order ?? null,
    _reference_id: input.reference_id ?? null,
    _is_active: input.is_active ?? null,
  });
  if (error) throw error;
}

export async function deleteDashboardWidget(widget_id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_dashboard_widget', { _widget_id: widget_id });
  if (error) throw error;
}

/**
 * Toggle whether the current user has hidden this widget from their own
 * dashboard. Doesn't change widget scope or visibility for any other user.
 * Returns true if now hidden, false if now visible.
 */
export async function toggleWidgetHiddenForSelf(widget_id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_widget_hidden_for_self', { _widget_id: widget_id });
  if (error) throw error;
  return data as boolean;
}

/**
 * Build the `config` JSONB blob from the legacy CubeConfig shape used by the UI.
 * Anything that's a top-level column is stripped.
 */
export function buildWidgetConfigJson(cube: {
  metrics?: any;
  faceMetrics?: any;
  faceTitles?: any;
  numFaces?: any;
  trackerScope?: any;
  trackerDisplayMode?: any;
  trackerItemRefs?: any;
  trackerPromoStart?: any;
  trackerPromoEnd?: any;
  trackerPromoImageUrl?: any;
  trackerLocationRefs?: any;
  trackerRankMetrics?: any;
  trackerLocationScope?: any;
}): Record<string, any> {
  const cfg: Record<string, any> = {};
  if (cube.metrics !== undefined) cfg.metrics = cube.metrics;
  if (cube.faceMetrics !== undefined) cfg.face_metrics = cube.faceMetrics;
  if (cube.faceTitles !== undefined) cfg.face_titles = cube.faceTitles;
  if (cube.numFaces !== undefined) cfg.num_faces = cube.numFaces;
  if (cube.trackerScope !== undefined) cfg.tracker_scope = cube.trackerScope;
  if (cube.trackerDisplayMode !== undefined) cfg.tracker_display_mode = cube.trackerDisplayMode;
  if (cube.trackerItemRefs !== undefined) cfg.tracker_item_refs = cube.trackerItemRefs;
  if (cube.trackerPromoStart !== undefined) cfg.tracker_promo_start = cube.trackerPromoStart;
  if (cube.trackerPromoEnd !== undefined) cfg.tracker_promo_end = cube.trackerPromoEnd;
  if (cube.trackerPromoImageUrl !== undefined) cfg.tracker_promo_image_url = cube.trackerPromoImageUrl;
  if (cube.trackerLocationRefs !== undefined) cfg.tracker_location_refs = cube.trackerLocationRefs;
  if (cube.trackerRankMetrics !== undefined) cfg.tracker_rank_metrics = cube.trackerRankMetrics;
  if (cube.trackerLocationScope !== undefined) cfg.tracker_location_scope = cube.trackerLocationScope;
  return cfg;
}
