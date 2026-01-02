import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, MapPin, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface InventoryItemsManagerProps {
  locationId: string;
}

const InventoryItemsManager = ({ locationId }: InventoryItemsManagerProps) => {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

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

  // Sync everything from PFG (locations + items)
  const syncFromPFG = async () => {
    setIsSyncing(true);
    try {
      const productListHeaderId = (pfgIntegration?.credentials as any)?.product_list_header_id 
        || "b4680e1a-4815-44c6-968e-634e94188009";
      const customerId = (pfgIntegration?.credentials as any)?.customer_id
        || "73094123-ab82-4044-9722-65099b55a11e";
      
      const { data, error } = await supabase.functions.invoke("fetch-pfg-orders", {
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

      // Step 1: Upsert storage locations
      let locationsAdded = 0;
      const locationMap = new Map<string, string>();
      
      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        // Check if exists
        const { data: existing } = await supabase
          .from("inventory_locations")
          .select("id")
          .eq("location_id", locationId)
          .ilike("name", cat.name)
          .maybeSingle();
        
        if (existing) {
          locationMap.set(cat.name.toLowerCase(), existing.id);
        } else {
          const { data: inserted, error: insertError } = await supabase
            .from("inventory_locations")
            .insert({
              location_id: locationId,
              name: cat.name,
              display_order: i
            })
            .select("id")
            .single();
          
          if (!insertError && inserted) {
            locationMap.set(cat.name.toLowerCase(), inserted.id);
            locationsAdded++;
          }
        }
      }

      // Step 2: Upsert items
      let itemsAdded = 0;
      let itemsUpdated = 0;
      
      for (const cat of categories) {
        const storageLocationId = locationMap.get(cat.name.toLowerCase());
        if (!storageLocationId) continue;

        for (const product of cat.products || []) {
          // Check if item exists by qubeyond_item_id
          const { data: existing } = await supabase
            .from("inventory_items")
            .select("id, name, unit, storage_location_id, cost_per_unit")
            .eq("location_id", locationId)
            .eq("qubeyond_item_id", product.id)
            .maybeSingle();
          
          const price = product.price ? Number(product.price) : null;
          const packQuantity = product.packQuantity ? Number(product.packQuantity) : null;
          
          const itemData = {
            name: product.name,
            unit: product.unit?.toLowerCase() || "case",
            storage_location_id: storageLocationId,
            cost_per_unit: price,
            pack_size: product.packSize || null,
            pack_quantity: packQuantity,
            brand: product.brand || null,
            item_number: product.itemNumber || null,
            image_url: product.imageUrl || null,
            is_active: true
          };
          
          if (existing) {
            // Always update to ensure all fields are current
            await supabase
              .from("inventory_items")
              .update(itemData)
              .eq("id", existing.id);
            itemsUpdated++;
          } else {
            const { error: insertError } = await supabase
              .from("inventory_items")
              .insert({
                location_id: locationId,
                qubeyond_item_id: product.id,
                display_order: itemsAdded,
                ...itemData
              });
            
            if (!insertError) itemsAdded++;
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      
      const messages = [];
      if (locationsAdded > 0) messages.push(`${locationsAdded} locations`);
      if (itemsAdded > 0) messages.push(`${itemsAdded} items`);
      if (itemsUpdated > 0) messages.push(`${itemsUpdated} updated`);
      
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
    }
  };

  return (
    <div className="space-y-6">
      {/* PFG Sync Button */}
      {pfgIntegration && (
        <Card>
          <CardContent className="pt-6">
            <Button 
              className="w-full" 
              onClick={syncFromPFG}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync with PFG
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Syncs storage locations and items from your PFG product list
            </p>
          </CardContent>
        </Card>
      )}

      {/* Storage Locations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Storage Locations ({storageLocations?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {storageLocations && storageLocations.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {storageLocations.map((loc) => (
                <div key={loc.id} className="px-3 py-1.5 bg-muted rounded-full text-sm">
                  {loc.name}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No storage locations yet. Click "Sync with PFG" to import.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Inventory Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5" />
            Items ({items?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items && items.length > 0 ? (
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {storageLocations?.map((loc) => {
                const locItems = items.filter(i => i.storage_location_id === loc.id);
                if (locItems.length === 0) return null;
                return (
                  <div key={loc.id}>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">{loc.name}</h4>
                    <div className="grid gap-1">
                      {locItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-muted/50 rounded text-sm">
                          <span>{item.name}</span>
                          <span className="text-muted-foreground">{item.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No items yet. Click "Sync with PFG" to import.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryItemsManager;
