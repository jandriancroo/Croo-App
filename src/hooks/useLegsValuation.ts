/**
 * useLegsValuation — single source of truth for fetching multi-config leg
 * data and valuing count items with snapshot-driven per-leg payloads.
 *
 * Replaces five copies of the same query + valuation logic that previously
 * lived inline in InventoryCountView, CountExportDialog, InventoryCountSession,
 * and pages/Inventory.tsx. New consumers (COGS, Variance, Reconciliation)
 * should call the hook (or `fetchLegsValuationContext` for non-component code)
 * and use `getItemValueWithLegs` instead of replicating the queries.
 *
 * Math contract (per spec §3.3, confirmed 2026-05-31):
 *   commonUnitCost = parent item.cost_per_unit / defaultCfg.count_units_per_case
 *   leg.cost_at_count = snapshot when present, else cfg.count_units_per_case × commonUnitCost
 *   pack_quantity_at_count = leg snapshot when present, else cfg.count_units_per_case
 *
 * Snapshots ALWAYS win over derived values — submitted counts are immutable.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  calculateCountItemValue,
  type CountItemForValue,
  type ItemForValue,
  type ConversionForValue,
  type LegForValue,
} from "@/utils/countItemValue";

// ── Types ────────────────────────────────────────────────────────────────

export type PersistedLegRow = {
  pack_config_id: string;
  entered_cases: number | null;
  entered_inner_packs: number | null;
  entered_units: number | null;
  quantity_common: number | null;
  pack_quantity_at_count: number | null;
  inner_pack_quantity_at_count: number | null;
  cost_at_count: number | null;
};

export type LegsConfigRow = {
  pack_config_id: string;
  is_default: boolean;
  label: string | null;
  outer_qty: number | null;
  outer_type: string | null;
  inner_qty: number | null;
  inner_type: string | null;
  common_unit: string | null;
  count_units_per_case: number | null;
  cost_per_common_unit: number | null;
  show_cases: boolean | null;
  show_inner_packs: boolean | null;
  show_common_unit: boolean | null;
};

export type LegsValuationContext = {
  legsEnabled: boolean;
  /** Persisted legs grouped by count_item_id (snapshot-driven). */
  legsByCountItemId: Map<string, PersistedLegRow[]>;
  /** Selected configs at this location, keyed by brand_template_id (= brand_item_id). */
  legsConfigsByBrandItemId: Map<string, LegsConfigRow[]>;
  /** Config labels keyed by pack_config_id — for per-leg display rows. */
  legLabelById: Map<string, string>;
};

export type LegsValuationBundle = LegsValuationContext & {
  isLoading: boolean;
  /** Value a count item, leg-aware when the item has ≥2 selected configs. */
  getItemValueWithLegs: (
    countItem: CountItemForValue & { id: string },
    item: ItemForValue,
    conversion: ConversionForValue | null | undefined,
    opts?: { forceLiveData?: boolean }
  ) => number;
};

// ── Core math (pure) ─────────────────────────────────────────────────────

/**
 * Build the LegForValue[] payload calculateCountItemValue expects, from
 * persisted leg rows + the location's selected configs. Returns undefined
 * when the item is single-config or required pieces (cost_per_unit,
 * default cfg's count_units_per_case) are missing — caller then falls
 * through to the canonical parent-row path.
 */
export function buildLegsForValuation(
  brandItemId: string | null | undefined,
  item: ItemForValue | undefined,
  legRows: PersistedLegRow[],
  configsByBrandItemId: Map<string, LegsConfigRow[]>
): LegForValue[] | undefined {
  if (!legRows || legRows.length < 2 || !brandItemId) return undefined;
  const cfgs = configsByBrandItemId.get(brandItemId) ?? [];
  if (cfgs.length < 2) return undefined;
  const cfgById = new Map(cfgs.map((c) => [c.pack_config_id, c]));
  const defaultCfg = cfgs.find((c) => c.is_default) ?? cfgs[0];
  const defaultUnitsPerCase = Number(defaultCfg?.count_units_per_case ?? 0);
  const costPerCase = Number(item?.cost_per_unit ?? 0);
  const commonUnitCost =
    defaultUnitsPerCase > 0 && costPerCase > 0
      ? costPerCase / defaultUnitsPerCase
      : null;
  if (commonUnitCost == null) return undefined;
  return legRows.map((leg) => {
    const cfg = cfgById.get(leg.pack_config_id);
    const cu = Number(cfg?.count_units_per_case ?? 0);
    const pq =
      leg.pack_quantity_at_count != null
        ? Number(leg.pack_quantity_at_count)
        : cu > 0
          ? cu
          : null;
    const legCost =
      leg.cost_at_count != null
        ? Number(leg.cost_at_count)
        : pq != null && pq > 0
          ? pq * commonUnitCost
          : null;
    return {
      entered_cases: leg.entered_cases,
      entered_units: 0,
      entered_inner_packs: 0,
      quantity_common: leg.quantity_common,
      pack_quantity_at_count: pq,
      inner_pack_quantity_at_count: null,
      cost_at_count: legCost,
    };
  });
}

