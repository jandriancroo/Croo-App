import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { ChevronLeft, ChevronRight, Minus, Plus, DollarSign, History, AlertTriangle, ArrowLeft, Save, Mic, MicOff, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useAudioVoiceInput } from "@/hooks/useAudioVoiceInput";
import { useInventoryVoiceFeedback } from "@/hooks/useInventoryVoiceFeedback";
import { useAuth } from "@/lib/auth";

import { useIsMobile } from "@/hooks/use-mobile";
import { useDockToast } from "@/contexts/DockToastContext";
import { ALL_CONTAINERS, getPanUnits, type PanSizesConfig } from "@/components/inventory/PanSizesSection";
import { fetchRecipeCosts } from "@/utils/recipeCostCalculation";

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
  item_number: string | null;
  brand: string | null;
  image_url: string | null;
  pan_sizes: PanSizesConfig | null;
  is_recipe: boolean;
  /** Per-shortcut counting mode: inherit uses global settings */
  count_by: 'inherit' | 'cases_and_units' | 'units_only' | 'cases_only';
}

// Count state: cases + individual units (supports decimals for partial cases)
interface ItemCount {
  cases: number;
  units: number;
}

interface PendingEdit {
  countItemId: string | null;
  itemName: string;
  previousQuantity: number;
  newQuantity: number;
  itemId?: string;
  storageLocationId?: string;
}

