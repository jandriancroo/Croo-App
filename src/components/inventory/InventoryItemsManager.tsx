import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MapPin, Package, Loader2, EyeOff, AlertTriangle, ArrowRightLeft, ChevronDown, Settings2, MoveRight, X, RefreshCw, Link2, Tag, ListOrdered, CheckSquare, Search, Power, PowerOff } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import pfgLogo from "@/assets/pfg-logo.png";
import paLogo from "@/assets/pa-logo.png";

import { useAuth } from "@/lib/auth";
import { useInventoryPermissions } from "@/hooks/useInventoryPermissions";
import { toast } from "sonner";
import InventoryScheduleSettings from "./InventoryScheduleSettings";

import RemapItemDialog from "./RemapItemDialog";
import PanSizesSection from "./PanSizesSection";
import type { PanSizesConfig } from "./PanSizesSection";

import BulkPanSizeDialog from "./BulkPanSizeDialog";
import ShortcutConfigSheet from "./ShortcutConfigSheet";
import StorageLocationManager from "./StorageLocationManager";
import { fetchRecipeCosts } from "@/utils/recipeCostCalculation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableInventoryItem, ItemDragOverlay, BulkReorderGroup } from "./SortableInventoryItem";

interface InventoryItemsManagerProps {
  locationId: string;
  mode?: "items" | "setup" | "build";
}

interface EditingItem {
  id: string;
  name: string;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  category: string | null;
  storage_location_id: string | null;
  cost_per_unit: number | null;
  unit: string | null;
  pack_size: string | null;
  brand_item_id: string | null;
}

const INVENTORY_CATEGORIES = [
  "Dough", "Sauce", "Cheese", "Meat", "Veggie", "Condiments", "Desserts", "Dry Goods", "Beverages", "Paper Goods", "Cleaning", "Other"
];

interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}