/**
 * Pure value resolver — bind a fetched LegsValuationContext to get a
 * `getItemValueWithLegs` function. Use this directly in queryFn bodies
 * (e.g. pages/Inventory.tsx summary aggregator) where hooks can't run.
 */
export function makeGetItemValueWithLegs(ctx: LegsValuationContext) {
  return function getItemValueWithLegs(
    countItem: CountItemForValue & { id: string },
    item: ItemForValue,
    conversion: ConversionForValue | null | undefined,
    opts?: { forceLiveData?: boolean }
  ): number {
    const force = opts?.forceLiveData ?? false;
    const legRows = ctx.legsByCountItemId.get(countItem.id) ?? [];
    const legs = ctx.legsEnabled
      ? buildLegsForValuation(
          item?.brand_item_id ?? null,
          item,
          legRows,
          ctx.legsConfigsByBrandItemId
        )
      : undefined;
    return calculateCountItemValue(countItem, item, conversion ?? null, force, legs);
  };
}

// ── Fetchers (shared by hook + non-hook utility) ─────────────────────────

async function fetchLegsEnabled(locationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("locations" as any)
    .select("legs_enabled")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw error;
  return (data as any)?.legs_enabled === true;
}

async function fetchLegsConfigs(
  locationId: string
): Promise<{
  configsByBrandItemId: Map<string, LegsConfigRow[]>;
  labelById: Map<string, string>;
}> {
  const { data, error } = await supabase
    .from("location_pack_selections" as any)
    .select(
      "brand_template_id, is_default, brand_pack_configs!inner(id, label, outer_qty, outer_type, inner_qty, inner_type, common_unit, count_units_per_case, cost_per_common_unit, status, show_cases, show_inner_packs, show_common_unit)"
    )
    .eq("location_id", locationId);
  if (error) throw error;

  const configsByBrandItemId = new Map<string, LegsConfigRow[]>();
  const labelById = new Map<string, string>();
  for (const row of (data as any[]) || []) {
    const bpc = row?.brand_pack_configs;
    if (!row?.brand_template_id || !bpc) continue;
    if (bpc.status && bpc.status !== "approved") continue;
    const entry: LegsConfigRow = {
      pack_config_id: bpc.id,
      is_default: !!row.is_default,
      label: bpc.label ?? null,
      outer_qty: bpc.outer_qty ?? null,
      outer_type: bpc.outer_type ?? null,
      inner_qty: bpc.inner_qty ?? null,
      inner_type: bpc.inner_type ?? null,
      common_unit: bpc.common_unit ?? null,
      count_units_per_case: bpc.count_units_per_case ?? null,
      cost_per_common_unit: bpc.cost_per_common_unit ?? null,
      show_cases: bpc.show_cases ?? null,
      show_inner_packs: bpc.show_inner_packs ?? null,
      show_common_unit: bpc.show_common_unit ?? null,
    };
    const list = configsByBrandItemId.get(row.brand_template_id) ?? [];
    list.push(entry);
    configsByBrandItemId.set(row.brand_template_id, list);
    if (bpc.id) labelById.set(bpc.id, bpc.label ?? "");
  }
  // Stable order: default first, then by label.
  for (const [k, list] of configsByBrandItemId) {
    list.sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return (a.label ?? "").localeCompare(b.label ?? "");
    });
    configsByBrandItemId.set(k, list);
  }
  return { configsByBrandItemId, labelById };
}

async function fetchLegsForCount(
  countId: string
): Promise<Map<string, PersistedLegRow[]>> {
  const { data, error } = await supabase
    .from("inventory_count_item_legs" as any)
    .select(
      "count_item_id, pack_config_id, entered_cases, entered_inner_packs, entered_units, quantity_common, pack_quantity_at_count, inner_pack_quantity_at_count, cost_at_count, inventory_count_items!inner(count_id)"
    )
    .eq("inventory_count_items.count_id", countId);
  if (error) throw error;
  const map = new Map<string, PersistedLegRow[]>();
  for (const row of (data as any[]) || []) {
    if (!row?.count_item_id) continue;
    const list = map.get(row.count_item_id) ?? [];
    list.push({
      pack_config_id: row.pack_config_id,
      entered_cases: row.entered_cases,
      entered_inner_packs: row.entered_inner_packs,
      entered_units: row.entered_units,
      quantity_common: row.quantity_common,
      pack_quantity_at_count: row.pack_quantity_at_count,
      inner_pack_quantity_at_count: row.inner_pack_quantity_at_count,
      cost_at_count: row.cost_at_count,
    });
    map.set(row.count_item_id, list);
  }
  return map;
}

