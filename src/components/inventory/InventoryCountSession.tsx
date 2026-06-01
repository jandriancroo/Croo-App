import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, Minus, Plus, DollarSign, History, AlertTriangle, ArrowLeft, Save, Mic, MicOff, Clock, ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useAudioVoiceInput } from "@/hooks/useAudioVoiceInput";
import { useInventoryVoiceFeedback } from "@/hooks/useInventoryVoiceFeedback";
import { useAuth } from "@/lib/auth";

import { useIsMobile } from "@/hooks/use-mobile";
import { useDockToast } from "@/contexts/DockToastContext";
import { calculateCountItemValue } from "@/utils/countItemValue";
import { useLegsValuation } from "@/hooks/useLegsValuation";
import { getEffectivePackQty, isLensValid } from "@/utils/getEffectivePackQty";
import { computeCountLanes } from "@/utils/computeCountLanes";
import { resolveItemPackShape, atomicUnitToken, type ResolvedPackShape } from "@/utils/resolveItemPackShape";
import { useBrandConversions } from "@/hooks/useBrandConversions";
import { resolveBrandId } from "@/utils/resolveBrandId";
import { ALL_CONTAINERS, getPanUnits, type PanSizesConfig } from "@/components/inventory/PanSizesSection";
import { fetchRecipeCosts } from "@/utils/recipeCostCalculation";
import { useInventoryCountLock } from "@/hooks/useInventoryCountLock";
import { setInventoryCountLock } from "@/utils/inventoryCountLock";
import {
  cacheCountEdit,
  clearCountCache,
} from "@/utils/inventoryCountCache";
import { InventorySyncPill } from "@/components/inventory/InventorySyncPill";

interface InventoryCountSessionProps {
  countId: string;
  locationId: string;
  onClose: () => void;
  isEditing?: boolean;
  isViewOnly?: boolean;
  saveRef?: React.MutableRefObject<{ save: () => Promise<void>; isSaving: boolean } | null>;
}

interface CountItem {
  item_id: string;
  item_name: string;
  unit: string;
  storage_location: string;
  storage_location_id: string;
  par_level: number | null;
  cost_per_unit: number | null;
  pack_size: string | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  /** Phase 3: units per inner pack (sleeve/bundle/inner box). NULL = no inner-pack tier. */
  inner_pack_quantity: number | null;
  brand_item_id: string | null;
  item_number: string | null;
  brand: string | null;
  image_url: string | null;
  pan_sizes: PanSizesConfig | null;
  is_recipe: boolean;
  /** Recipe yield fields — passed through to canonical valuator so Count matches Review/COGS. */
  recipe_yield_qty?: number | null;
  recipe_yield_unit?: string | null;
  /** Per-shortcut counting mode: inherit uses global settings */
  count_by: 'inherit' | 'cases_and_units' | 'units_only' | 'cases_only';
}

// Count state: cases + pack tier + individual units (supports decimals for partial cases)
interface ItemCount {
  cases: number;
  units: number;
  /** Phase 4: optional pack tier between cases and individual units. Defaults to 0 when item has no inner_pack_quantity. */
  innerPacks?: number;
}

interface PendingEdit {
  countItemId: string | null;
  itemName: string;
  previousQuantity: number;
  newQuantity: number;
  itemId?: string;
  storageLocationId?: string;
  // Snapshot + entered fields so the edit save mirrors the autosave shape
  // (otherwise re-opening the count would show stale entered_cases / entered_units
  // and the next "Save Changes" pass would compute the diff against zero inputs).
  enteredCases?: number;
  enteredUnits?: number;
  enteredInnerPacks?: number;
  panInputs?: Record<string, number> | null;
  costAtCount?: number | null;
  packQuantityAtCount?: number | null;
  innerPackQuantityAtCount?: number | null;
  itemNameAtCount?: string | null;
  unitAtCount?: string | null;
  panSizesAtCount?: any | null;
}