const InventoryCountSession = ({ countId, locationId, onClose, isEditing = false, isViewOnly = false, saveRef }: InventoryCountSessionProps) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { setDockContent } = useDockToast();
  const { playSuccess, playError } = useInventoryVoiceFeedback();
  const [currentLocationIndex, setCurrentLocationIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, ItemCount>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, { cases: string; units: string }>>({});
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
          count_units_per_case,
          item_number,
          brand,
          image_url,
          pan_sizes,
          storage_location_id,
          is_recipe,
          countable,
          recipe_yield_unit,
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

      // For edit/continue mode: also fetch items in the count record that may now be inactive/hidden
      // This prevents data loss when re-opening a completed count
      let itemsData = activeItems || [];
      if (isEditing) {
        const { data: countItemIds } = await supabase
          .from("inventory_count_items")
          .select("item_id")
          .eq("count_id", countId);
        
        const activeIdSet = new Set((activeItems || []).map(i => i.id));
        const missingIds = (countItemIds || [])
          .map(ci => ci.item_id)
          .filter(id => !activeIdSet.has(id));
        
        if (missingIds.length > 0) {
          // Deduplicate missing IDs
          const uniqueMissingIds = [...new Set(missingIds)];
          const { data: inactiveItems } = await supabase
            .from("inventory_items")
            .select(itemColumns)
            .in("id", uniqueMissingIds);
          
          if (inactiveItems && inactiveItems.length > 0) {
            itemsData = [...itemsData, ...inactiveItems];
          }
        }
      }

      // Fetch multi-location assignments from junction table (including count_by override and display_order)
      const { data: itemLocations } = await supabase
        .from("inventory_item_locations")
        .select("item_id, storage_location_id, count_by, display_order");
      
      // Build map: item_id -> list of storage_location_ids
      const multiLocMap = new Map<string, string[]>();
      // Build map: "itemId|storLocId" -> count_by override
      const countByMap = new Map<string, string>();
      // Build map: "itemId|storLocId" -> display_order from junction table (for shortcuts)
      const junctionOrderMap = new Map<string, number>();
      for (const il of itemLocations || []) {
        const existing = multiLocMap.get(il.item_id) || [];
        existing.push(il.storage_location_id);
        multiLocMap.set(il.item_id, existing);
        countByMap.set(`${il.item_id}|${il.storage_location_id}`, il.count_by || 'inherit');
        if (typeof (il as any).display_order === 'number') {
          junctionOrderMap.set(`${il.item_id}|${il.storage_location_id}`, (il as any).display_order);
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
        .select("id, item_id, quantity, entered_cases, entered_units, storage_location_id")
        .eq("count_id", countId) as any;
      
      if (countError) throw countError;

      // Map: "itemId|storLocId" -> { quantity, countItemId, entered_cases, entered_units }
      const countMap = new Map(
        (countItems as any[])?.map((ci: any) => [
          `${ci.item_id}|${ci.storage_location_id || ''}`, 
          { quantity: ci.quantity, countItemId: ci.id, entered_cases: ci.entered_cases, entered_units: ci.entered_units }
        ]) || []
      );
      // Also keep a simple item_id map for backwards compat (old counts without storage_location_id)
      const simpleCountMap = new Map((countItems as any[])?.map((ci: any) => [ci.item_id, { quantity: ci.quantity, countItemId: ci.id, entered_cases: ci.entered_cases, entered_units: ci.entered_units }]) || []);

      const result: (CountItem & { _existingQuantity: number; _existingCases: number | null; _existingUnits: number | null; _countItemId: string | null; _splitKey: string })[] = [];
      
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
            unit: isRecipe ? ((item as any).recipe_yield_unit || item.unit) : item.unit,
            storage_location: isRecipe 
              ? (locId ? (locNameMap.get(locId) || "Recipes") : "Recipes")
              : (locId ? (locNameMap.get(locId) || "Uncategorized") : "Uncategorized"),
            storage_location_id: isRecipe 
              ? (locId || "recipes") 
              : (locId || "uncategorized"),
            par_level: item.par_level,
            cost_per_unit: item.cost_per_unit,
            pack_size: item.pack_size,
            pack_quantity: item.pack_quantity_override ?? item.pack_quantity,
            count_units_per_case: (item as any).count_units_per_case,
            item_number: item.item_number,
            brand: item.brand,
            image_url: item.image_url,
            pan_sizes: (item as any).pan_sizes ?? null,
            is_recipe: isRecipe,
            count_by: (locId ? countByMap.get(`${item.id}|${locId}`) : 'inherit') as CountItem['count_by'] || 'inherit',
            _existingQuantity: countData?.quantity ?? 0,
            _existingCases: countData?.entered_cases ?? null,
            _existingUnits: countData?.entered_units ?? null,
            _countItemId: countData?.countItemId || null,
            _splitKey: splitKey,
            _sortOrder: sortOrder,
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
  useEffect(() => {
    if (!items || countsInitializedRef.current) return;
    countsInitializedRef.current = true;
    
    const initialCounts: Record<string, ItemCount> = {};
    const originals: Record<string, number> = {};
    
    items.forEach(item => {
      const key = (item as any)._splitKey || item.item_id;
      const existingCases = (item as any)._existingCases;
      const existingUnits = (item as any)._existingUnits;
      const totalUnits = (item as any)._existingQuantity || 0;
      const packQty = item.pack_quantity || 1;
      
      // Prefer stored entered_cases/entered_units (exact user input)
      // Fall back to mathematical decomposition of quantity
      // CRITICAL: If entered_cases=0 and entered_units=0 but quantity>0,
      // the entry was counted via pan sizes or old method — decompose instead
      const hasStoredInput = existingCases !== null && existingCases !== undefined
        && (existingCases > 0 || (existingUnits ?? 0) > 0 || totalUnits === 0);
      if (hasStoredInput) {
        initialCounts[key] = {
          cases: existingCases,
          units: existingUnits ?? 0,
        };
      } else {
        initialCounts[key] = {
          cases: Math.floor(totalUnits / packQty),
          units: totalUnits % packQty
        };
      }
      
      // Store original quantities for edit tracking
      if (isEditing) {
        originals[key] = totalUnits;
      }
    });
    
    setCounts(initialCounts);
    if (isEditing) {
      originalCounts.current = originals;
    }
  }, [items, isEditing]);

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

  // Calculate total quantity for an item (cases * pack_quantity + units + pan units)
  // Uses rawInputs if available (live typing), falls back to committed counts
  const getTotalQuantity = useCallback((itemId: string, packQuantity: number | null, panSizes?: PanSizesConfig | null) => {
    const packQty = packQuantity || 1;
    // Prefer live rawInputs so cost updates while the user is typing
    const rawCases = parseFloat(rawInputs[itemId]?.cases ?? '');
    const rawUnits = parseFloat(rawInputs[itemId]?.units ?? '');
    const committed = counts[itemId] || { cases: 0, units: 0 };
    const casesVal = isNaN(rawCases) ? committed.cases : Math.max(0, rawCases);
    const unitsVal = isNaN(rawUnits) ? committed.units : Math.max(0, rawUnits);
    const panUnits = panSizes !== undefined ? getPanUnitsTotal(itemId, panSizes) : 0;
    return Math.round((casesVal * packQty + unitsVal + panUnits) * 100) / 100;
  }, [counts, rawInputs, getPanUnitsTotal]);

  // Calculate cost for a single item (supports recipe cost trickle-down)
  // key param allows split-count items to be identified by splitKey
  const getItemCost = useCallback((item: CountItem & { _splitKey?: string }) => {
    const key = (item as any)._splitKey || item.item_id;
    const totalUnits = getTotalQuantity(key, item.pack_quantity, item.pan_sizes);
    
    // Check if this is a recipe item with a calculated batch cost
    const batchCost = recipeCosts?.get(item.item_id);
    if (batchCost !== undefined && batchCost > 0) {
      return totalUnits * batchCost;
    }
    
    // Standard items: cost_per_unit is per case, pack_quantity is units per case
    // pack_quantity already incorporates pack_quantity_override (set at line 268)
    const costPerCase = item.cost_per_unit || 0;
    const packQty = item.pack_quantity || 1;
    const costPerUnit = costPerCase / Math.max(packQty, 1);
    return totalUnits * costPerUnit;
  }, [counts, rawInputs, getTotalQuantity, recipeCosts]);

  // Calculate total running cost
  const totalCost = useMemo(() => {
    if (!items) return 0;
    return items.reduce((sum, item) => sum + getItemCost(item), 0);
  }, [items, getItemCost]);

  // Count stats
  const totalItems = items?.length || 0;
  const countedItems = Object.values(counts).filter(c => c.cases > 0 || c.units > 0).length;

  // Save count mutation is now replaced by the resilient saveItemsBatch function below

  // Save edit with tracking mutation
  const saveEditMutation = useMutation({
    mutationFn: async ({ edits, reason }: { edits: PendingEdit[]; reason: string }) => {
      for (const edit of edits) {
        let countItemId = edit.countItemId;

        if (!countItemId) {
          // Item had no previous count entry — insert a new row
          const storLocId = edit.storageLocationId;
          const { data: inserted, error: insertErr } = await supabase
            .from("inventory_count_items")
            .insert({
              count_id: countId,
              item_id: edit.itemId!,
              quantity: edit.newQuantity,
              storage_location_id: (storLocId === 'uncategorized' || storLocId === 'recipes') ? null : storLocId,
            } as any)
            .select("id")
            .single();
          
          if (insertErr) throw insertErr;
          countItemId = (inserted as any).id;
        } else {
          // Update existing count item
          await supabase
            .from("inventory_count_items")
            .update({ quantity: edit.newQuantity })
            .eq("id", countItemId);
        }

        // Log the edit for audit trail
        await supabase
          .from("inventory_count_edits")
          .insert({
            count_item_id: countItemId,
            edited_by: user?.id,
            previous_quantity: edit.previousQuantity,
            new_quantity: edit.newQuantity,
            reason: reason || null
          });
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
      const extendedItem = item as CountItem & { _existingQuantity: number; _countItemId: string | null; _splitKey: string };
      const key = extendedItem._splitKey || item.item_id;
      const newQuantity = getTotalQuantity(key, item.pack_quantity, item.pan_sizes);
      const originalQuantity = originalCounts.current[key] ?? 0;
      
      if (newQuantity !== originalQuantity) {
        edits.push({
          countItemId: extendedItem._countItemId,
          itemName: item.item_name,
          previousQuantity: originalQuantity,
          newQuantity,
          // Carry forward item metadata for inserts
          itemId: item.item_id,
          storageLocationId: extendedItem.storage_location_id,
        } as PendingEdit);
      }
    }
    
    return edits;
  }, [isEditing, items, getTotalQuantity]);

  // Handle save for edit mode
  const handleSaveEdits = () => {
    const edits = calculatePendingEdits();
    if (edits.length === 0) {
      toast.info("No changes to save");
      onClose();
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
        const countState = counts[key] || { cases: 0, units: 0 };
        return {
          item_id: item.item_id,
          quantity: getTotalQuantity(key, item.pack_quantity, item.pan_sizes),
          storage_location_id: (storLocId === 'uncategorized' || storLocId === 'recipes') ? null : storLocId,
          entered_cases: countState.cases,
          entered_units: countState.units,
        };
      });
      return { itemCounts, snapshot: JSON.stringify(itemCounts) };
    };
  }, [items, counts, panCounts, getTotalQuantity]);

  // Resilient batch save: ONE bulk SELECT, then only UPDATE/INSERT changed items
  // Protected by mutex to prevent concurrent save operations (race condition)
  const saveItemsBatch = useCallback(async (itemCounts: any[]): Promise<{ saved: number; failed: number }> => {
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

    try {
      // ONE query to fetch all existing count items for this count
      const { data: allExisting, error: fetchErr } = await supabase
        .from("inventory_count_items")
        .select("id, item_id, storage_location_id, quantity, entered_cases, entered_units")
        .eq("count_id", countId) as any;
      
      if (fetchErr) throw fetchErr;

      // Build lookup map: "item_id|storage_location_id" -> existing record
      const existingMap = new Map<string, any>();
      for (const row of (allExisting || [])) {
        const key = `${row.item_id}|${row.storage_location_id || ''}`;
        existingMap.set(key, row);
      }

      // Separate into updates vs inserts, and skip unchanged items
      const toUpdate: { id: string; quantity: number; entered_cases: number; entered_units: number }[] = [];
      const toInsert: any[] = [];

      for (const ic of itemCounts) {
        const key = `${ic.item_id}|${ic.storage_location_id || ''}`;
        const existing = existingMap.get(key);
        
        // Build a fingerprint to skip unchanged items
        const fingerprint = `${ic.quantity}|${ic.entered_cases}|${ic.entered_units}`;
        const lastSaved = lastSavedQuantitiesRef.current.get(key);
        
        if (existing) {
          // CRITICAL GUARD: Never overwrite a non-zero DB value with zero
          // This prevents race conditions from blanking counted data
          if (ic.quantity === 0 && existing.quantity > 0) {
            console.warn(`[Inventory] BLOCKED zero-overwrite for item ${ic.item_id} (DB has ${existing.quantity})`);
            continue;
          }
          
          // Skip if quantity hasn't changed from DB AND from last save
          const dbFingerprint = `${existing.quantity}|${existing.entered_cases ?? 0}|${existing.entered_units ?? 0}`;
          if (fingerprint === dbFingerprint && fingerprint === lastSaved) continue;
          
          toUpdate.push({
            id: existing.id,
            quantity: ic.quantity,
            entered_cases: ic.entered_cases,
            entered_units: ic.entered_units,
          });
        } else {
          if (fingerprint === lastSaved) continue; // Already inserted on a previous cycle
          toInsert.push({
            count_id: countId,
            item_id: ic.item_id,
            quantity: ic.quantity,
            storage_location_id: ic.storage_location_id,
            entered_cases: ic.entered_cases,
            entered_units: ic.entered_units,
          });
        }
      }

      console.log(`[Inventory] Save batch: ${toUpdate.length} updates, ${toInsert.length} inserts (${itemCounts.length} total items, ${existingMap.size} existing)`);

      // Batch updates (individual PATCHes but NO extra SELECT per item)
      for (const upd of toUpdate) {
        try {
          const { error } = await supabase
            .from("inventory_count_items")
            .update({ quantity: upd.quantity, entered_cases: upd.entered_cases, entered_units: upd.entered_units } as any)
            .eq("id", upd.id);
          if (error) throw error;
          const key = itemCounts.find(ic => {
            const existing = existingMap.get(`${ic.item_id}|${ic.storage_location_id || ''}`);
            return existing?.id === upd.id;
          });
          if (key) {
            const k = `${key.item_id}|${key.storage_location_id || ''}`;
            lastSavedQuantitiesRef.current.set(k, `${upd.quantity}|${upd.entered_cases}|${upd.entered_units}`);
            failedItemsRef.current.delete(k);
          }
          saved++;
        } catch (e) {
          const key = itemCounts.find(ic => {
            const existing = existingMap.get(`${ic.item_id}|${ic.storage_location_id || ''}`);
            return existing?.id === upd.id;
          });
          if (key) {
            const k = `${key.item_id}|${key.storage_location_id || ''}`;
            failedItemsRef.current.set(k, key);
          }
          failed++;
          console.warn(`[Inventory] Failed to update item:`, e);
        }
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
            lastSavedQuantitiesRef.current.set(k, `${ins.quantity}|${ins.entered_cases}|${ins.entered_units}`);
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

    // Save elapsed duration (separate try/catch so item failures don't block this)
    try {
      await supabase
        .from("inventory_counts")
        .update({ duration_seconds: elapsedSecondsRef.current })
        .eq("id", countId);
    } catch (e) {
      console.warn("[Inventory] Failed to save duration:", e);
    }
    
    saveInProgressRef.current = false;
    return { saved, failed };
  }, [countId]);

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
  const flushSaveAsync = useCallback(async () => {
    if (isViewOnly || isEditing) return;
    const builder = buildSnapshotRef.current;
    if (!builder) return;
    const { itemCounts, snapshot } = builder();
    if (!snapshot || snapshot === lastAutosavedRef.current || itemCounts.length === 0) return;

    try {
      await saveItemsBatch(itemCounts);
      lastAutosavedRef.current = snapshot;
      console.log("[Inventory] Flush save completed (async)");
    } catch (e) {
      console.warn("[Inventory] Flush save failed:", e);
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
      // Fire async flush on unmount — also fire sync as safety net
      flushSaveAsyncRef.current();
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
      return {
        item_id: item.item_id,
        quantity: getTotalQuantity(key, item.pack_quantity, item.pan_sizes),
        storage_location_id: (storLocId === 'uncategorized' || storLocId === 'recipes') ? null : storLocId,
        entered_cases: casesVal,
        entered_units: unitsVal,
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
      // Also update raw input to stay in sync
      setRawInputs(p => ({
        ...p,
        [itemId]: { ...p[itemId], cases: String(newValue) }
      }));
      return {
        ...prev,
        [itemId]: {
          cases: newValue,
          units: prev[itemId]?.units || 0
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
      // Also update raw input to stay in sync
      setRawInputs(p => ({
        ...p,
        [itemId]: { ...p[itemId], units: String(newValue) }
      }));
      return {
        ...prev,
        [itemId]: {
          cases: prev[itemId]?.cases || 0,
          units: newValue
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
    
    setCounts(prev => ({
      ...prev,
      [itemId]: { cases: finalValue, units: prev[itemId]?.units || 0 }
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
    
    setCounts(prev => ({
      ...prev,
      [itemId]: { cases: prev[itemId]?.cases || 0, units: finalValue }
    }));
    
    setRawInputs(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], units: String(finalValue) }
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
        onSave: () => onClose(), // Triggers Save & Exit dialog in parent
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
    <div className={cn("space-y-3", isMobile && !isViewOnly ? "pb-32" : "pb-6")}>
      {/* Desktop: Stats bar at top */}
      {!isMobile && !isViewOnly && (
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border -mx-4 px-4 py-3 space-y-2">
          {/* Progress bar */}
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${totalItems > 0 ? (countedItems / totalItems) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Items:</span>
                <span className="font-semibold">{countedItems}<span className="text-muted-foreground font-normal">/{totalItems}</span></span>
              </div>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="font-semibold text-primary">{formatCurrency(totalCost)}</span>
              </div>
              <div className="h-6 w-px bg-border" />
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold font-mono">{Math.floor(elapsedSeconds / 60)} min</span>
              </div>
              {lastSavedAt && (
                <>
                  <div className="h-6 w-px bg-border" />
                  <div className="flex items-center gap-1">
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-muted-foreground">Saved</span>
                  </div>
                </>
              )}
              {isSupported && !isEditing && (
                <>
                  <div className="h-6 w-px bg-border" />
                  <Button
                    variant={isListening ? "destructive" : "outline"}
                    size="sm"
                    onClick={toggleListening}
                    className="gap-2"
                  >
                    {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {isListening ? "Stop Voice" : "Voice Input"}
                  </Button>
                </>
              )}
              {isEditing && (
                <>
                  <div className="h-6 w-px bg-border" />
                  <div className="flex items-center gap-2 text-amber-600 text-sm font-medium">
                    <History className="h-4 w-4" />
                    <span>Editing - changes tracked</span>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button 
                onClick={isEditing ? handleSaveEdits : () => onClose()} 
                disabled={isEditing ? saveEditMutation.isPending : isSaving}
                variant={isEditing ? "default" : "outline"}
                className={isEditing ? "bg-amber-600 hover:bg-amber-700" : ""}
              >
                {isEditing ? (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {saveEditMutation.isPending ? "Saving..." : "Save Changes"}
                  </>
                ) : (
                  <>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Save & Exit
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit mode indicator */}
      {isEditing && (
        <div className="flex items-center gap-2 text-amber-600 text-sm font-medium bg-amber-500/10 rounded-lg px-3 py-2">
          <History className="h-4 w-4" />
          <span>Editing completed count - changes will be tracked</span>
        </div>
      )}

      {/* Progress bar with percentage */}
      {!isViewOnly && (
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
            <div 
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${totalItems > 0 ? (countedItems / totalItems) * 100 : 0}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-muted-foreground whitespace-nowrap">
            {totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0}%
          </span>
        </div>
      )}

      {/* Pending voice processing indicator */}
      {pendingVoiceText && isListening && (
        <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 animate-pulse">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm text-muted-foreground italic">{pendingVoiceText}</span>
        </div>
      )}

      {/* Location navigation */}
      {locationKeys.length > 1 && (
        <div className="flex items-center justify-between bg-primary text-primary-foreground rounded-md px-2 py-3">
          <button
            className="h-10 w-10 flex items-center justify-center rounded-md text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
            onClick={() => setCurrentLocationIndex(Math.max(0, currentLocationIndex - 1))}
            disabled={currentLocationIndex === 0}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-center">
            <p className="font-semibold text-sm text-primary-foreground">{itemsByLocation[currentLocation]?.name}</p>
            <p className="text-xs text-primary-foreground/60">
              {currentLocationIndex + 1} of {locationKeys.length}
            </p>
          </div>
          <button
            className="h-10 w-10 flex items-center justify-center rounded-md text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
            onClick={() => setCurrentLocationIndex(Math.min(locationKeys.length - 1, currentLocationIndex + 1))}
            disabled={currentLocationIndex === locationKeys.length - 1}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Item list with dual counting */}
      <div className="space-y-3 -mx-1 sm:mx-0">
        {currentItems.map((item) => {
          const splitKey = (item as any)._splitKey || item.item_id;
          const count = counts[splitKey] || { cases: 0, units: 0 };
          const itemCost = getItemCost(item);
          const packQty = item.pack_quantity || 1;
          const isHighlighted = highlightedItemId === splitKey;
          const isErrorHighlighted = errorHighlightedItemId === splitKey;
          
          // Determine which counting inputs to show based on count_by override
          const countBy = item.count_by || 'inherit';
          const showCases = countBy === 'inherit' || countBy === 'cases_and_units' || countBy === 'cases_only';
          const showUnits = countBy === 'inherit' || countBy === 'cases_and_units' || countBy === 'units_only';
          
          return (
            <div 
              key={splitKey}
              className={cn(
                "bg-card rounded-md border border-border overflow-hidden flex relative transition-all duration-300",
                isHighlighted && "ring-2 ring-green-500 ring-offset-2 ring-offset-background scale-[1.02] shadow-lg shadow-green-500/20",
                isErrorHighlighted && "ring-2 ring-destructive ring-offset-2 ring-offset-background scale-[1.02] shadow-lg shadow-destructive/20 animate-pulse"
              )}
            >
              {/* Left accent bar (Vault) */}
              <div className="w-1 bg-primary flex-shrink-0" />

              {/* Value badge — pinned to top-right corner */}
              <div className="absolute top-0 right-0 bg-accent text-accent-foreground px-3 py-1.5 rounded-bl-lg">
                <p className="text-[15px] font-semibold tabular-nums leading-tight tracking-tight">{formatCurrency(itemCost)}</p>
                <p className="text-[9px] text-accent-foreground/70 text-center">
                  {getTotalQuantity(splitKey, item.pack_quantity, item.pan_sizes)} units
                </p>
              </div>

              <div className="flex-1 min-w-0">
                {/* Item header with badge chips */}
                <div className="px-3 py-3 border-b border-border pr-28">
                  <div className="flex items-start gap-3">
                    {item.image_url && (
                      <img 
                        src={item.image_url} 
                        alt={item.item_name}
                        className="w-12 h-12 rounded object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-foreground truncate tracking-tight">{item.item_name}</p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          {item.pack_size || item.unit || 'ea'}
                        </span>
                        {item.item_number && (
                          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            #{item.item_number}
                          </span>
                        )}
                        {(item.cost_per_unit || recipeCosts?.get(item.item_id)) && (
                          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {item.cost_per_unit 
                              ? `${formatCurrency(item.cost_per_unit)}/cs`
                              : `${formatCurrency(recipeCosts?.get(item.item_id) || 0)}/ea`
                            }
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Count controls */}
                <div className="p-3">
                  {item.is_recipe ? (
                    /* Single count stepper for recipe items */
                    <div className="max-w-xs mx-auto">
                      <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider text-center">
                        Count ({item.unit || 'ea'})
                      </p>
                      <div className="flex items-center rounded-lg overflow-hidden border border-foreground/20">
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center text-muted-foreground border-r border-inherit active:bg-muted transition-colors flex-shrink-0"
                            onClick={() => updateCases(splitKey, -1)}
                          >
                            <Minus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                        <input
                          type="text"
                          inputMode="decimal"
                          value={rawInputs[splitKey]?.cases ?? count.cases}
                          onChange={(e) => handleCasesInput(splitKey, e.target.value)}
                          onBlur={() => handleCasesBlur(splitKey)}
                          disabled={isViewOnly}
                          className="flex-1 text-center text-2xl font-bold text-foreground tabular-nums bg-transparent outline-none w-0"
                        />
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center text-muted-foreground border-l border-inherit active:bg-muted transition-colors flex-shrink-0"
                            onClick={() => updateCases(splitKey, 1)}
                          >
                            <Plus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {/* Cases counter — hidden if count_by=units_only */}
                    {showCases && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider">
                        Cases
                      </p>
                      <div className="flex items-center rounded-lg overflow-hidden border border-foreground/20">
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center text-muted-foreground border-r border-inherit active:bg-muted transition-colors flex-shrink-0"
                            onClick={() => updateCases(splitKey, -1)}
                          >
                            <Minus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                        <input
                          type="text"
                          inputMode="decimal"
                          value={rawInputs[splitKey]?.cases ?? count.cases}
                          onChange={(e) => handleCasesInput(splitKey, e.target.value)}
                          onBlur={() => handleCasesBlur(splitKey)}
                          disabled={isViewOnly}
                          className="flex-1 text-center text-2xl font-bold text-foreground tabular-nums bg-transparent outline-none w-0"
                        />
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center text-muted-foreground border-l border-inherit active:bg-muted transition-colors flex-shrink-0"
                            onClick={() => updateCases(splitKey, 1)}
                          >
                            <Plus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                    )}

                    {/* Units counter — hidden if count_by=cases_only */}
                    {showUnits && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider">
                        Units
                        {packQty > 1 && (
                          <span className="ml-1 normal-case tracking-normal">({packQty}/case)</span>
                        )}
                      </p>
                      <div className="flex items-center rounded-lg overflow-hidden border border-foreground/20">
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center text-muted-foreground border-r border-inherit active:bg-muted transition-colors flex-shrink-0"
                            onClick={() => updateUnits(splitKey, -1)}
                          >
                            <Minus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                        <input
                          type="text"
                          inputMode="decimal"
                          value={rawInputs[splitKey]?.units ?? count.units}
                          onChange={(e) => handleUnitsInput(splitKey, e.target.value)}
                          onBlur={() => handleUnitsBlur(splitKey)}
                          disabled={isViewOnly}
                          className="flex-1 text-center text-2xl font-bold text-foreground tabular-nums bg-transparent outline-none w-0"
                        />
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center text-muted-foreground border-l border-inherit active:bg-muted transition-colors flex-shrink-0"
                            onClick={() => updateUnits(splitKey, 1)}
                          >
                            <Plus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                    )}
                  </div>
                  )}

                  {/* Pan size rows */}
                  {item.pan_sizes?.enabled && item.pan_sizes.enabled_keys?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mb-1.5">
                        Pan / Cambro
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {item.pan_sizes.enabled_keys.map(panKey => {
                          const container = ALL_CONTAINERS.find(c => c.key === panKey);
                          if (!container) return null;
                          const unitsEach = getPanUnits(item.pan_sizes!, panKey);
                          const panQty = panCounts[splitKey]?.[panKey] || 0;
                          return (
                            <div key={panKey} className="text-center">
                              <p className="text-[9px] text-muted-foreground font-medium mb-1 truncate">
                                {container.label}
                                {unitsEach != null && ` (${unitsEach})`}
                              </p>
                              <div className="flex items-center bg-background rounded-md border border-foreground/15 overflow-hidden">
                                {!isViewOnly && (
                                  <button
                                    type="button"
                                    className="h-8 w-8 flex items-center justify-center text-muted-foreground active:bg-muted transition-colors flex-shrink-0"
                                    onClick={() => updatePanCount(splitKey, panKey, -0.5)}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </button>
                                )}
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={rawPanInputs[splitKey]?.[panKey] ?? panQty}
                                  onChange={(e) => handlePanInput(splitKey, panKey, e.target.value)}
                                  onBlur={() => handlePanBlur(splitKey, panKey)}
                                  disabled={isViewOnly}
                                  className="flex-1 text-center text-sm font-bold bg-transparent outline-none w-0"
                                />
                                {!isViewOnly && (
                                  <button
                                    type="button"
                                    className="h-8 w-8 flex items-center justify-center text-muted-foreground active:bg-muted transition-colors flex-shrink-0"
                                    onClick={() => updatePanCount(splitKey, panKey, 0.5)}
                                  >
                                    <Plus className="h-3 w-3" />
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
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation bar with back/forward and location name */}
      {locationKeys.length > 1 && (
        <div className="bg-primary text-primary-foreground rounded-md">
          <div className="flex items-center justify-between px-2 py-3">
            <button
              className="h-10 w-10 flex items-center justify-center rounded-md text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
              onClick={() => setCurrentLocationIndex(prev => Math.max(0, prev - 1))}
              disabled={currentLocationIndex === 0}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            
            <div className="text-center">
              <p className="font-semibold text-sm truncate text-primary-foreground">
                {itemsByLocation[currentLocation]?.name}
              </p>
              <p className="text-xs text-primary-foreground/60">
                {currentLocationIndex + 1} of {locationKeys.length}
              </p>
            </div>
            
            <button
              className="h-10 w-10 flex items-center justify-center rounded-md text-primary-foreground active:scale-95 transition-all disabled:opacity-40"
              onClick={() => setCurrentLocationIndex(prev => Math.min(locationKeys.length - 1, prev + 1))}
              disabled={currentLocationIndex === locationKeys.length - 1}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          
          {/* Quick navigation dots */}
          <div className="flex justify-center gap-2 pb-2">
            {locationKeys.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentLocationIndex(idx)}
                className={cn(
                  "w-2 h-2 rounded-full transition-colors",
                  idx === currentLocationIndex ? "bg-primary-foreground" : "bg-primary-foreground/30"
                )}
              />
            ))}
          </div>
        </div>
      )}
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
