import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Check, ChevronLeft, ChevronRight, X, Minus, Plus } from "lucide-react";
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
  quantity: number;
  par_level: number | null;
  cost_per_unit: number | null;
}

const InventoryCountSession = ({ countId, locationId, onClose }: InventoryCountSessionProps) => {
  const queryClient = useQueryClient();
  const [currentLocationIndex, setCurrentLocationIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
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
        quantity: countMap.get(item.id) ?? 0,
        par_level: item.par_level,
        cost_per_unit: item.cost_per_unit
      })) as CountItem[];
    }
  });

  // Initialize counts from items
  useEffect(() => {
    if (items) {
      const initialCounts: Record<string, number> = {};
      items.forEach(item => {
        initialCounts[item.item_id] = item.quantity;
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

  // Save count mutation
  const saveCountMutation = useMutation({
    mutationFn: async (itemCounts: { item_id: string; quantity: number }[]) => {
      // Upsert all count items
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
      // First save all counts
      const itemCounts = Object.entries(counts).map(([item_id, quantity]) => ({
        item_id,
        quantity
      }));
      
      await saveCountMutation.mutateAsync(itemCounts);

      // Then mark as complete
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
    if (Object.keys(counts).length === 0) return;
    
    setIsSaving(true);
    const itemCounts = Object.entries(counts).map(([item_id, quantity]) => ({
      item_id,
      quantity
    }));
    
    try {
      await saveCountMutation.mutateAsync(itemCounts);
    } catch (error) {
      console.error("Auto-save failed:", error);
    } finally {
      setIsSaving(false);
    }
  }, [counts]);

  // Auto-save when changing locations
  useEffect(() => {
    const timer = setTimeout(() => {
      saveCurrentCounts();
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [currentLocationIndex]);

  const updateCount = (itemId: string, delta: number) => {
    setCounts(prev => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] || 0) + delta)
    }));
  };

  const setCount = (itemId: string, value: number) => {
    setCounts(prev => ({
      ...prev,
      [itemId]: Math.max(0, value)
    }));
  };

  // Calculate progress
  const totalItems = items?.length || 0;
  const countedItems = Object.values(counts).filter(q => q > 0).length;
  const progress = totalItems > 0 ? (countedItems / totalItems) * 100 : 0;

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
      {/* Header with progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
              <span className="font-medium">
                {countedItems} / {totalItems} items
              </span>
              {isSaving && (
                <Badge variant="secondary" className="text-xs">Saving...</Badge>
              )}
            </div>
            <Button 
              onClick={() => completeCountMutation.mutate()}
              disabled={completeCountMutation.isPending}
            >
              <Check className="h-4 w-4 mr-2" />
              Complete
            </Button>
          </div>
          <Progress value={progress} className="h-2" />
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

      {/* Item list - optimized for fast mobile counting */}
      <div className="space-y-2">
        {currentItems.map((item) => (
          <Card key={item.item_id} className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex items-center">
                {/* Item info */}
                <div className="flex-1 p-4 min-w-0">
                  <p className="font-medium truncate">{item.item_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.unit}
                    {item.par_level && (
                      <span className={cn(
                        "ml-2",
                        (counts[item.item_id] || 0) < item.par_level && "text-destructive"
                      )}>
                        Par: {item.par_level}
                      </span>
                    )}
                  </p>
                </div>
                
                {/* Count controls - large touch targets */}
                <div className="flex items-center gap-0 border-l border-border">
                  <Button
                    variant="ghost"
                    size="lg"
                    className="h-16 w-14 rounded-none text-xl font-bold hover:bg-destructive/10"
                    onClick={() => updateCount(item.item_id, -1)}
                  >
                    <Minus className="h-6 w-6" />
                  </Button>
                  
                  <input
                    type="number"
                    inputMode="numeric"
                    value={counts[item.item_id] || 0}
                    onChange={(e) => setCount(item.item_id, parseInt(e.target.value) || 0)}
                    className="w-16 h-16 text-center text-xl font-bold bg-transparent border-x border-border focus:outline-none focus:bg-primary/5"
                  />
                  
                  <Button
                    variant="ghost"
                    size="lg"
                    className="h-16 w-14 rounded-none text-xl font-bold hover:bg-primary/10"
                    onClick={() => updateCount(item.item_id, 1)}
                  >
                    <Plus className="h-6 w-6" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick navigation dots */}
      {locationKeys.length > 1 && (
        <div className="flex justify-center gap-2 py-2">
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
      )}
    </div>
  );
};

export default InventoryCountSession;