const InventoryItemsManager = ({ locationId, mode = "setup" }: InventoryItemsManagerProps) => {
  const isBuildMode = mode === "build";
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { canEditCategories, canTriggerSync } = useInventoryPermissions();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPaSyncing, setIsPaSyncing] = useState(false);
  const [isDailyTracked, setIsDailyTracked] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [paProgress, setPaProgress] = useState<SyncProgress | null>(null);
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);
  const [editRecipeId, setEditRecipeId] = useState<string | null>(null);
  const [categoryValue, setCategoryValue] = useState<string>("");
  const [storageLocationValue, setStorageLocationValue] = useState<string>("");
  const [storageLocationIds, setStorageLocationIds] = useState<Set<string>>(new Set());
  const [remapItem, setRemapItem] = useState<any>(null);
  const [panSizesConfig, setPanSizesConfig] = useState<PanSizesConfig | null>(null);
  
  const [linkTargetItemId, setLinkTargetItemId] = useState<string>("");


  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [activeSelectGroup, setActiveSelectGroup] = useState<string | null>(null);
  const [showBulkPanDialog, setShowBulkPanDialog] = useState(false);
  const [showBulkCategoryDialog, setShowBulkCategoryDialog] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState<string>("");
  const [showStorageManager, setShowStorageManager] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [showBulkMoveDialog, setShowBulkMoveDialog] = useState(false);
  const [bulkMoveTargets, setBulkMoveTargets] = useState<Set<string>>(new Set());
  const [showShortcutDialog, setShowShortcutDialog] = useState(false);
  const [shortcutTarget, setShortcutTarget] = useState<string | null>(null);
  const [shortcutCountBy, setShortcutCountBy] = useState<string>('inherit');
  const [activeDragItemId, setActiveDragItemId] = useState<string | null>(null);
  const [shortcutConfigItem, setShortcutConfigItem] = useState<{ itemId: string; itemName: string; storageLocationId: string; storageLocationName: string } | null>(null);
  const [isBulkDragMode, setIsBulkDragMode] = useState(false);
  const [bulkDragGroupKey, setBulkDragGroupKey] = useState<string | null>(null);
  const [bulkDragItemIds, setBulkDragItemIds] = useState<string[]>([]);
  
  const [recipePurgeMode, setRecipePurgeMode] = useState(false);
  const [recipePurgeSelection, setRecipePurgeSelection] = useState<Set<string>>(new Set());
  const [isPurging, setIsPurging] = useState(false);
  const [reorderModeGroup, setReorderModeGroup] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionContext, setSelectionContext] = useState<'active' | 'deactivated' | null>(null);
  const [deactivatedCollapsed, setDeactivatedCollapsed] = useState(false);

  // Optimistic reorder state: maps storageLocId -> ordered item id list
  const [optimisticOrder, setOptimisticOrder] = useState<Record<string, string[]>>({});
  const reorderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReorderRef = useRef<{ primaryUpdates: { id: string; displayOrder: number }[]; shortcuts?: { itemId: string; storageLocationId: string; displayOrder: number }[] } | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const reorderItemsMutation = useMutation({
    mutationFn: async ({ primaryUpdates: pUpdates, shortcuts }: { primaryUpdates: { id: string; displayOrder: number }[]; shortcuts?: { itemId: string; storageLocationId: string; displayOrder: number }[] }) => {
      console.log("[reorder] mutationFn called with", pUpdates.length, "primary items,", shortcuts?.length || 0, "shortcuts");
      const primaryOps = pUpdates.map(p =>
        supabase.from("inventory_items").update({ display_order: p.displayOrder } as any).eq("id", p.id)
      );
      const shortcutOps = (shortcuts || []).map(s =>
        supabase.from("inventory_item_locations")
          .update({ display_order: s.displayOrder } as any)
          .eq("item_id", s.itemId)
          .eq("storage_location_id", s.storageLocationId)
      );
      const results = await Promise.all([...primaryOps, ...shortcutOps]);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        console.error("[reorder] DB errors:", errors.map(e => e.error));
      } else {
        console.log("[reorder] All", results.length, "updates succeeded");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-item-locations", locationId] });
    },
    onError: (err) => {
      console.error("[reorder] onError:", err);
      toast.error("Failed to reorder items");
    },
  });

  // Flush any pending reorder to DB immediately
  const flushReorder = useCallback(() => {
    if (reorderSaveTimerRef.current) {
      clearTimeout(reorderSaveTimerRef.current);
      reorderSaveTimerRef.current = null;
    }
    if (pendingReorderRef.current) {
      reorderItemsMutation.mutate(pendingReorderRef.current);
      pendingReorderRef.current = null;
    }
  }, [reorderItemsMutation]);

  // Schedule a debounced save (600ms)
  const scheduleReorderSave = useCallback((payload: { primaryUpdates: { id: string; displayOrder: number }[]; shortcuts?: { itemId: string; storageLocationId: string; displayOrder: number }[] }) => {
    pendingReorderRef.current = payload;
    if (reorderSaveTimerRef.current) clearTimeout(reorderSaveTimerRef.current);
    reorderSaveTimerRef.current = setTimeout(() => {
      if (pendingReorderRef.current) {
        reorderItemsMutation.mutate(pendingReorderRef.current);
        pendingReorderRef.current = null;
      }
      reorderSaveTimerRef.current = null;
    }, 600);
  }, [reorderItemsMutation]);

  // Build reorder payload from an ordered list
  const buildReorderPayload = useCallback((reordered: any[], shortcutIdSet?: Set<string>, storageLocId?: string) => {
    const primaryEntries: { id: string; displayOrder: number }[] = [];
    const shortcutEntries: { itemId: string; storageLocationId: string; displayOrder: number }[] = [];
    reordered.forEach((item, globalIdx) => {
      if (shortcutIdSet?.has(item.id)) {
        if (storageLocId) shortcutEntries.push({ itemId: item.id, storageLocationId: storageLocId, displayOrder: globalIdx });
      } else {
        primaryEntries.push({ id: item.id, displayOrder: globalIdx });
      }
    });
    return { primaryUpdates: primaryEntries, shortcuts: shortcutEntries };
  }, []);

  const handleItemDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id).replace('-shortcut', '');
    setActiveDragItemId(id);
  }, []);

  const handleItemDragEnd = useCallback((event: DragEndEvent, groupItems: any[], isShortcutList?: Set<string>, storageLocId?: string) => {
    setActiveDragItemId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const getSortableId = (item: any) => {
      const isShortcut = isShortcutList?.has(item.id);
      return item.id + (isShortcut ? '-shortcut' : '');
    };
    const oldIndex = groupItems.findIndex(i => getSortableId(i) === active.id);
    const newIndex = groupItems.findIndex(i => getSortableId(i) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(groupItems, oldIndex, newIndex);
    reorderItemsMutation.mutate(buildReorderPayload(reordered, isShortcutList, storageLocId));
  }, [reorderItemsMutation, buildReorderPayload]);

  const handleArrowMove = useCallback((direction: 'up' | 'down', groupItems: any[], itemId: string, shortcutIdSet?: Set<string>, storageLocId?: string) => {
    const idx = groupItems.findIndex(i => i.id === itemId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= groupItems.length) return;
    const reordered = arrayMove(groupItems, idx, targetIdx);
    // Optimistic: update local order immediately
    if (storageLocId) {
      setOptimisticOrder(prev => ({ ...prev, [storageLocId]: reordered.map(i => i.id) }));
    }
    scheduleReorderSave(buildReorderPayload(reordered, shortcutIdSet, storageLocId));
  }, [scheduleReorderSave, buildReorderPayload]);

  const handleBulkArrowMove = useCallback((direction: 'up' | 'down', groupItems: any[], shortcutIdSet?: Set<string>, storageLocId?: string) => {
    if (bulkDragItemIds.length === 0) return;
    const bulkSet = new Set(bulkDragItemIds);
    const nonGroupItems = groupItems.filter(i => !bulkSet.has(i.id));
    const draggedItems = groupItems.filter(i => bulkSet.has(i.id));
    
    let groupStartIdx = groupItems.findIndex(i => bulkSet.has(i.id));
    let insertIdx = nonGroupItems.findIndex(i => {
      const origIdx = groupItems.indexOf(i);
      return origIdx > groupStartIdx;
    });
    if (insertIdx === -1) insertIdx = nonGroupItems.length;
    
    if (direction === 'up') {
      if (insertIdx <= 0 && groupStartIdx === 0) return;
      insertIdx = Math.max(0, insertIdx - 1);
    } else {
      if (insertIdx >= nonGroupItems.length) return;
      insertIdx = insertIdx + 1;
    }
    
    const reordered = [...nonGroupItems.slice(0, insertIdx), ...draggedItems, ...nonGroupItems.slice(insertIdx)];
    if (storageLocId) {
      setOptimisticOrder(prev => ({ ...prev, [storageLocId]: reordered.map(i => i.id) }));
    }
    scheduleReorderSave(buildReorderPayload(reordered, shortcutIdSet, storageLocId));
  }, [bulkDragItemIds, scheduleReorderSave, buildReorderPayload]);


  // Check if PFG is configured
  const { data: pfgIntegration } = useQuery({
    queryKey: ["pfg-integration", locationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("location_integrations")
        .select("*")
        .eq("location_id", locationId)
        .eq("integration_type", "pfg")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    }
  });

  // Check if Produce Alliance is configured
  const { data: paIntegration } = useQuery({
    queryKey: ["pa-integration", locationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("location_integrations")
        .select("*")
        .eq("location_id", locationId)
        .eq("integration_type", "produce_alliance")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    }
  });

  // Fetch last sync times for PFG and PA
  const { data: lastPfgSync } = useQuery({
    queryKey: ["last-pfg-sync", locationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_sync_logs")
        .select("completed_at")
        .eq("location_id", locationId)
        .eq("sync_source", "pfg")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!pfgIntegration
  });

  const { data: lastPaSync } = useQuery({
    queryKey: ["last-pa-sync", locationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_sync_logs")
        .select("completed_at")
        .eq("location_id", locationId)
        .eq("sync_source", "produce_alliance")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!paIntegration
  });

  const formatSyncTime = (isoDate: string | null | undefined) => {
    if (!isoDate) return null;
    const d = new Date(isoDate);
    return d.toLocaleString('en-US', { 
      timeZone: 'America/Los_Angeles',
      month: 'short', day: 'numeric', 
      hour: 'numeric', minute: '2-digit',
      hour12: true
    });
  };

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

  // Fetch active items
  const { data: items } = useQuery({
    queryKey: ["inventory-items", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(`
          *,
          storage_location:inventory_locations(name)
        `)
        .eq("location_id", locationId)
        .eq("is_active", true)
        .eq("user_hidden", false)
        .order("display_order");
      
      if (error) throw error;
      return data;
    }
  });


  // Fetch deactivated brand items for this location
  const { data: deactivatedBrandItems } = useQuery({
    queryKey: ['deactivated-brand-items', locationId],
    queryFn: async () => {
      // Step 1: Get all deactivated items with a brand link
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name, category, brand_item_id, storage_location_id')
        .eq('location_id', locationId)
        .eq('is_active', false)
        .not('brand_item_id', 'is', null)
        .order('name');
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Step 2: Find which of those brand templates are archived — exclude them
      const brandItemIds = data.map((d: any) => d.brand_item_id!);
      const { data: archivedTemplates } = await supabase
        .from('brand_inventory_templates')
        .select('id')
        .in('id', brandItemIds)
        .eq('status', 'archived');

      const archivedIds = new Set((archivedTemplates || []).map((t: any) => t.id));

      // Step 3: Filter out archived — return everything else
      return data.filter((item: any) => !archivedIds.has(item.brand_item_id));
    },
    enabled: !!locationId
  });


  const { data: itemLocationShortcuts } = useQuery({
    queryKey: ["inventory-item-locations", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_item_locations")
        .select("item_id, storage_location_id, display_order")
        .in("item_id", (items || []).map(i => i.id));
      if (error) throw error;
      return data || [];
    },
    enabled: !!items && items.length > 0,
  });

  // Fetch recipe costs for items without stored cost_per_unit
  const { data: recipeCosts } = useQuery({
    queryKey: ["recipe-costs", locationId],
    queryFn: () => fetchRecipeCosts(locationId),
    staleTime: 5 * 60 * 1000,
  });


  const hideItemMutation = useMutation({
    mutationFn: async ({ itemId, linkedItemId }: { itemId: string; linkedItemId?: string }) => {
      const updateData: any = { user_hidden: true, is_active: false };
      if (linkedItemId) {
        updateData.linked_item_id = linkedItemId;
      }
      const { error } = await supabase
        .from("inventory_items")
        .update(updateData)
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: (_, { linkedItemId }) => {
      toast.success(linkedItemId 
        ? "Item hidden & linked — prices will be blended on next sync" 
        : "Item hidden — it won't come back on sync"
      );
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items-hidden", locationId] });
      setEditingItem(null);
      setLinkTargetItemId("");
    },
    onError: () => {
      toast.error("Failed to hide item");
    }
  });


  // Update pack quantity override mutation
  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, override, category, storage_location_id, pan_sizes, is_daily_tracked }: { itemId: string; override: number | null; category: string | null; storage_location_id: string | null; pan_sizes: PanSizesConfig | null; is_daily_tracked?: boolean }) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({ pack_quantity_override: override, category, storage_location_id, pan_sizes: pan_sizes as any, is_daily_tracked: is_daily_tracked ?? false } as any)
        .eq("id", itemId);
      
      if (error) throw error;

      // Auto-create "Daily Spot Check" storage location + shortcut when enabling daily tracking
      if (is_daily_tracked) {
        // Check if "Daily Spot Check" storage location exists
        const { data: existing } = await supabase
          .from("inventory_locations")
          .select("id")
          .eq("location_id", locationId)
          .eq("name", "Daily Spot Check")
          .maybeSingle();

        let spotCheckLocId = existing?.id;

        if (!spotCheckLocId) {
          // Get max display_order to put it at the end
          const { data: maxOrder } = await supabase
            .from("inventory_locations")
            .select("display_order")
            .eq("location_id", locationId)
            .order("display_order", { ascending: false })
            .limit(1)
            .maybeSingle();

          const nextOrder = ((maxOrder?.display_order as number) || 0) + 1;

          const { data: newLoc, error: locErr } = await supabase
            .from("inventory_locations")
            .insert({ location_id: locationId, name: "Daily Spot Check", display_order: nextOrder } as any)
            .select("id")
            .single();

          if (locErr) {
            console.error("Failed to create Daily Spot Check location:", locErr);
          } else {
            spotCheckLocId = newLoc.id;
          }
        }

        // Create shortcut entry if the item's primary location is different
        if (spotCheckLocId) {
          const { data: itemData } = await supabase
            .from("inventory_items")
            .select("storage_location_id")
            .eq("id", itemId)
            .single();

          if (itemData?.storage_location_id !== spotCheckLocId) {
            await supabase
              .from("inventory_item_locations")
              .upsert(
                { item_id: itemId, storage_location_id: spotCheckLocId } as any,
                { onConflict: "item_id,storage_location_id" }
              );
          }
        }
      }
    },
    onSuccess: () => {
      toast.success("Item updated");
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-item-shortcuts", locationId] });
      setEditingItem(null);
    },
    onError: () => {
      toast.error("Failed to save");
    }
  });

  const openEditDialog = async (item: any) => {
    setLinkTargetItemId("");
    setEditingItem({
      id: item.id,
      name: item.name,
      pack_quantity: item.pack_quantity,
      pack_quantity_override: item.pack_quantity_override,
      category: item.category,
      storage_location_id: item.storage_location_id || null,
      cost_per_unit: item.cost_per_unit ? Number(item.cost_per_unit) : null,
      unit: item.unit || null,
      pack_size: item.pack_size || null,
      brand_item_id: item.brand_item_id || null,
    });
    setIsDailyTracked(!!item.is_daily_tracked);
    setOverrideValue(item.pack_quantity_override?.toString() || "");
    setCategoryValue(item.category || "");
    setStorageLocationValue(item.storage_location_id || "");
    setStorageLocationValue(item.storage_location_id || "");
    setPanSizesConfig(item.pan_sizes ? (item.pan_sizes as PanSizesConfig) : null);

    // Fetch multi-location assignments from junction table
    const { data: assignments } = await supabase
      .from("inventory_item_locations")
      .select("storage_location_id")
      .eq("item_id", item.id);
    
    if (assignments && assignments.length > 0) {
      setStorageLocationIds(new Set(assignments.map(a => a.storage_location_id)));
    } else if (item.storage_location_id) {
      setStorageLocationIds(new Set([item.storage_location_id]));
    } else {
      setStorageLocationIds(new Set());
    }
  };

  const saveItem = async () => {
    if (!editingItem) return;
    const override = overrideValue.trim() === "" ? null : parseInt(overrideValue);
    const category = categoryValue || null;
    const storage_location_id = storageLocationValue || null;

    updateItemMutation.mutate({ itemId: editingItem.id, override, category, storage_location_id, pan_sizes: panSizesConfig, is_daily_tracked: isDailyTracked });
  };


  // Sync everything from PFG (locations + items)
  const syncFromPFG = async () => {
    setIsSyncing(true);
    const syncStartedAt = new Date().toISOString();
    setProgress({ phase: "Connecting to PFG...", current: 0, total: 100 });
    
    try {
      const productListHeaderId = (pfgIntegration?.credentials as any)?.product_list_header_id;
      const customerId = (pfgIntegration?.credentials as any)?.customer_id;
      
      if (!productListHeaderId || !customerId) {
        toast.error('PFG Order Guide not configured — go to Location Settings → Integrations to set it up');
        setIsSyncing(false);
        return;
      }
      
      setProgress({ phase: "Fetching product list from PFG...", current: 10, total: 100 });
      
      const { data, error } = await supabase.functions.invoke("pfg-service", {
        body: { locationId, action: "categories", productListHeaderId, customerId }
      });

      if (error) throw error;
      if (!data?.authenticated) {
        toast.error("PFG authentication failed. Check your settings.");
        return;
      }

      const categories = data?.data?.categories || [];
      
      if (categories.length === 0) {
        toast.info("No categories found in PFG");
        return;
      }

      // Count total items
      let totalProducts = 0;
      for (const cat of categories) {
        totalProducts += (cat.products || []).length;
      }

      // Step 1: Map PFG categories to existing storage locations (don't auto-create)
      const locationMap = new Map<string, string>();
      
      const { data: existingLocations } = await supabase
        .from("inventory_locations")
        .select("id, name")
        .eq("location_id", locationId);
      
      for (const loc of existingLocations || []) {
        locationMap.set(loc.name.toLowerCase(), loc.id);
      }
      
      // Also try to match PFG categories to existing locations by name
      for (const cat of categories) {
        const key = cat.name.toLowerCase();
        if (!locationMap.has(key)) {
          // No matching location — items will go to Unassigned
        }
      }

      setProgress({ phase: "Syncing inventory items...", current: 30, total: 100, detail: `0 / ${totalProducts} items` });

      // Pre-fetch brand_vendor_mappings for PFG
      const { data: pfgMappings } = await supabase
        .from("brand_vendor_mappings")
        .select("vendor_item_id, brand_template_id")
        .eq("vendor", "pfg");
      const pfgSkuToTemplate = new Map<string, string>();
      for (const m of pfgMappings || []) {
        if (m.vendor_item_id) pfgSkuToTemplate.set(m.vendor_item_id, m.brand_template_id);
      }

      // Resolve brand_id + location name for vendor gap alerts
      const { data: locRow } = await supabase.from("locations").select("organization_id, name").eq("id", locationId).single();
      const { data: orgRow } = await supabase.from("organizations").select("brand_id").eq("id", locRow?.organization_id).single();
      const brandId = orgRow?.brand_id;
      const locationName = locRow?.name || 'Unknown';

      // Pre-fetch all local items for in-memory matching
      const { data: allLocalItems } = await supabase
        .from("inventory_items")
        .select("id, item_number, qubeyond_item_id, brand_item_id, image_url, storage_location_id, user_hidden")
        .eq("location_id", locationId)
        .eq("is_active", true);
      const localByItemNumber = new Map((allLocalItems || []).filter(i => i.item_number).map(i => [i.item_number!, i]));
      const localByBrandItemId = new Map((allLocalItems || []).filter(i => i.brand_item_id).map(i => [i.brand_item_id!, i]));

      // Step 2: Update matched items only
      let itemsUpdated = 0;
      let processedItems = 0;
      let skippedUnmapped = 0;
      const gapAlerts: any[] = [];
      
      // Collect items needing AI images
      const itemsNeedingImages: { itemId: string; productName: string; brand?: string }[] = [];
      
      for (const cat of categories) {
        const storageLocationId = locationMap.get(cat.name.toLowerCase()) || null;

        for (const product of cat.products || []) {
          processedItems++;
          
          // Update progress every 5 items
          if (processedItems % 5 === 0 || processedItems === totalProducts) {
            const progressPct = 30 + Math.floor((processedItems / totalProducts) * 55);
            setProgress({ 
              phase: "Syncing inventory items...", 
              current: progressPct, 
              total: 100, 
              detail: `${processedItems} / ${totalProducts} items` 
            });
          }
          
          // Matching chain: item_number → brand_vendor_mappings (qubeyond_item_id is for depletion only)
          let existing = product.itemNumber ? (localByItemNumber.get(product.itemNumber) || null) : null;

          // brand_vendor_mappings fallback
          if (!existing && product.itemNumber) {
            const templateId = pfgSkuToTemplate.get(product.itemNumber);
            if (templateId) {
              existing = localByBrandItemId.get(templateId) || null;
            }
          }
          
          if (!existing) {
            // VENDOR GATE: Do NOT create new inventory_items.
            skippedUnmapped++;
            if (brandId && product.itemNumber) {
              gapAlerts.push({
                brand_id: brandId,
                vendor_source: 'pfg',
                item_number: product.itemNumber,
                vendor_name: product.name || 'Unknown',
                vendor_description: product.name || null,
                pack_size: product.packSize || null,
                status: 'new',
              });
            }
            continue;
          }
          
          const price = product.price ? Number(product.price) : null;
          const packQuantity = product.packQuantity ? Number(product.packQuantity) : null;
          
          const hasExistingImage = existing?.image_url;
          const hasPfgImage = product.imageUrl;
          let imageUrl = hasExistingImage || hasPfgImage || null;
          let needsAiImage = !imageUrl;
          
          // Check if another location already has an image for this item
          if (needsAiImage && product.itemNumber) {
            const { data: crossLocationItem } = await supabase
              .from("inventory_items")
              .select("image_url")
              .eq("item_number", product.itemNumber)
              .not("image_url", "is", null)
              .neq("location_id", locationId)
              .limit(1)
              .maybeSingle();
            
            if (crossLocationItem?.image_url) {
              imageUrl = crossLocationItem.image_url;
              needsAiImage = false;
            }
          }
          
          const itemData: Record<string, any> = {
            cost_per_unit: price,
            pack_size: product.packSize || null,
            pack_quantity: packQuantity,
            item_number: product.itemNumber || null,
            image_url: imageUrl,
            is_active: (existing as any)?.user_hidden ? false : true,
            last_synced_at: new Date().toISOString()
          };
          // Preserve existing shelf assignment
          if (!existing.storage_location_id && storageLocationId) {
            itemData.storage_location_id = storageLocationId;
          }
          
          let itemId: string | null = existing.id;
          
          await supabase
            .from("inventory_items")
            .update(itemData)
            .eq("id", existing.id);
          itemsUpdated++;
          
          // Queue for AI image generation only if no existing image AND no PFG image
          if (itemId && needsAiImage) {
            itemsNeedingImages.push({
              itemId,
              productName: product.name,
              brand: product.brand
            });
          }
        }
      }

      if (skippedUnmapped > 0) {
        console.log(`[PFG Sync] Skipped ${skippedUnmapped} unmapped items (not in brand catalog)`);
      }

      // Route unmatched PFG items to vendor_gap_alerts (atomic location-merge via RPC)
      if (gapAlerts.length > 0) {
        for (const gap of gapAlerts) {
          const { error: gapErr } = await supabase.rpc('upsert_vendor_gap_with_location' as any, {
            _brand_id: gap.brand_id,
            _vendor_source: gap.vendor_source,
            _item_number: gap.item_number,
            _vendor_name: gap.vendor_name,
            _vendor_description: gap.vendor_description,
            _pack_size: gap.pack_size,
            _category_name: null,
            _location_id: locationId,
            _location_name: locationName,
          });
          if (gapErr) console.warn('[PFG Sync] Gap alert write error:', gapErr.message);
        }
        console.log(`[PFG Sync] Routed ${gapAlerts.length} unmatched items to vendor_gap_alerts`);
      }
      
      // Step 3: Generate AI images for items without images (batch of 3 at a time)
      if (itemsNeedingImages.length > 0) {
        setProgress({ 
          phase: "Generating images for items...", 
          current: 85, 
          total: 100, 
          detail: `0 / ${itemsNeedingImages.length} images` 
        });
        
        const BATCH_SIZE = 3;
        let imagesGenerated = 0;
        
        for (let i = 0; i < itemsNeedingImages.length; i += BATCH_SIZE) {
          const batch = itemsNeedingImages.slice(i, i + BATCH_SIZE);
          
          const results = await Promise.allSettled(
             batch.map(async (item) => {
               try {
                 const { data, error } = await supabase.functions.invoke("image-service?action=generate-product-image", {
                   body: { productName: item.productName, brand: item.brand }
                 });
                
                if (error || !data?.imageUrl) {
                  console.log(`Failed to generate image for ${item.productName}:`, error);
                  return null;
                }
                
                // Update the item with the generated image
                await supabase
                  .from("inventory_items")
                  .update({ image_url: data.imageUrl })
                  .eq("id", item.itemId);
                
                return data.imageUrl;
              } catch (err) {
                console.error(`Error generating image for ${item.productName}:`, err);
                return null;
              }
            })
          );
          
          imagesGenerated += results.filter(r => r.status === 'fulfilled' && r.value).length;
          
          setProgress({ 
            phase: "Generating images for items...", 
            current: 85 + Math.floor((imagesGenerated / itemsNeedingImages.length) * 10), 
            total: 100, 
            detail: `${imagesGenerated} / ${itemsNeedingImages.length} images` 
          });
        }
        
        console.log(`Generated ${imagesGenerated} AI images for items without PFG images`);
      }

      setProgress({ phase: "Checking for dropped items...", current: 97, total: 100 });

      // Auto-flag items that were in inventory but NOT in the order guide response
      const syncedProductIds = new Set<string>();
      for (const cat of categories) {
        for (const p of cat.products || []) {
          if (p.id) syncedProductIds.add(String(p.id));
        }
      }

      // Find active PFG items in this location that weren't in the sync
      const { data: allPfgItems } = await supabase
        .from("inventory_items")
        .select("id, qubeyond_item_id, remap_status")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .not("qubeyond_item_id", "is", null);

      let flaggedCount = 0;
      for (const item of (allPfgItems || [])) {
        if (item.qubeyond_item_id && !syncedProductIds.has(String(item.qubeyond_item_id)) && (item as any).remap_status !== 'needs_remap' && (item as any).remap_status !== 'remapped') {
          await supabase
            .from("inventory_items")
            .update({ remap_status: "needs_remap" } as any)
            .eq("id", item.id);
          flaggedCount++;
        }
      }

      setProgress({ phase: "Complete!", current: 100, total: 100 });

      // Write sync log
      await supabase.from("inventory_sync_logs").insert({
        location_id: locationId,
        sync_source: "pfg",
        sync_type: "manual",
        started_at: syncStartedAt,
        completed_at: new Date().toISOString(),
        status: "completed",
        items_synced: itemsUpdated,
        orders_processed: 0,
        triggered_by: (await supabase.auth.getUser()).data.user?.id || null,
      });

      // ---- Blended price calculation for linked items ----
      const { data: linkedItems } = await supabase
        .from("inventory_items")
        .select("id, linked_item_id, cost_per_unit")
        .eq("location_id", locationId)
        .eq("user_hidden", true)
        .not("linked_item_id", "is", "null");

      if (linkedItems && linkedItems.length > 0) {
        const linkMap = new Map<string, number[]>();
        for (const li of linkedItems) {
          if (!(li as any).linked_item_id || li.cost_per_unit == null) continue;
          const existing = linkMap.get((li as any).linked_item_id) || [];
          existing.push(Number(li.cost_per_unit));
          linkMap.set((li as any).linked_item_id, existing);
        }

        for (const [primaryId, hiddenPrices] of linkMap.entries()) {
          const { data: primary } = await supabase
            .from("inventory_items")
            .select("cost_per_unit")
            .eq("id", primaryId)
            .single();

          if (!primary?.cost_per_unit) continue;

          const allPrices = [Number(primary.cost_per_unit), ...hiddenPrices];
          const avg = allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length;
          const blended = Math.round(avg * 100) / 100;

          await supabase
            .from("inventory_items")
            .update({ blended_price: blended } as any)
            .eq("id", primaryId);

          console.log(`Blended price for ${primaryId}: $${blended}`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["last-pfg-sync", locationId] });

      // Also sync PFG orders in background (for COGS)
      supabase.functions.invoke("pfg-service?action=sync_orders", {
        body: { locationId }
      }).catch(console.warn);
      
      const messages = [];
      if (skippedUnmapped > 0) messages.push(`${skippedUnmapped} unmapped (skipped)`);
      if (itemsUpdated > 0) messages.push(`${itemsUpdated} updated`);
      if (flaggedCount > 0) messages.push(`${flaggedCount} flagged for remap`);
      
      if (messages.length > 0) {
        toast.success(`Synced: ${messages.join(", ")}`);
      } else {
        toast.info("Already in sync with PFG");
      }
    } catch (err) {
      console.error("PFG sync error:", err);
      toast.error("Failed to sync from PFG");
    } finally {
      setIsSyncing(false);
      setTimeout(() => setProgress(null), 2000);
    }
  };

  // Sync from Produce Alliance
  const syncFromPA = async () => {
    if (!paIntegration) return;
    setIsPaSyncing(true);
    setPaProgress({ phase: "Connecting to Produce Alliance...", current: 0, total: 100 });

    try {
      const credentials = paIntegration.credentials as any;
      
      setPaProgress({ phase: "Syncing items from PA...", current: 20, total: 100 });

      const { data, error } = await supabase.functions.invoke("produce-alliance-service", {
        body: {
          action: "sync_items",
          locationId,
          username: credentials?.username,
          password: credentials?.password,
          paLocationId: credentials?.pa_location_id,
          triggeredBy: user?.id,
        }
      });

      if (error) throw error;

      setPaProgress({ phase: "Complete!", current: 100, total: 100 });

      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["last-pa-sync", locationId] });

      const itemCount = data?.itemsSynced ?? data?.items_synced ?? data?.synced ?? 0;
      if (itemCount > 0) {
        toast.success(`Synced ${itemCount} items from Produce Alliance`);
      } else {
        toast.info(data?.message || "Already in sync with Produce Alliance");
      }

      if (data?.errors?.length > 0) {
        toast.warning(`${data.errors.length} warning(s) during sync`);
      }
    } catch (err: any) {
      console.error("PA sync error:", err);
      setPaProgress({ phase: "Sync failed", current: 0, total: 100 });
      toast.error(err.message || "Failed to sync from Produce Alliance");
    } finally {
      setIsPaSyncing(false);
      setTimeout(() => setPaProgress(null), 2000);
    }
  };

  return (
    <>
    <div className="space-y-6">
      {mode === "setup" && <>
      {/* Schedule + Sync side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InventoryScheduleSettings locationId={locationId} />

        {(pfgIntegration || paIntegration) && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <RefreshCw className="h-4 w-4" />
                Vendor Sync
              </div>
              {pfgIntegration && (
                <div>
                  <Button 
                    className="w-full" 
                    size="sm"
                    onClick={syncFromPFG}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <img src={pfgLogo} alt="PFG" className="h-5 w-auto mr-1.5" />
                    )}
                    Sync PFG
                  </Button>
                  {progress && (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-xs text-muted-foreground truncate">{progress.phase}</p>
                      <Progress value={progress.current} className="h-1.5" />
                    </div>
                  )}
                  {!progress && lastPfgSync?.completed_at && (
                    <p className="text-[10px] text-muted-foreground text-center mt-1">
                      Last synced {formatSyncTime(lastPfgSync.completed_at)}
                    </p>
                  )}
                </div>
              )}
              {paIntegration && (
                <div>
                  <Button 
                    className="w-full" 
                    variant="outline"
                    size="sm"
                    onClick={syncFromPA}
                    disabled={isPaSyncing}
                  >
                    {isPaSyncing ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <img src={paLogo} alt="PA" className="h-5 w-auto mr-1.5" />
                    )}
                    Sync PA
                  </Button>
                  {paProgress && (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-xs text-muted-foreground truncate">{paProgress.phase}</p>
                      <Progress value={paProgress.current} className="h-1.5" />
                    </div>
                  )}
                  {!paProgress && lastPaSync?.completed_at && (
                    <p className="text-[10px] text-muted-foreground text-center mt-1">
                      Last synced {formatSyncTime(lastPaSync.completed_at)}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      </>}

      {(mode === "build" || isBuildMode) && <>
      {/* POS Mapping now handled inline in Recipe Catalog */}

      {/* Usage Rates removed — recipes are now the single source of truth */}

      {/* Prep Recipes moved to RecipeCatalog */}
      </>}

      {mode === "items" && <>
      <Card>
        <div className="p-3 sm:p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2 font-semibold text-sm min-w-0">
              <Package className="h-4 w-4 flex-shrink-0" />
              <span className="whitespace-nowrap">Items ({items?.length || 0}{deactivatedBrandItems && deactivatedBrandItems.length > 0 ? `/${(items?.length || 0) + deactivatedBrandItems.length}` : ''})</span>
              {deactivatedBrandItems && deactivatedBrandItems.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal whitespace-nowrap">
                  — {deactivatedBrandItems.length} deactivated
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="sm" variant="outline" onClick={() => setShowStorageManager(true)} className="gap-1">
                  <Settings2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Locations</span>
                </Button>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items..."
              className="h-8 pl-8 pr-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {items && items.length > 0 ? (
            <div className="space-y-2">
              {/* Items needing remap */}
              {(() => {
                const remapItems = items.filter(i => (i as any).remap_status === 'needs_remap');
                if (remapItems.length === 0) return null;
                const bidGuideId = (pfgIntegration?.credentials as any)?.bid_guide_header_id;
                const custId = (pfgIntegration?.credentials as any)?.customer_id;
                return (
                  <div>
                    <h4 className="text-sm font-medium text-destructive mb-2 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Needs Remap ({remapItems.length})
                    </h4>
                    <div className="grid gap-1">
                      {remapItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-destructive/10 border border-destructive/20 rounded text-sm group">
                          <div className="flex items-center gap-2 truncate flex-1">
                            <span className="truncate">{item.name}</span>
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                              Remap
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            {bidGuideId && custId && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-xs px-2"
                                onClick={() => setRemapItem(item)}
                              >
                                <ArrowRightLeft className="h-3 w-3 mr-1" />
                                Find Replacement
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Recipes moved to dedicated card below */}

              {/* Regular items grouped by storage location — collapsible with drag-and-drop */}
              {storageLocations?.map((loc) => {
                // Primary items (home location)
                const primaryItems = items
                  .filter(i => i.storage_location_id === loc.id);
                // Shortcut items (items whose primary is elsewhere but have a junction entry here)
                const shortcutJunctions = (itemLocationShortcuts || [])
                  .filter(s => s.storage_location_id === loc.id);
                const shortcutItemIds = shortcutJunctions.map(s => s.item_id);
                const shortcutItems = items
                  .filter(i => shortcutItemIds.includes(i.id) && i.storage_location_id !== loc.id);

                // Legacy guard: older shortcut order values were local-only (0..N), which collides with primary orders and causes staggering.
                const primaryOrderSet = new Set(
                  primaryItems.map(i => (i as any).display_order).filter((v): v is number => typeof v === "number")
                );
                const hasLegacyShortcutOrderCollisions = shortcutJunctions.some(s =>
                  typeof (s as any).display_order === "number" && primaryOrderSet.has((s as any).display_order)
                );

                // Build unified list with display_order for interleaved sorting
                let allLocItems = [
                  ...primaryItems.map(i => ({ ...i, _sortOrder: (i as any).display_order ?? 9999, _isShortcut: false })),
                  ...shortcutItems.map(i => {
                    const junctionOrder = shortcutJunctions.find(s => s.item_id === i.id)?.display_order;
                    const normalizedShortcutOrder = hasLegacyShortcutOrderCollisions
                      ? (primaryItems.length + ((junctionOrder as number) ?? 9999))
                      : ((junctionOrder as number) ?? 9999);
                    return { ...i, _sortOrder: normalizedShortcutOrder, _isShortcut: true };
                  }),
                ].sort((a, b) => a._sortOrder - b._sortOrder);

                // Apply optimistic order if available
                const optOrder = optimisticOrder[loc.id];
                if (optOrder) {
                  const orderMap = new Map(optOrder.map((id, idx) => [id, idx]));
                  allLocItems = [...allLocItems].sort((a, b) => {
                    const aIdx = orderMap.get(a.id) ?? 9999;
                    const bIdx = orderMap.get(b.id) ?? 9999;
                    return aIdx - bIdx;
                  });
                }
                const searchLower = searchQuery.toLowerCase().trim();
                if (searchLower) {
                  allLocItems = allLocItems.filter(i => i.name.toLowerCase().includes(searchLower));
                  if (allLocItems.length === 0) return null;
                }
                const isCollapsed = searchLower ? false : collapsedSections.has(loc.id);
                const isSelectingThisGroup = activeSelectGroup === loc.id;
                const panCount = primaryItems.filter(i => (i as any).pan_sizes?.enabled).length;
                return (
                  <div key={loc.id} className="border border-border rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/50 hover:bg-muted/80 transition-colors text-left"
                      onClick={() => {
                        const next = new Set(collapsedSections);
                        if (isCollapsed) next.delete(loc.id); else next.add(loc.id);
                        setCollapsedSections(next);
                      }}
                    >
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                      <span className="text-sm font-medium flex-1">{loc.name}</span>
                      <span className="text-xs text-muted-foreground">{allLocItems.length} items</span>
                      {shortcutItems.length > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
                          <Link2 className="h-2.5 w-2.5" />
                          {shortcutItems.length}
                        </Badge>
                      )}
                      {panCount > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {panCount} pans
                        </Badge>
                      )}
                    </button>
                    {!isCollapsed && !isBulkDragMode && !activeSelectGroup && (
                      <div className="flex justify-end px-2 py-1 bg-muted/30">
                        <Button
                          size="sm"
                          variant={reorderModeGroup === loc.id ? "default" : "ghost"}
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => {
                            if (reorderModeGroup === loc.id) {
                              flushReorder();
                              setOptimisticOrder(prev => { const next = { ...prev }; delete next[loc.id]; return next; });
                              setReorderModeGroup(null);
                            } else {
                              setReorderModeGroup(loc.id);
                            }
                          }}
                        >
                          <ListOrdered className="h-3 w-3" />
                          {reorderModeGroup === loc.id ? "Done" : "Reorder"}
                        </Button>
                      </div>
                    )}
                    {!isCollapsed && (() => {
                      const shortcutIdSet = new Set(shortcutItems.map(i => i.id));
                      const isBulkDragThisGroup = isBulkDragMode && bulkDragGroupKey === loc.id;
                      const isReorderThisGroup = reorderModeGroup === loc.id;
                      const bulkDragSet = new Set(bulkDragItemIds);

                      // Build render items — in bulk mode, replace consecutive selected items with a group row
                      let renderItems: { type: 'item' | 'group'; item?: any; items?: any[]; sortableId: string; isShortcut?: boolean }[] = [];
                      if (isBulkDragThisGroup) {
                        let groupInserted = false;
                        for (const item of allLocItems) {
                          if (bulkDragSet.has(item.id)) {
                            if (!groupInserted) {
                              renderItems.push({
                                type: 'group',
                                items: allLocItems.filter(i => bulkDragSet.has(i.id)),
                                sortableId: '__bulk_group__',
                              });
                              groupInserted = true;
                            }
                          } else {
                            const isShortcut = (item as any)._isShortcut || shortcutIdSet.has(item.id);
                            renderItems.push({ type: 'item', item, sortableId: item.id + (isShortcut ? '-shortcut' : ''), isShortcut });
                          }
                        }
                      } else {
                        renderItems = allLocItems.map(item => {
                          const isShortcut = (item as any)._isShortcut || shortcutIdSet.has(item.id);
                          return { type: 'item' as const, item, sortableId: item.id + (isShortcut ? '-shortcut' : ''), isShortcut };
                        });
                      }

                      // Check if bulk group is at edges
                      const bulkGroupIdx = renderItems.findIndex(r => r.type === 'group');
                      const isBulkFirst = bulkGroupIdx === 0;
                      const isBulkLast = bulkGroupIdx === renderItems.length - 1;

                      return (
                      <DndContext
                        sensors={dndSensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleItemDragStart}
                        onDragEnd={(event) => {
                          handleItemDragEnd(event, allLocItems, shortcutIdSet, loc.id);
                        }}
                      >
                        <SortableContext
                          items={renderItems.filter(r => r.type === 'item').map(r => r.sortableId)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="grid gap-0.5 p-1">
                            {allLocItems.length === 0 && (
                              <p className="text-xs text-muted-foreground italic px-2 py-3 text-center">No items assigned yet</p>
                            )}
                            {renderItems.map((ri) => {
                              if (ri.type === 'group') {
                                return (
                                  <BulkReorderGroup
                                    key="__bulk_group__"
                                    items={ri.items!}
                                    onMoveUp={() => handleBulkArrowMove('up', allLocItems, shortcutIdSet, loc.id)}
                                    onMoveDown={() => handleBulkArrowMove('down', allLocItems, shortcutIdSet, loc.id)}
                                    isFirst={isBulkFirst}
                                    isLast={isBulkLast}
                                  />
                                );
                              }
                              const item = ri.item!;
                              const isShortcut = ri.isShortcut!;
                              const itemIdx = renderItems.indexOf(ri);
                              return (
                                <SortableInventoryItem
                                  key={ri.sortableId}
                                  sortableId={ri.sortableId}
                                  item={item}
                                  isShortcut={isShortcut}
                                  isSelected={selectedItemIds.has(item.id)}
                                  isSelectingThisGroup={isSelectingThisGroup && !isBulkDragThisGroup}
                                  isDragDisabled={isSelectingThisGroup || isBulkDragThisGroup}
                                  isReorderMode={isBulkDragThisGroup || isReorderThisGroup}
                                  onMoveUp={isReorderThisGroup ? () => handleArrowMove('up', allLocItems, item.id, shortcutIdSet, loc.id) : undefined}
                                  onMoveDown={isReorderThisGroup ? () => handleArrowMove('down', allLocItems, item.id, shortcutIdSet, loc.id) : undefined}
                                  isFirst={itemIdx === 0}
                                  isLast={itemIdx === renderItems.length - 1}
                                  onClick={() => {
                                    if (isBulkDragThisGroup || isReorderThisGroup) return;
                                    if (isSelectingThisGroup) {
                                      const next = new Set(selectedItemIds);
                                      if (selectedItemIds.has(item.id)) next.delete(item.id); else next.add(item.id);
                                      setSelectedItemIds(next);
                                    } else if (isShortcut) {
                                      setShortcutConfigItem({
                                        itemId: item.id,
                                        itemName: item.name,
                                        storageLocationId: loc.id,
                                        storageLocationName: loc.name,
                                      });
                                    } else {
                                      openEditDialog(item);
                                    }
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    if (selectionContext === 'deactivated') setSelectionContext(null);
                                    setSelectionContext('active');
                                    setActiveSelectGroup(loc.id);
                                    setSelectedItemIds(new Set([item.id]));
                                  }}
                                />
                              );
                            })}
                          </div>
                        </SortableContext>
                        <DragOverlay>
                          {activeDragItemId ? (
                            <ItemDragOverlay item={items?.find(i => i.id === activeDragItemId) || { name: '' }} />
                          ) : null}
                        </DragOverlay>
                      </DndContext>
                      );
                    })()}
                  </div>
                );
              })}
              {/* Unassigned items */}
              {(() => {
                const searchLower = searchQuery.toLowerCase().trim();
                let unassigned = items.filter(i => !i.storage_location_id)
                  .sort((a, b) => ((a as any).display_order || 0) - ((b as any).display_order || 0));
                if (searchLower) {
                  unassigned = unassigned.filter(i => i.name.toLowerCase().includes(searchLower));
                }
                if (unassigned.length === 0) return null;
                const isCollapsed = searchLower ? false : collapsedSections.has("__unassigned__");
                const isSelectingThisGroup = activeSelectGroup === "__unassigned__";
                return (
                  <div className="border border-border/60 rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                      onClick={() => {
                        const next = new Set(collapsedSections);
                        if (isCollapsed) next.delete("__unassigned__"); else next.add("__unassigned__");
                        setCollapsedSections(next);
                      }}
                    >
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium flex-1">Unassigned</span>
                      <span className="text-xs text-muted-foreground">{unassigned.length} items</span>
                    </button>
                    {!isCollapsed && (
                      <DndContext
                        sensors={dndSensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleItemDragStart}
                        onDragEnd={(event) => handleItemDragEnd(event, unassigned)}
                      >
                        <SortableContext
                          items={unassigned.map(i => i.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="grid gap-0.5 p-1">
                            {unassigned.map((item, idx) => (
                              <SortableInventoryItem
                                key={item.id}
                                sortableId={item.id}
                                item={item}
                                isShortcut={false}
                                isSelected={selectedItemIds.has(item.id)}
                                isSelectingThisGroup={isSelectingThisGroup}
                                isDragDisabled={isSelectingThisGroup}
                                isReorderMode={false}
                                reorderState="idle"
                                pickedCount={0}
                                onClick={() => {
                                  if (isSelectingThisGroup) {
                                    const next = new Set(selectedItemIds);
                                    if (selectedItemIds.has(item.id)) next.delete(item.id); else next.add(item.id);
                                    setSelectedItemIds(next);
                                  } else {
                                    openEditDialog(item);
                                  }
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  if (selectionContext === 'deactivated') setSelectionContext(null);
                                  setSelectionContext('active');
                                  setActiveSelectGroup("__unassigned__");
                                  setSelectedItemIds(new Set([item.id]));
                                }}
                              />
                            ))}
                          </div>
                        </SortableContext>
                        <DragOverlay>
                          {activeDragItemId ? (
                            <ItemDragOverlay item={items?.find(i => i.id === activeDragItemId) || { name: '' }} />
                          ) : null}
                        </DragOverlay>
                      </DndContext>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No items yet. Click "Sync with PFG" to import.
            </p>
          )}
        </div>
      </Card>
      </>}

      {/* Deactivated Brand Items Section */}
      {deactivatedBrandItems && deactivatedBrandItems.length > 0 && (
        <div className="border border-red-200 dark:border-red-900/40 rounded-lg overflow-hidden mt-4">
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/60 dark:hover:bg-red-950/30 transition-colors text-left"
            onClick={() => setDeactivatedCollapsed(!deactivatedCollapsed)}
          >
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${deactivatedCollapsed ? '-rotate-90' : ''}`} />
            <PowerOff className="h-3.5 w-3.5 text-red-500" />
            <span className="text-sm font-medium flex-1">Deactivated Brand Items</span>
            <Badge variant="outline" className="text-xs border-red-200 dark:border-red-800 text-red-600 dark:text-red-400">
              {deactivatedBrandItems.length}
            </Badge>
          </button>
          {!deactivatedCollapsed && (
            <div className="grid gap-0.5 p-1">
              {deactivatedBrandItems.map((item: any) => {
                const isSelected = selectedItemIds.has(item.id);
                const isSelectingDeactivated = selectionContext === 'deactivated';
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-red-50/60 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 ${
                      isSelected ? 'ring-2 ring-primary/50' : ''
                    }`}
                    onClick={() => {
                      if (isSelectingDeactivated) {
                        const next = new Set(selectedItemIds);
                        if (isSelected) next.delete(item.id); else next.add(item.id);
                        setSelectedItemIds(next);
                        if (next.size === 0) setSelectionContext(null);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (selectionContext === 'active') {
                        setActiveSelectGroup(null);
                      }
                      setSelectedItemIds(new Set([item.id]));
                      setSelectionContext('deactivated');
                    }}
                  >
                    {isSelectingDeactivated && (
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                      }`}>
                        {isSelected && <CheckSquare className="h-3 w-3 text-primary-foreground" />}
                      </div>
                    )}
                    <Package className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                    <span className="flex-1 truncate text-muted-foreground">{item.name}</span>
                    {item.category && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                        {item.category}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>


      {/* Edit Item Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto overflow-x-hidden">
           <DialogHeader>
             <DialogTitle className="sr-only">Edit Item</DialogTitle>
           </DialogHeader>
           {editingItem && (
              <div className="space-y-4">
                {!!editingItem.brand_item_id && (
                  <div className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 rounded-md px-2.5 py-1.5">
                    <Tag className="h-3 w-3" />
                    Brand managed — category controlled by brand catalog
                  </div>
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 pr-6 min-w-0 max-w-full">
                    <p className="text-sm font-medium min-w-0 flex-1 break-all line-clamp-2">
                      {editingItem.name}
                    </p>
                   <Select
                     value={categoryValue || "__none__"}
                     onValueChange={(val) => setCategoryValue(val === "__none__" ? "" : val)}
                     disabled={!canEditCategories || !!editingItem.brand_item_id}
                   >
                     <SelectTrigger className="h-7 w-auto gap-1.5 px-3 py-0 text-xs rounded-full font-medium bg-primary text-primary-foreground border-primary hover:bg-primary/90 flex-shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-primary-foreground">
                       <SelectValue placeholder="No category" />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem value="__none__">No category</SelectItem>
                       {INVENTORY_CATEGORIES.map(cat => (
                         <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                       ))}
                     </SelectContent>
                   </Select>
                 </div>
              </div>

              {/* Storage Location */}
              <div className="space-y-2">
                <Label>Storage Location</Label>
                <Select
                  value={storageLocationValue || "__unassigned__"}
                  onValueChange={(val) => {
                    const newVal = val === "__unassigned__" ? "" : val;
                    setStorageLocationValue(newVal);
                    // Keep storageLocationIds in sync — primary location is always included
                    const next = new Set(storageLocationIds);
                    // Remove old primary if it was only there as primary
                    if (storageLocationValue) next.delete(storageLocationValue);
                    if (newVal) next.add(newVal);
                    setStorageLocationIds(next);
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {storageLocations?.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Shortcuts info */}
              {(() => {
                const shortcuts = (itemLocationShortcuts || [])
                  .filter(s => s.item_id === editingItem.id && s.storage_location_id !== editingItem.storage_location_id);
                if (shortcuts.length === 0) return null;
                return (
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Link2 className="h-3 w-3" />
                      Shortcuts ({shortcuts.length})
                    </Label>
                    <div className="space-y-1">
                      {shortcuts.map(s => {
                        const locName = storageLocations?.find(l => l.id === s.storage_location_id)?.name || 'Unknown';
                        return (
                          <div key={s.storage_location_id} className="flex items-center justify-between px-2 py-1.5 bg-accent/20 border border-dashed border-accent/40 rounded text-sm">
                            <div className="flex items-center gap-1.5">
                              <Link2 className="h-3 w-3 text-muted-foreground" />
                              <span>{locName}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-destructive hover:text-destructive"
                              onClick={async () => {
                                await supabase
                                  .from("inventory_item_locations")
                                  .delete()
                                  .eq("item_id", editingItem.id)
                                  .eq("storage_location_id", s.storage_location_id);
                                queryClient.invalidateQueries({ queryKey: ["inventory-item-locations", locationId] });
                                queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
                                toast.success(`Shortcut to ${locName} removed`);
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Shortcuts let this item appear in multiple locations during counting. Use bulk select + "Shortcut" to add more.
                    </p>
                  </div>
                );
              })()}

              {/* Category is now in the dialog header */}

              {/* Common name is now edited inline at the top */}

              {/* Pan Sizes */}
              <PanSizesSection
                value={panSizesConfig}
                onChange={setPanSizesConfig}
                costPerUnit={editingItem.cost_per_unit ? Number(editingItem.cost_per_unit) : null}
                unitLabel={editingItem.unit || 'case'}
                packSize={editingItem.pack_size || null}
                packQuantity={editingItem.pack_quantity_override || editingItem.pack_quantity || null}
              />

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  PFG Pack Quantity: {editingItem.pack_quantity || "Not set"}
                </Label>
                
                <div className="space-y-1">
                  <Label htmlFor="override">Units per Case Override</Label>
                  <Input
                    id="override"
                    type="number"
                    inputMode="numeric"
                    placeholder="e.g., 64 for 64 brownies per case"
                    value={overrideValue}
                    onChange={(e) => setOverrideValue(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use PFG value.
                  </p>
                </div>
              </div>

              {/* Daily Tracking Toggle */}
              <div className="flex items-center justify-between py-2 border-t border-border/50">
                <div>
                  <Label className="text-sm font-medium">Daily Spot Check</Label>
                  <p className="text-[10px] text-muted-foreground">Track this item in daily spot counts</p>
                </div>
                <Switch
                  checked={isDailyTracked}
                  onCheckedChange={setIsDailyTracked}
                />
              </div>

              {/* Flag for Remap */}
              {pfgIntegration && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={async () => {
                    if (!editingItem) return;
                    await supabase
                      .from("inventory_items")
                      .update({ remap_status: "needs_remap" } as any)
                      .eq("id", editingItem.id);
                    toast.success("Item flagged for remap");
                    queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
                    setEditingItem(null);
                  }}
                >
                  <AlertTriangle className="h-4 w-4 mr-1" />
                  Flag for Remap
                </Button>
              )}
              
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => editingItem && hideItemMutation.mutate({ itemId: editingItem.id })}
                disabled={hideItemMutation.isPending}
              >
                <EyeOff className="h-4 w-4 mr-1" />
                {hideItemMutation.isPending ? "Hiding..." : "Hide Item"}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center -mt-1">
                Hidden items won't reappear after syncing
              </p>


              {/* Link to primary item for price blending */}
              {items && items.length > 1 && (
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs font-medium">Link to another item (for price blending)</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={linkTargetItemId}
                    onChange={(e) => setLinkTargetItemId(e.target.value)}
                  >
                    <option value="">No link</option>
                    {items.filter(i => i.id !== editingItem?.id).map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground">
                    If this is a duplicate (e.g., case vs. single), link it to the primary item. Prices will be averaged during sync.
                  </p>
                  {linkTargetItemId && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => editingItem && hideItemMutation.mutate({ itemId: editingItem.id, linkedItemId: linkTargetItemId })}
                      disabled={hideItemMutation.isPending}
                    >
                      <EyeOff className="h-4 w-4 mr-1" />
                      {hideItemMutation.isPending ? "Hiding..." : "Hide & Link"}
                    </Button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setEditingItem(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={saveItem}
                  disabled={updateItemMutation.isPending}
                >
                  {updateItemMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Recipe Builder Dialog — moved to RecipeCatalog/PrepRecipesSection */}

      {/* Remap Item Dialog */}
      <RemapItemDialog
        open={!!remapItem}
        onOpenChange={(open) => !open && setRemapItem(null)}
        item={remapItem}
        locationId={locationId}
        bidGuideHeaderId={(pfgIntegration?.credentials as any)?.bid_guide_header_id || ""}
        customerId={(pfgIntegration?.credentials as any)?.customer_id || ""}
      />


      {/* Bulk Category Dialog */}
      <Dialog open={showBulkCategoryDialog} onOpenChange={setShowBulkCategoryDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Assign Category
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''} will be categorized
          </p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {INVENTORY_CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                  bulkCategoryValue === cat ? 'bg-primary/10 ring-1 ring-primary/30 font-medium' : 'hover:bg-muted/50'
                }`}
                onClick={() => setBulkCategoryValue(cat)}
              >
                <Tag className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                {cat}
              </button>
            ))}
          </div>
          <Button
            disabled={!bulkCategoryValue || isBulkUpdating}
            onClick={async () => {
              setIsBulkUpdating(true);
              try {
                const ids = Array.from(selectedItemIds);
                const { error } = await supabase
                  .from("inventory_items")
                  .update({ category: bulkCategoryValue })
                  .in("id", ids);
                if (error) throw error;

                toast.success(`${ids.length} item${ids.length !== 1 ? 's' : ''} → ${bulkCategoryValue}`);
                queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
                setSelectedItemIds(new Set());
                setActiveSelectGroup(null);
                setShowBulkCategoryDialog(false);
              } catch {
                toast.error("Failed to assign category");
              } finally {
                setIsBulkUpdating(false);
              }
            }}
          >
            {isBulkUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Tag className="h-4 w-4 mr-1" />}
            Assign Category
          </Button>
        </DialogContent>
      </Dialog>

      {/* Create Shortcut Dialog */}
      <Dialog open={showShortcutDialog} onOpenChange={(open) => { setShowShortcutDialog(open); if (!open) setShortcutCountBy('inherit'); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Create Shortcut
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''} will appear in the selected location during counting
          </p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {storageLocations?.filter(loc => loc.id !== activeSelectGroup).map(loc => (
              <button
                key={loc.id}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                  shortcutTarget === loc.id ? 'bg-primary/10 ring-1 ring-primary/30 font-medium' : 'hover:bg-muted/50'
                }`}
                onClick={() => setShortcutTarget(loc.id)}
              >
                <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                {loc.name}
              </button>
            ))}
          </div>
          
          {/* Count-by selector */}
          <div className="space-y-1.5 pt-1 border-t border-border">
            <label className="text-xs font-medium text-muted-foreground">Count by</label>
            <Select value={shortcutCountBy} onValueChange={(v: any) => setShortcutCountBy(v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit (default)</SelectItem>
                <SelectItem value="cases_and_units">Cases & Units</SelectItem>
                <SelectItem value="cases_only">Cases only</SelectItem>
                <SelectItem value="units_only">Units only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            disabled={!shortcutTarget || isBulkUpdating}
            onClick={async () => {
              if (!shortcutTarget) return;
              setIsBulkUpdating(true);
              try {
                const ids = Array.from(selectedItemIds);
                const inserts = ids.map(itemId => ({
                  item_id: itemId,
                  storage_location_id: shortcutTarget,
                  count_by: shortcutCountBy,
                }));
                const { error } = await supabase
                  .from("inventory_item_locations")
                  .upsert(inserts, { onConflict: "item_id,storage_location_id" });
                if (error) throw error;

                const targetName = storageLocations?.find(l => l.id === shortcutTarget)?.name || 'location';
                toast.success(`Shortcut created for ${ids.length} item${ids.length !== 1 ? 's' : ''} → ${targetName}`);
                queryClient.invalidateQueries({ queryKey: ["inventory-item-locations", locationId] });
                queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
                setSelectedItemIds(new Set());
                setActiveSelectGroup(null);
                setShowShortcutDialog(false);
                setShortcutCountBy('inherit');
              } catch {
                toast.error("Failed to create shortcuts");
              } finally {
                setIsBulkUpdating(false);
              }
            }}
          >
            {isBulkUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
            Create Shortcut
          </Button>
        </DialogContent>
      </Dialog>

      {/* Shortcut Config Sheet */}
      <ShortcutConfigSheet
        open={!!shortcutConfigItem}
        onOpenChange={(open) => { if (!open) setShortcutConfigItem(null); }}
        itemId={shortcutConfigItem?.itemId || ""}
        itemName={shortcutConfigItem?.itemName || ""}
        storageLocationId={shortcutConfigItem?.storageLocationId || ""}
        storageLocationName={shortcutConfigItem?.storageLocationName || ""}
        locationId={locationId}
      />

      {/* Bulk Pan Size Dialog */}
      <BulkPanSizeDialog
        open={showBulkPanDialog}
        onOpenChange={setShowBulkPanDialog}
        selectedCount={selectedItemIds.size}
        isPending={isBulkUpdating}
        onApply={async (config) => {
          setIsBulkUpdating(true);
          try {
            const ids = Array.from(selectedItemIds);
            for (const id of ids) {
              await supabase
                .from("inventory_items")
                .update({ pan_sizes: config as any } as any)
                .eq("id", id);
            }
            toast.success(`Pan sizes applied to ${ids.length} items`);
            queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
            setSelectedItemIds(new Set());
            setShowBulkPanDialog(false);
          } catch {
            toast.error("Failed to apply pan sizes");
          } finally {
            setIsBulkUpdating(false);
          }
        }}
      />

      <StorageLocationManager
        open={showStorageManager}
        onOpenChange={setShowStorageManager}
        locationId={locationId}
      />

      {/* Bulk Assign Locations Dialog */}
      <Dialog open={showBulkMoveDialog} onOpenChange={setShowBulkMoveDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">Move {selectedItemIds.size} items</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">Select destination location</p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {storageLocations?.filter(loc => loc.id !== activeSelectGroup).map(loc => (
              <button
                key={loc.id}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                  bulkMoveTargets.has(loc.id) ? 'bg-primary/10 ring-1 ring-primary/30 font-medium' : 'hover:bg-muted/50'
                }`}
                onClick={() => setBulkMoveTargets(new Set([loc.id]))}
              >
                <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                {loc.name}
              </button>
            ))}
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                bulkMoveTargets.has("__unassigned__") ? 'bg-primary/10 ring-1 ring-primary/30 font-medium' : 'hover:bg-muted/50'
              }`}
              onClick={() => setBulkMoveTargets(new Set(["__unassigned__"]))}
            >
              <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              Unassigned
            </button>
          </div>
          <Button
            disabled={bulkMoveTargets.size === 0 || isBulkUpdating}
            onClick={async () => {
              setIsBulkUpdating(true);
              try {
                const ids = Array.from(selectedItemIds);
                const targetLocId = Array.from(bulkMoveTargets)[0];
                const newLocId = targetLocId === "__unassigned__" ? null : targetLocId;

                const { error } = await supabase
                  .from("inventory_items")
                  .update({ storage_location_id: newLocId } as any)
                  .in("id", ids);
                if (error) throw error;

                const targetName = newLocId
                  ? storageLocations?.find(l => l.id === newLocId)?.name || 'location'
                  : 'Unassigned';
                toast.success(`Moved ${ids.length} items to ${targetName}`);
                queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
                setSelectedItemIds(new Set());
                setActiveSelectGroup(null);
                setShowBulkMoveDialog(false);
              } catch {
                toast.error("Failed to move items");
              } finally {
                setIsBulkUpdating(false);
              }
            }}
          >
            {isBulkUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Move Items
          </Button>
        </DialogContent>
      </Dialog>

      {/* Floating Bulk Action Bar — scoped to active location group */}
      {activeSelectGroup && selectedItemIds.size > 0 && !isBulkDragMode && (
        <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg overflow-x-auto">
            <Badge variant="secondary" className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary shrink-0">
              {selectedItemIds.size} selected
            </Badge>

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
              onClick={() => {
                const groupKey = activeSelectGroup;
                if (!groupKey || selectedItemIds.size === 0) return;
                let groupItems: any[] = [];
                if (groupKey === "__unassigned__") {
                  groupItems = (items || []).filter(i => !i.storage_location_id).sort((a, b) => ((a as any).display_order || 0) - ((b as any).display_order || 0));
                } else {
                  const primaryItems = (items || []).filter(i => i.storage_location_id === groupKey).sort((a, b) => ((a as any).display_order || 0) - ((b as any).display_order || 0));
                  const shortcutJunctions = (itemLocationShortcuts || []).filter((s: any) => s.storage_location_id === groupKey);
                  const shortcutItemIds = shortcutJunctions.map((s: any) => s.item_id);
                  const shortcutItems = (items || []).filter(i => shortcutItemIds.includes(i.id) && i.storage_location_id !== groupKey)
                    .sort((a, b) => {
                      const aOrder = shortcutJunctions.find((s: any) => s.item_id === a.id)?.display_order ?? 9999;
                      const bOrder = shortcutJunctions.find((s: any) => s.item_id === b.id)?.display_order ?? 9999;
                      return (aOrder as number) - (bOrder as number);
                    });
                  groupItems = [...primaryItems, ...shortcutItems];
                }
                const selectedArr = Array.from(selectedItemIds);
                const indices = selectedArr.map(id => groupItems.findIndex(i => i.id === id)).filter(i => i !== -1).sort((a, b) => a - b);
                if (indices.length === 0) return;
                const isConsecutive = indices.every((val, i) => i === 0 || val === indices[i - 1] + 1);
                if (!isConsecutive) {
                  toast.error("Select consecutive items to reorder as a group");
                  return;
                }
                const orderedIds = indices.map(idx => groupItems[idx].id);
                setBulkDragItemIds(orderedIds);
                setBulkDragGroupKey(groupKey);
                setIsBulkDragMode(true);
              }}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              Reorder
            </button>

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
              onClick={() => { setBulkMoveTargets(new Set()); setShowBulkMoveDialog(true); }}
            >
              <MoveRight className="h-3.5 w-3.5" />
              Move
            </button>

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
              onClick={() => { setShortcutTarget(null); setShowShortcutDialog(true); }}
            >
              <Link2 className="h-3.5 w-3.5" />
              Shortcut
            </button>


            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
              onClick={() => { setBulkCategoryValue(""); setShowBulkCategoryDialog(true); }}
            >
              <Tag className="h-3.5 w-3.5" />
              Category
            </button>

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
              onClick={async () => {
                setIsBulkUpdating(true);
                try {
                  const ids = Array.from(selectedItemIds);
                  const { error } = await supabase
                    .from("inventory_items")
                    .update({ is_active: false } as any)
                    .in("id", ids);
                  if (error) throw error;
                  toast.success(`Deactivated ${ids.length} items`);
                  queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
                  queryClient.invalidateQueries({ queryKey: ["deactivated-brand-items", locationId] });
                  setSelectedItemIds(new Set());
                  setActiveSelectGroup(null);
                  setSelectionContext(null);
                } catch {
                  toast.error("Failed to deactivate items");
                } finally {
                  setIsBulkUpdating(false);
                }
              }}
            >
              <PowerOff className="h-3.5 w-3.5" />
              Deactivate
            </button>

            <button
              className="p-1.5 rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors shrink-0"
              onClick={() => {
                setSelectedItemIds(new Set());
                setActiveSelectGroup(null);
                setSelectionContext(null);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar — deactivated items */}
      {selectionContext === 'deactivated' && selectedItemIds.size > 0 && (
        <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg overflow-x-auto">
            <Badge variant="secondary" className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary shrink-0">
              {selectedItemIds.size} selected
            </Badge>

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors whitespace-nowrap"
              onClick={async () => {
                setIsBulkUpdating(true);
                try {
                  const ids = Array.from(selectedItemIds);
                  const { error } = await supabase
                    .from("inventory_items")
                    .update({ is_active: true } as any)
                    .in("id", ids);
                  if (error) throw error;
                  toast.success(`Activated ${ids.length} items`);
                  queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
                  queryClient.invalidateQueries({ queryKey: ["deactivated-brand-items", locationId] });
                  setSelectedItemIds(new Set());
                  setSelectionContext(null);
                } catch {
                  toast.error("Failed to activate items");
                } finally {
                  setIsBulkUpdating(false);
                }
              }}
            >
              <Power className="h-3.5 w-3.5" />
              Activate
            </button>

            <button
              className="p-1.5 rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors shrink-0"
              onClick={() => {
                setSelectedItemIds(new Set());
                setSelectionContext(null);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk drag mode banner */}
      {isBulkDragMode && (
        <div className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)]">
          <div className="bg-primary text-primary-foreground rounded-lg shadow-lg px-4 sm:px-6 py-3 flex items-center gap-3 border-2 border-primary-foreground/20">
            <span className="font-semibold text-sm">Use arrows to move {bulkDragItemIds.length} items</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                flushReorder();
                setOptimisticOrder({});
                setIsBulkDragMode(false);
                setBulkDragGroupKey(null);
                setBulkDragItemIds([]);
                setSelectedItemIds(new Set());
                setActiveSelectGroup(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default InventoryItemsManager;
