import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, Minus, Plus, DollarSign, History, AlertTriangle, X, Save, Mic, MicOff, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useAudioVoiceInput } from "@/hooks/useAudioVoiceInput";
import { useInventoryVoiceFeedback } from "@/hooks/useInventoryVoiceFeedback";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
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
  saveRef?: React.MutableRefObject<{ save: () => void; isSaving: boolean } | null>;
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
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
    queryFn: async () => {
      // Get all items
      const { data: itemsData, error: itemsError } = await supabase
        .from("inventory_items")
        .select(`
          id,
          name,
          common_name,
          unit,
          par_level,
          cost_per_unit,
          pack_size,
          pack_quantity,
          pack_quantity_override,
          item_number,
          brand,
          image_url,
          pan_sizes,
          storage_location_id,
          is_recipe,
          countable,
          recipe_yield_unit,
          storage_location:inventory_locations(name)
        `)
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("display_order");
      
      if (itemsError) throw itemsError;

      // Fetch multi-location assignments from junction table
      const { data: itemLocations } = await supabase
        .from("inventory_item_locations")
        .select("item_id, storage_location_id");
      
      // Build map: item_id -> list of storage_location_ids
      const multiLocMap = new Map<string, string[]>();
      for (const il of itemLocations || []) {
        const existing = multiLocMap.get(il.item_id) || [];
        existing.push(il.storage_location_id);
        multiLocMap.set(il.item_id, existing);
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
        .select("id, item_id, quantity")
        .eq("count_id", countId) as any;
      
      if (countError) throw countError;

      // Map: "itemId|storLocId" -> { quantity, countItemId }
      const countMap = new Map(
        (countItems as any[])?.map((ci: any) => [
          `${ci.item_id}|${ci.storage_location_id || ''}`, 
          { quantity: ci.quantity, countItemId: ci.id }
        ]) || []
      );
      // Also keep a simple item_id map for backwards compat (old counts without storage_location_id)
      const simpleCountMap = new Map((countItems as any[])?.map((ci: any) => [ci.item_id, { quantity: ci.quantity, countItemId: ci.id }]) || []);

      const result: (CountItem & { _existingQuantity: number; _countItemId: string | null; _splitKey: string })[] = [];
      
      for (const item of itemsData || []) {
        // Exclude non-countable recipe items
        if ((item as any).is_recipe && (item as any).countable === false) continue;

        const isRecipe = (item as any).is_recipe === true;
        const multiLocs = multiLocMap.get(item.id);
        
        // Determine which storage locations this item should appear in
        const locIds: (string | null)[] = (multiLocs && multiLocs.length > 0)
          ? multiLocs
          : [item.storage_location_id || null];

        for (const locId of locIds) {
          const splitKey = `${item.id}|${locId || ''}`;
          const countData = countMap.get(splitKey) || (locIds.length === 1 ? simpleCountMap.get(item.id) : undefined);
          
          result.push({
            item_id: item.id,
            item_name: (item as any).common_name || item.name,
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
            item_number: item.item_number,
            brand: item.brand,
            image_url: item.image_url,
            pan_sizes: (item as any).pan_sizes ?? null,
            is_recipe: isRecipe,
            _existingQuantity: countData?.quantity ?? 0,
            _countItemId: countData?.countItemId || null,
            _splitKey: splitKey,
          });
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

  // Initialize counts from items (convert flat quantity to cases + units)
  // Uses _splitKey as the state key to support split-count items
  useEffect(() => {
    if (items) {
      const initialCounts: Record<string, ItemCount> = {};
      const originals: Record<string, number> = {};
      
      items.forEach(item => {
        const key = (item as any)._splitKey || item.item_id;
        const totalUnits = (item as any)._existingQuantity || 0;
        const packQty = item.pack_quantity || 1;
        initialCounts[key] = {
          cases: Math.floor(totalUnits / packQty),
          units: totalUnits % packQty
        };
        // Store original quantities for edit tracking
        if (isEditing) {
          originals[key] = totalUnits;
        }
      });
      
      setCounts(initialCounts);
      if (isEditing) {
        originalCounts.current = originals;
      }
    }
  }, [items, isEditing]);

  // Initialize timer from existing duration (for resumed counts)
  useEffect(() => {
    if (countRecord?.duration_seconds != null) {
      setElapsedSeconds(countRecord.duration_seconds);
    }
  }, [countRecord]);

  // Group items by storage location
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

  const locationKeys = Object.keys(itemsByLocation);
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
    
    // Standard items: cost_per_unit is per case
    const costPerCase = item.cost_per_unit || 0;
    const packQty = item.pack_quantity || 1;
    const costPerUnit = costPerCase / packQty;
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

  // Save count mutation (saves progress without completing)
  // Now supports split-count items with storage_location_id
  const saveCountMutation = useMutation({
    mutationFn: async (itemCounts: { item_id: string; quantity: number; storage_location_id: string | null }[]) => {
      // Use individual upserts since the unique constraint now uses COALESCE
      for (const ic of itemCounts) {
        const storLocId = ic.storage_location_id;
        // Check if a row exists for this combo
          const { data: existing } = await supabase
            .from("inventory_count_items")
            .select("id, storage_location_id")
            .eq("count_id", countId)
            .eq("item_id", ic.item_id)
            .then(res => {
              // Filter by storage_location_id manually since types may not be updated
              const filtered = (res.data || []).filter((r: any) => 
                (r as any).storage_location_id === storLocId || 
                (!storLocId && !(r as any).storage_location_id)
              );
              return { ...res, data: filtered };
            }) as any;
        
        if (existing && existing.length > 0) {
          await supabase
            .from("inventory_count_items")
            .update({ quantity: ic.quantity } as any)
            .eq("id", existing[0].id);
        } else {
          await supabase
            .from("inventory_count_items")
            .insert({
              count_id: countId,
              item_id: ic.item_id,
              quantity: ic.quantity,
              storage_location_id: storLocId,
            } as any);
        }
      }
    }
  });

  // Save edit with tracking mutation
  const saveEditMutation = useMutation({
    mutationFn: async ({ edits, reason }: { edits: PendingEdit[]; reason: string }) => {
      // First update the count items
      for (const edit of edits) {
        // Update the count item
        await supabase
          .from("inventory_count_items")
          .update({ quantity: edit.newQuantity })
          .eq("id", edit.countItemId);
        
        // Log the edit
        await supabase
          .from("inventory_count_edits")
          .insert({
            count_item_id: edit.countItemId,
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
      // Navigate to view mode (remove edit param)
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

  // Silent autosave - saves progress in background without UI feedback
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutosavedRef = useRef<string>("");

  useEffect(() => {
    if (!items || Object.keys(counts).length === 0 || isViewOnly || isEditing) return;

    // Debounce: save 3 seconds after last change
    if (autosaveRef.current) clearTimeout(autosaveRef.current);

    autosaveRef.current = setTimeout(async () => {
      const itemCounts = items.map(item => {
        const key = (item as any)._splitKey || item.item_id;
        const storLocId = item.storage_location_id;
        return {
          item_id: item.item_id,
          quantity: getTotalQuantity(key, item.pack_quantity, item.pan_sizes),
          storage_location_id: (storLocId === 'uncategorized' || storLocId === 'recipes') ? null : storLocId,
        };
      });

      // Skip if nothing changed since last autosave
      const snapshot = JSON.stringify(itemCounts);
      if (snapshot === lastAutosavedRef.current) return;

      try {
        // Save each split-count entry individually
        for (const ic of itemCounts) {
          const { data: existing } = await supabase
            .from("inventory_count_items")
            .select("id, storage_location_id")
            .eq("count_id", countId)
            .eq("item_id", ic.item_id) as any;
          
          const storLocId = ic.storage_location_id;
          const match = (existing || []).find((r: any) => 
            (r as any).storage_location_id === storLocId || 
            (!storLocId && !(r as any).storage_location_id)
          );
          
          if (match) {
            await supabase
              .from("inventory_count_items")
              .update({ quantity: ic.quantity } as any)
              .eq("id", match.id);
          } else {
            await supabase
              .from("inventory_count_items")
              .insert({
                count_id: countId,
                item_id: ic.item_id,
                quantity: ic.quantity,
                storage_location_id: storLocId,
              } as any);
          }
        }

        // Save elapsed duration too
        await supabase
          .from("inventory_counts")
          .update({ duration_seconds: elapsedSeconds })
          .eq("id", countId);

        lastAutosavedRef.current = snapshot;
        console.log("[Inventory] Autosaved");
      } catch (e) {
        console.warn("[Inventory] Autosave failed:", e);
      }
    }, 3000);

    return () => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
    };
  }, [counts, panCounts, items, isViewOnly, isEditing, countId, elapsedSeconds, getTotalQuantity]);

  // Save current progress (manual save — used by Save & Exit)
  const handleSave = async () => {
    if (!items || Object.keys(counts).length === 0) return;
    
    setIsSaving(true);
    const itemCounts = items.map(item => {
      const key = (item as any)._splitKey || item.item_id;
      const storLocId = item.storage_location_id;
      return {
        item_id: item.item_id,
        quantity: getTotalQuantity(key, item.pack_quantity, item.pan_sizes),
        storage_location_id: (storLocId === 'uncategorized' || storLocId === 'recipes') ? null : storLocId,
      };
    });
    
    try {
      await saveCountMutation.mutateAsync(itemCounts);
      
      // Save elapsed duration
      await supabase
        .from("inventory_counts")
        .update({ duration_seconds: elapsedSeconds })
        .eq("id", countId);
      
      toast.success("Progress saved");
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
      onClose();
    } catch (error) {
      console.error("Save failed:", error);
      toast.error("Failed to save");
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
        save: () => isEditing ? handleSaveEditsRef.current() : handleSaveRef.current(),
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
        setElapsedSeconds(prev => prev + 1);
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
        onSave: () => {}, // Save moved to page header
        onToggleVoice: () => toggleListeningRef.current(),
      });
    } else {
      setDockContent(null);
    }
    
    // Clear dock content on unmount
    return () => {
      setDockContent(null);
    };
  }, [isMobile, isViewOnly, totalCost, countedItems, totalItems, isSaving, isListening, isSupported, isEditing, elapsedSeconds, setDockContent]);

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
              <Button variant="outline" onClick={onClose}>
                <X className="h-4 w-4 mr-2" />
                {isEditing ? "Cancel" : "Back"}
              </Button>
              <Button 
                onClick={isEditing ? handleSaveEdits : handleSave} 
                disabled={isEditing ? saveEditMutation.isPending : isSaving}
                className={isEditing ? "bg-amber-600 hover:bg-amber-700" : ""}
              >
                <Save className="h-4 w-4 mr-2" />
                {isEditing 
                  ? (saveEditMutation.isPending ? "Saving..." : "Save Changes")
                  : (isSaving ? "Saving..." : "Save")
                }
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
        <div className="flex items-center justify-between bg-primary text-primary-foreground rounded-lg p-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground hover:bg-primary-foreground/20"
            onClick={() => setCurrentLocationIndex(Math.max(0, currentLocationIndex - 1))}
            disabled={currentLocationIndex === 0}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="text-center">
            <p className="font-medium text-primary-foreground">{itemsByLocation[currentLocation]?.name}</p>
            <p className="text-xs text-primary-foreground/70">
              {currentLocationIndex + 1} of {locationKeys.length}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground hover:bg-primary-foreground/20"
            onClick={() => setCurrentLocationIndex(Math.min(locationKeys.length - 1, currentLocationIndex + 1))}
            disabled={currentLocationIndex === locationKeys.length - 1}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      )}

      {/* Item list with dual counting */}
      <div className="space-y-3 -mx-1 sm:mx-0">
        {currentItems.map((item) => {
          const splitKey = (item as any)._splitKey || item.item_id;
          const count = counts[splitKey] || { cases: 0, units: 0 };
          const itemCost = getItemCost(item);
          const packQty = item.pack_quantity || 1;
          const costPerUnit = (item.cost_per_unit || 0) / packQty;
          const isHighlighted = highlightedItemId === splitKey;
          const isErrorHighlighted = errorHighlightedItemId === splitKey;
          
          return (
            <Card 
              key={splitKey}
              className={cn(
                "overflow-hidden transition-all duration-300",
                isHighlighted && "ring-2 ring-green-500 ring-offset-2 ring-offset-background scale-[1.02] shadow-lg shadow-green-500/20",
                isErrorHighlighted && "ring-2 ring-destructive ring-offset-2 ring-offset-background scale-[1.02] shadow-lg shadow-destructive/20 animate-pulse"
              )}
            >
              <CardContent className="p-0">
                {/* Item header with details */}
                <div className="p-3 border-b border-border bg-primary text-primary-foreground">
                  <div className="flex items-start gap-3">
                    {item.image_url && (
                      <img 
                        src={item.image_url} 
                        alt={item.item_name}
                        className="w-12 h-12 rounded object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.item_name}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-primary-foreground/70 mt-1">
                          {item.item_number && <span>#{item.item_number}</span>}
                          <span>{item.pack_size || item.unit || 'ea'}</span>
                          {(item.cost_per_unit || recipeCosts?.get(item.item_id)) && (
                            <span className="text-primary-foreground font-medium">
                              {item.cost_per_unit 
                                ? `${formatCurrency(item.cost_per_unit)}/case`
                                : `${formatCurrency(recipeCosts?.get(item.item_id) || 0)}/ea`
                              }
                            </span>
                          )}
                      </div>
                    </div>
                    {/* Item value */}
                    <div className="text-right flex-shrink-0">
                        <p className="text-2xl font-bold text-primary-foreground">{formatCurrency(itemCost)}</p>
                        <p className="text-xs text-primary-foreground/70">
                          {getTotalQuantity(splitKey, item.pack_quantity, item.pan_sizes)} units
                        </p>
                    </div>
                  </div>
                </div>
                
                {/* Count controls */}
                <div className="p-4">
                  {item.is_recipe ? (
                    /* Single count stepper for recipe items */
                    <div className="max-w-xs mx-auto">
                      <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium text-center">
                        Count ({item.unit || 'ea'})
                      </p>
                      <div className="flex items-center bg-muted/60 rounded-full overflow-hidden border border-border/50">
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95 transition-all rounded-full flex-shrink-0"
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
                          className="flex-1 text-center text-xl font-bold text-foreground tabular-nums bg-transparent border-none outline-none w-0"
                        />
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all rounded-full flex-shrink-0"
                            onClick={() => updateCases(splitKey, 1)}
                          >
                            <Plus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                  <div className="flex items-center gap-3">
                    {/* Cases pill stepper */}
                    <div className="flex-1">
                      <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">
                        Cases
                      </p>
                      <div className="flex items-center bg-muted/60 rounded-full overflow-hidden border border-border/50">
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95 transition-all rounded-full flex-shrink-0"
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
                          className="flex-1 text-center text-xl font-bold text-foreground tabular-nums bg-transparent border-none outline-none w-0"
                        />
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all rounded-full flex-shrink-0"
                            onClick={() => updateCases(splitKey, 1)}
                          >
                            <Plus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Units pill stepper */}
                    <div className="flex-1">
                      <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">
                        Units
                        {packQty > 1 && (
                          <span className="ml-1 normal-case tracking-normal">({packQty}/case)</span>
                        )}
                      </p>
                      <div className="flex items-center bg-muted/60 rounded-full overflow-hidden border border-border/50">
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95 transition-all rounded-full flex-shrink-0"
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
                          className="flex-1 text-center text-xl font-bold text-foreground tabular-nums bg-transparent border-none outline-none w-0"
                        />
                        {!isViewOnly && (
                          <button
                            type="button"
                            className="h-11 w-11 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all rounded-full flex-shrink-0"
                            onClick={() => updateUnits(splitKey, 1)}
                          >
                            <Plus className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Pan size rows */}
                  {item.pan_sizes?.enabled && item.pan_sizes.enabled_keys?.length > 0 && (
                    <div className="-mx-4 px-4 pt-3 pb-4 border-t border-border/40 space-y-2 mt-3">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
                        Pan / Cambro Sizes
                      </p>
                      <div className="grid grid-cols-2 gap-3 items-end">
                        {item.pan_sizes.enabled_keys.map(panKey => {
                          const container = ALL_CONTAINERS.find(c => c.key === panKey);
                          if (!container) return null;
                          const unitsEach = getPanUnits(item.pan_sizes!, panKey);
                          const panQty = panCounts[splitKey]?.[panKey] || 0;
                          return (
                            <div key={panKey} className="flex-1">
                              <p className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider font-medium truncate">
                                {container.label}
                                {unitsEach != null && (
                                  <span className="normal-case tracking-normal ml-1">({unitsEach}/ea)</span>
                                )}
                              </p>
                              <div className="flex items-center bg-muted/60 rounded-full overflow-hidden border border-border/50">
                                {!isViewOnly && (
                                  <button
                                    type="button"
                                    className="h-11 w-11 flex items-center justify-center bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95 transition-all rounded-full flex-shrink-0"
                                    onClick={() => updatePanCount(splitKey, panKey, -0.5)}
                                  >
                                    <Minus className="h-4 w-4" strokeWidth={2} />
                                  </button>
                                )}
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={rawPanInputs[splitKey]?.[panKey] ?? panQty}
                                  onChange={(e) => handlePanInput(splitKey, panKey, e.target.value)}
                                  onBlur={() => handlePanBlur(splitKey, panKey)}
                                  disabled={isViewOnly}
                                  className="flex-1 text-center text-xl font-bold text-foreground tabular-nums bg-transparent border-none outline-none w-0"
                                />
                                {!isViewOnly && (
                                  <button
                                    type="button"
                                    className="h-11 w-11 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all rounded-full flex-shrink-0"
                                    onClick={() => updatePanCount(splitKey, panKey, 0.5)}
                                  >
                                    <Plus className="h-4 w-4" strokeWidth={2} />
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
                </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Navigation bar with back/forward and location name */}
      {locationKeys.length > 1 && (
        <div className="border-t border-primary/30 bg-primary text-primary-foreground rounded-lg">
          <div className="flex items-center justify-between px-2 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentLocationIndex(prev => Math.max(0, prev - 1))}
              disabled={currentLocationIndex === 0}
              className="h-10 px-3 text-primary-foreground hover:bg-primary-foreground/20"
            >
              <ChevronLeft className="h-5 w-5 mr-1" />
              Back
            </Button>
            
            <div className="flex-1 text-center px-2">
              <p className="font-semibold text-sm truncate text-primary-foreground">
                {itemsByLocation[currentLocation]?.name}
              </p>
              <p className="text-xs text-primary-foreground/70">
                {currentLocationIndex + 1} of {locationKeys.length}
              </p>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentLocationIndex(prev => Math.min(locationKeys.length - 1, prev + 1))}
              disabled={currentLocationIndex === locationKeys.length - 1}
              className="h-10 px-3 text-primary-foreground hover:bg-primary-foreground/20"
            >
              Next
              <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
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
