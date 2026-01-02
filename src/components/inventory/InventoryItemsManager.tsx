import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, MapPin, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface InventoryItemsManagerProps {
  locationId: string;
}

interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}

const InventoryItemsManager = ({ locationId }: InventoryItemsManagerProps) => {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);

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
    setProgress({ phase: "Connecting to PFG...", current: 0, total: 100 });
    
    try {
      const productListHeaderId = (pfgIntegration?.credentials as any)?.product_list_header_id 
        || "b4680e1a-4815-44c6-968e-634e94188009";
      const customerId = (pfgIntegration?.credentials as any)?.customer_id
        || "73094123-ab82-4044-9722-65099b55a11e";
      
      setProgress({ phase: "Fetching product list from PFG...", current: 10, total: 100 });
      
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

      // Count total items
      let totalProducts = 0;
      for (const cat of categories) {
        totalProducts += (cat.products || []).length;
      }

      setProgress({ phase: "Creating storage locations...", current: 20, total: 100, detail: `${categories.length} locations` });

      // Step 1: Upsert storage locations
      let locationsAdded = 0;
      const locationMap = new Map<string, string>();
      
      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
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

      setProgress({ phase: "Syncing inventory items...", current: 30, total: 100, detail: `0 / ${totalProducts} items` });

      // Step 2: Upsert items with progress
      let itemsAdded = 0;
      let itemsUpdated = 0;
      let processedItems = 0;
      
      // Collect items needing AI images
      const itemsNeedingImages: { itemId: string; productName: string; brand?: string }[] = [];
      
      for (const cat of categories) {
        const storageLocationId = locationMap.get(cat.name.toLowerCase());
        if (!storageLocationId) continue;

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
          
          const { data: existing } = await supabase
            .from("inventory_items")
            .select("id, name, unit, storage_location_id, cost_per_unit, image_url")
            .eq("location_id", locationId)
            .eq("qubeyond_item_id", product.id)
            .maybeSingle();
          
          const price = product.price ? Number(product.price) : null;
          const packQuantity = product.packQuantity ? Number(product.packQuantity) : null;
          
          // Use existing image, PFG image, or mark for AI generation
          const hasExistingImage = existing?.image_url && !existing.image_url.includes('blob.core.windows.net');
          const hasPfgImage = product.imageUrl;
          const imageUrl = hasExistingImage ? existing.image_url : (hasPfgImage || null);
          
          const itemData = {
            name: product.name,
            unit: product.unit?.toLowerCase() || "case",
            storage_location_id: storageLocationId,
            cost_per_unit: price,
            pack_size: product.packSize || null,
            pack_quantity: packQuantity,
            brand: product.brand || null,
            item_number: product.itemNumber || null,
            image_url: imageUrl,
            is_active: true
          };
          
          let itemId: string | null = null;
          
          if (existing) {
            await supabase
              .from("inventory_items")
              .update(itemData)
              .eq("id", existing.id);
            itemsUpdated++;
            itemId = existing.id;
          } else {
            const { data: inserted, error: insertError } = await supabase
              .from("inventory_items")
              .insert({
                location_id: locationId,
                qubeyond_item_id: product.id,
                display_order: itemsAdded,
                ...itemData
              })
              .select("id")
              .single();
            
            if (!insertError && inserted) {
              itemsAdded++;
              itemId = inserted.id;
            }
          }
          
          // Queue for AI image generation if no image
          if (itemId && !imageUrl) {
            itemsNeedingImages.push({
              itemId,
              productName: product.name,
              brand: product.brand
            });
          }
        }
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
                const { data, error } = await supabase.functions.invoke("generate-product-image", {
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

      setProgress({ phase: "Complete!", current: 100, total: 100 });

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
      setTimeout(() => setProgress(null), 2000);
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
            
            {/* Progress indicator */}
            {progress && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{progress.phase}</span>
                  <span className="text-muted-foreground">{progress.current}%</span>
                </div>
                <Progress value={progress.current} className="h-2" />
                {progress.detail && (
                  <p className="text-xs text-muted-foreground text-center">{progress.detail}</p>
                )}
              </div>
            )}
            
            {!progress && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                Syncs storage locations and items from your PFG product list
              </p>
            )}
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
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {item.pack_size && <span className="text-xs">{item.pack_size}</span>}
                            {item.cost_per_unit && (
                              <span className="text-xs text-primary">${item.cost_per_unit.toFixed(2)}</span>
                            )}
                          </div>
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