const InventoryCountSession = ({ countId, locationId, onClose, isEditing = false, isViewOnly = false, saveRef }: InventoryCountSessionProps) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { setDockContent } = useDockToast();
  const { playSuccess, playError } = useInventoryVoiceFeedback();

  // Lock the session: blocks browser back / swipe / sidebar / location switcher
  // / PWA auto-reload while active. Released on unmount via the hook's cleanup.
  useInventoryCountLock({
    active: !isViewOnly,
    reason: isEditing ? "edit_mode" : "active_count",
  });
  const [currentLocationIndex, setCurrentLocationIndex] = useState(0);
  const [showEditNotice, setShowEditNotice] = useState(isEditing);
  const [counts, setCounts] = useState<Record<string, ItemCount>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, { cases: string; units: string; innerPacks?: string }>>({});
  // panCounts: itemId -> { panKey -> count of that pan }
  const [panCounts, setPanCounts] = useState<Record<string, Record<string, number>>>({});
  // rawPanInputs: itemId -> { panKey -> raw string while typing }
  const [rawPanInputs, setRawPanInputs] = useState<Record<string, Record<string, string>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [pendingVoiceText, setPendingVoiceText] = useState<string | null>(null);
  const [errorHighlightedItemId, setErrorHighlightedItemId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedSecondsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  
  // Edit tracking
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [editReason, setEditReason] = useState("");
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const originalCounts = useRef<Record<string, number>>({});

  const HEMET_LOCATION_ID = '12c977c7-1786-4131-90f5-1eef3f96e2c6';
  const SPINACH_BRAND_ITEM_ID = 'bfa8d2a6-f544-4695-ae2b-f610a66d5c91';
  const TRACE_ENABLED = import.meta.env.DEV && locationId === HEMET_LOCATION_ID;

  const traceSpinach = useCallback((stage: string, payload: Record<string, unknown>) => {
    if (!TRACE_ENABLED) return;
    console.log(`[InventoryTrace:${stage}]`, payload);
  }, [TRACE_ENABLED]);

  const exitEditMode = useCallback(() => {
    setShowEditConfirm(false);
    navigate(`/inventory/${locationId}/count/${countId}`);
  }, [navigate, locationId, countId]);

  // Fetch storage locations
  const { data: storageLocations } = useQuery({
    queryKey: ["inventory-storage-locations", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("*")
        .eq("location_id", locationId)
        .order("display_order");
      
      if (error) throw error;
      return data;
    }
  });

  // Fetch items with existing counts — supports split-count for multi-location items
  const { data: items } = useQuery({
    queryKey: ["inventory-items-for-count", locationId, countId],
    staleTime: 0, // Always refetch on mount to get fresh DB values (prevents stale cache on re-entry)
    gcTime: 0, // Don't cache this query — each session must load fresh from DB
    refetchOnWindowFocus: false, // Prevent app-switch from triggering refetch
    refetchOnMount: 'always', // Force refetch even if data exists in cache
    queryFn: async () => {
      const itemColumns = `
          id,
          name,
           
          unit,
          par_level,
          cost_per_unit,
          pack_size,
          pack_quantity,
          pack_quantity_override,
          inner_pack_quantity,
          inner_pack_label,
          brand_item_id,
          item_number,
          brand,
          image_url,
          pan_sizes,
          storage_location_id,
          is_recipe,
          countable,
          recipe_yield_unit,
          recipe_yield_qty,
          storage_location:inventory_locations(name)
      `;
      
      // Get all active items
      const { data: activeItems, error: itemsError } = await supabase
        .from("inventory_items")
        .select(itemColumns)
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("display_order");
      
      if (itemsError) throw itemsError;

      // Also fetch items already present in this count even if they are now inactive/hidden.
      // This keeps continue-counting, review totals, and historical counts in sync.
      let itemsData = activeItems || [];
      const { data: countItemIds } = await supabase
        .from("inventory_count_items")
        .select("item_id")
        .eq("count_id", countId);
      
      const activeIdSet = new Set((activeItems || []).map(i => i.id));
      const missingIds = (countItemIds || [])
        .map(ci => ci.item_id)
        .filter(id => !activeIdSet.has(id));
      
      if (missingIds.length > 0) {
        const uniqueMissingIds = [...new Set(missingIds)];
        const { data: inactiveItems } = await supabase
          .from("inventory_items")
          .select(itemColumns)
          .in("id", uniqueMissingIds);
        
        if (inactiveItems && inactiveItems.length > 0) {
          itemsData = [...itemsData, ...inactiveItems];
        }
      }

      // Fetch multi-location assignments from junction table (including count_by override, display_order, and per-shortcut pan/pack overrides)
      const { data: itemLocations } = await supabase
        .from("inventory_item_locations")
        .select("item_id, storage_location_id, count_by, display_order, pan_enabled_keys, pack_quantity_override");
      
      // Build map: item_id -> list of storage_location_ids
      const multiLocMap = new Map<string, string[]>();
      // Build map: "itemId|storLocId" -> count_by override
      const countByMap = new Map<string, string>();
      // Build map: "itemId|storLocId" -> display_order from junction table (for shortcuts)
      const junctionOrderMap = new Map<string, number>();
      // Build map: "itemId|storLocId" -> shortcut pan_enabled_keys override
      const junctionPanKeysMap = new Map<string, string[]>();
      // Build map: "itemId|storLocId" -> shortcut pack_quantity_override
      const junctionPackQtyMap = new Map<string, number>();
      for (const il of itemLocations || []) {
        const existing = multiLocMap.get(il.item_id) || [];
        existing.push(il.storage_location_id);
        multiLocMap.set(il.item_id, existing);
        countByMap.set(`${il.item_id}|${il.storage_location_id}`, il.count_by || 'inherit');
        if (typeof (il as any).display_order === 'number') {
          junctionOrderMap.set(`${il.item_id}|${il.storage_location_id}`, (il as any).display_order);
        }
        const panKeys = (il as any).pan_enabled_keys;
        if (Array.isArray(panKeys) && panKeys.length > 0) {
          junctionPanKeysMap.set(`${il.item_id}|${il.storage_location_id}`, panKeys);
        }
        const pkOverride = (il as any).pack_quantity_override;
        if (pkOverride != null) {
          junctionPackQtyMap.set(`${il.item_id}|${il.storage_location_id}`, pkOverride);
        }
      }

      // Get storage location names for lookup
      const { data: storLocs } = await supabase
        .from("inventory_locations")
        .select("id, name")
        .eq("location_id", locationId);
      const locNameMap = new Map((storLocs || []).map(l => [l.id, l.name]));

      // Get existing count items (include id for edit tracking)
      // Count items now use storage_location_id to distinguish split entries
      const { data: countItems, error: countError } = await supabase
        .from("inventory_count_items")
        .select("id, item_id, quantity, entered_cases, entered_units, entered_inner_packs, storage_location_id, cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count, pan_inputs")
        .eq("count_id", countId) as any;
      
      if (countError) throw countError;

      // Map: "itemId|storLocId" -> { quantity, countItemId, entered_cases, entered_units, entered_inner_packs, cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count, pan_inputs }
      // Phase 1: pan_inputs hydrated as source of truth.
      // Phase 3: entered_inner_packs + inner_pack_quantity_at_count hydrated for the third counting tier.
      const countMap = new Map(
        (countItems as any[])?.map((ci: any) => [
          `${ci.item_id}|${ci.storage_location_id || ''}`, 
          { quantity: ci.quantity, countItemId: ci.id, entered_cases: ci.entered_cases, entered_units: ci.entered_units, entered_inner_packs: ci.entered_inner_packs, cost_at_count: ci.cost_at_count, pack_quantity_at_count: ci.pack_quantity_at_count, inner_pack_quantity_at_count: ci.inner_pack_quantity_at_count, pan_inputs: ci.pan_inputs }
        ]) || []
      );
      // Also keep a simple item_id map for backwards compat (old counts without storage_location_id)
      const simpleCountMap = new Map((countItems as any[])?.map((ci: any) => [ci.item_id, { quantity: ci.quantity, countItemId: ci.id, entered_cases: ci.entered_cases, entered_units: ci.entered_units, entered_inner_packs: ci.entered_inner_packs, cost_at_count: ci.cost_at_count, pack_quantity_at_count: ci.pack_quantity_at_count, inner_pack_quantity_at_count: ci.inner_pack_quantity_at_count, pan_inputs: ci.pan_inputs }]) || []);

      const result: (CountItem & { _existingQuantity: number; _existingCases: number | null; _existingUnits: number | null; _countItemId: string | null; _splitKey: string })[] = [];

      // Phase 1 Option 2: side map of RAW (uncollapsed) pack values per item_id,
      // captured BEFORE the line 273 collapse. getItemCost reads from this so
      // calculateCountItemValue receives the same shape as Period/Review/Export.
      const rawPackMap = new Map<string, { pack_quantity: number | null; pack_quantity_override: number | null }>();
      for (const item of itemsData || []) {
        rawPackMap.set(item.id, {
          pack_quantity: (item as any).pack_quantity ?? null,
          pack_quantity_override: (item as any).pack_quantity_override ?? null,
        });
      }

      for (const item of itemsData || []) {
        // Exclude non-countable recipe items
        if ((item as any).is_recipe && (item as any).countable === false) continue;

        const isRecipe = (item as any).is_recipe === true;
        const multiLocs = multiLocMap.get(item.id);
        
        // Determine which storage locations this item should appear in
        // Always include the primary storage_location_id + any shortcut locations
        const primaryLoc = item.storage_location_id || null;
        const locIds: (string | null)[] = (multiLocs && multiLocs.length > 0)
          ? [primaryLoc, ...multiLocs.filter(l => l !== primaryLoc)]
          : [primaryLoc];

        for (const locId of locIds) {
          const splitKey = `${item.id}|${locId || ''}`;
          const countData = countMap.get(splitKey) || (locIds.length === 1 ? simpleCountMap.get(item.id) : undefined);
          
          // Determine sort order: shortcuts use junction display_order, primaries use item display_order
          const isPrimaryLoc = locId === primaryLoc;
          const sortOrder = isPrimaryLoc
            ? ((item as any).display_order ?? 9999)
            : (junctionOrderMap.get(`${item.id}|${locId}`) ?? 9999);

          result.push({
            item_id: item.id,
            item_name: item.name,
            // Recipes: count by produced unit (each ball/qt/etc), NOT by yield_unit (oz of dough).
            // cost_per_unit on a recipe is per-produced-unit, so counting must match that grain.
            unit: item.unit || 'ea',
            storage_location: isRecipe 
              ? (locId ? (locNameMap.get(locId) || "Recipes") : "Recipes")
              : (locId ? (locNameMap.get(locId) || "Uncategorized") : "Uncategorized"),
            storage_location_id: isRecipe 
              ? (locId || "recipes") 
              : (locId || "uncategorized"),
            par_level: item.par_level,
            cost_per_unit: item.cost_per_unit,
            pack_size: item.pack_size,
            // Effective pack qty: shortcut override (junction) > item override > item default
            pack_quantity: (locId ? junctionPackQtyMap.get(`${item.id}|${locId}`) : undefined)
              ?? (item as any).pack_quantity_override
              ?? item.pack_quantity,
            pack_quantity_override: null,
            // Phase 3: brand-level inner pack tier (NULL = no inner-pack input shown)
            inner_pack_quantity: (item as any).inner_pack_quantity ?? null,
            inner_pack_label: (item as any).inner_pack_label ?? null,
            brand_item_id: (item as any).brand_item_id ?? null,
            item_number: item.item_number,
            brand: item.brand,
            image_url: item.image_url,
            // Pan config: apply per-shortcut enabled_keys override if junction has one
            pan_sizes: (() => {
              const basePan = (item as any).pan_sizes ?? null;
              const shortcutKeys = locId ? junctionPanKeysMap.get(`${item.id}|${locId}`) : null;
              if (basePan && shortcutKeys && shortcutKeys.length > 0) {
                return { ...basePan, enabled_keys: shortcutKeys };
              }
              return basePan;
            })(),
            is_recipe: isRecipe,
            // Recipe yield fields — required for canonical valuation parity with Review/COGS.
            // Without these, calculateCountItemValue's yield branch is skipped and recipe items
            // are valued at qty × batchCost instead of qty × (batchCost / yield_qty), inflating
            // the Count screen total vs. Review.
            recipe_yield_qty: (item as any).recipe_yield_qty ?? null,
            recipe_yield_unit: (item as any).recipe_yield_unit ?? null,
            count_by: (locId ? countByMap.get(`${item.id}|${locId}`) : 'inherit') as CountItem['count_by'] || 'inherit',
            _existingQuantity: countData?.quantity ?? 0,
            _existingCases: countData?.entered_cases ?? null,
            _existingUnits: countData?.entered_units ?? null,
            _existingPanInputs: (countData as any)?.pan_inputs ?? null,
            _existingInnerPacks: (countData as any)?.entered_inner_packs ?? null,
            _costAtCount: (countData as any)?.cost_at_count ?? null,
            _packQuantityAtCount: (countData as any)?.pack_quantity_at_count ?? null,
            _innerPackQuantityAtCount: (countData as any)?.inner_pack_quantity_at_count ?? null,
            _countItemId: countData?.countItemId || null,
            _splitKey: splitKey,
            _sortOrder: sortOrder,
            // Raw uncollapsed pack values (before line 284 collapse) for SOT parity
            _rawPackQuantity: rawPackMap.get(item.id)?.pack_quantity ?? null,
            _rawPackQuantityOverride: rawPackMap.get(item.id)?.pack_quantity_override ?? null,
          } as any);
        }
      }

      return result;
    }
  });

  // Fetch recipe costs for on-the-fly calculation
  const { data: recipeCosts } = useQuery({
    queryKey: ["recipe-costs", locationId],
    queryFn: () => fetchRecipeCosts(locationId),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Resolve brand for Pipeline 1 conversion fallback (standard SOT contract)
  const { data: brandId } = useQuery({
    queryKey: ["location-brand-id", locationId],
    queryFn: () => resolveBrandId(locationId),
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
  });
  const { conversionMap } = useBrandConversions(brandId);

  // Per-location lens gate. Default false on every store. The lens read path
  // activates ONLY when this is true AND an approved config exists for the item.
  // When false/null, lens is never attached → resolver behaves byte-for-byte
  // like today regardless of how many approved configs exist brand-wide.
  const { data: lensEnabledForLocation } = useQuery({
    queryKey: ["location-lens-enabled", locationId],
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations" as any)
        .select("lens_enabled")
        .eq("id", locationId)
        .maybeSingle();
      if (error) throw error;
      return (data as any)?.lens_enabled === true;
    },
  });

  // Per-location legs gate (Step 2a — render-only preview of multi-config legs).
  // Default false on every store. Hemet is the canary. When false/null, the
  // multi-config selections fetch and the read-only legs block below are both
  // skipped → byte-for-byte identical render at every other store.
  // Legs queries (enabled flag, configs map, hydration map) are owned by
  // useLegsValuation — single source of truth shared with Review / Export /
  // period summary / future COGS+Variance. Session still builds its own
  // live-input legs[] payload inside getItemCost (it reads from rawInputs,
  // not from persisted snapshots), but it now pulls the same config + flag
  // data so the queries don't run twice on the page.
  const {
    legsEnabled: legsEnabledForLocationRaw,
    legsByCountItemId,
    legsConfigsByBrandItemId: legsConfigsMap,
    getItemValueWithLegs,
  } = useLegsValuation(countId, locationId);
  // Session's downstream code expects `boolean | undefined` (loading state
  // distinguished from "off") — preserve that shape.
  const legsEnabledForLocation: boolean | undefined =
    locationId == null ? undefined : legsEnabledForLocationRaw;


  // Lens (approved brand_pack_configs) — keyed by brand_item_id (= brand_template_id).
  // Read-path only; resolver falls back to local when missing. Snapshots still win.
  // Skipped entirely when the location gate is off.
  const { data: packLensMap } = useQuery({
    queryKey: ["pack-config-lens", brandId, lensEnabledForLocation],
    enabled: !!brandId && lensEnabledForLocation === true,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_pack_configs" as any)
        .select("brand_template_id, count_units_per_case, cost_per_common_unit, common_unit, outer_qty, outer_type, inner_qty, inner_type, status")
        .eq("status", "approved");
      if (error) throw error;
      const map = new Map<string, {
        count_units_per_case: number | null;
        cost_per_common_unit: number | null;
        common_unit: string | null;
        outer_qty: number | null;
        outer_type: string | null;
        inner_qty: number | null;
        inner_type: string | null;
      }>();
      for (const row of (data as any[]) || []) {
        if (!row?.brand_template_id) continue;
        map.set(row.brand_template_id, {
          count_units_per_case: row.count_units_per_case,
          cost_per_common_unit: row.cost_per_common_unit,
          common_unit: row.common_unit,
          outer_qty: row.outer_qty,
          outer_type: row.outer_type,
          inner_qty: row.inner_qty,
          inner_type: row.inner_type,
        });
      }
      return map;
    },
  });

  // legsConfigsMap (configs by brand_template_id) and legsHydrationMap
  // (entered values by `${count_item_id}|${pack_config_id}`) both derive
  // from the shared useLegsValuation hook above — no duplicate queries.
  const legsHydrationMap = useMemo(() => {
    const map = new Map<string, { entered_cases: number | null; entered_inner_packs: number | null; entered_units: number | null; quantity_common: number | null }>();
    for (const [countItemId, legs] of legsByCountItemId) {
      for (const leg of legs) {
        if (!leg.pack_config_id) continue;
        map.set(`${countItemId}|${leg.pack_config_id}`, {
          entered_cases: leg.entered_cases,
          entered_inner_packs: leg.entered_inner_packs,
          entered_units: leg.entered_units,
          quantity_common: leg.quantity_common,
        });
      }
    }
    return map;
  }, [legsByCountItemId]);



  // Fetch existing duration for resumed counts
  const { data: countRecord } = useQuery({
    queryKey: ["inventory-count-duration", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("duration_seconds")
        .eq("id", countId)
        .single();
      if (error) throw error;
      return data;
    }
  });

  // Initialize counts from items — ONLY ONCE on first load
  // Uses entered_cases/entered_units when available (preserves raw user input)
  // Falls back to decomposing quantity for legacy counts
  const countsInitializedRef = useRef(false);
  // Track whether counts have been fully initialized from DB — used to guard autosave
  const countsReadyRef = useRef(false);
  useEffect(() => {
    if (!items || countsInitializedRef.current) return;
    countsInitializedRef.current = true;
    
    const initialCounts: Record<string, ItemCount> = {};
    const initialPanCounts: Record<string, Record<string, number>> = {};
    const originals: Record<string, number> = {};
    
    items.forEach(item => {
      const key = (item as any)._splitKey || item.item_id;
      const existingCases = (item as any)._existingCases;
      const existingUnits = (item as any)._existingUnits;
      const existingInnerPacks = (item as any)._existingInnerPacks;
      const existingPanInputs = (item as any)._existingPanInputs;
      const totalUnits = (item as any)._existingQuantity || 0;
      // For previously-saved rows, the effective pack qty must match the one used
      // when the row was saved — otherwise shortcut/junction pack-qty overrides
      // applied later would fabricate phantom diffs on edit.
      const packQty = (item as any)._packQuantityAtCount ?? item.pack_quantity ?? 1;
      // Phase 3: snapshot inner_pack_quantity at save time, fall back to live for new rows.
      const innerPackQty = (item as any)._innerPackQuantityAtCount ?? (item as any).inner_pack_quantity ?? null;
      const caseUnits = innerPackQty != null && innerPackQty > 0 ? packQty * innerPackQty : packQty;
      
      // PHASE 1 (source of truth): entered_cases / entered_units / entered_inner_packs / pan_inputs
      // are the authoritative inputs. `quantity` is derived only at save time and is
      // never read here. Fall back to decomposing quantity ONLY for truly legacy
      // rows that never stored the split (all fields null).
      const hasStoredInput =
        (existingCases !== null && existingCases !== undefined) ||
        (existingUnits !== null && existingUnits !== undefined) ||
        (existingInnerPacks !== null && existingInnerPacks !== undefined);
      if (hasStoredInput) {
        initialCounts[key] = {
          cases: existingCases ?? 0,
          units: existingUnits ?? 0,
          innerPacks: existingInnerPacks ?? 0,
        };
      } else {
        const wholeCases = Math.floor(totalUnits / caseUnits);
        const afterCases = totalUnits - (wholeCases * caseUnits);
        const wholeInnerPacks = innerPackQty != null && innerPackQty > 0 ? Math.floor(afterCases / innerPackQty) : 0;
        const remainingUnits = afterCases - (wholeInnerPacks * (innerPackQty ?? 0));
        initialCounts[key] = {
          cases: wholeCases,
          units: remainingUnits,
          innerPacks: wholeInnerPacks,
        };
      }

      // Hydrate persisted pan inputs so pan-counted rows restore at full value
      // instead of $0 on Edit Count load.
      if (existingPanInputs && typeof existingPanInputs === 'object') {
        const panMap: Record<string, number> = {};
        for (const [panKey, qty] of Object.entries(existingPanInputs as Record<string, any>)) {
          const n = Number(qty);
          if (Number.isFinite(n) && n > 0) panMap[panKey] = n;
        }
        if (Object.keys(panMap).length > 0) initialPanCounts[key] = panMap;
      }

      // Dev validator: flag rows where stored quantity disagrees with derived
      // (cases × pack + inner_packs × inner_pack + units + pan units).
      if (import.meta.env.DEV && hasStoredInput) {
        const panTotal = Object.entries(initialPanCounts[key] || {}).reduce((sum, [pk, qty]) => {
          const unitsPer = item.pan_sizes ? (getPanUnits(item.pan_sizes, pk) ?? 0) : 0;
          return sum + unitsPer * (qty as number);
        }, 0);
        const innerPackTerm = innerPackQty != null ? (existingInnerPacks ?? 0) * innerPackQty : 0;
        const derived = (existingCases ?? 0) * caseUnits + innerPackTerm + (existingUnits ?? 0) + panTotal;
        if (Math.abs(derived - totalUnits) > 0.01) {
          // eslint-disable-next-line no-console
          console.warn('[hydration-validator] quantity drift', {
            name: (item as any).item_name,
            key,
            storedQuantity: totalUnits,
            derived,
            cases: existingCases, units: existingUnits, innerPacks: existingInnerPacks, packQty, innerPackQty, panTotal,
          });
        }
      }
      
      // Store original quantities for edit tracking.
      // CRITICAL: derive the baseline from the SAME formula getTotalQuantity uses
      // (cases × caseUnits + innerPacks × innerPackQty + units + panUnits) so the
      // edit-mode "is this a change?" check compares apples to apples with what
      // the user sees in the input fields. Comparing against the stored `quantity`
      // produces phantom diffs (or, worse, hides real diffs) whenever the legacy
      // quantity column drifted from the entered split — e.g. recipes whose
      // quantity was bumped by a prior edit but whose entered_cases stayed at 0.
      if (isEditing) {
        if (hasStoredInput) {
          const baseCases = existingCases ?? 0;
          const baseUnits = existingUnits ?? 0;
          const baseInner = existingInnerPacks ?? 0;
          const basePan = Object.entries(initialPanCounts[key] || {}).reduce((sum, [pk, qty]) => {
            const u = item.pan_sizes ? (getPanUnits(item.pan_sizes, pk) ?? 0) : 0;
            return sum + u * (qty as number);
          }, 0);
          originals[key] = Math.round(
            (baseCases * caseUnits + baseInner * (innerPackQty || 0) + baseUnits + basePan) * 100
          ) / 100;
        } else {
          originals[key] = totalUnits;
        }
      }
    });
    
    setCounts(initialCounts);
    if (Object.keys(initialPanCounts).length > 0) setPanCounts(initialPanCounts);
    // Mark counts as ready AFTER state is set (next tick)
    setTimeout(() => { countsReadyRef.current = true; }, 0);
    if (isEditing) {
      originalCounts.current = originals;
    }
  }, [items, isEditing]);

  // 2b: per-leg input key. Default leg shares the bare _splitKey with the top
  // stepper (so the existing UI keeps driving it). Non-default legs use a
  // suffixed key that can't collide with the existing `|`-delimited splitKey
  // namespace.
  const makeLegInputKey = useCallback(
    (splitKey: string, packConfigId: string, isDefault: boolean) =>
      isDefault ? splitKey : `${splitKey}::leg::${packConfigId}`,
    [],
  );

  // 2b: hydrate non-default leg inputs from inventory_count_item_legs once the
  // legs hydration query lands. Runs once per mount; default-leg state stays
  // owned by the existing init effect above.
  const legsHydratedRef = useRef(false);
  // Separate guard for the edit-mode baseline override pass. The main
  // hydration may have run before `isEditing` flipped true (parent prop /
  // lock hook resolves async), which would silently skip the baseline
  // override and produce phantom diffs in the Save dialog. This ref lets
  // the baseline pass run exactly once when isEditing becomes true.
  const legsBaselineHydratedRef = useRef(false);
  useEffect(() => {
    const baselineDone = !isEditing || legsBaselineHydratedRef.current;
    if (legsHydratedRef.current && baselineDone) return;
    if (!items || !legsHydrationMap) return;
    if (legsEnabledForLocation !== true) return;
    if (!legsConfigsMap) return;
    const firstRun = !legsHydratedRef.current;
    legsHydratedRef.current = true;
    if (isEditing) legsBaselineHydratedRef.current = true;

    const additions: Record<string, ItemCount> = {};
    const rawAdditions: Record<string, { cases: string; units: string; innerPacks: string }> = {};
    // Fix (A): for multi-leg items in edit mode, the parent-row baseline computed
    // at lines 683-685 uses the parent's snapshotted pack_quantity_at_count, which
    // for split items is outer_qty (not count_units_per_case) and produces phantom
    // diffs in the edit dialog. The legs table is the source of truth for split
    // quantities, so derive the baseline from SUM(legs.quantity_common) instead.
    // Single-config items skip this branch (configs.length < 2) and keep the
    // existing baseline formula unchanged. Edit-tracking only — write path is
    // not touched.
    const legBaselineOverrides: Record<string, number> = {};
    for (const item of items) {
      const countItemId = (item as any)._countItemId;
      const splitKey = (item as any)._splitKey || item.item_id;
      if (!countItemId || !item.brand_item_id) continue;
      const configs = legsConfigsMap?.get(item.brand_item_id) ?? [];
      if (configs.length < 2) continue;
      if (isEditing) {
        // Multi-config totals must use the SAME per-leg math as the stored leg
        // rows and the write RPC: cases × cfg.count_units_per_case +
        // inner_packs × cfg.inner_qty + units. The default leg cannot reuse the
        // generic item/lens resolver because items like Baby Spinach expose a
        // bag lane only through the default pack-config (inner_qty=2.5), not
        // item.inner_pack_quantity. Reusing item-level math is what rendered 26
        // on reopen instead of the true 28.5.
        const itemPackQty = resolveItemPackQty(item);
        const itemInnerQty = resolveInnerPackQtyForTotal(item) ?? 0;
        let baseline = 0;
        for (const cfg of configs) {
          const leg = legsHydrationMap.get(`${countItemId}|${cfg.pack_config_id}`);
          if (!leg) continue;
          const c = Number(leg.entered_cases ?? 0) || 0;
          const u = Number(leg.entered_units ?? 0) || 0;
          const ip = Number(leg.entered_inner_packs ?? 0) || 0;
          const cu = Number(cfg.count_units_per_case ?? 0) || 0;
          const ipq = Number(cfg.inner_qty ?? 0) || 0;
          baseline += c * cu + ip * ipq + u;
        }
        // Pan portion: init effect already stamped originals[splitKey] =
        // parent-row base + pan units. Re-derive parent-row base the same way
        // the init effect did (item-level multipliers × parent entered_*), then
        // pan = priorBaseline − parentBase. This preserves pan without needing
        // panCounts in the closure.
        const parentCases = Number((item as any)._existingCases ?? 0) || 0;
        const parentUnits = Number((item as any)._existingUnits ?? 0) || 0;
        const parentInner = Number((item as any)._existingInnerPacks ?? 0) || 0;
        const parentBase =
          parentCases * itemPackQty + parentInner * itemInnerQty + parentUnits;
        const priorBaseline = originalCounts.current[splitKey] ?? 0;
        const panPortion = Math.max(0, priorBaseline - parentBase);
        legBaselineOverrides[splitKey] =
          Math.round((baseline + panPortion) * 100) / 100;
      }
      // Default-leg override: for multi-leg items, the legs table is the source
      // of truth for BOTH the default-leg stepper (bare splitKey) and non-default
      // leg keys. The parent row's entered_cases/units may have drifted from a
      // prior bad save, so hydrate the default-leg stepper from the default leg
      // row's entered_* values instead of the parent row.
      for (const cfg of configs) {
        const leg = legsHydrationMap.get(`${countItemId}|${cfg.pack_config_id}`);
        if (!leg) continue;
        const c = leg.entered_cases ?? 0;
        const u = leg.entered_units ?? 0;
        const ip = leg.entered_inner_packs ?? 0;
        const k = cfg.is_default ? splitKey : makeLegInputKey(splitKey, cfg.pack_config_id, false);
        if (item.brand_item_id === SPINACH_BRAND_ITEM_ID) {
          traceSpinach('hydrate-leg-row', {
            itemName: item.item_name,
            splitKey,
            legKey: k,
            isDefault: cfg.is_default,
            packConfigId: cfg.pack_config_id,
            countItemId,
            entered_cases: c,
            entered_inner_packs: ip,
            entered_units: u,
            quantity_common: leg.quantity_common ?? null,
          });
        }
        additions[k] = { cases: c, units: u, innerPacks: ip };
        rawAdditions[k] = { cases: String(c), units: String(u), innerPacks: String(ip) };
      }
    }
    if (isEditing && Object.keys(legBaselineOverrides).length > 0) {
      originalCounts.current = { ...originalCounts.current, ...legBaselineOverrides };
    }
    if (!firstRun) return;
    if (Object.keys(additions).length === 0) return;
    traceSpinach('hydrate-leg-state-merge', {
      keys: Object.keys(additions),
      additions,
    });
    // For multi-leg items, additions (from legs table) must WIN over prev
    // (parent-row hydration) on splitKey collisions — legs are source of truth.
    // Non-default leg keys never collide with prev, so they're additive either way.
    setCounts(prev => ({ ...prev, ...additions }));
    setRawInputs(prev => ({ ...prev, ...rawAdditions }));

  }, [items, legsHydrationMap, legsConfigsMap, legsEnabledForLocation, makeLegInputKey, isEditing]);

  // Initialize timer from existing duration (for resumed counts)
  useEffect(() => {
    if (countRecord?.duration_seconds != null) {
      setElapsedSeconds(countRecord.duration_seconds);
    }
  }, [countRecord]);

  // Group items by storage location and sort within each group by unified display_order
  const itemsByLocation = items?.reduce((acc, item) => {
    const locId = item.storage_location_id;
    if (!acc[locId]) {
      acc[locId] = {
        name: item.storage_location,
        items: []
      };
    }
    acc[locId].items.push(item);
    return acc;
  }, {} as Record<string, { name: string; items: CountItem[] }>) || {};
  
  // Sort items within each location by their unified _sortOrder
  for (const locId of Object.keys(itemsByLocation)) {
    itemsByLocation[locId].items.sort((a, b) => 
      ((a as any)._sortOrder ?? 9999) - ((b as any)._sortOrder ?? 9999)
    );
  }

  // Sort location keys by storage location display_order
  const locationKeys = Object.keys(itemsByLocation).sort((a, b) => {
    const orderA = storageLocations?.find(sl => sl.id === a)?.display_order ?? 999;
    const orderB = storageLocations?.find(sl => sl.id === b)?.display_order ?? 999;
    return orderA - orderB;
  });
  const currentLocation = locationKeys[currentLocationIndex];
  const currentItems = currentLocation ? itemsByLocation[currentLocation].items : [];

  // Calculate total units from pan counts for an item
  const getPanUnitsTotal = useCallback((itemId: string, panSizes: PanSizesConfig | null): number => {
    if (!panSizes?.enabled || !panCounts[itemId]) return 0;
    return Object.entries(panCounts[itemId]).reduce((sum, [key, qty]) => {
      const unitsPer = getPanUnits(panSizes, key);
      return sum + (unitsPer ?? 0) * qty;
    }, 0);
  }, [panCounts]);

  // === Unified pack-shape resolver ===
  // Single entry point — snapshot > lens > local — used by every downstream
  // consumer (lane decisions, header subtitle, valuation, save snapshot).
  // Strict null/undefined checks: stale non-null local values no longer
  // silently beat the approved lens config. See src/utils/resolveItemPackShape.ts.
  const getShape = useCallback((item: any): ResolvedPackShape => {
    if (!item) {
      return { packQty: 1, innerPackQty: null, innerLabel: null, outerLabel: null, unit: "ea", costPerCase: null, source: "local" };
    }
    const lens = (lensEnabledForLocation === true && item.brand_item_id)
      ? packLensMap?.get(item.brand_item_id) ?? null
      : null;
    return resolveItemPackShape(
      {
        pack_quantity_at_count: item.pack_quantity_at_count ?? null,
        inner_pack_quantity_at_count: item.inner_pack_quantity_at_count ?? null,
        pack_quantity: item.pack_quantity ?? null,
        pack_quantity_override: item.pack_quantity_override ?? null,
        _rawPackQuantity: item._rawPackQuantity ?? null,
        _rawPackQuantityOverride: item._rawPackQuantityOverride ?? null,
        inner_pack_quantity: item.inner_pack_quantity ?? null,
        inner_pack_label: item.inner_pack_label ?? null,
        unit: item.unit ?? null,
        cost_per_unit: item.cost_per_unit ?? null,
      },
      lens as any,
    );
  }, [packLensMap, lensEnabledForLocation]);

  // Thin wrappers preserved for call-site compatibility. Single source of
  // truth = getShape; these just project the relevant field.
  const resolveItemPackQty = useCallback(
    (item: any): number => getShape(item).packQty,
    [getShape],
  );
  const resolveInnerPackQtyForTotal = useCallback(
    (item: any): number | null => getShape(item).innerPackQty,
    [getShape],
  );

  // Calculate total quantity for an item:
  //   cases × (pack_quantity × inner_pack_quantity when present, else pack_quantity)
  //   + inner_packs × inner_pack_quantity + units + pan_units
  // Uses rawInputs if available (live typing), falls back to committed counts.
  // innerPackQuantity is null/undefined for items without an inner-pack tier — that term collapses to 0.
  const getTotalQuantity = useCallback((itemId: string, packQuantity: number | null, panSizes?: PanSizesConfig | null, innerPackQuantity?: number | null) => {
    const packQty = packQuantity || 1;
    const innerPackQty = innerPackQuantity || 0;
    const caseUnits = innerPackQty > 0 ? packQty * innerPackQty : packQty;
    // Prefer live rawInputs so cost updates while the user is typing
    const rawCases = parseFloat(rawInputs[itemId]?.cases ?? '');
    const rawUnits = parseFloat(rawInputs[itemId]?.units ?? '');
    const rawInner = parseFloat(rawInputs[itemId]?.innerPacks ?? '');
    const committed = counts[itemId] || { cases: 0, units: 0, innerPacks: 0 };
    const casesVal = isNaN(rawCases) ? committed.cases : Math.max(0, rawCases);
    const unitsVal = isNaN(rawUnits) ? committed.units : Math.max(0, rawUnits);
    const innerVal = isNaN(rawInner) ? (committed.innerPacks ?? 0) : Math.max(0, rawInner);
    const panUnits = panSizes !== undefined ? getPanUnitsTotal(itemId, panSizes) : 0;
    return Math.round((casesVal * caseUnits + innerVal * innerPackQty + unitsVal + panUnits) * 100) / 100;
  }, [counts, rawInputs, getPanUnitsTotal]);

  // For multi-leg items, the parent's total quantity = default leg (via
  // getTotalQuantity on the bare splitKey) + sum of every non-default leg's
  // (cases × leg.count_units_per_case + innerPacks × leg.inner_qty + units).
  // Mirrors the exact formula used when writing legs (line ~1546). Single-config
  // items just return getTotalQuantity unchanged.
  const getItemTotalIncludingLegs = useCallback((
    item: CountItem,
    splitKey: string,
    defaultPackQty: number | null,
    defaultInnerPackQty: number | null,
  ): number => {
    const base = getTotalQuantity(splitKey, defaultPackQty, item.pan_sizes, defaultInnerPackQty);
    const bid = (item as any).brand_item_id;
    if (legsEnabledForLocation !== true || !bid) return base;
    const cfgs = legsConfigsMap?.get(bid) ?? [];
    if (cfgs.length < 2) return base;
    const panUnits = item.pan_sizes !== undefined ? getPanUnitsTotal(splitKey, item.pan_sizes) : 0;
    let total = panUnits;
    for (const cfg of cfgs) {
      const legKey = cfg.is_default ? splitKey : `${splitKey}::leg::${cfg.pack_config_id}`;
      const rawCases = parseFloat(rawInputs[legKey]?.cases ?? '');
      const rawUnits = parseFloat(rawInputs[legKey]?.units ?? '');
      const rawInner = parseFloat(rawInputs[legKey]?.innerPacks ?? '');
      const committed = counts[legKey] || { cases: 0, units: 0, innerPacks: 0 };
      const c = isNaN(rawCases) ? committed.cases : Math.max(0, rawCases);
      const u = isNaN(rawUnits) ? committed.units : Math.max(0, rawUnits);
      const ip = isNaN(rawInner) ? (committed.innerPacks ?? 0) : Math.max(0, rawInner);
      const cu = Number(cfg.count_units_per_case ?? 0);
      const ipq = Number(cfg.inner_qty ?? 0);
      total += c * cu + ip * ipq + u;
    }
    return Math.round(total * 100) / 100;
  }, [getTotalQuantity, getPanUnitsTotal, legsEnabledForLocation, legsConfigsMap, counts, rawInputs]);

  // Calculate cost for a single item (supports recipe cost trickle-down)
  // key param allows split-count items to be identified by splitKey
  // Uses the shared SOT formula from src/utils/countItemValue.ts so the running
  // total in this Edit Count view matches Period view, Review view, and Export.
  const getItemCost = useCallback((item: CountItem & {
    _splitKey?: string;
    _existingQuantity?: number;
    _existingCases?: number | null;
    _existingUnits?: number | null;
    _costAtCount?: number | null;
  }) => {
    const key = (item as any)._splitKey || item.item_id;

    // Edit mode snapshot path (hoisted ABOVE the recipe batchCost branch):
    // when viewing a submitted count and the user hasn't typed into this row,
    // value it from the persisted cost_at_count / pack_quantity_at_count
    // snapshots via the same hook Review and COGS use. This applies to
    // recipe items too — otherwise live batchCost drift (ingredient cost
    // changes after submit) would make the session total disagree with
    // Review/COGS. Once the user edits the row, the live recompute path
    // below takes over so pending changes are reflected immediately.
    if (
      isEditing &&
      (item as any)._countItemId &&
      ((item as any)._costAtCount != null || (item as any)._packQuantityAtCount != null) &&
      !rawInputs[(item as any)._splitKey || item.item_id]
    ) {
      const conv = item.brand_item_id ? conversionMap.get(item.brand_item_id) : null;
      return getItemValueWithLegs(
        {
          id: (item as any)._countItemId,
          quantity: Number((item as any)._existingQuantity ?? 0),
          entered_cases: (item as any)._existingCases ?? null,
          entered_units: (item as any)._existingUnits ?? null,
          entered_inner_packs: (item as any)._existingInnerPacks ?? null,
          cost_at_count: (item as any)._costAtCount ?? null,
          pack_quantity_at_count: (item as any)._packQuantityAtCount ?? null,
          inner_pack_quantity_at_count: (item as any)._innerPackQuantityAtCount ?? null,
        },
        {
          brand_item_id: item.brand_item_id,
          cost_per_unit: item.cost_per_unit,
          pack_quantity: (item as any)._rawPackQuantity ?? item.pack_quantity,
          pack_quantity_override: (item as any)._rawPackQuantityOverride ?? null,
          inner_pack_quantity: (item as any).inner_pack_quantity || null,
          is_recipe: (item as any).is_recipe === true,
          unit: (item as any).unit,
          recipe_yield_qty: (item as any).recipe_yield_qty,
          recipe_yield_unit: (item as any).recipe_yield_unit,
        },
        conv || null,
      );
    }

    // Recipe items: route through the canonical calculator so yield-qty
    // division applies (counted unit may differ from yield unit).
    const batchCost = recipeCosts?.get(item.item_id);
    if (batchCost !== undefined && batchCost > 0) {
      const totalUnits = getTotalQuantity(key, 1, item.pan_sizes);
      return calculateCountItemValue(
        {
          quantity: totalUnits,
          entered_cases: null,
          entered_units: null,
          entered_inner_packs: null,
          cost_at_count: null,
          pack_quantity_at_count: null,
          inner_pack_quantity_at_count: null,
        },
        {
          cost_per_unit: batchCost,
          is_recipe: true,
          unit: (item as any).unit,
          recipe_yield_qty: (item as any).recipe_yield_qty,
          recipe_yield_unit: (item as any).recipe_yield_unit,
        },
        null,
        true
      );
    }


    // Live values (mid-typing) override saved values
    const rawCases = parseFloat(rawInputs[key]?.cases ?? '');
    const rawUnits = parseFloat(rawInputs[key]?.units ?? '');
    const rawInner = parseFloat(rawInputs[key]?.innerPacks ?? '');
    const committed = counts[key] || { cases: 0, units: 0, innerPacks: 0 };
    const casesVal = isNaN(rawCases) ? committed.cases : Math.max(0, rawCases);
    const unitsVal = isNaN(rawUnits) ? committed.units : Math.max(0, rawUnits);
    const innerVal = isNaN(rawInner) ? (committed.innerPacks ?? 0) : Math.max(0, rawInner);
    const panUnits = item.pan_sizes !== undefined ? getPanUnitsTotal(key, item.pan_sizes) : 0;

    // [hydration-drift diagnostic] compare hydrated counts vs DB existing values
    const dbCases = Number((item as any)._existingCases ?? 0);
    const dbUnits = Number((item as any)._existingUnits ?? 0);
    if (Math.abs(casesVal - dbCases) > 0.01 || Math.abs(unitsVal - dbUnits) > 0.01) {
      // eslint-disable-next-line no-console
      console.log('[hydration-drift]', {
        name: (item as any).item_name,
        splitKey: key,
        casesVal, dbCases,
        unitsVal, dbUnits,
        panUnits,
        innerPacksVal: innerVal,
        innerPackQty: (item as any).inner_pack_quantity ?? null,
      });
    }

    // PHASE 1: forceLiveData=true — Edit Count must match Period/Review/Export by
    // recomputing every line via current live cost + live pack chain, ignoring
    // any cost_at_count / pack_quantity_at_count snapshot.
    // Standard contract: pass entered_cases / entered_units (no synthesized quantity);
    // pass full item shape; pass Pipeline 1 conversion lookup.
    const conversion = item.brand_item_id ? conversionMap.get(item.brand_item_id) : null;
    // Per-location gate: only attach lens when the store has opted in.
    // Defense-in-depth — the query is also disabled when the flag is off,
    // but checking here too means a stale map can never leak through.
    const lens = (lensEnabledForLocation === true && item.brand_item_id)
      ? packLensMap?.get(item.brand_item_id) ?? null
      : null;
    const shape = getShape(item);
    const innerPackQty = Number(shape.innerPackQty ?? 0) || 0;

    // Multi-config (Path B): when legs are enabled AND this item has 2+ selected
    // pack configs, build a synthetic legs[] payload so calculateCountItemValue
    // values each leg with its own pack_qty + per-case cost. Per interpretation
    // (a) confirmed 2026-05-31:
    //   commonUnitCost = item.cost_per_unit / defaultCfg.count_units_per_case
    //   leg.cost_at_count = cfg.count_units_per_case × commonUnitCost
    // If either piece is missing/zero, fall through to today's parent-row math
    // (no legs passed). Single-config items never enter this branch.
    let legsForValuation: Array<{
      entered_cases: number | null;
      entered_units: number | null;
      entered_inner_packs: number | null;
      quantity_common: number | null;
      pack_quantity_at_count: number | null;
      inner_pack_quantity_at_count: number | null;
      cost_at_count: number | null;
    }> | undefined;
    const bidForLegs = item.brand_item_id;
    if (legsEnabledForLocation === true && bidForLegs) {
      const cfgs = legsConfigsMap?.get(bidForLegs) ?? [];
      if (cfgs.length >= 2) {
        const defaultCfg = cfgs.find((c: any) => c.is_default) ?? cfgs[0];
        const defaultUnitsPerCase = Number(defaultCfg?.count_units_per_case ?? 0);
        const costPerCase = Number(item.cost_per_unit ?? 0);
        const commonUnitCost = (defaultUnitsPerCase > 0 && costPerCase > 0)
          ? costPerCase / defaultUnitsPerCase
          : null;
        if (commonUnitCost != null) {
          legsForValuation = cfgs.map((cfg: any) => {
            const legKey = cfg.is_default ? key : `${key}::leg::${cfg.pack_config_id}`;
            const rCases = parseFloat(rawInputs[legKey]?.cases ?? '');
            const rUnits = parseFloat(rawInputs[legKey]?.units ?? '');
            const rInner = parseFloat(rawInputs[legKey]?.innerPacks ?? '');
            const committedLeg = counts[legKey] || { cases: 0, units: 0, innerPacks: 0 };
            const c = isNaN(rCases) ? committedLeg.cases : Math.max(0, rCases);
            const u = isNaN(rUnits) ? committedLeg.units : Math.max(0, rUnits);
            const ip = isNaN(rInner) ? (committedLeg.innerPacks ?? 0) : Math.max(0, rInner);
            const cu = Number(cfg.count_units_per_case ?? 0);
            const ipq = Number(cfg.inner_qty ?? 0);
            // qc = total common units for this leg. Pans live on the parent /
            // default leg only — fold them in so pan-counted inventory is valued.
            let qc = c * cu + ip * ipq + u;
            if (cfg.is_default) qc += panUnits;
            // Pass quantity=qc + entered_cases only. zero out entered_units /
            // entered_inner_packs so calculateCountItemValue doesn't double-count
            // via the fallback path. Skip inner_pack_quantity_at_count to avoid
            // the caseUnits = pack × inner inflation bug on legs whose "inner"
            // lane is the de-facto case lane (outer_qty=1 multi-config items).
            // Math reduces cleanly to qc × commonUnitCost per leg.
            return {
              entered_cases: c,
              entered_units: 0,
              entered_inner_packs: 0,
              quantity_common: qc,
              pack_quantity_at_count: cu > 0 ? cu : null,
              inner_pack_quantity_at_count: null,
              cost_at_count: cu > 0 ? cu * commonUnitCost : null,
            };
          });
        }
      }
    }

    const result = calculateCountItemValue(
      {
        quantity: null,
        entered_cases: casesVal,
        entered_units: unitsVal + panUnits,
        entered_inner_packs: innerVal,
        cost_at_count: null,
        pack_quantity_at_count: null,
        inner_pack_quantity_at_count: innerPackQty || null,
      },
      {
        brand_item_id: item.brand_item_id,
        cost_per_unit: item.cost_per_unit,
        // Option 2: pass RAW uncollapsed pack values (captured pre-collapse on line 284)
        // so calculateCountItemValue receives the same shape as Period/Review/Export.
        pack_quantity: (item as any)._rawPackQuantity ?? item.pack_quantity,
        pack_quantity_override: (item as any)._rawPackQuantityOverride ?? null,
        inner_pack_quantity: innerPackQty || null,
        is_recipe: (item as any).is_recipe === true,
        unit: (item as any).unit,
        recipe_yield_qty: (item as any).recipe_yield_qty,
        recipe_yield_unit: (item as any).recipe_yield_unit,
        lens, // approved brand_pack_configs entry; resolver fails closed to local when invalid
      },
      conversion || null,
      true,
      legsForValuation
    );

    return result;
  }, [counts, rawInputs, getTotalQuantity, recipeCosts, getPanUnitsTotal, conversionMap, packLensMap, lensEnabledForLocation, legsEnabledForLocation, legsConfigsMap, isEditing, getItemValueWithLegs, getShape]);


  // Calculate total running cost
  const totalCost = useMemo(() => {
    if (!items) return 0;
    const total = items.reduce((sum, item) => sum + getItemCost(item), 0);
    // TEMP DIAGNOSTIC — remove after $5.74 gap investigation
    const allNonZero = items
      .map(i => ({
        name: (i as any).item_name,
        splitKey: (i as any)._splitKey,
        existingQty: (i as any)._existingQuantity,
        existingCases: (i as any)._existingCases,
        existingUnits: (i as any)._existingUnits,
        existingInner: (i as any)._existingInnerPacks,
        costAtCount: (i as any)._costAtCount,
        packAtCount: (i as any)._packQuantityAtCount,
        innerPackQty: (i as any).inner_pack_quantity,
        isRecipe: (i as any).is_recipe,
        hasRawInput: !!rawInputs[(i as any)._splitKey || (i as any).item_id],
        cost: getItemCost(i as any),
      }))
      .filter(r => r.cost > 0)
      .sort((a, b) => b.cost - a.cost);
    console.log('[totalCost]', {
      total: Number(total.toFixed(2)),
      itemCount: items.length,
      nonZeroItems: allNonZero.length,
      allNonZero,
    });
    return total;
  }, [items, getItemCost]);

  // Count stats
  const totalItems = items?.length || 0;
  const countedItems = Object.values(counts).filter(c => c.cases > 0 || c.units > 0).length;

  // Save count mutation is now replaced by the resilient saveItemsBatch function below

  // Save edit with tracking mutation
  const saveEditMutation = useMutation({
    mutationFn: async ({ edits, reason }: { edits: PendingEdit[]; reason: string }) => {
      // Acquire the same mutex that autosave uses so an in-flight autosave
      // can't race the edit writes (and vice versa). Edit Mode already gates
      // autosave with `isEditing`, but holding the lock makes the contract
      // explicit and survives any future code path that triggers a save.
      let waited = 0;
      while (saveInProgressRef.current && waited < 20) {
        await new Promise((r) => setTimeout(r, 250));
        waited++;
      }
      saveInProgressRef.current = true;
      try {
        const CONCURRENCY = 6;
        const runEdit = async (edit: PendingEdit) => {
          let countItemId = edit.countItemId;

          // Leg-aware branch (Fix B, 2026-05-31): for multi-config items,
          // route through save_count_item_with_legs so parent.quantity /
          // entered_* mirror SUM(legs) and the default leg's split, instead
          // of clobbering the parent with the aggregate UI roll-up (root
          // cause of the Baby Spinach 37.5-vs-27.5 drift). Single-config
          // items keep the today path. Edit Mode never freezes, so we pass
          // freeze=false — the original-submit cost snapshot stays intact
          // (snapshot-wins contract).
          const itemsNow = itemsRef.current || [];
          const countsNow = countsRef.current || {};
          const legsMapNow = legsConfigsMapRef.current;
          const itemRow = itemsNow.find(
            (i) =>
              i.item_id === edit.itemId &&
              (i.storage_location_id ?? null) === (edit.storageLocationId ?? null),
          );
          const bid = (itemRow as any)?.brand_item_id;
          const cfgs = (legsEnabledRef.current === true && bid)
            ? (legsMapNow?.get(bid) ?? [])
            : [];
          const isMultiConfig = cfgs.length >= 2;

          if (isMultiConfig && countItemId) {
            const splitKey = (itemRow as any)?._splitKey || edit.itemId!;
            const legsPayload = cfgs.map((cfg: any) => {
              const legKey = cfg.is_default ? splitKey : `${splitKey}::leg::${cfg.pack_config_id}`;
              const s = countsNow[legKey] || { cases: 0, units: 0, innerPacks: 0 };
              const cu = Number(cfg.count_units_per_case ?? 0);
              const ipq = Number(cfg.inner_qty ?? 0);
              const qc =
                (Number(s.cases) || 0) * cu +
                (Number(s.innerPacks) || 0) * ipq +
                (Number(s.units) || 0);
              return {
                pack_config_id: cfg.pack_config_id,
                is_default: !!cfg.is_default,
                entered_cases: Number(s.cases) || 0,
                entered_inner_packs: Number(s.innerPacks) || 0,
                entered_units: Number(s.units) || 0,
                quantity_common: qc,
                pack_quantity_at_count: cu > 0 ? cu : null,
                inner_pack_quantity_at_count: (ipq > 0 && ipq !== cu) ? ipq : null,
                // cost_at_count omitted — RPC freeze=false ignores it anyway,
                // and original-submit cost snapshot is preserved.
                common_unit_at_count: (cfg as any).common_unit ?? null,
              };
            });
            const { error: rpcErr } = await (supabase as any).rpc('save_count_item_with_legs', {
              p_count_item_id: countItemId,
              p_legs: legsPayload,
              p_freeze_snapshots: false,
              p_rollup_blocked: false,
            });
            if (rpcErr) throw rpcErr;
            await supabase.from("inventory_count_edits").insert({
              count_item_id: countItemId,
              edited_by: user?.id,
              previous_quantity: edit.previousQuantity,
              new_quantity: edit.newQuantity,
              reason: reason || null,
            });
            return;
          }

          // Single-config path (unchanged): direct parent UPDATE.
          // Build the full payload so the row mirrors what an autosave would
          // have written. Without this, only `quantity` updates and the entered
          // split / snapshots stay stale — which is what caused "no changes to
          // save" on subsequent edits.
          const payload: Record<string, any> = {
            quantity: edit.newQuantity,
            entered_cases: edit.enteredCases ?? 0,
            entered_units: edit.enteredUnits ?? 0,
            entered_inner_packs: edit.enteredInnerPacks ?? 0,
            pan_inputs: edit.panInputs ?? null,
            cost_at_count: edit.costAtCount ?? null,
            pack_quantity_at_count: edit.packQuantityAtCount ?? null,
            inner_pack_quantity_at_count: edit.innerPackQuantityAtCount ?? null,
            item_name_at_count: edit.itemNameAtCount ?? null,
            unit_at_count: edit.unitAtCount ?? null,
            pan_sizes_at_count: edit.panSizesAtCount ?? null,
          };
          if (!countItemId) {
            const storLocId = edit.storageLocationId;
            const { data: inserted, error: insertErr } = await supabase
              .from("inventory_count_items")
              .insert({
                count_id: countId,
                item_id: edit.itemId!,
                storage_location_id:
                  storLocId === "uncategorized" || storLocId === "recipes" ? null : storLocId,
                ...payload,
              } as any)
              .select("id")
              .single();
            if (insertErr) throw insertErr;
            countItemId = (inserted as any).id;
          } else {
            await supabase
              .from("inventory_count_items")
              .update(payload)
              .eq("id", countItemId);
          }
          await supabase.from("inventory_count_edits").insert({
            count_item_id: countItemId,
            edited_by: user?.id,
            previous_quantity: edit.previousQuantity,
            new_quantity: edit.newQuantity,
            reason: reason || null,
          });
        };
        for (let i = 0; i < edits.length; i += CONCURRENCY) {
          const slice = edits.slice(i, i + CONCURRENCY);
          await Promise.all(slice.map(runEdit));
        }
      } finally {
        saveInProgressRef.current = false;
      }
    },
    onSuccess: () => {
      toast.success("Changes saved with audit trail");
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-count-edits"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-count-items-view"] });
      window.location.href = `/inventory/${locationId}/count/${countId}`;
    },
    onError: () => {
      toast.error("Failed to save changes");
    }
  });

  // Calculate pending edits when in edit mode
  const calculatePendingEdits = useCallback((): PendingEdit[] => {
    if (!isEditing || !items) return [];
    
    const edits: PendingEdit[] = [];
    
    for (const item of items) {
      const extendedItem = item as CountItem & { _existingQuantity: number; _countItemId: string | null; _splitKey: string; _packQuantityAtCount?: number | null; _innerPackQuantityAtCount?: number | null };
      const key = extendedItem._splitKey || item.item_id;
      // Phase 4 (2026-06-01): thread the resolved inner factor (snapshot > lens > local)
      // through the edit-mode snapshot so 3-tier items (jugs/sleeves/cans) freeze the
      // correct inner_pack_quantity_at_count alongside pack_quantity_at_count. Without
      // this, lens-derived inner factors were silently dropped at save time and the
      // reader's caseUnits denominator collapsed to pack only, inflating valuations.
      const innerPackQty = resolveInnerPackQtyForTotal(item);
      // Diff math uses the LIVE effective pack qty so the baseline (computed from
      // the current entered_cases × current caseUnits) and the new value share
      // the same multiplier. Snapshots are stamped on save below for history.
      // Lens-aware: when an approved brand_pack_config is in effect, its
      // count_units_per_case is authoritative — matches valuation precedence.
      const effectivePackQty = resolveItemPackQty(item);
      const newQuantity = getItemTotalIncludingLegs(item, key, effectivePackQty, resolveInnerPackQtyForTotal(item));
      const originalQuantity = originalCounts.current[key] ?? 0;
      const storedQuantity = Number(extendedItem._existingQuantity ?? 0);
      const brandItemId = (item as any).brand_item_id;
      const isMultiConfig =
        legsEnabledForLocation === true &&
        !!brandItemId &&
        (legsConfigsMap?.get(brandItemId)?.length ?? 0) >= 2;
      // For multi-config items, the `legBaselineOverrides` pass above already
      // set originalCounts[key] to SUM(legs.quantity_common) — the legs table
      // is the source of truth. Never fall back to parent.quantity (which can
      // be stale from pre-leg-RPC writes); doing so produced phantom diffs on
      // exit (e.g. Baby Spinach 35.5 → 23.5 with no user input).
      const hasStoredDrift =
        !isMultiConfig &&
        Math.abs(storedQuantity - originalQuantity) > 0.01 &&
        Math.abs(newQuantity - originalQuantity) <= 0.01;
      const previousQuantity = hasStoredDrift ? storedQuantity : originalQuantity;

      if (Math.abs(newQuantity - previousQuantity) > 0.01) {
        const liveCounts = counts[key] || { cases: 0, units: 0, innerPacks: 0 };
        const livePan = panCounts[key] || null;
        edits.push({
          countItemId: extendedItem._countItemId,
          itemName: item.item_name,
          previousQuantity,
          newQuantity,
          itemId: item.item_id,
          storageLocationId: extendedItem.storage_location_id,
          // Mirror the autosave snapshot shape so re-opening the count shows the
          // correct entered_cases / entered_units and Period view value math stays
          // consistent (it derives unit value from quantity − cases × pack).
          enteredCases: liveCounts.cases || 0,
          enteredUnits: liveCounts.units || 0,
          enteredInnerPacks: liveCounts.innerPacks || 0,
          panInputs: livePan && Object.keys(livePan).length > 0 ? livePan : null,
          costAtCount: item.cost_per_unit ?? null,
          packQuantityAtCount: (item as any).pack_quantity_override ?? item.pack_quantity ?? null,
          innerPackQuantityAtCount: innerPackQty,
          itemNameAtCount: item.item_name,
          unitAtCount: (item as any).unit ?? null,
          panSizesAtCount: item.pan_sizes ?? null,
        } as PendingEdit);
      }
    }
    
    return edits;
  }, [isEditing, items, getItemTotalIncludingLegs, counts, panCounts, resolveItemPackQty, resolveInnerPackQtyForTotal, legsEnabledForLocation, legsConfigsMap]);

  // Handle save for edit mode
  const handleSaveEdits = () => {
    const edits = calculatePendingEdits();
    if (edits.length === 0) {
      toast.info("No changes to save");
      exitEditMode();
      return;
    }
    setPendingEdits(edits);
    setShowEditConfirm(true);
  };

  const confirmSaveEdits = () => {
    saveEditMutation.mutate({ edits: pendingEdits, reason: editReason });
    setShowEditConfirm(false);
  };

  const lastAutosavedRef = useRef<string>("");
  const failedItemsRef = useRef<Map<string, any>>(new Map()); // key -> item payload for retry
  // Track last-saved quantities per item to avoid re-saving unchanged items
  const lastSavedQuantitiesRef = useRef<Map<string, string>>(new Map());
  // Mutex: prevent concurrent save operations (race condition guard)
  const saveInProgressRef = useRef(false);
  const saveQueueRef = useRef(false); // flag: another save was requested while one is running

  // Ref-based snapshot builder so unmount/beforeunload can flush without stale closures
  const buildSnapshotRef = useRef<(() => { itemCounts: any[]; snapshot: string }) | null>(null);

  useEffect(() => {
    buildSnapshotRef.current = () => {
      if (!items || Object.keys(counts).length === 0) return { itemCounts: [], snapshot: "" };
      const itemCounts = items.map(item => {
        const key = (item as any)._splitKey || item.item_id;
        const storLocId = item.storage_location_id;
        const countState = counts[key] || { cases: 0, units: 0, innerPacks: 0 };
        // Phase 4 (2026-06-01): see calculatePendingEdits for rationale — autosave
        // must also persist the resolver-derived inner factor, not the stale local field.
        const innerPackQty = resolveInnerPackQtyForTotal(item);
        // Fold raw per-leg lane triples into the snapshot so the diff guard fires
        // when a non-default leg's cases/innerPacks/units change. Prefixed `_` so
        // the RPC/insert path ignores it. Single-config items get null.
        const bid = (item as any).brand_item_id;
        const cfgs = (legsEnabledForLocation === true && bid) ? (legsConfigsMap?.get(bid) ?? []) : [];
        let _legLanes: Array<{ pack_config_id: string; cases: number; innerPacks: number; units: number }> | null = null;
        if (cfgs.length >= 2) {
          _legLanes = cfgs.map((cfg: any) => {
            const legKey = cfg.is_default ? key : `${key}::leg::${cfg.pack_config_id}`;
            const s = counts[legKey] || { cases: 0, units: 0, innerPacks: 0 };
            return {
              pack_config_id: cfg.pack_config_id,
              cases: Number(s.cases) || 0,
              innerPacks: Number(s.innerPacks) || 0,
              units: Number(s.units) || 0,
            };
          });
          if (item.brand_item_id === SPINACH_BRAND_ITEM_ID) {
            traceSpinach('snapshot-leg-fold', {
              itemName: item.item_name,
              splitKey: key,
              storageLocationId: (storLocId === 'uncategorized' || storLocId === 'recipes') ? null : storLocId,
              topLevel: countState,
              _legLanes,
            });
          }
        }
        return {
          item_id: item.item_id,
          quantity: getItemTotalIncludingLegs(item, key, resolveItemPackQty(item), resolveInnerPackQtyForTotal(item)),
          storage_location_id: (storLocId === 'uncategorized' || storLocId === 'recipes') ? null : storLocId,
          entered_cases: countState.cases,
          entered_units: countState.units,
          // Phase 3: third counting tier
          entered_inner_packs: countState.innerPacks ?? 0,
          // Snapshot fields for historical integrity
          item_name_at_count: item.item_name,
          cost_at_count: item.cost_per_unit,
          unit_at_count: item.unit,
          pack_quantity_at_count: resolveItemPackQty(item),
          // Phase 3: snapshot the inner_pack_quantity at save time (mirrors pack_quantity_at_count)
          inner_pack_quantity_at_count: innerPackQty,
          pan_sizes_at_count: item.pan_sizes ?? null,
          // --- Audit log fields (Palm Springs forensic logging) ---
          _item_name: item.item_name,
          _storage_location_name: item.storage_location,
          _pack_quantity: item.pack_quantity,
          _inner_pack_quantity: innerPackQty,
          _pan_sizes: item.pan_sizes,
          _pan_inputs: panCounts[key] || null,
          _legLanes,
        };
      });
      return { itemCounts, snapshot: JSON.stringify(itemCounts) };
    };
  }, [items, counts, panCounts, getItemTotalIncludingLegs, legsConfigsMap, legsEnabledForLocation, resolveInnerPackQtyForTotal]);

  // === Palm Springs forensic audit log ===
  // Logs every save attempt with raw UI inputs (cases, units, pan inputs) verbatim
  // so we can reconstruct Dave's exact inputs even if conversion math changes later.
  const PALM_SPRINGS_LOCATION_ID = 'd667741f-6d4c-433e-bb22-307e817ea7f1';
  const logInputsToAudit = useCallback(async (itemCounts: any[]) => {
    if (locationId !== PALM_SPRINGS_LOCATION_ID) return;
    try {
      const rows = itemCounts
        .filter(ic => (ic.entered_cases || 0) > 0 || (ic.entered_units || 0) > 0 || (ic._pan_inputs && Object.values(ic._pan_inputs as Record<string, number>).some(v => (v || 0) > 0)))
        .map(ic => ({
          count_id: countId,
          location_id: locationId,
          item_id: ic.item_id,
          item_name: ic._item_name ?? ic.item_name_at_count ?? null,
          storage_location_id: ic.storage_location_id,
          storage_location_name: ic._storage_location_name ?? null,
          entered_cases: ic.entered_cases ?? 0,
          entered_units: ic.entered_units ?? 0,
          pan_inputs: ic._pan_inputs ?? null,
          pack_quantity: ic._pack_quantity ?? null,
          pan_sizes: ic._pan_sizes ?? null,
          computed_quantity: ic.quantity ?? null,
          user_id: user?.id ?? null,
          user_email: (user as any)?.email ?? null,
          event_type: 'save',
        }));
      if (rows.length === 0) return;
      // Fire-and-forget; never block the actual save
      supabase.from('inventory_count_input_log' as any).insert(rows as any).then(({ error }) => {
        if (error) console.warn('[InputLog] insert failed:', error.message);
      });
    } catch (e) {
      console.warn('[InputLog] logging error:', e);
    }
  }, [countId, locationId, user]);

  // Resilient batch save: ONE bulk SELECT, then only UPDATE/INSERT changed items
  // Protected by mutex to prevent concurrent save operations (race condition)
  // 2b: refs let saveItemsBatch read current items/counts/legs maps without
  // re-creating the callback on every keystroke (which would destabilize the
  // autosave debounce).
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const countsRef = useRef(counts);
  useEffect(() => { countsRef.current = counts; }, [counts]);
  const legsConfigsMapRef = useRef(legsConfigsMap);
  useEffect(() => { legsConfigsMapRef.current = legsConfigsMap; }, [legsConfigsMap]);
  const legsEnabledRef = useRef(legsEnabledForLocation);
  useEffect(() => { legsEnabledRef.current = legsEnabledForLocation; }, [legsEnabledForLocation]);

  const saveItemsBatch = useCallback(async (itemCounts: any[], opts?: { isExit?: boolean }): Promise<{ saved: number; failed: number }> => {
    // Mutex: if another save is in progress, skip this cycle
    if (saveInProgressRef.current) {
      console.log("[Inventory] Save skipped — another save is in progress");
      saveQueueRef.current = true; // Mark that we wanted to save
      return { saved: 0, failed: 0 };
    }
    
    saveInProgressRef.current = true;
    let saved = 0;
    let failed = 0;
    if (itemCounts.length === 0) {
      saveInProgressRef.current = false;
      return { saved, failed };
    }

    // Forensic input log (Palm Springs only) — fire-and-forget, never blocks
    logInputsToAudit(itemCounts);

    try {
      // ONE query to fetch all existing count items for this count
      const { data: allExisting, error: fetchErr } = await supabase
        .from("inventory_count_items")
        .select("id, item_id, storage_location_id, quantity, entered_cases, entered_units, entered_inner_packs")
        .eq("count_id", countId) as any;
      
      if (fetchErr) throw fetchErr;

      // Build lookup map: "item_id|storage_location_id" -> existing record
      const existingMap = new Map<string, any>();
      for (const row of (allExisting || [])) {
        const key = `${row.item_id}|${row.storage_location_id || ''}`;
        existingMap.set(key, row);
      }

      // Separate into updates vs inserts, and skip unchanged items
      const toUpdate: { id: string; quantity: number; entered_cases: number; entered_units: number; entered_inner_packs: number }[] = [];
      const toInsert: any[] = [];

      for (const ic of itemCounts) {
        const key = `${ic.item_id}|${ic.storage_location_id || ''}`;
        const existing = existingMap.get(key);
        const innerPacksVal = ic.entered_inner_packs ?? 0;
        if (TRACE_ENABLED && ic.item_id && itemsRef.current?.some((it) => it.item_id === ic.item_id && (it as any).brand_item_id === SPINACH_BRAND_ITEM_ID)) {
          traceSpinach('save-parent-row', {
            key,
            existingId: existing?.id ?? null,
            quantity: ic.quantity,
            entered_cases: ic.entered_cases,
            entered_inner_packs: innerPacksVal,
            entered_units: ic.entered_units,
            legLanes: ic._legLanes ?? null,
          });
        }
        
        // Build a fingerprint to skip unchanged items (Phase 3: includes inner packs)
        const fingerprint = `${ic.quantity}|${ic.entered_cases}|${ic.entered_units}|${innerPacksVal}`;
        const lastSaved = lastSavedQuantitiesRef.current.get(key);
        
        if (existing) {
          // CRITICAL GUARD: Never overwrite a non-zero DB value with zero
          // ONLY during the brief window before counts are initialized from DB
          // Once countsReady=true, the user has control and zero is intentional
          if (ic.quantity === 0 && existing.quantity > 0 && !countsReadyRef.current) {
            console.warn(`[Inventory] BLOCKED zero-overwrite for item ${ic.item_id} (DB has ${existing.quantity})`);
            continue;
          }
          
          // Skip if quantity hasn't changed from DB AND from last save
          const dbFingerprint = `${existing.quantity}|${existing.entered_cases ?? 0}|${existing.entered_units ?? 0}|${existing.entered_inner_packs ?? 0}`;
          if (fingerprint === dbFingerprint && fingerprint === lastSaved) continue;
          
          toUpdate.push({
            id: existing.id,
            quantity: ic.quantity,
            entered_cases: ic.entered_cases,
            entered_units: ic.entered_units,
            entered_inner_packs: innerPacksVal,
            pan_inputs: ic._pan_inputs ?? null,
          } as any);
        } else {
          if (fingerprint === lastSaved) continue; // Already inserted on a previous cycle
          toInsert.push({
            count_id: countId,
            item_id: ic.item_id,
            quantity: ic.quantity,
            storage_location_id: ic.storage_location_id,
            entered_cases: ic.entered_cases,
            entered_units: ic.entered_units,
            entered_inner_packs: innerPacksVal,
            item_name_at_count: ic.item_name_at_count,
            cost_at_count: ic.cost_at_count,
            unit_at_count: ic.unit_at_count,
            pack_quantity_at_count: ic.pack_quantity_at_count,
            inner_pack_quantity_at_count: ic.inner_pack_quantity_at_count ?? null,
            pan_sizes_at_count: ic.pan_sizes_at_count,
            pan_inputs: ic._pan_inputs ?? null,
          });
        }
      }

      console.log(`[Inventory] Save batch: ${toUpdate.length} updates, ${toInsert.length} inserts (${itemCounts.length} total items, ${existingMap.size} existing)`);

      // Parallel updates — fan out PATCHes concurrently for ~10× speedup over the
      // sequential loop. Concurrency is bounded so we don't overwhelm the network
      // on slow store wifi (Hemet was hitting save timeouts on big counts).
      const CONCURRENCY = 6;
      const findKeyForUpd = (id: string) =>
        itemCounts.find((ic) => {
          const existing = existingMap.get(`${ic.item_id}|${ic.storage_location_id || ''}`);
          return existing?.id === id;
        });

      const runUpdate = async (upd: typeof toUpdate[number]) => {
        try {
          // Fix B (2026-05-31): multi-config items are owned by pass 2b
          // (legs RPC). Skip pass 2a's direct parent UPDATE for them — the
          // RPC rewrites parent.quantity = SUM(legs) and default-leg
          // entered_*. Without this skip, 2a wrote the aggregate roll-up
          // (e.g. 37.5) that 2b then had to correct; if 2b failed, the
          // parent drifted from its legs.
          const itemsNow = itemsRef.current || [];
          const legsMapNow = legsConfigsMapRef.current;
          const keyForMulti = findKeyForUpd(upd.id);
          const itRow = keyForMulti
            ? itemsNow.find(
                (i) =>
                  i.item_id === keyForMulti.item_id &&
                  (i.storage_location_id ?? null) === (keyForMulti.storage_location_id ?? null),
              )
            : undefined;
          const bidMulti = (itRow as any)?.brand_item_id;
          const isMulti = legsEnabledRef.current === true && bidMulti
            && ((legsMapNow?.get(bidMulti)?.length ?? 0) >= 2);
          if (isMulti) {
            // Mark fingerprint saved so dirty-tracking doesn't keep retrying
            // 2a; 2b is authoritative for this row's parent state.
            if (keyForMulti) {
              const k = `${keyForMulti.item_id}|${keyForMulti.storage_location_id || ''}`;
              lastSavedQuantitiesRef.current.set(k, `${upd.quantity}|${upd.entered_cases}|${upd.entered_units}|${upd.entered_inner_packs}`);
              failedItemsRef.current.delete(k);
            }
            saved++;
            return;
          }

          const { error } = await supabase
            .from("inventory_count_items")
            .update({ quantity: upd.quantity, entered_cases: upd.entered_cases, entered_units: upd.entered_units, entered_inner_packs: upd.entered_inner_packs, pan_inputs: (upd as any).pan_inputs ?? null } as any)
            .eq("id", upd.id);
          if (error) throw error;
          const key = findKeyForUpd(upd.id);
          if (key) {
            const k = `${key.item_id}|${key.storage_location_id || ''}`;
            lastSavedQuantitiesRef.current.set(k, `${upd.quantity}|${upd.entered_cases}|${upd.entered_units}|${upd.entered_inner_packs}`);
            failedItemsRef.current.delete(k);
          }
          saved++;
        } catch (e) {
          const key = findKeyForUpd(upd.id);
          if (key) {
            const k = `${key.item_id}|${key.storage_location_id || ''}`;
            failedItemsRef.current.set(k, key);
          }
          failed++;
          console.warn(`[Inventory] Failed to update item:`, e);
        }
      };

      // Drain `toUpdate` in chunks of CONCURRENCY, awaiting each chunk before
      // launching the next so the pool size stays bounded.
      for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
        const slice = toUpdate.slice(i, i + CONCURRENCY);
        await Promise.all(slice.map(runUpdate));
      }

      // Batch inserts (one call for all new items)
      if (toInsert.length > 0) {
        try {
          const { error } = await supabase
            .from("inventory_count_items")
            .insert(toInsert as any);
          if (error) throw error;
          for (const ins of toInsert) {
            const k = `${ins.item_id}|${ins.storage_location_id || ''}`;
            lastSavedQuantitiesRef.current.set(k, `${ins.quantity}|${ins.entered_cases}|${ins.entered_units}|${ins.entered_inner_packs ?? 0}`);
            failedItemsRef.current.delete(k);
          }
          saved += toInsert.length;
        } catch (e) {
          for (const ins of toInsert) {
            const k = `${ins.item_id}|${ins.storage_location_id || ''}`;
            failedItemsRef.current.set(k, ins);
          }
          failed += toInsert.length;
          console.warn(`[Inventory] Failed to insert items:`, e);
        }
      }

    } catch (e) {
      // Bulk SELECT failed — everything fails this cycle, will retry
      console.warn("[Inventory] Bulk fetch failed, will retry next cycle:", e);
      for (const ic of itemCounts) {
        const k = `${ic.item_id}|${ic.storage_location_id || ''}`;
        failedItemsRef.current.set(k, ic);
      }
      failed = itemCounts.length;
    }

    // 2b: leg writer pass. For items that have ≥2 selected pack configs at
    // this location, re-fetch the parent count_item id (keyed off the SAME
    // composite `${item_id}|${storage_location_id || ''}` the parent writer
    // uses, so a collision is impossible by construction) and route each
    // multi-config item through save_count_item_with_legs. Single-config
    // items are intentionally not touched here — they keep the today writer.
    // Submit-freeze is OUT of scope for 2b: we always pass freeze=false.
    let legFailed = 0;
    if (legsEnabledRef.current === true) {
      const itemsNow = itemsRef.current || [];
      const countsNow = countsRef.current || {};
      const legsMapNow = legsConfigsMapRef.current;
      const multi = itemCounts.filter((ic) => {
        const it = itemsNow.find((i) => i.item_id === ic.item_id && (i.storage_location_id ?? null) === (ic.storage_location_id ?? null));
        const bid = (it as any)?.brand_item_id;
        return bid && ((legsMapNow?.get(bid)?.length ?? 0) >= 2);
      });
      if (multi.length > 0) {
        try {
          const { data: parentRows, error: parentErr } = await supabase
            .from("inventory_count_items")
            .select("id, item_id, storage_location_id")
            .eq("count_id", countId);
          if (parentErr) throw parentErr;
          const parentMap = new Map<string, string>();
          for (const r of (parentRows || []) as any[]) {
            parentMap.set(`${r.item_id}|${r.storage_location_id || ''}`, r.id);
          }
          traceSpinach('leg-pass-parent-map', {
            rows: (parentRows || []).filter((r: any) => itemsNow.some((it) => it.item_id === r.item_id && (it as any).brand_item_id === SPINACH_BRAND_ITEM_ID)),
          });
          for (const ic of multi) {
            const composite = `${ic.item_id}|${ic.storage_location_id || ''}`;
            const countItemId = parentMap.get(composite);
            const it = itemsNow.find((i) => i.item_id === ic.item_id && (i.storage_location_id ?? null) === (ic.storage_location_id ?? null));
            const splitKey = (it as any)?._splitKey || ic.item_id;
            const bid = (it as any)?.brand_item_id;
            if (!countItemId || !bid) { legFailed++; continue; }
            const configs = legsMapNow?.get(bid) ?? [];
            // Per-leg cost stamp (interpretation (a), 2026-05-31): derive
            // commonUnitCost from the default config; each leg's case cost =
            // cfg.count_units_per_case × commonUnitCost. RPC only writes these
            // snapshots when p_freeze_snapshots=true (submit). Autosave keeps
            // them in the payload but they're ignored server-side.
            const defaultCfg = configs.find((c: any) => c.is_default) ?? configs[0];
            const defaultUnitsPerCase = Number((defaultCfg as any)?.count_units_per_case ?? 0);
            const itemCostPerCase = Number((it as any)?.cost_per_unit ?? 0);
            const commonUnitCost = (defaultUnitsPerCase > 0 && itemCostPerCase > 0)
              ? itemCostPerCase / defaultUnitsPerCase
              : null;
            const legsPayload = configs.map((cfg) => {
              const legKey = cfg.is_default ? splitKey : `${splitKey}::leg::${cfg.pack_config_id}`;
              const s = countsNow[legKey] || { cases: 0, units: 0, innerPacks: 0 };
              const cu = Number(cfg.count_units_per_case ?? 0);
              const ipq = Number(cfg.inner_qty ?? 0);
              const qc = (Number(s.cases) || 0) * cu + (Number(s.innerPacks) || 0) * ipq + (Number(s.units) || 0);
              return {
                pack_config_id: cfg.pack_config_id,
                is_default: !!cfg.is_default,
                entered_cases: Number(s.cases) || 0,
                entered_inner_packs: Number(s.innerPacks) || 0,
                entered_units: Number(s.units) || 0,
                quantity_common: qc,
                pack_quantity_at_count: cu > 0 ? cu : null,
                // Skip inner snapshot when inner_qty == count_units_per_case
                // (the "inner" lane IS the case for outer_qty=1 multi-configs).
                // Storing both would inflate caseUnits on reload-time valuation.
                inner_pack_quantity_at_count: (ipq > 0 && ipq !== cu) ? ipq : null,
                cost_at_count: (commonUnitCost != null && cu > 0) ? cu * commonUnitCost : null,
                common_unit_at_count: (cfg as any).common_unit ?? null,
              };
            });
            if (bid === SPINACH_BRAND_ITEM_ID) {
              traceSpinach('leg-rpc-request', {
                composite,
                countItemId,
                splitKey,
                legsPayload,
              });
            }
            try {
              const { error: rpcErr } = await (supabase as any).rpc('save_count_item_with_legs', {
                p_count_item_id: countItemId,
                p_legs: legsPayload,
                p_freeze_snapshots: false,
                p_rollup_blocked: false,
              });
              if (rpcErr) throw rpcErr;
              if (bid === SPINACH_BRAND_ITEM_ID) {
                traceSpinach('leg-rpc-success', {
                  composite,
                  countItemId,
                  legsPayload,
                });
              }
            } catch (e) {
              legFailed++;
              if (bid === SPINACH_BRAND_ITEM_ID) {
                traceSpinach('leg-rpc-failure', {
                  composite,
                  countItemId,
                  error: e instanceof Error ? e.message : String(e),
                  legsPayload,
                });
              }
              console.warn(`[Inventory] Leg RPC failed for item ${ic.item_id}:`, e);
            }
          }
        } catch (e) {
          // Parent re-fetch failed — count every multi-config item as a leg
          // failure for this cycle so the autosave loop will retry.
          legFailed += multi.length;
          console.warn("[Inventory] Leg pass: parent re-fetch failed:", e);
        }
      }
    }
    failed += legFailed;

    // Exit-path visibility: if the user is leaving the screen and any leg
    // write failed this cycle, surface a toast AND re-throw so the
    // flushSaveAsync catch can display its own error. Silent swallow on exit
    // is how we'd corrupt a count without anyone noticing.
    if (opts?.isExit && legFailed > 0) {
      saveInProgressRef.current = false;
      const msg = `Failed to save ${legFailed} multi-config leg${legFailed === 1 ? '' : 's'} on exit — reopen the count and resave.`;
      toast.error(msg);
      throw new Error(msg);
    }



    // Save elapsed duration (separate try/catch so item failures don't block this)
    try {
      await supabase
        .from("inventory_counts")
        .update({ duration_seconds: elapsedSecondsRef.current })
        .eq("id", countId);
    } catch (e) {
      console.warn("[Inventory] Failed to save duration:", e);
    }

    // Phone-notepad cache: mirror this batch into IndexedDB (pending=true for
    // anything that failed to write to cloud, then refresh the global pending
    // counter so the sync pill in the header reflects reality).
    try {
      const failedKeys = new Set<string>();
      for (const k of failedItemsRef.current.keys()) failedKeys.add(k);
      await Promise.all(
        itemCounts.map((ic) =>
          cacheCountEdit({
            countId,
            itemId: ic.item_id,
            storageLocationId: ic.storage_location_id ?? null,
            payload: ic,
          }).then(() => {
            // If this item didn't fail, immediately mark as not-pending by
            // overwriting via a synced seed-style write. We do this implicitly
            // by recomputing pending below via getPendingCount.
          })
        )
      );
      // Mark non-failed rows as synced by re-writing them with pending=false.
      // We reuse cacheCountEdit (always pending=true) above for simplicity,
      // then walk the just-cached rows and stamp synced state for the ones
      // that the cloud accepted. This is cheap because IDB writes are fast
      // and the set is bounded by the autosave batch size.
      const syncedItems = itemCounts.filter((ic) => {
        const k = `${ic.item_id}|${ic.storage_location_id || ''}`;
        return !failedKeys.has(k) && !failedItemsRef.current.has(k);
      });
      // Re-stamp synced rows (we cheat by calling cacheCountEdit with the same
      // payload and then immediately invoking the existing markSynced helper
      // would require tracking baselines; for simplicity we lean on the
      // "pending count = number of rows the cloud rejected" semantic).
      const pending = failedItemsRef.current.size;
      setInventoryCountLock({ pending });
      // Suppress unused-var lint for syncedItems while keeping the intent
      // (the variable documents which rows were definitively confirmed).
      void syncedItems;
    } catch (e) {
      console.warn("[Inventory] Cache mirror failed (non-fatal):", e);
    }

    saveInProgressRef.current = false;
    return { saved, failed };
  }, [countId, logInputsToAudit]);

  // Synchronous flush: fire-and-forget save using sendBeacon + edge fallback
  // IMPORTANT: Does NOT mark as saved — sendBeacon can't confirm success
  const flushSaveSync = useCallback(() => {
    if (isViewOnly || isEditing) return;
    const builder = buildSnapshotRef.current;
    if (!builder) return;
    const { itemCounts, snapshot } = builder();
    if (!snapshot || snapshot === lastAutosavedRef.current || itemCounts.length === 0) return;

    // Use navigator.sendBeacon for reliability during unload
    const payload = JSON.stringify({ countId, itemCounts, elapsedSeconds: elapsedSecondsRef.current });
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/utility-service?action=flush_inventory_count`;
    const sent = navigator.sendBeacon?.(url, new Blob([payload], { type: 'application/json' }));
    
    if (!sent) {
      // Fallback: fire-and-forget fetch (no await)
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }

    // DO NOT set lastAutosavedRef here — sendBeacon success is unconfirmed
    // The next autosave cycle will re-save this data with confirmation
    console.log("[Inventory] Flush save fired (unmount/unload) — unconfirmed");
  }, [isViewOnly, isEditing, countId]);

  // Async flush for unmount (component cleanup)
  const flushSaveAsync = useCallback(async (opts?: { isExit?: boolean }) => {
    if (isViewOnly || isEditing) return;
    const builder = buildSnapshotRef.current;
    if (!builder) return;
    const { itemCounts, snapshot } = builder();
    if (!snapshot || snapshot === lastAutosavedRef.current || itemCounts.length === 0) return;

    try {
      const result = await saveItemsBatch(itemCounts, opts);
      lastAutosavedRef.current = snapshot;
      // 2b: on exit, even a "soft" partial failure (parent saved but legs
      // didn't) must be visible. The batch already toasts + throws for leg
      // failures; this guards parent-only failures.
      if (opts?.isExit && result.failed > 0) {
        toast.error(`Failed to save ${result.failed} item${result.failed === 1 ? '' : 's'} on exit — reopen the count and resave.`);
      }
      console.log("[Inventory] Flush save completed (async)");
    } catch (e) {
      console.warn("[Inventory] Flush save failed:", e);
      if (opts?.isExit) {
        toast.error("Failed to save count on exit — reopen and resave before continuing.");
      }
    }
  }, [isViewOnly, isEditing, saveItemsBatch]);

  // beforeunload: use sync flush to save data before tab/window close
  useEffect(() => {
    if (isViewOnly || isEditing) return;
    const handler = () => flushSaveSync();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flushSaveSync, isViewOnly, isEditing]);

  // Unmount flush: save pending data when component unmounts (SPA navigation)
  const flushSaveAsyncRef = useRef(flushSaveAsync);
  useEffect(() => { flushSaveAsyncRef.current = flushSaveAsync; }, [flushSaveAsync]);
  useEffect(() => {
    return () => {
      // Fire async flush on unmount — also fire sync as safety net.
      // isExit:true so saveItemsBatch surfaces leg-write failures via toast
      // instead of silently swallowing them.
      flushSaveAsyncRef.current({ isExit: true });
    };
  }, []);

  // True interval autosave — saves every 10 seconds regardless of activity
  // Uses resilient saveItemsBatch with per-item error isolation
  useEffect(() => {
    if (!items || isViewOnly || isEditing) return;

    const autosaveInterval = setInterval(async () => {
      const builder = buildSnapshotRef.current;
      if (!builder) return;
      const { itemCounts, snapshot } = builder();

      // Also include any previously failed items for retry
      const retryItems = Array.from(failedItemsRef.current.values());
      const allItems = retryItems.length > 0 
        ? [...itemCounts, ...retryItems.filter(ri => !itemCounts.some((ic: any) => ic.item_id === ri.item_id && ic.storage_location_id === ri.storage_location_id))]
        : itemCounts;

      // Skip if nothing changed and no retries pending
      if ((!snapshot || snapshot === lastAutosavedRef.current) && retryItems.length === 0) return;
      if (allItems.length === 0) return;

      const { saved, failed } = await saveItemsBatch(allItems);
      
      if (saved > 0) {
        lastAutosavedRef.current = snapshot;
        setLastSavedAt(new Date());
        console.log(`[Inventory] Autosaved ${saved} items${failed > 0 ? ` (${failed} failed, will retry)` : ''}`);
      }
      if (failed > 0 && saved === 0) {
        console.warn(`[Inventory] Autosave: all ${failed} items failed, will retry next cycle`);
      }
    }, 5000); // Every 5 seconds — more frequent to minimize data loss window

    return () => {
      clearInterval(autosaveInterval);
    };
  }, [items, isViewOnly, isEditing, countId, saveItemsBatch]);

  // Save on visibility change (user switches tabs/apps — confirmed async save)
  useEffect(() => {
    if (isViewOnly || isEditing) return;
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'hidden') {
        // User is leaving — do CONFIRMED async save (not sendBeacon which can't confirm)
        const builder = buildSnapshotRef.current;
        if (!builder) return;
        const { itemCounts, snapshot } = builder();
        if (!snapshot || snapshot === lastAutosavedRef.current || itemCounts.length === 0) return;
        
        try {
          const { saved } = await saveItemsBatch(itemCounts);
          if (saved > 0) {
            lastAutosavedRef.current = snapshot;
            setLastSavedAt(new Date());
            console.log(`[Inventory] Visibility-change save: ${saved} items confirmed`);
          }
        } catch (e) {
          // If async fails, fire sync as last resort (better than nothing)
          flushSaveSync();
          console.warn("[Inventory] Visibility-change async failed, fired sync fallback:", e);
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [saveItemsBatch, flushSaveSync, isViewOnly, isEditing]);

  // Save current progress (manual save — used by Save & Exit)
  // Uses resilient saveItemsBatch with up to 2 retries for failed items
  // Waits for any in-progress autosave to finish first
  const handleSave = async () => {
    if (!items || Object.keys(counts).length === 0) return;
    
    // Wait for any in-progress save to complete before manual save
    let waitAttempts = 0;
    while (saveInProgressRef.current && waitAttempts < 20) {
      await new Promise(r => setTimeout(r, 250));
      waitAttempts++;
    }
    
    setIsSaving(true);
    const itemCounts = items.map(item => {
      const key = (item as any)._splitKey || item.item_id;
      const storLocId = item.storage_location_id;
      const casesVal = counts[key]?.cases || 0;
      const unitsVal = counts[key]?.units || 0;
      const innerVal = counts[key]?.innerPacks || 0;
      const lens = (lensEnabledForLocation === true && item.brand_item_id)
        ? packLensMap?.get(item.brand_item_id) ?? null
        : null;
      const innerPackQty = Number((item as any).inner_pack_quantity ?? (lens as any)?.inner_qty ?? 0) || null;
      return {
        item_id: item.item_id,
        quantity: getItemTotalIncludingLegs(item, key, resolveItemPackQty(item), resolveInnerPackQtyForTotal(item)),
        storage_location_id: (storLocId === 'uncategorized' || storLocId === 'recipes') ? null : storLocId,
        entered_cases: casesVal,
        entered_units: unitsVal,
        // Phase 3: third counting tier
        entered_inner_packs: innerVal,
        item_name_at_count: item.item_name,
        cost_at_count: item.cost_per_unit,
        unit_at_count: item.unit,
        pack_quantity_at_count: resolveItemPackQty(item),
        // Phase 3: snapshot inner_pack_quantity at save time for historical immutability
        inner_pack_quantity_at_count: innerPackQty,
        pan_sizes_at_count: item.pan_sizes ?? null,
        // Audit log metadata (Palm Springs forensic logging)
        _item_name: item.item_name,
        _storage_location_name: item.storage_location,
        _pack_quantity: item.pack_quantity,
        _inner_pack_quantity: innerPackQty,
        _pan_sizes: item.pan_sizes,
        _pan_inputs: panCounts[key] || null,
      };
    });
    
    console.log(`[Inventory] Manual save: ${itemCounts.length} items, ${itemCounts.filter(ic => ic.quantity > 0).length} non-zero`);
    
    try {
      let result = await saveItemsBatch(itemCounts);
      
      // Retry failed items up to 2 more times
      for (let attempt = 0; attempt < 2 && result.failed > 0; attempt++) {
        console.log(`[Inventory] Manual save retry ${attempt + 1} for ${result.failed} failed items`);
        await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        const retryItems = Array.from(failedItemsRef.current.values());
        if (retryItems.length === 0) break;
        result = await saveItemsBatch(retryItems);
      }
      
      // Update last autosaved to prevent unmount flush from re-saving stale data
      if (buildSnapshotRef.current) {
        const { snapshot } = buildSnapshotRef.current();
        lastAutosavedRef.current = snapshot;
      }
      
      if (failedItemsRef.current.size > 0) {
        toast.warning(`Saved with ${failedItemsRef.current.size} item(s) pending — they'll retry automatically`);
      } else {
        toast.success("Progress saved");
      }
      setLastSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
      // Invalidate the items-for-count cache so re-entry loads fresh DB values
      queryClient.invalidateQueries({ queryKey: ["inventory-items-for-count", locationId, countId] });
      // Phone-notepad: clean local cache once the cloud has confirmed everything.
      // If failed items remain, leave the cache intact so the next autosave /
      // re-entry can replay them.
      if (failedItemsRef.current.size === 0) {
        await clearCountCache(countId);
        setInventoryCountLock({ pending: 0 });
      }
    } catch (error) {
      console.error("Save failed:", error);
      toast.error("Failed to save");
      throw error; // Re-throw so Save & Exit knows it failed
    } finally {
      setIsSaving(false);
    }
  };

  const updateCases = (itemId: string, delta: number) => {
    setCounts(prev => {
      const newValue = Math.max(0, Math.round(((prev[itemId]?.cases || 0) + delta) * 100) / 100);
      if (itemId.includes('::leg::')) {
        traceSpinach('ui-update-cases-stepper', {
          key: itemId,
          prev: prev[itemId] || { cases: 0, units: 0, innerPacks: 0 },
          nextCases: newValue,
        });
      }
      // Also update raw input to stay in sync
      setRawInputs(p => ({
        ...p,
        [itemId]: { ...p[itemId], cases: String(newValue) }
      }));
      return {
        ...prev,
        [itemId]: {
          ...(prev[itemId] || { cases: 0, units: 0, innerPacks: 0 }),
          cases: newValue,
        }
      };
    });
  };

  const updatePanCount = (itemId: string, panKey: string, delta: number) => {
    setPanCounts(prev => {
      const itemPans = prev[itemId] || {};
      const newVal = Math.max(0, Math.round(((itemPans[panKey] || 0) + delta) * 2) / 2);
      setRawPanInputs(p => ({ ...p, [itemId]: { ...p[itemId], [panKey]: String(newVal) } }));
      return { ...prev, [itemId]: { ...itemPans, [panKey]: newVal } };
    });
  };

  const handlePanInput = (itemId: string, panKey: string, value: string) => {
    setRawPanInputs(prev => ({ ...prev, [itemId]: { ...prev[itemId], [panKey]: value } }));
  };

  const handlePanBlur = (itemId: string, panKey: string) => {
    const raw = rawPanInputs[itemId]?.[panKey] ?? '';
    const parsed = parseFloat(raw);
    const finalVal = isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed * 2) / 2);
    setPanCounts(prev => ({ ...prev, [itemId]: { ...prev[itemId], [panKey]: finalVal } }));
    setRawPanInputs(prev => ({ ...prev, [itemId]: { ...prev[itemId], [panKey]: String(finalVal) } }));
  };

  const updateUnits = (itemId: string, delta: number) => {
    setCounts(prev => {
      const newValue = Math.max(0, Math.round(((prev[itemId]?.units || 0) + delta) * 100) / 100);
      if (itemId.includes('::leg::')) {
        traceSpinach('ui-update-units-stepper', {
          key: itemId,
          prev: prev[itemId] || { cases: 0, units: 0, innerPacks: 0 },
          nextUnits: newValue,
        });
      }
      setRawInputs(p => ({
        ...p,
        [itemId]: { ...p[itemId], units: String(newValue) }
      }));
      return {
        ...prev,
        [itemId]: {
          ...(prev[itemId] || { cases: 0, units: 0, innerPacks: 0 }),
          units: newValue,
        }
      };
    });
  };

  // Phase 4: third counting tier (Sleeves / Bundles / Inner Boxes / Inner Packs)
  const updateInnerPacks = (itemId: string, delta: number) => {
    setCounts(prev => {
      const newValue = Math.max(0, Math.round(((prev[itemId]?.innerPacks || 0) + delta) * 100) / 100);
      if (itemId.includes('::leg::')) {
        traceSpinach('ui-update-inner-stepper', {
          key: itemId,
          prev: prev[itemId] || { cases: 0, units: 0, innerPacks: 0 },
          nextInnerPacks: newValue,
        });
      }
      setRawInputs(p => ({
        ...p,
        [itemId]: { ...p[itemId], innerPacks: String(newValue) }
      }));
      return {
        ...prev,
        [itemId]: {
          ...(prev[itemId] || { cases: 0, units: 0, innerPacks: 0 }),
          innerPacks: newValue,
        }
      };
    });
  };

  // Handle raw input for cases - allows typing decimals like ".5"
  const handleCasesInput = (itemId: string, inputValue: string) => {
    setRawInputs(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], cases: inputValue, units: prev[itemId]?.units || '' }
    }));
  };

  // Process cases input on blur - just store the decimal value
  const handleCasesBlur = (itemId: string) => {
    const rawValue = rawInputs[itemId]?.cases || '';
    const value = parseFloat(rawValue);
    
    const finalValue = isNaN(value) ? 0 : Math.max(0, value);
    if (itemId.includes('::leg::')) {
      traceSpinach('ui-blur-cases', {
        key: itemId,
        rawValue,
        finalValue,
      });
    }
    
    setCounts(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || { cases: 0, units: 0, innerPacks: 0 }),
        cases: finalValue,
      }
    }));
    
    setRawInputs(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], cases: String(finalValue) }
    }));
  };

  // Handle raw input for units
  const handleUnitsInput = (itemId: string, inputValue: string) => {
    setRawInputs(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], units: inputValue, cases: prev[itemId]?.cases || '' }
    }));
  };

  // Process units input on blur
  const handleUnitsBlur = (itemId: string) => {
    const rawValue = rawInputs[itemId]?.units || '';
    const value = parseFloat(rawValue);
    
    const finalValue = isNaN(value) ? 0 : Math.max(0, value);
    if (itemId.includes('::leg::')) {
      traceSpinach('ui-blur-units', {
        key: itemId,
        rawValue,
        finalValue,
      });
    }
    
    setCounts(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || { cases: 0, units: 0, innerPacks: 0 }),
        units: finalValue,
      }
    }));
    
    setRawInputs(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], units: String(finalValue) }
    }));
  };

  // Phase 4: inner pack input handlers
  const handleInnerPacksInput = (itemId: string, inputValue: string) => {
    setRawInputs(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], innerPacks: inputValue, cases: prev[itemId]?.cases || '', units: prev[itemId]?.units || '' }
    }));
  };

  const handleInnerPacksBlur = (itemId: string) => {
    const rawValue = rawInputs[itemId]?.innerPacks || '';
    const value = parseFloat(rawValue);
    const finalValue = isNaN(value) ? 0 : Math.max(0, value);
    if (itemId.includes('::leg::')) {
      traceSpinach('ui-blur-inner', {
        key: itemId,
        rawValue,
        finalValue,
      });
    }
    setCounts(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || { cases: 0, units: 0, innerPacks: 0 }),
        innerPacks: finalValue,
      }
    }));
    setRawInputs(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], innerPacks: String(finalValue) }
    }));
  };

  // Apply parsed voice commands to state (shared by local + AI paths)
  const applyVoiceCommands = useCallback((commands: any[], transcript: string) => {
    let successCount = 0;
    let lastMatchedId: string | null = null;

    for (const cmd of commands) {
      if (cmd.matched_item_id && cmd.confidence !== 'low') {
        const itemId = cmd.matched_item_id;
        const cases = cmd.cases ?? 0;
        const units = cmd.units ?? 0;

        // Safety: skip if zero for both - don't wipe existing data
        if (cases === 0 && units === 0) {
          console.warn('[Voice] Skipping zero-count command for item:', cmd.item_name);
          toast.warning(`Skipped "${cmd.item_name}" — heard 0 cases & 0 units`);
          playError();
          continue;
        }

        setCounts(prev => ({ ...prev, [itemId]: { cases, units } }));
        setRawInputs(prev => ({ ...prev, [itemId]: { cases: String(cases), units: String(units) } }));

        lastMatchedId = itemId;
        successCount++;

        const matchedItem = currentItems?.find(i => i.item_id === itemId);
        if (matchedItem) {
          playSuccess(matchedItem.item_name, cases, units);
        }
        toast.success(`${matchedItem?.item_name}: ${cases} cases, ${units} units`);
      } else if (cmd.item_name) {
        toast.warning(`Couldn't match "${cmd.item_name}" to an item`);
        playError();
        setErrorHighlightedItemId("__unmatched__");
        setTimeout(() => setErrorHighlightedItemId(null), 2000);
      }
    }

    if (lastMatchedId) {
      setHighlightedItemId(lastMatchedId);
      setTimeout(() => setHighlightedItemId(null), 2000);
    }

    if (successCount === 0 && commands.length === 0) {
      toast.warning(`Couldn't understand: "${transcript}"`);
      playError();
    }
  }, [currentItems, playSuccess, playError]);

  // Voice input handler — text-based path (Chrome/Android native speech)
  const handleVoiceTranscript = useCallback(async (transcript: string) => {
    if (!currentItems || currentItems.length === 0) return;

    const itemList = currentItems.map(i => ({ item_id: i.item_id, item_name: i.item_name }));

    // Show what was heard immediately (feels responsive)
    toast.info(`"${transcript}"`, { duration: 3000 });

    try {
      const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=parse-inventory-voice', {
        body: { transcript, items: itemList }
      });

      if (error) throw error;
      applyVoiceCommands(data.commands || [], transcript);
    } catch (error) {
      console.error('[Voice] AI parse error:', error);
      toast.error('Failed to process voice command');
      playError();
    }
  }, [currentItems, applyVoiceCommands, playError]);

  // Native speech (Chrome/Android) — returns isSupported=false on iOS
  const nativeVoice = useVoiceInput({
    onTranscript: handleVoiceTranscript,
    continuous: true
  });

  // Audio-based voice input (iOS) — records audio → sends to Gemini for transcription + matching
  const audioItemList = useMemo(
    () => (currentItems || []).map(i => ({ item_id: i.item_id, item_name: i.item_name })),
    [currentItems]
  );

  const handleAudioResult = useCallback((commands: any[], transcript: string) => {
    setPendingVoiceText(null);
    toast.info(`"${transcript}"`, { duration: 3000 });
    applyVoiceCommands(commands, transcript);
  }, [applyVoiceCommands]);

  const handleAudioPending = useCallback((text: string) => {
    setPendingVoiceText(text);
  }, []);

  const handleAudioError = useCallback((message: string) => {
    setPendingVoiceText(null);
    toast.error(message);
    playError();
  }, [playError]);

  const audioVoice = useAudioVoiceInput({
    onResult: handleAudioResult,
    onPending: handleAudioPending,
    onError: handleAudioError,
    items: audioItemList,
  });

  // Pick the right voice engine — audio for iOS, native for everything else
  const useAudioPath = !nativeVoice.isSupported && audioVoice.isSupported;
  const isListening = useAudioPath ? audioVoice.isListening : nativeVoice.isListening;
  const isSupported = useAudioPath ? audioVoice.isSupported : nativeVoice.isSupported;
  const toggleListening = useAudioPath ? audioVoice.toggleListening : nativeVoice.toggleListening;

  // Refs for stable callback references
  const handleSaveRef = useRef(handleSave);
  const handleSaveEditsRef = useRef(handleSaveEdits);
  const onCloseRef = useRef(onClose);
  const toggleListeningRef = useRef(toggleListening);
  
  // Keep refs updated
  useEffect(() => {
    handleSaveRef.current = handleSave;
    handleSaveEditsRef.current = handleSaveEdits;
    onCloseRef.current = onClose;
    toggleListeningRef.current = toggleListening;
  });

  // Expose save to parent via ref
  useEffect(() => {
    if (saveRef) {
      saveRef.current = {
        save: async () => { 
          if (isEditing) { 
            handleSaveEditsRef.current(); 
          } else { 
            await handleSaveRef.current(); 
          } 
        },
        isSaving,
      };
    }
    return () => {
      if (saveRef) saveRef.current = null;
    };
  }, [saveRef, isEditing, isSaving]);

  // Timer for elapsed counting time
  useEffect(() => {
    if (!isViewOnly && !isEditing) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(prev => {
          const next = prev + 1;
          elapsedSecondsRef.current = next;
          return next;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isViewOnly, isEditing]);

  // Set up smart dock on mobile
  useEffect(() => {
    if (isMobile && !isViewOnly) {
      setDockContent({
        type: 'inventory-count',
        totalValue: totalCost,
        countedItems,
        totalItems,
        isSaving,
        isListening,
        isVoiceSupported: isSupported,
        isEditing,
        elapsedSeconds,
        lastSavedAt,
        onSave: () => (isEditing ? handleSaveEditsRef.current() : onClose()),
        onToggleVoice: () => toggleListeningRef.current(),
      });
    } else {
      setDockContent(null);
    }
    
    // Clear dock content on unmount
    return () => {
      setDockContent(null);
    };
  }, [isMobile, isViewOnly, totalCost, countedItems, totalItems, isSaving, isListening, isSupported, isEditing, elapsedSeconds, lastSavedAt, setDockContent]);

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  if (!items || items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-muted-foreground">No inventory items configured.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Go to Setup tab to add items.
          </p>
          <Button variant="outline" className="mt-4" onClick={onClose}>
            Close
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <div
      data-inventory-count-session={isViewOnly ? undefined : "true"}
      className={cn("space-y-3", isMobile && !isViewOnly ? "pb-32" : "pb-6")}
    >
      {/* Desktop: Stats bar at top */}
      {!isMobile && !isViewOnly && (
        <div className="sticky top-14 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border -mx-4 px-4 py-3 space-y-2">
          {/* Progress bar */}
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${totalItems > 0 ? (countedItems / totalItems) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 lg:gap-3 min-w-0 flex-1">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-xs text-muted-foreground">Items:</span>
                <span className="font-semibold text-sm">{countedItems}<span className="text-muted-foreground font-normal">/{totalItems}</span></span>
              </div>
              <div className="h-5 w-px bg-border" />
              <div className="flex items-center gap-1 whitespace-nowrap">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="font-semibold text-primary text-sm">{formatCurrency(totalCost)}</span>
              </div>
              <div className="h-5 w-px bg-border" />
              <div className="flex items-center gap-1 whitespace-nowrap">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold font-mono text-sm">{Math.floor(elapsedSeconds / 60)} min</span>
              </div>
              {!isViewOnly && (
                <>
                  <div className="h-5 w-px bg-border" />
                  <div className="shrink-0"><InventorySyncPill /></div>
                </>
              )}
              {isEditing && (
                <>
                  <div className="h-5 w-px bg-border" />
                  <div className="flex items-center gap-1.5 text-amber-600 text-xs font-medium whitespace-nowrap">
                    <History className="h-4 w-4" />
                    <span>Editing</span>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isSupported && !isEditing && (
                <Button
                  variant={isListening ? "destructive" : "outline"}
                  size="icon"
                  onClick={toggleListening}
                  title={isListening ? "Stop Voice" : "Voice Input"}
                  aria-label={isListening ? "Stop Voice" : "Voice Input"}
                >
                  {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Button
                onClick={isEditing ? handleSaveEdits : () => onClose()}
                disabled={isEditing ? saveEditMutation.isPending : isSaving}
                variant={isEditing ? "default" : "outline"}
                size="icon"
                title={isEditing ? "Save Changes" : "Save & Exit"}
                aria-label={isEditing ? "Save Changes" : "Save & Exit"}
                className={isEditing ? "bg-amber-600 hover:bg-amber-700" : ""}
              >
                {isEditing ? <Save className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              </Button>
            </div>
          </div>

        </div>
      )}

      {/* Edit mode notice — shown once on entry as a dialog */}
      <Dialog open={showEditNotice} onOpenChange={setShowEditNotice}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <History className="h-5 w-5" />
              Editing a completed count
            </DialogTitle>
            <DialogDescription>
              Any changes you make will be tracked and added to the audit trail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowEditNotice(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Progress bar moved into sticky top nav */}


      {/* Pending voice processing indicator */}
      {pendingVoiceText && isListening && (
        <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 animate-pulse">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm text-muted-foreground italic">{pendingVoiceText}</span>
        </div>
      )}

      {/* Location navigation — sticky with progress indicator */}
      {locationKeys.length > 1 && (
        <div className="sticky top-[calc(env(safe-area-inset-top)+3.25rem+0.5rem)] md:top-[8.5rem] z-20 mt-2 bg-primary/95 backdrop-blur-md text-primary-foreground rounded-md px-2 py-2 shadow-md overflow-hidden border border-white/10">
          <div className="flex items-center gap-2">
            <button
              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
              onClick={() => setCurrentLocationIndex(Math.max(0, currentLocationIndex - 1))}
              disabled={currentLocationIndex === 0}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="text-center flex-1 min-w-0">
              <p className="font-semibold text-sm text-primary-foreground truncate leading-tight">
                {itemsByLocation[currentLocation]?.name} ({currentItems.length}) — {formatCurrency(currentItems.reduce((sum, i) => sum + getItemCost(i), 0))}
              </p>
              <p className="text-[11px] text-primary-foreground/70 tabular-nums leading-tight">
                Page {currentLocationIndex + 1}/{locationKeys.length}
              </p>
            </div>
            <button
              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
              onClick={() => setCurrentLocationIndex(Math.min(locationKeys.length - 1, currentLocationIndex + 1))}
              disabled={currentLocationIndex === locationKeys.length - 1}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Item list with dual counting */}
      <div className="space-y-3 -mx-1 sm:mx-0">
        {currentItems.map((item) => {
          const splitKey = (item as any)._splitKey || item.item_id;
          const count = counts[splitKey] || { cases: 0, units: 0, innerPacks: 0 };
          const innerPackQty = (item as any).inner_pack_quantity ?? null;
          const showInnerPacks = !item.is_recipe && innerPackQty != null && innerPackQty > 0;
          const itemCost = getItemCost(item);
          const conv = item.brand_item_id ? conversionMap.get(item.brand_item_id) : null;
          const pipeline2Pack =
            conv && (conv.canonical_unit === 'ea' || conv.outer_unit === 'ea' || conv.inner_unit === 'ea')
              ? (conv.outer_qty || 0) * (conv.canonical_qty_per_inner || 1)
              : 0;
          const packQty =
            (item.pack_quantity && item.pack_quantity > 1)
              ? item.pack_quantity
              : (pipeline2Pack > 1 ? pipeline2Pack : 1);
          const isHighlighted = highlightedItemId === splitKey;
          const isErrorHighlighted = errorHighlightedItemId === splitKey;
          
          // Lane decision delegated to computeCountLanes — single source of
          // truth shared with the BrandPackConfigApprovals preview. See
          // src/utils/computeCountLanes.ts. The visibility rule (lens-driven
          // case tier, true-single-unit suppression, count_by overrides) and
          // the inner-lane label resolution all live there.
          const lensForItem = (lensEnabledForLocation === true && item.brand_item_id)
            ? packLensMap?.get(item.brand_item_id) ?? null
            : null;
          const lanes = computeCountLanes({
            item: {
              is_recipe: item.is_recipe,
              pack_quantity: item.pack_quantity,
              _rawPackQuantityOverride: (item as any)._rawPackQuantityOverride,
              _rawPackQuantity: (item as any)._rawPackQuantity,
              inner_pack_quantity: (item as any).inner_pack_quantity,
              inner_pack_label: (item as any).inner_pack_label,
              unit: item.unit,
              cost_per_unit: item.cost_per_unit,
              count_by: (item.count_by ?? 'inherit') as any,
            },
            lens: lensForItem,
            lensEnabled: lensEnabledForLocation === true && !!item.brand_item_id,
          });
          const showCases = lanes.showCases;
          const showUnits = lanes.showUnits;
          const hasMultipleLegConfigs =
            legsEnabledForLocation === true &&
            lensEnabledForLocation === true &&
            !!item.brand_item_id &&
            (legsConfigsMap?.get(item.brand_item_id)?.length ?? 0) >= 2;
          
          // === Build unified configs array (single source for mobile + desktop renders) ===
          type LaneSpec = {
            kind: 'cases' | 'inner' | 'units';
            label: string;
            value: any;
            onDown: () => void;
            onUp: () => void;
            onChange: (v: string) => void;
            onBlur: () => void;
          };
          type ConfigRow = {
            configId: string;
            label: string;
            subtitle: string;
            isDefault: boolean;
            lanes: (LaneSpec | null)[]; // [cases?, inner?, units?]
          };

          let configRows: ConfigRow[] = [];

          if (item.is_recipe) {
            configRows = [{
              configId: 'recipe',
              label: '',
              subtitle: '',
              isDefault: true,
              lanes: [
                {
                  kind: 'cases',
                  label: lanes.casesLabel,
                  value: rawInputs[splitKey]?.cases ?? count.cases,
                  onDown: () => updateCases(splitKey, -1),
                  onUp: () => updateCases(splitKey, 1),
                  onChange: (v) => handleCasesInput(splitKey, v),
                  onBlur: () => handleCasesBlur(splitKey),
                }, null, null,
              ],
            }];
          } else if (hasMultipleLegConfigs) {
            const configs = legsConfigsMap?.get(item.brand_item_id!) ?? [];
            configRows = configs.map((cfg) => {
              const legKey = cfg.is_default
                ? splitKey
                : makeLegInputKey(splitKey, cfg.pack_config_id, cfg.is_default);
              const legState = counts[legKey] || { cases: 0, units: 0, innerPacks: 0 };
              const outerQty = Number(cfg.outer_qty ?? 1) || 1;
              const innerIsCommon =
                (cfg.inner_type ?? '').trim().toLowerCase() ===
                (cfg.common_unit ?? '').trim().toLowerCase();
              const hasInnerTier = !innerIsCommon && Number(cfg.inner_qty ?? 0) > 0;
              // Pass cfg as the lens so resolveItemPackShape becomes the single
              // label/structure source for both single-config and multi-leg
              // branches. cfg still drives valuation below (subtitle/perCommon);
              // structural visibility (showCases/showInnerPacks) is overridden
              // per-leg below to preserve multi-leg semantics.
              const baseLanes = computeCountLanes({
                item: {
                  is_recipe: item.is_recipe,
                  pack_quantity: item.pack_quantity,
                  inner_pack_quantity: item.inner_pack_quantity,
                  inner_pack_label: (item as any).inner_pack_label ?? null,
                  unit: item.unit,
                  cost_per_unit: item.cost_per_unit,
                  count_by: 'inherit',
                },
                lens: {
                  count_units_per_case: cfg.count_units_per_case,
                  cost_per_common_unit: cfg.cost_per_common_unit,
                  common_unit: cfg.common_unit,
                  outer_qty: cfg.outer_qty,
                  outer_type: cfg.outer_type,
                  inner_qty: cfg.inner_qty,
                  inner_type: cfg.inner_type,
                } as any,
                lensEnabled: true,
              });
              // Trust the resolver (baseLanes) for lane structure & labels.
              // The resolver already triggers a 3-tier (Cases · Outer · Units)
              // shape when outer_qty > 1, and correctly collapses to 2-tier
              // when outer_qty <= 1. Previous override gated the middle tier
              // on inner_type !== common_unit, which incorrectly suppressed
              // the BAGS lane for items like Pesto (8 bag / 4 lb) where the
              // inner measure unit matches the common unit.
              void outerQty; void hasInnerTier; void innerIsCommon;
              const legLanes = baseLanes;
              const liveUnits = cfg.count_units_per_case ?? null;
              const livePerCommon =
                item.cost_per_unit != null && liveUnits && liveUnits > 0
                  ? item.cost_per_unit / liveUnits
                  : null;
              const perCommon = livePerCommon != null
                ? `${formatCurrency(livePerCommon)}/${cfg.common_unit || 'ea'}`
                : '—';
              return {
                configId: cfg.pack_config_id,
                label: cfg.label || `${cfg.outer_qty}/${cfg.inner_qty} ${cfg.common_unit}`,
                subtitle: `${cfg.count_units_per_case} ${cfg.common_unit}/cs · ${perCommon}`,
                isDefault: !!cfg.is_default,
                lanes: [
                  legLanes.showCases ? {
                    kind: 'cases', label: legLanes.casesLabel,
                    value: rawInputs[legKey]?.cases ?? legState.cases,
                    onDown: () => updateCases(legKey, -1),
                    onUp: () => updateCases(legKey, 1),
                    onChange: (v) => handleCasesInput(legKey, v),
                    onBlur: () => handleCasesBlur(legKey),
                  } : null,
                  legLanes.showInnerPacks ? {
                    kind: 'inner', label: legLanes.innerLabel,
                    value: rawInputs[legKey]?.innerPacks ?? legState.innerPacks,
                    onDown: () => updateInnerPacks(legKey, -1),
                    onUp: () => updateInnerPacks(legKey, 1),
                    onChange: (v) => handleInnerPacksInput(legKey, v),
                    onBlur: () => handleInnerPacksBlur(legKey),
                  } : null,
                  legLanes.showUnits ? {
                    kind: 'units', label: legLanes.unitsLabel,
                    value: rawInputs[legKey]?.units ?? legState.units,
                    onDown: () => updateUnits(legKey, -1),
                    onUp: () => updateUnits(legKey, 1),
                    onChange: (v) => handleUnitsInput(legKey, v),
                    onBlur: () => handleUnitsBlur(legKey),
                  } : null,
                ],
              };
            });
          } else {
            configRows = [{
              configId: 'single',
              label: item.pack_size || '',
              subtitle: '',
              isDefault: true,
              lanes: [
                showCases ? {
                  kind: 'cases', label: 'Cases',
                  value: rawInputs[splitKey]?.cases ?? count.cases,
                  onDown: () => updateCases(splitKey, -1),
                  onUp: () => updateCases(splitKey, 1),
                  onChange: (v) => handleCasesInput(splitKey, v),
                  onBlur: () => handleCasesBlur(splitKey),
                } : null,
                lanes.showInnerPacks ? {
                  kind: 'inner', label: lanes.innerLabel,
                  value: rawInputs[splitKey]?.innerPacks ?? (count.innerPacks ?? 0),
                  onDown: () => updateInnerPacks(splitKey, -1),
                  onUp: () => updateInnerPacks(splitKey, 1),
                  onChange: (v) => handleInnerPacksInput(splitKey, v),
                  onBlur: () => handleInnerPacksBlur(splitKey),
                } : null,
                showUnits ? {
                  kind: 'units', label: lanes.unitsLabel,
                  value: rawInputs[splitKey]?.units ?? count.units,
                  onDown: () => updateUnits(splitKey, -1),
                  onUp: () => updateUnits(splitKey, 1),
                  onChange: (v) => handleUnitsInput(splitKey, v),
                  onBlur: () => handleUnitsBlur(splitKey),
                } : null,
              ],
            }];
          }

          const isMultiConfig = configRows.length > 1;
          const hasPan = !!(item.pan_sizes?.enabled && item.pan_sizes.enabled_keys?.length);
          const panKeys = item.pan_sizes?.enabled_keys ?? [];

          // Build item header subtitle text (plain string, comma-separated)
          const headerBits: string[] = [];
          if (item.pack_size) headerBits.push(item.pack_size);
          if (item.item_number) headerBits.push(`#${item.item_number}`);
          if (item.is_recipe) {
            const rc = recipeCosts?.get(item.item_id) || item.cost_per_unit || 0;
            if (rc) headerBits.push(`${formatCurrency(rc)}/ea`);
          } else if (item.cost_per_unit) {
            // Header subtitle pulls pack structure + unit from the unified
            // shape resolver (snapshot > lens > local) so it agrees with the
            // lane labels, valuation math, and save snapshot. Previously this
            // block read item.pack_quantity / inner_pack_quantity directly,
            // which is why approved-lens items rendered "/u" instead of the
            // lens common_unit (e.g. "/lb").
            const shape = getShape(item);
            const caseCost = Number(item.cost_per_unit) || 0;
            const packsPerCase = Number(shape.packQty) || 1;
            const unitsPerPack = Number(shape.innerPackQty ?? 0) || 0;
            const hasInner = unitsPerPack > 0;
            const totalUnits = hasInner ? packsPerCase * unitsPerPack : packsPerCase;
            const unitToken = atomicUnitToken(shape.unit) ?? 'u';
            headerBits.push(`${formatCurrency(caseCost)}/cs`);
            if (hasInner) headerBits.push(`${formatCurrency(caseCost / packsPerCase)}/pk`);
            if (totalUnits > 0 && totalUnits !== packsPerCase) {
              headerBits.push(`${formatCurrency(caseCost / totalUnits)}/${unitToken}`);
            }
          }
          const headerSubtitle = headerBits.join(' · ');
          const headerUnits = item.is_recipe
            ? getTotalQuantity(splitKey, 1, item.pan_sizes, null)
            : getItemTotalIncludingLegs(item, splitKey, resolveItemPackQty(item), resolveInnerPackQtyForTotal(item));
          const headerUnitLabel = item.is_recipe ? (item.unit || 'ea') : 'units';

          // Reusable button row (coral down / mint up)
          const renderBtns = (lane: LaneSpec, sizeCls: string, iconCls: string, gapCls: string) => (
            <div className={cn("flex items-center", gapCls)}>
              {!isViewOnly && (
                <button
                  type="button"
                  onClick={lane.onDown}
                  className={cn(sizeCls, "flex items-center justify-center rounded-md border border-[#F5C4B3] bg-[#FEF3EE] text-[#993C1D] active:scale-95 transition-transform")}
                >
                  <ArrowDown className={iconCls} strokeWidth={2.25} />
                </button>
              )}
              {!isViewOnly && (
                <button
                  type="button"
                  onClick={lane.onUp}
                  className={cn(sizeCls, "flex items-center justify-center rounded-md border border-[#9FE1CB] bg-[#E1F5EE] text-[#0F6E56] active:scale-95 transition-transform")}
                >
                  <ArrowUp className={iconCls} strokeWidth={2.25} />
                </button>
              )}
            </div>
          );

          const gridColsClass = (n: number) =>
            n === 3 ? "grid-cols-3" : n === 2 ? "grid-cols-2" : "grid-cols-1";

          return (
            <div
              key={splitKey}
              className={cn(
                "bg-card rounded-lg border border-border/60 overflow-hidden relative transition-all duration-300",
                isHighlighted && "ring-2 ring-green-500 ring-offset-2 ring-offset-background scale-[1.02] shadow-lg shadow-green-500/20",
                isErrorHighlighted && "ring-2 ring-destructive ring-offset-2 ring-offset-background scale-[1.02] shadow-lg shadow-destructive/20 animate-pulse"
              )}
            >
              {/* Item header: name + subtitle + value badge */}
              <div className="relative px-3.5 py-3 sm:px-5 sm:py-4 border-b border-border/60">
                <div
                  className="absolute top-0 right-0 text-white text-center leading-tight"
                  style={{ backgroundColor: '#e85d04', padding: '6px 11px', borderTopRightRadius: 'calc(0.5rem - 1px)', borderBottomLeftRadius: '0.5rem' }}
                >
                  <p className="text-[15px] sm:text-base font-semibold tabular-nums tracking-tight">{formatCurrency(itemCost)}</p>
                  <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    {headerUnits} {headerUnitLabel}
                  </p>
                </div>
                <div style={{ paddingRight: 68 }}>
                  <p className="text-[15px] sm:text-base font-bold text-foreground truncate leading-tight">{item.item_name}</p>
                  {headerSubtitle && (
                    <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 truncate">{headerSubtitle}</p>
                  )}
                </div>
              </div>



              {/* ============ MOBILE LAYOUT (< 640px) ============ */}
              <div className="sm:hidden">
                {configRows.map((cfg, cfgIdx) => {
                  const active = cfg.lanes.filter((l): l is LaneSpec => !!l);
                  return (
                    <div key={cfg.configId} className={cn(cfgIdx > 0 && "border-t border-border/60")}>
                      {isMultiConfig && (
                        <div
                          className={cn(
                            "flex items-center gap-1.5 px-3.5 py-1.5 border-b border-border/60",
                            cfg.isDefault ? "" : "bg-muted"
                          )}
                          style={cfg.isDefault ? { backgroundColor: '#E1F5EE' } : undefined}
                        >
                          <span
                            className="text-[12px] font-medium"
                            style={cfg.isDefault ? { color: '#085041' } : undefined}
                          >
                            {cfg.label}
                          </span>
                          {cfg.isDefault && (
                            <span
                              className="rounded-full text-[9px] font-medium"
                              style={{ backgroundColor: '#0F6E56', color: '#E1F5EE', padding: '1px 8px' }}
                            >
                              default
                            </span>
                          )}
                          {cfg.subtitle && (
                            <span
                              className="ml-auto text-[10px] truncate"
                              style={cfg.isDefault ? { color: '#1D9E75' } : undefined}
                            >
                              {cfg.subtitle}
                            </span>
                          )}
                        </div>
                      )}
                      {active.length > 0 && (
                        <div className={cn("grid", gridColsClass(active.length))}>
                          {active.map((lane, i) => (
                            <div
                              key={lane.kind}
                              className={cn(
                                "flex flex-col items-center gap-1.5 py-2 px-1",
                                i < active.length - 1 && "border-r border-border/60"
                              )}
                            >
                              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                                {lane.label}
                              </p>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={lane.value}
                                onChange={(e) => lane.onChange(e.target.value)}
                                onBlur={lane.onBlur}
                                disabled={isViewOnly}
                                className="w-full text-center font-bold leading-none tabular-nums bg-transparent outline-none"
                              style={{ fontSize: 40, minHeight: 0 }}
                              />
                              {renderBtns(lane, "h-[42px] w-[42px]", "h-[18px] w-[18px]", "gap-4")}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {hasPan && (
                  <div className="border-t border-border/60">
                    <div className="px-3.5 py-1.5 bg-muted">
                      <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">PAN / CAMBRO</p>
                    </div>
                    <div className={cn("grid", gridColsClass(Math.min(panKeys.length, 3)))}>
                      {panKeys.map((panKey, i) => {
                        const container = ALL_CONTAINERS.find(c => c.key === panKey);
                        if (!container) return null;
                        const unitsEach = getPanUnits(item.pan_sizes!, panKey);
                        const panQty = panCounts[splitKey]?.[panKey] || 0;
                        const last = i === Math.min(panKeys.length, 3) - 1;
                        return (
                          <div
                            key={panKey}
                            className={cn(
                              "flex flex-col items-center gap-1.5 py-2 px-1",
                              !last && "border-r border-border/60"
                            )}
                          >
                            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground text-center truncate w-full px-1">
                              {container.label}{unitsEach != null && ` (${unitsEach})`}
                            </p>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={rawPanInputs[splitKey]?.[panKey] ?? panQty}
                              onChange={(e) => handlePanInput(splitKey, panKey, e.target.value)}
                              onBlur={() => handlePanBlur(splitKey, panKey)}
                              disabled={isViewOnly}
                              className="w-full text-center font-bold leading-none tabular-nums bg-transparent outline-none"
                              style={{ fontSize: 40, minHeight: 0 }}
                            />
                            <div className="flex items-center gap-4">
                              {!isViewOnly && (
                                <button
                                  type="button"
                                  onClick={() => updatePanCount(splitKey, panKey, -0.5)}
                                  className="h-[42px] w-[42px] flex items-center justify-center rounded-lg border border-[#F5C4B3] bg-[#FEF3EE] text-[#993C1D] active:scale-95 transition-transform"
                                >
                                  <ArrowDown className="h-4 w-4" strokeWidth={2.25} />
                                </button>
                              )}
                              {!isViewOnly && (
                                <button
                                  type="button"
                                  onClick={() => updatePanCount(splitKey, panKey, 0.5)}
                                  className="h-[42px] w-[42px] flex items-center justify-center rounded-lg border border-[#9FE1CB] bg-[#E1F5EE] text-[#0F6E56] active:scale-95 transition-transform"
                                >
                                  <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ============ DESKTOP LAYOUT (>= 640px) ============ */}
              <div
                className={cn(
                  "hidden sm:grid",
                  isMultiConfig
                    ? "grid-cols-[180px_1fr_1fr_1fr]"
                    : "grid-cols-3"
                )}
              >
                {configRows.map((cfg) => {
                  const defaultBg = { backgroundColor: '#E1F5EE' };
                  const defaultBorder = '#9FE1CB';
                  const labelColor = cfg.isDefault ? '#085041' : undefined;
                  const subColor = cfg.isDefault ? '#1D9E75' : undefined;
                  return (
                    <div key={cfg.configId} className="contents">
                      {/* Row A — labels */}
                      {isMultiConfig && (
                        <div
                          className={cn(
                            "px-3.5 flex items-center gap-1.5 min-h-[36px] border-r border-b",
                            !cfg.isDefault && "bg-muted border-border/60"
                          )}
                          style={cfg.isDefault ? { ...defaultBg, borderRightColor: defaultBorder, borderBottomColor: defaultBorder } : undefined}
                        >
                          <span className="text-[12px] font-medium" style={labelColor ? { color: labelColor } : undefined}>
                            {cfg.label}
                          </span>
                          {cfg.isDefault && (
                            <span
                              className="rounded-full text-[9px] font-medium"
                              style={{ backgroundColor: '#0F6E56', color: '#E1F5EE', padding: '1px 8px' }}
                            >
                              default
                            </span>
                          )}
                        </div>
                      )}
                      {[0, 1, 2].map((slot) => {
                        const lane = cfg.lanes[slot];
                        return (
                          <div
                            key={`A-${slot}`}
                            className={cn(
                              "flex items-center justify-center min-h-[36px] border-b",
                              !cfg.isDefault && "bg-muted border-border/60"
                            )}
                            style={cfg.isDefault ? { ...defaultBg, borderBottomColor: defaultBorder } : undefined}
                          >
                            {lane ? (
                              <span
                                className="text-[9px] font-medium uppercase tracking-wider"
                                style={labelColor ? { color: labelColor } : { color: 'hsl(var(--muted-foreground))' }}
                              >
                                {lane.label}
                              </span>
                            ) : (
                              <span className="text-[9px] opacity-20">—</span>
                            )}
                          </div>
                        );
                      })}

                      {/* Row B — subtitle + steppers */}
                      {isMultiConfig && (
                        <div
                          className={cn(
                            "px-3.5 flex items-center border-r border-b py-2.5",
                            !cfg.isDefault && "bg-muted border-border/60"
                          )}
                          style={cfg.isDefault ? { ...defaultBg, borderRightColor: defaultBorder, borderBottomColor: defaultBorder } : undefined}
                        >
                          <span className="text-[10px]" style={subColor ? { color: subColor } : { color: 'hsl(var(--muted-foreground))' }}>
                            {cfg.subtitle}
                          </span>
                        </div>
                      )}
                      {[0, 1, 2].map((slot) => {
                        const lane = cfg.lanes[slot];
                        if (!lane) {
                          return (
                            <div
                              key={`B-${slot}`}
                              className="border-b border-border/60"
                              style={cfg.isDefault ? { ...defaultBg, borderBottomColor: defaultBorder } : undefined}
                            />
                          );
                        }
                        return (
                          <div
                            key={`B-${slot}`}
                            className="flex flex-col items-center gap-1.5 py-2 border-b border-border/60"
                          >
                            <input
                              type="text"
                              inputMode="decimal"
                              value={lane.value}
                              onChange={(e) => lane.onChange(e.target.value)}
                              onBlur={lane.onBlur}
                              disabled={isViewOnly}
                              className="w-full text-center font-bold leading-none tabular-nums bg-transparent outline-none"
                              style={{ fontSize: 40, minHeight: 0 }}
                            />
                            {renderBtns(lane, "h-[42px] w-[42px]", "h-[18px] w-[18px]", "gap-4")}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {hasPan && (
                  <div className="contents">
                    {/* Row C — pan labels */}
                    {isMultiConfig && (
                      <div className="px-3.5 flex items-center min-h-[36px] bg-muted border-r border-b border-border/60">
                        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">PAN / CAMBRO</span>
                      </div>
                    )}
                    {[0, 1, 2].map((slot) => {
                      const panKey = panKeys[slot];
                      const container = panKey ? ALL_CONTAINERS.find(c => c.key === panKey) : null;
                      const unitsEach = panKey ? getPanUnits(item.pan_sizes!, panKey) : null;
                      return (
                        <div
                          key={`C-${slot}`}
                          className="flex items-center justify-center min-h-[36px] bg-muted border-b border-border/60"
                        >
                          {container ? (
                            <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                              {container.label}{unitsEach != null && ` (${unitsEach})`}
                            </span>
                          ) : (
                            <span className="text-[9px] opacity-20">—</span>
                          )}
                        </div>
                      );
                    })}
                    {/* Row D — pan steppers */}
                    {isMultiConfig && (
                      <div className="bg-muted border-r border-b border-border/60" />
                    )}
                    {[0, 1, 2].map((slot) => {
                      const panKey = panKeys[slot];
                      if (!panKey) return <div key={`D-${slot}`} className="border-b border-border/60" />;
                      const panQty = panCounts[splitKey]?.[panKey] || 0;
                      return (
                        <div key={`D-${slot}`} className="flex flex-col items-center gap-1.5 py-2 border-b border-border/60">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={rawPanInputs[splitKey]?.[panKey] ?? panQty}
                            onChange={(e) => handlePanInput(splitKey, panKey, e.target.value)}
                            onBlur={() => handlePanBlur(splitKey, panKey)}
                            disabled={isViewOnly}
                            className="w-full text-center font-bold leading-none tabular-nums bg-transparent outline-none"
                              style={{ fontSize: 40, minHeight: 0 }}
                          />
                          <div className="flex items-center gap-4">
                            {!isViewOnly && (
                              <button
                                type="button"
                                onClick={() => updatePanCount(splitKey, panKey, -0.5)}
                                className="h-[42px] w-[42px] flex items-center justify-center rounded-lg border border-[#F5C4B3] bg-[#FEF3EE] text-[#993C1D] active:scale-95 transition-transform"
                              >
                                <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.25} />
                              </button>
                            )}
                            {!isViewOnly && (
                              <button
                                type="button"
                                onClick={() => updatePanCount(splitKey, panKey, 0.5)}
                                className="h-[42px] w-[42px] flex items-center justify-center rounded-lg border border-[#9FE1CB] bg-[#E1F5EE] text-[#0F6E56] active:scale-95 transition-transform"
                              >
                                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>

    {/* Mobile uses the smart dock via context - no inline dock needed */}

    {/* Edit Confirmation Dialog */}
    <Dialog open={showEditConfirm} onOpenChange={setShowEditConfirm}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Confirm Changes
          </DialogTitle>
          <DialogDescription>
            You're editing a completed inventory count. All changes will be tracked for audit purposes.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* List of changes */}
          <div className="bg-muted rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
            <p className="text-sm font-medium text-muted-foreground mb-2">
              {pendingEdits.length} item{pendingEdits.length !== 1 ? 's' : ''} changed:
            </p>
            {pendingEdits.map((edit, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="truncate flex-1">{edit.itemName}</span>
                <span className="text-muted-foreground ml-2">
                  {edit.previousQuantity} → <span className="font-medium text-foreground">{edit.newQuantity}</span>
                </span>
              </div>
            ))}
          </div>
          
          {/* Reason input */}
          <div>
            <label className="text-sm font-medium">Reason for changes (optional)</label>
            <Textarea
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g., Recount found 2 extra cases in back room"
              className="mt-1.5"
              rows={2}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowEditConfirm(false)}>
            Cancel
          </Button>
          <Button 
            onClick={confirmSaveEdits}
            disabled={saveEditMutation.isPending}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Save with Audit Trail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default InventoryCountSession;
