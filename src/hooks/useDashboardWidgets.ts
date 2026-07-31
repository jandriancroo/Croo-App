import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import type { MetricType, WidgetSize } from '@/components/dashboard/DashboardWidget';
import type { CubeType, TrackerDisplayMode, TrackerRankMetric, TrackerScopeType } from '@/components/dashboard/AddWidgetDialog';

export interface DashboardWidgetRow {
  id: string;
  widget_type: string;
  config: any;
  display_order: number;
  created_by: string;
  authority_scope: 'self' | 'location' | 'org' | 'brand' | 'app';
  brand_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  audience_roles: string[] | null;
  is_active: boolean;
  title: string | null;
  accent_color: string | null;
  widget_size: 'small' | 'medium' | 'large';
  reference_id: string | null;
  hidden_for_user_ids: string[] | null;
}

/**
 * UI-shaped widget config compatible with the legacy DataCubeConfig shape
 * used by WidgetsSection / DashboardWidget / TrackerWidget.
 *
 * Reads the unified dashboard_widgets table. RLS handles all visibility:
 * self / location / org / brand / app, optionally filtered by audience_roles.
 */
export interface UnifiedWidgetConfig {
  id: string;
  title: string;
  size: WidgetSize;
  metrics: MetricType[];
  accentColor: string;
  displayOrder: number;
  cubeType: CubeType | 'data-3d';
  authorityScope: DashboardWidgetRow['authority_scope'];
  createdBy: string;
  audienceRoles: string[] | null;
  brandId: string | null;
  organizationId: string | null;
  locationId: string | null;
  hiddenForSelf: boolean;
  hiddenForLocation: boolean;
  // 3D
  faceMetrics?: MetricType[][];
  faceTitles?: string[];
  numFaces?: number;
  // Tracker
  trackerScope?: { type: TrackerScopeType; role?: string };
  trackerDisplayMode?: TrackerDisplayMode;
  trackerItemRefs?: string[];
  trackerPromoStart?: string | null;
  trackerPromoEnd?: string | null;
  trackerPromoImageUrl?: string | null;
  trackerLocationRefs?: string[];
  trackerLocationScope?: 'org' | 'brand';
  trackerRankMetrics?: TrackerRankMetric[];
  trackerExcludedLocationIds?: string[];
}

function mapRow(row: DashboardWidgetRow, userId: string, locationId: string): UnifiedWidgetConfig {
  const cfg = row.config || {};
  const excludedLocs: string[] = Array.isArray(cfg.tracker_excluded_location_ids) ? cfg.tracker_excluded_location_ids : [];
  return {
    id: row.id,
    title: row.title || '',
    size: (row.widget_size as WidgetSize) || 'small',
    metrics: (cfg.metrics as MetricType[]) || [],
    accentColor: row.accent_color || '#8B5CF6',
    displayOrder: row.display_order,
    cubeType: (row.widget_type as CubeType | 'data-3d') || 'data',
    authorityScope: row.authority_scope,
    createdBy: row.created_by,
    audienceRoles: row.audience_roles ?? null,
    brandId: row.brand_id ?? null,
    organizationId: row.organization_id ?? null,
    locationId: row.location_id ?? null,
    hiddenForSelf: Array.isArray(row.hidden_for_user_ids) && row.hidden_for_user_ids.includes(userId),
    hiddenForLocation: row.widget_type === 'tracker' && !!locationId && excludedLocs.includes(locationId),
    faceMetrics: (cfg.face_metrics as MetricType[][]) || [],
    faceTitles: (cfg.face_titles as string[]) || [],
    numFaces: cfg.num_faces || 1,
    trackerScope: (cfg.tracker_scope as { type: TrackerScopeType; role?: string }) || { type: 'location' },
    trackerDisplayMode: (cfg.tracker_display_mode as TrackerDisplayMode) || 'summary',
    trackerItemRefs: (cfg.tracker_item_refs as string[]) || [],
    trackerPromoStart: cfg.tracker_promo_start ?? null,
    trackerPromoEnd: cfg.tracker_promo_end ?? null,
    trackerPromoImageUrl: cfg.tracker_promo_image_url ?? null,
    trackerLocationRefs: (cfg.tracker_location_refs as string[]) || [],
    trackerLocationScope: (cfg.tracker_location_scope as 'org' | 'brand') || 'org',
    trackerRankMetrics: (cfg.tracker_rank_metrics as TrackerRankMetric[]) || ['units', 'sales', 'pmix'],
    trackerExcludedLocationIds: (cfg.tracker_excluded_location_ids as string[]) || [],
  };
}

/**
 * Shared fetcher so the splash prefetch and the hook produce the IDENTICAL
 * cache shape under the IDENTICAL key.
 */
export async function fetchDashboardWidgets(
  userId: string,
  locationId: string
): Promise<UnifiedWidgetConfig[]> {
  const { data, error } = await supabase
    .from('dashboard_widgets')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[useDashboardWidgets] error:', error);
    return [];
  }

  const rows = (data || []) as DashboardWidgetRow[];
  const filtered = rows.filter(r => {
    if (r.authority_scope === 'org' || r.authority_scope === 'brand' || r.authority_scope === 'app') {
      return true;
    }
    return r.location_id === locationId;
  });

  return filtered.map(r => mapRow(r, userId, locationId));
}

export const DASHBOARD_WIDGETS_STALE_TIME = 30 * 1000;


/**
 * Fetch all widgets visible to the current user for the given location.
 * RLS filters by visibility/role; we filter client-side to widgets that
 * apply to this location (self/location bound to id, or org/brand/app cascading down).
 *
 * Widgets the user has personally hidden are returned with `hiddenForSelf=true`
 * so the Edit dialog can list them; consumers rendering the live dashboard
 * should filter them out (see Dashboard.tsx).
 */
export function useDashboardWidgets(locationId: string | null | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['dashboard-widgets', user?.id, locationId],
    queryFn: async (): Promise<UnifiedWidgetConfig[]> => {
      if (!user?.id || !locationId) return [];

      const { data, error } = await supabase
        .from('dashboard_widgets')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) {
        console.error('[useDashboardWidgets] error:', error);
        return [];
      }

      const rows = (data || []) as DashboardWidgetRow[];

      const filtered = rows.filter(r => {
        if (r.authority_scope === 'org' || r.authority_scope === 'brand' || r.authority_scope === 'app') {
          return true;
        }
        return r.location_id === locationId;
      });

      return filtered.map(r => mapRow(r, user.id, locationId));
    },
    enabled: !!user?.id && !!locationId,
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });
}
