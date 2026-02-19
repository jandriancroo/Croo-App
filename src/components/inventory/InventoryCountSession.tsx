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
import { ChevronLeft, ChevronRight, Minus, Plus, DollarSign, History, AlertTriangle, X, Save, Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDockToast } from "@/contexts/DockToastContext";

interface InventoryCountSessionProps {
  countId: string;
  locationId: string;
  onClose: () => void;
  isEditing?: boolean; // True if reopening a completed count for editing
  isViewOnly?: boolean; // True if just viewing a completed count (no editing)
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
}

// Count state: cases + individual units (supports decimals for partial cases)
interface ItemCount {
  cases: number;
  units: number;
}

interface PendingEdit {
  countItemId: string;
  itemName: string;
  previousQuantity: number;
  newQuantity: number;
}

const InventoryCountSession = ({ countId, locationId, onClose, isEditing = false, isViewOnly = false }: InventoryCountSessionProps) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { setDockContent } = useDockToast();
  const [currentLocationIndex, setCurrentLocationIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, ItemCount>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, { cases: string; units: string }>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  
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

  // Fetch items with existing counts
  const { data: items } = useQuery({
    queryKey: ["inventory-items-for-count", locationId, countId],
    queryFn: async () => {
      // Get all items
      const { data: itemsData, error: itemsError } = await supabase
        .from("inventory_items")
        .select(`
          id,
          name,
          unit,
          par_level,
          cost_per_unit,
          pack_size,
          pack_quantity,
          pack_quantity_override,
          item_number,
          brand,
          image_url,
          storage_location_id,
          storage_location:inventory_locations(name)
        `)
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("display_order");
      
      if (itemsError) throw itemsError;

      // Get existing count items (include id for edit tracking)
      const { data: countItems, error: countError } = await supabase
        .from("inventory_count_items")
        .select("id, item_id, quantity")
        .eq("count_id", countId);
      
      if (countError) throw countError;

      // Map items with their counts and count_item_id
      const countMap = new Map(countItems?.map(ci => [ci.item_id, { quantity: ci.quantity, countItemId: ci.id }]) || []);
      
      return itemsData?.map(item => {
        const countData = countMap.get(item.id);
        return {
          item_id: item.id,
          item_name: item.name,
          unit: item.unit,
          storage_location: (item.storage_location as any)?.name || "Uncategorized",
          storage_location_id: item.storage_location_id || "uncategorized",
          par_level: item.par_level,
          cost_per_unit: item.cost_per_unit,
          pack_size: item.pack_size,
          pack_quantity: item.pack_quantity_override ?? item.pack_quantity,
          item_number: item.item_number,
          brand: item.brand,
          image_url: item.image_url,
          _existingQuantity: countData?.quantity ?? 0,
          _countItemId: countData?.countItemId || null
        };
      }) as (CountItem & { _existingQuantity: number; _countItemId: string | null })[];
    }
  });

  // Initialize counts from items (convert flat quantity to cases + units)
  useEffect(() => {
    if (items) {
      const initialCounts: Record<string, ItemCount> = {};
      const originals: Record<string, number> = {};
      
      items.forEach(item => {
        const totalUnits = (item as any)._existingQuantity || 0;
        const packQty = item.pack_quantity || 1;
        initialCounts[item.item_id] = {
          cases: Math.floor(totalUnits / packQty),
          units: totalUnits % packQty
        };
        // Store original quantities for edit tracking
        if (isEditing) {
          originals[item.item_id] = totalUnits;
        }
      });
      
      setCounts(initialCounts);
      if (isEditing) {
        originalCounts.current = originals;
      }
    }
  }, [items, isEditing]);

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

  // Calculate total quantity for an item (cases * pack_quantity + units)
  const getTotalQuantity = useCallback((itemId: string, packQuantity: number | null) => {
    const count = counts[itemId] || { cases: 0, units: 0 };
    const packQty = packQuantity || 1;
    return count.cases * packQty + count.units;
  }, [counts]);

  // Calculate cost for a single item
  const getItemCost = useCallback((item: CountItem) => {
    const count = counts[item.item_id] || { cases: 0, units: 0 };
    const costPerCase = item.cost_per_unit || 0;
    const packQty = item.pack_quantity || 1;
    const costPerUnit = costPerCase / packQty;
    
    return count.cases * costPerCase + count.units * costPerUnit;
  }, [counts]);

  // Calculate total running cost
  const totalCost = useMemo(() => {
    if (!items) return 0;
    return items.reduce((sum, item) => sum + getItemCost(item), 0);
  }, [items, getItemCost]);

  // Count stats
  const totalItems = items?.length || 0;
  const countedItems = Object.values(counts).filter(c => c.cases > 0 || c.units > 0).length;

  // Save count mutation (saves progress without completing)
  const saveCountMutation = useMutation({
    mutationFn: async (itemCounts: { item_id: string; quantity: number }[]) => {
      const { error } = await supabase
        .from("inventory_count_items")
        .upsert(
          itemCounts.map(ic => ({
            count_id: countId,
            item_id: ic.item_id,
            quantity: ic.quantity
          })),
          { onConflict: "count_id,item_id" }
        );
      
      if (error) throw error;
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
      const extendedItem = item as CountItem & { _existingQuantity: number; _countItemId: string | null };
      const newQuantity = getTotalQuantity(item.item_id, item.pack_quantity);
      const originalQuantity = originalCounts.current[item.item_id] ?? 0;
      
      if (newQuantity !== originalQuantity && extendedItem._countItemId) {
        edits.push({
          countItemId: extendedItem._countItemId,
          itemName: item.item_name,
          previousQuantity: originalQuantity,
          newQuantity
        });
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

  // Save current progress (doesn't complete, just saves)
  const handleSave = async () => {
    if (!items || Object.keys(counts).length === 0) return;
    
    setIsSaving(true);
    const itemCounts = items.map(item => ({
      item_id: item.item_id,
      quantity: getTotalQuantity(item.item_id, item.pack_quantity)
    }));
    
    try {
      await saveCountMutation.mutateAsync(itemCounts);
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

  // Handle exit without saving
  const handleExit = () => {
    onClose();
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

  // Voice input handler - supports multiple items in one transcript
  const handleVoiceTranscript = useCallback(async (transcript: string) => {
    if (!items || items.length === 0) return;

    toast.info(`Processing: "${transcript}"`);

    try {
      const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=parse-inventory-voice', {
        body: {
          transcript,
          items: items.map(i => ({ item_id: i.item_id, item_name: i.item_name }))
        }
      });

      if (error) throw error;

      const commands = data.commands || [];
      let successCount = 0;
      let lastMatchedId: string | null = null;

      for (const cmd of commands) {
        if (cmd.matched_item_id && cmd.confidence !== 'low') {
          const itemId = cmd.matched_item_id;
          const cases = cmd.cases ?? 0;
          const units = cmd.units ?? 0;

          // Safety: skip if AI returned zero for both - likely a mis-parse, don't wipe existing data
          if (cases === 0 && units === 0) {
            console.warn('[Voice] Skipping zero-count command for item:', cmd.item_name);
            toast.warning(`Skipped "${cmd.item_name}" — heard 0 cases & 0 units`);
            continue;
          }

          // Update counts
          setCounts(prev => ({
            ...prev,
            [itemId]: { cases, units }
          }));
          setRawInputs(prev => ({
            ...prev,
            [itemId]: { cases: String(cases), units: String(units) }
          }));

          lastMatchedId = itemId;
          successCount++;

          const matchedItem = items.find(i => i.item_id === itemId);
          toast.success(`${matchedItem?.item_name}: ${cases} cases, ${units} units`);
        } else if (cmd.item_name) {
          toast.warning(`Couldn't match "${cmd.item_name}" to an item`);
        }
      }

      // Highlight the last matched item
      if (lastMatchedId) {
        setHighlightedItemId(lastMatchedId);
        setTimeout(() => setHighlightedItemId(null), 2000);
      }

      if (successCount === 0 && commands.length === 0) {
        toast.warning(`Couldn't understand: "${transcript}"`);
      }
    } catch (error) {
      console.error('[Voice] Parse error:', error);
      toast.error('Failed to process voice command');
    }
  }, [items]);

  const { isListening, isSupported, toggleListening } = useVoiceInput({
    onTranscript: handleVoiceTranscript,
    continuous: true
  });

  // Refs for stable callback references
  const handleSaveRef = useRef(handleSave);
  const handleSaveEditsRef = useRef(handleSaveEdits);
  const handleExitRef = useRef(handleExit);
  const onCloseRef = useRef(onClose);
  const toggleListeningRef = useRef(toggleListening);
  
  // Keep refs updated
  useEffect(() => {
    handleSaveRef.current = handleSave;
    handleSaveEditsRef.current = handleSaveEdits;
    handleExitRef.current = handleExit;
    onCloseRef.current = onClose;
    toggleListeningRef.current = toggleListening;
  });

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
        onSave: () => isEditing ? handleSaveEditsRef.current() : handleSaveRef.current(),
        onExit: () => isEditing ? onCloseRef.current() : handleExitRef.current(),
        onToggleVoice: () => toggleListeningRef.current(),
      });
    } else {
      setDockContent(null);
    }
    
    // Clear dock content on unmount
    return () => {
      setDockContent(null);
    };
  }, [isMobile, isViewOnly, totalCost, countedItems, totalItems, isSaving, isListening, isSupported, isEditing, setDockContent]);

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
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border -mx-4 px-4 py-3">
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
              <Button variant="outline" onClick={isEditing ? onClose : handleExit}>
                <X className="h-4 w-4 mr-2" />
                {isEditing ? "Cancel" : "Exit"}
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

      {/* Location navigation */}
      {locationKeys.length > 1 && (
        <div className="flex items-center justify-between bg-muted rounded-lg p-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentLocationIndex(Math.max(0, currentLocationIndex - 1))}
            disabled={currentLocationIndex === 0}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="text-center">
            <p className="font-medium">{itemsByLocation[currentLocation]?.name}</p>
            <p className="text-xs text-muted-foreground">
              {currentLocationIndex + 1} of {locationKeys.length}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
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
          const count = counts[item.item_id] || { cases: 0, units: 0 };
          const itemCost = getItemCost(item);
          const packQty = item.pack_quantity || 1;
          const costPerUnit = (item.cost_per_unit || 0) / packQty;
          const isHighlighted = highlightedItemId === item.item_id;
          
          return (
            <Card 
              key={item.item_id} 
              className={cn(
                "overflow-hidden transition-all duration-300",
                isHighlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02] shadow-lg"
              )}
            >
              <CardContent className="p-0">
                {/* Item header with details */}
                <div className="p-3 border-b border-border bg-muted/30">
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
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                        {item.item_number && <span>#{item.item_number}</span>}
                        <span>{item.pack_size || item.unit || 'ea'}</span>
                        {item.cost_per_unit && (
                          <span className="text-primary font-medium">
                            {formatCurrency(item.cost_per_unit)}/case
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Item value */}
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold text-primary">{formatCurrency(itemCost)}</p>
                      <p className="text-xs text-muted-foreground">
                        {getTotalQuantity(item.item_id, item.pack_quantity)} units
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Dual count controls - Mobile optimized */}
                <div className="grid grid-cols-2 divide-x divide-border">
                  {/* Cases counter */}
                  <div className="p-3">
                    <p className="text-xs text-center text-muted-foreground mb-2 uppercase tracking-wide font-medium">
                      Cases
                      {item.cost_per_unit && (
                        <span className="ml-1 text-primary">@ {formatCurrency(item.cost_per_unit)}</span>
                      )}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      {!isViewOnly && (
                        <button
                          type="button"
                          className="h-12 w-12 flex items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/80 active:scale-95 transition-all"
                          onClick={() => updateCases(item.item_id, -1)}
                        >
                          <Minus className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                      )}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={rawInputs[item.item_id]?.cases ?? count.cases}
                        onChange={(e) => handleCasesInput(item.item_id, e.target.value)}
                        onBlur={() => handleCasesBlur(item.item_id)}
                        disabled={isViewOnly}
                        className={cn(
                          "w-16 h-14 text-center text-2xl font-bold bg-background border-2 border-border rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20",
                          isViewOnly && "w-20 cursor-default"
                        )}
                      />
                      {!isViewOnly && (
                        <button
                          type="button"
                          className="h-12 w-12 flex items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/80 active:scale-95 transition-all"
                          onClick={() => updateCases(item.item_id, 1)}
                        >
                          <Plus className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Units counter */}
                  <div className="p-3">
                    <p className="text-xs text-center text-muted-foreground mb-2 uppercase tracking-wide font-medium">
                      Units
                      {costPerUnit > 0 && (
                        <span className="ml-1 text-primary">@ {formatCurrency(costPerUnit)}</span>
                      )}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      {!isViewOnly && (
                        <button
                          type="button"
                          className="h-12 w-12 flex items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/80 active:scale-95 transition-all"
                          onClick={() => updateUnits(item.item_id, -1)}
                        >
                          <Minus className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                      )}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={rawInputs[item.item_id]?.units ?? count.units}
                        onChange={(e) => handleUnitsInput(item.item_id, e.target.value)}
                        onBlur={() => handleUnitsBlur(item.item_id)}
                        disabled={isViewOnly}
                        className={cn(
                          "w-16 h-14 text-center text-2xl font-bold bg-background border-2 border-border rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20",
                          isViewOnly && "w-20 cursor-default"
                        )}
                      />
                      {!isViewOnly && (
                        <button
                          type="button"
                          className="h-12 w-12 flex items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/80 active:scale-95 transition-all"
                          onClick={() => updateUnits(item.item_id, 1)}
                        >
                          <Plus className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                    {packQty > 1 && (
                      <p className="text-[10px] text-center text-muted-foreground mt-1">
                        {packQty} per case
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Navigation bar with back/forward and location name */}
      {locationKeys.length > 1 && (
        <div className="border-t border-border bg-card rounded-lg">
          <div className="flex items-center justify-between px-2 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentLocationIndex(prev => Math.max(0, prev - 1))}
              disabled={currentLocationIndex === 0}
              className="h-10 px-3"
            >
              <ChevronLeft className="h-5 w-5 mr-1" />
              Back
            </Button>
            
            <div className="flex-1 text-center px-2">
              <p className="font-semibold text-sm truncate">
                {itemsByLocation[currentLocation]?.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {currentLocationIndex + 1} of {locationKeys.length}
              </p>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentLocationIndex(prev => Math.min(locationKeys.length - 1, prev + 1))}
              disabled={currentLocationIndex === locationKeys.length - 1}
              className="h-10 px-3"
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
                  idx === currentLocationIndex ? "bg-primary" : "bg-muted-foreground/30"
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
