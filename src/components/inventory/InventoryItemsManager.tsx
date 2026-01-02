import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Edit2, Trash2, MapPin, Package, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface InventoryItemsManagerProps {
  locationId: string;
}

const InventoryItemsManager = ({ locationId }: InventoryItemsManagerProps) => {
  const queryClient = useQueryClient();
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isSyncingPFG, setIsSyncingPFG] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newItem, setNewItem] = useState({
    name: "",
    unit: "each",
    storage_location_id: "",
    par_level: "",
    cost_per_unit: ""
  });

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

  // Fetch items
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
        .order("display_order");
      
      if (error) throw error;
      return data;
    }
  });

  // Add storage location mutation
  const addLocationMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("inventory_locations")
        .insert({
          location_id: locationId,
          name,
          display_order: (storageLocations?.length || 0)
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      setNewLocationName("");
      setIsAddingLocation(false);
      toast.success("Storage location added");
    },
    onError: () => {
      toast.error("Failed to add location");
    }
  });

  // Add item mutation
  const addItemMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("inventory_items")
        .insert({
          location_id: locationId,
          name: newItem.name,
          unit: newItem.unit,
          storage_location_id: newItem.storage_location_id || null,
          par_level: newItem.par_level ? parseFloat(newItem.par_level) : null,
          cost_per_unit: newItem.cost_per_unit ? parseFloat(newItem.cost_per_unit) : null,
          display_order: (items?.length || 0)
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      setNewItem({ name: "", unit: "each", storage_location_id: "", par_level: "", cost_per_unit: "" });
      setIsAddingItem(false);
      toast.success("Item added");
    },
    onError: () => {
      toast.error("Failed to add item");
    }
  });

  // Delete item mutation
  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({ is_active: false })
        .eq("id", itemId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      toast.success("Item removed");
    }
  });

  // Delete storage location mutation
  const deleteLocationMutation = useMutation({
    mutationFn: async (locId: string) => {
      const { error } = await supabase
        .from("inventory_locations")
        .delete()
        .eq("id", locId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      toast.success("Location removed");
    }
  });

  // Sync from PFG
  const syncFromPFG = async () => {
    setIsSyncingPFG(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-pfg-orders", {
        body: { locationId, action: "categories" }
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

      // Get existing storage locations to avoid duplicates
      const existingNames = new Set(storageLocations?.map(l => l.name.toLowerCase()) || []);
      
      let added = 0;
      for (const cat of categories) {
        if (!existingNames.has(cat.name.toLowerCase())) {
          const { error: insertError } = await supabase
            .from("inventory_locations")
            .insert({
              location_id: locationId,
              name: cat.name,
              display_order: (storageLocations?.length || 0) + added
            });
          
          if (!insertError) added++;
        }
      }

      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      
      if (added > 0) {
        toast.success(`Added ${added} storage locations from PFG`);
      } else {
        toast.info("All PFG categories already exist");
      }
    } catch (err) {
      console.error("PFG sync error:", err);
      toast.error("Failed to sync from PFG");
    } finally {
      setIsSyncingPFG(false);
    }
  };

  const units = ["each", "case", "lb", "oz", "gal", "bag", "box", "pack"];

  return (
    <div className="space-y-6">
      {/* Storage Locations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Storage Locations
          </CardTitle>
          <div className="flex gap-2">
            {pfgIntegration && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={syncFromPFG}
                disabled={isSyncingPFG}
              >
                {isSyncingPFG ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1" />
                )}
                PFG
              </Button>
            )}
            <Dialog open={isAddingLocation} onOpenChange={setIsAddingLocation}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Storage Location</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label>Name</Label>
                  <Input
                    placeholder="e.g., Walk-in Cooler"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                  />
                </div>
                <Button 
                  className="w-full" 
                  onClick={() => addLocationMutation.mutate(newLocationName)}
                  disabled={!newLocationName || addLocationMutation.isPending}
                >
                  Add Location
                </Button>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {storageLocations && storageLocations.length > 0 ? (
            <div className="space-y-2">
              {storageLocations.map((loc) => (
                <div key={loc.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span>{loc.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm("Remove this location?")) {
                        deleteLocationMutation.mutate(loc.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No storage locations yet. Add locations like "Walk-in", "Dry Storage", etc.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Inventory Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5" />
            Items ({items?.length || 0})
          </CardTitle>
          <Dialog open={isAddingItem} onOpenChange={setIsAddingItem}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Inventory Item</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label>Item Name</Label>
                  <Input
                    placeholder="e.g., Mozzarella Cheese"
                    value={newItem.name}
                    onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Unit</Label>
                    <Select
                      value={newItem.unit}
                      onValueChange={(v) => setNewItem({ ...newItem, unit: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((unit) => (
                          <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>Storage Location</Label>
                    <Select
                      value={newItem.storage_location_id}
                      onValueChange={(v) => setNewItem({ ...newItem, storage_location_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {storageLocations?.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Par Level (optional)</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={newItem.par_level}
                      onChange={(e) => setNewItem({ ...newItem, par_level: e.target.value })}
                    />
                  </div>
                  
                  <div>
                    <Label>Cost per Unit ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={newItem.cost_per_unit}
                      onChange={(e) => setNewItem({ ...newItem, cost_per_unit: e.target.value })}
                    />
                  </div>
                </div>

                <Button 
                  className="w-full" 
                  onClick={() => addItemMutation.mutate()}
                  disabled={!newItem.name || addItemMutation.isPending}
                >
                  Add Item
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {items && items.length > 0 ? (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.unit}
                      {(item.storage_location as any)?.name && (
                        <span> • {(item.storage_location as any).name}</span>
                      )}
                      {item.par_level && (
                        <span> • Par: {item.par_level}</span>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm("Remove this item?")) {
                        deleteItemMutation.mutate(item.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No items yet. Add items to start counting inventory.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryItemsManager;
