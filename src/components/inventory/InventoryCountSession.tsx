import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Check, ChevronLeft, ChevronRight, X, Minus, Plus, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface InventoryCountSessionProps {
  countId: string;
  locationId: string;
  onClose: () => void;
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
  cases: number; // Can be decimal (e.g., 0.5 for half case)
  units: number;
}

const InventoryCountSession = ({ countId, locationId, onClose }: InventoryCountSessionProps) => {
  const queryClient = useQueryClient();
  const [currentLocationIndex, setCurrentLocationIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, ItemCount>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, { cases: string; units: string }>>({});
  const [isSaving, setIsSaving] = useState(false);

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

      // Get existing count items
      const { data: countItems, error: countError } = await supabase
        .from("inventory_count_items")
        .select("item_id, quantity")
        .eq("count_id", countId);
      
      if (countError) throw countError;

      // Map items with their counts
      const countMap = new Map(countItems?.map(ci => [ci.item_id, ci.quantity]) || []);
      
      return itemsData?.map(item => ({
        item_id: item.id,
        item_name: item.name,
        unit: item.unit,
        storage_location: (item.storage_location as any)?.name || "Uncategorized",
        storage_location_id: item.storage_location_id || "uncategorized",
        par_level: item.par_level,
        cost_per_unit: item.cost_per_unit,
        pack_size: item.pack_size,
        // Use override if set, otherwise fall back to PFG pack_quantity
        pack_quantity: item.pack_quantity_override ?? item.pack_quantity,
        item_number: item.item_number,
        brand: item.brand,
        image_url: item.image_url,
        // Store existing quantity to convert back
        _existingQuantity: countMap.get(item.id) ?? 0
      })) as (CountItem & { _existingQuantity: number })[];
    }
  });

  // Initialize counts from items (convert flat quantity to cases + units)
  useEffect(() => {
    if (items) {
      const initialCounts: Record<string, ItemCount> = {};
      items.forEach(item => {
        const totalUnits = (item as any)._existingQuantity || 0;
        const packQty = item.pack_quantity || 1;
        initialCounts[item.item_id] = {
          cases: Math.floor(totalUnits / packQty),
          units: totalUnits % packQty
        };
      });
      setCounts(initialCounts);
    }
  }, [items]);

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

  // Save count mutation
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

  // Complete count mutation
  const completeCountMutation = useMutation({
    mutationFn: async () => {
      // Convert counts to flat quantities
      const itemCounts = items?.map(item => ({
        item_id: item.item_id,
        quantity: getTotalQuantity(item.item_id, item.pack_quantity)
      })) || [];
      
      await saveCountMutation.mutateAsync(itemCounts);

      const { error } = await supabase
        .from("inventory_counts")
        .update({ 
          status: "completed",
          completed_at: new Date().toISOString()
        })
        .eq("id", countId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Inventory count completed!");
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      onClose();
    },
    onError: () => {
      toast.error("Failed to complete count");
    }
  });

  // Auto-save counts periodically
  const saveCurrentCounts = useCallback(async () => {
    if (!items || Object.keys(counts).length === 0) return;
    
    setIsSaving(true);
    const itemCounts = items.map(item => ({
      item_id: item.item_id,
      quantity: getTotalQuantity(item.item_id, item.pack_quantity)
    }));
    
    try {
      await saveCountMutation.mutateAsync(itemCounts);
    } catch (error) {
      console.error("Auto-save failed:", error);
    } finally {
      setIsSaving(false);
    }
  }, [counts, items, getTotalQuantity]);

  // Auto-save when changing locations
  useEffect(() => {
    const timer = setTimeout(() => {
      saveCurrentCounts();
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [currentLocationIndex]);

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

  // Calculate progress
  const totalItems = items?.length || 0;
  const countedItems = Object.values(counts).filter(c => c.cases > 0 || c.units > 0).length;
  const progress = totalItems > 0 ? (countedItems / totalItems) * 100 : 0;

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
    <div className="space-y-4">
      {/* Header with progress and live cost */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
              <div>
                <span className="font-medium">
                  {countedItems} / {totalItems} items
                </span>
                {isSaving && (
                  <Badge variant="secondary" className="text-xs ml-2">Saving...</Badge>
                )}
              </div>
            </div>
            <Button 
              onClick={() => completeCountMutation.mutate()}
              disabled={completeCountMutation.isPending}
            >
              <Check className="h-4 w-4 mr-2" />
              Complete
            </Button>
          </div>
          
          <Progress value={progress} className="h-2 mb-3" />
          
          {/* Live cost display */}
          <div className="flex items-center justify-center gap-2 p-3 bg-background rounded-lg border">
            <DollarSign className="h-5 w-5 text-primary" />
            <span className="text-2xl font-bold text-primary">
              {formatCurrency(totalCost)}
            </span>
            <span className="text-sm text-muted-foreground">total value</span>
          </div>
        </CardContent>
      </Card>

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
      <div className="space-y-3">
        {currentItems.map((item) => {
          const count = counts[item.item_id] || { cases: 0, units: 0 };
          const itemCost = getItemCost(item);
          const packQty = item.pack_quantity || 1;
          const costPerUnit = (item.cost_per_unit || 0) / packQty;
          
          return (
            <Card key={item.item_id} className="overflow-hidden">
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
                        {item.pack_size && <span>{item.pack_size}</span>}
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
                      <button
                        type="button"
                        className="h-14 w-14 flex items-center justify-center rounded-lg border-2 border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 active:scale-95 transition-all"
                        onClick={() => updateCases(item.item_id, -1)}
                      >
                        <Minus className="h-6 w-6" strokeWidth={3} />
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={rawInputs[item.item_id]?.cases ?? count.cases}
                        onChange={(e) => handleCasesInput(item.item_id, e.target.value)}
                        onBlur={() => handleCasesBlur(item.item_id)}
                        className="w-16 h-14 text-center text-2xl font-bold bg-background border-2 border-border rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                      <button
                        type="button"
                        className="h-14 w-14 flex items-center justify-center rounded-lg border-2 border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all"
                        onClick={() => updateCases(item.item_id, 1)}
                      >
                        <Plus className="h-6 w-6" strokeWidth={3} />
                      </button>
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
                      <button
                        type="button"
                        className="h-14 w-14 flex items-center justify-center rounded-lg border-2 border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 active:scale-95 transition-all"
                        onClick={() => updateUnits(item.item_id, -1)}
                      >
                        <Minus className="h-6 w-6" strokeWidth={3} />
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={rawInputs[item.item_id]?.units ?? count.units}
                        onChange={(e) => handleUnitsInput(item.item_id, e.target.value)}
                        onBlur={() => handleUnitsBlur(item.item_id)}
                        className="w-16 h-14 text-center text-2xl font-bold bg-background border-2 border-border rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                      <button
                        type="button"
                        className="h-14 w-14 flex items-center justify-center rounded-lg border-2 border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all"
                        onClick={() => updateUnits(item.item_id, 1)}
                      >
                        <Plus className="h-6 w-6" strokeWidth={3} />
                      </button>
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
        <div className="border-t border-border bg-card">
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
  );
};

export default InventoryCountSession;