/**
 * Batch fetch legs for multiple counts in one query — used by pages that
 * summarize many counts (Inventory.tsx period list). Returns a Map keyed
 * by count_item_id across ALL count_ids.
 */
async function fetchLegsForCounts(
  countIds: string[]
): Promise<Map<string, PersistedLegRow[]>> {
  if (countIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("inventory_count_item_legs" as any)
    .select(
      "count_item_id, pack_config_id, entered_cases, entered_inner_packs, entered_units, quantity_common, pack_quantity_at_count, inner_pack_quantity_at_count, cost_at_count, inventory_count_items!inner(count_id)"
    )
    .in("inventory_count_items.count_id", countIds);
  if (error) throw error;
  const map = new Map<string, PersistedLegRow[]>();
  for (const row of (data as any[]) || []) {
    if (!row?.count_item_id) continue;
    const list = map.get(row.count_item_id) ?? [];
    list.push({
      pack_config_id: row.pack_config_id,
      entered_cases: row.entered_cases,
      entered_inner_packs: row.entered_inner_packs,
      entered_units: row.entered_units,
      quantity_common: row.quantity_common,
      pack_quantity_at_count: row.pack_quantity_at_count,
      inner_pack_quantity_at_count: row.inner_pack_quantity_at_count,
      cost_at_count: row.cost_at_count,
    });
    map.set(row.count_item_id, list);
  }
  return map;
}

/**
 * Non-hook fetch — use inside React Query queryFn bodies or other async
 * non-component contexts (e.g. pages/Inventory.tsx summary aggregator,
 * future server-side reducers).
 */
export async function fetchLegsValuationContext(args: {
  locationId: string;
  countIds: string[];
}): Promise<LegsValuationContext> {
  const { locationId, countIds } = args;
  const legsEnabled = await fetchLegsEnabled(locationId);
  if (!legsEnabled) {
    return {
      legsEnabled: false,
      legsByCountItemId: new Map(),
      legsConfigsByBrandItemId: new Map(),
      legLabelById: new Map(),
    };
  }
  const [{ configsByBrandItemId, labelById }, legsByCountItemId] = await Promise.all([
    fetchLegsConfigs(locationId),
    fetchLegsForCounts(countIds),
  ]);
  return {
    legsEnabled: true,
    legsByCountItemId,
    legsConfigsByBrandItemId: configsByBrandItemId,
    legLabelById: labelById,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * Fetches everything needed to value a single count's items leg-aware.
 * Three queries, all gated on the location's `legs_enabled` flag:
 *   1. locations.legs_enabled (5min cache)
 *   2. brand_pack_configs via location_pack_selections (60s cache)
 *   3. inventory_count_item_legs for this countId (0 cache — leg writes
 *      must reflect immediately on reopen)
 */
export function useLegsValuation(
  countId: string | undefined,
  locationId: string | undefined,
  opts?: { enabled?: boolean }
): LegsValuationBundle {
  const enabled = opts?.enabled ?? true;

  const { data: legsEnabled, isLoading: enabledLoading } = useQuery({
    queryKey: ["legs-valuation:enabled", locationId],
    enabled: enabled && !!locationId,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchLegsEnabled(locationId!),
  });

  const { data: configs, isLoading: configsLoading } = useQuery({
    queryKey: ["legs-valuation:configs", locationId, legsEnabled],
    enabled: enabled && !!locationId && legsEnabled === true,
    staleTime: 60 * 1000,
    queryFn: () => fetchLegsConfigs(locationId!),
  });

  const { data: legsByCountItemId, isLoading: legsLoading } = useQuery({
    queryKey: ["legs-valuation:legs", countId, legsEnabled],
    enabled: enabled && !!countId && legsEnabled === true,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => fetchLegsForCount(countId!),
  });

  const ctx: LegsValuationContext = useMemo(
    () => ({
      legsEnabled: legsEnabled === true,
      legsByCountItemId: legsByCountItemId ?? new Map(),
      legsConfigsByBrandItemId: configs?.configsByBrandItemId ?? new Map(),
      legLabelById: configs?.labelById ?? new Map(),
    }),
    [legsEnabled, legsByCountItemId, configs]
  );

  const getItemValueWithLegs = useMemo(() => makeGetItemValueWithLegs(ctx), [ctx]);

  return {
    ...ctx,
    isLoading: enabledLoading || configsLoading || legsLoading,
    getItemValueWithLegs,
  };
}
