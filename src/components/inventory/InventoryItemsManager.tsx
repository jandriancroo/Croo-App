import { useState, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RefreshCw, MapPin, Package, Loader2, Pencil, FileSpreadsheet, Upload, CheckCircle2, ChevronDown, Link2 } from "lucide-react";
import { toast } from "sonner";
import InventoryScheduleSettings from "./InventoryScheduleSettings";
import { BOMMatchingManager } from "./BOMMatchingManager";
import { BOMMenuItemMatcher } from "./BOMMenuItemMatcher";

interface InventoryItemsManagerProps {
  locationId: string;
}

interface EditingItem {
  id: string;
  name: string;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
}

interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}

interface BOMImportStats {
  totalRows: number;
  uniqueIngredients: number;
  uniqueMenuItems: number;
  recipeMappings: number;
  ingredientCategories: Record<string, number>;
  menuCategories: Record<string, number>;
}

const InventoryItemsManager = ({ locationId }: InventoryItemsManagerProps) => {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  
  // BOM import state
  const [isImportingBOM, setIsImportingBOM] = useState(false);
  const [bomStats, setBomStats] = useState<BOMImportStats | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Fetch BOM stats
  const { data: bomData } = useQuery({
    queryKey: ["bom-stats", locationId],
    queryFn: async () => {
      const [ingredientsRes, menuItemsRes, recipesRes] = await Promise.all([
        supabase
          .from("bom_ingredients")
          .select("id, category", { count: "exact" })
          .eq("location_id", locationId),
        supabase
          .from("bom_menu_items")
          .select("id, is_sellable", { count: "exact" })
          .eq("location_id", locationId),
        supabase
          .from("bom_recipe_ingredients")
          .select("id", { count: "exact" })
          .eq("location_id", locationId)
      ]);
      
      const sellableCount = menuItemsRes.data?.filter(m => m.is_sellable).length || 0;
      
      return {
        ingredientsCount: ingredientsRes.count || 0,
        menuItemsCount: menuItemsRes.count || 0,
        sellableItemsCount: sellableCount,
        recipeMappingsCount: recipesRes.count || 0
      };
    }
  });

  // Update pack quantity override mutation
  const updateOverrideMutation = useMutation({
    mutationFn: async ({ itemId, override }: { itemId: string; override: number | null }) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({ pack_quantity_override: override })
        .eq("id", itemId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pack quantity override saved");
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      setEditingItem(null);
    },
    onError: () => {
      toast.error("Failed to save override");
    }
  });

  const openEditDialog = (item: any) => {
    setEditingItem({
      id: item.id,
      name: item.name,
      pack_quantity: item.pack_quantity,
      pack_quantity_override: item.pack_quantity_override
    });
    setOverrideValue(item.pack_quantity_override?.toString() || "");
  };

  const saveOverride = () => {
    if (!editingItem) return;
    const value = overrideValue.trim() === "" ? null : parseInt(overrideValue);
    updateOverrideMutation.mutate({ itemId: editingItem.id, override: value });
  };

  // Handle BOM CSV file selection
  const handleBOMFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingBOM(true);
    setBomStats(null);

    try {
      const content = await file.text();
      
      const { data, error } = await supabase.functions.invoke("data-sync-service?action=import-bom", {
        body: { csvContent: content, locationId }
      });

      if (error) throw error;
      
      if (data?.success) {
        setBomStats(data.stats);
        queryClient.invalidateQueries({ queryKey: ["bom-stats", locationId] });
        toast.success(`BOM imported: ${data.stats.uniqueIngredients} ingredients, ${data.stats.uniqueMenuItems} menu items`);
      } else {
        throw new Error(data?.error || "Import failed");
      }
    } catch (err: any) {
      console.error("BOM import error:", err);
      toast.error(err.message || "Failed to import BOM");
    } finally {
      setIsImportingBOM(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

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
          
          // Use existing image if present, otherwise use PFG image, otherwise leave null for AI generation
          // Only generate AI images for items with NO image at all
          const hasExistingImage = existing?.image_url;
          const hasPfgImage = product.imageUrl;
          const imageUrl = hasExistingImage || hasPfgImage || null;
          const needsAiImage = !hasExistingImage && !hasPfgImage;
          
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
    <>
    <div className="space-y-6">
      {/* Schedule Settings */}
      <InventoryScheduleSettings locationId={locationId} />

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

      {/* BOM Import */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Bill of Materials (BOM)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current BOM stats */}
          {bomData && bomData.ingredientsCount > 0 && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                {bomData.ingredientsCount} Ingredients
              </Badge>
              <Badge variant="secondary">
                {bomData.menuItemsCount} Recipes
              </Badge>
              <Badge variant="secondary">
                {bomData.sellableItemsCount} Sellable Items
              </Badge>
              <Badge variant="secondary">
                {bomData.recipeMappingsCount} Mappings
              </Badge>
            </div>
          )}

          {/* Import result stats */}
          {bomStats && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm space-y-2">
              <p className="font-medium text-green-600 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Import Complete
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>Ingredients: <span className="font-medium">{bomStats.uniqueIngredients}</span></div>
                <div>Menu Items: <span className="font-medium">{bomStats.uniqueMenuItems}</span></div>
                <div>Mappings: <span className="font-medium">{bomStats.recipeMappings}</span></div>
                <div>CSV Rows: <span className="font-medium">{bomStats.totalRows}</span></div>
              </div>
            </div>
          )}

          {/* Upload button */}
          <div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              onChange={handleBOMFileSelect}
              className="hidden"
            />
            <Button 
              variant="outline"
              className="w-full" 
              onClick={() => fileInputRef.current?.click()}
              disabled={isImportingBOM}
            >
              {isImportingBOM ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {bomData && bomData.ingredientsCount > 0 ? "Re-import BOM CSV" : "Import BOM CSV"}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Import R365 ingredient/recipe CSV to calculate theoretical usage
            </p>
          </div>

          {/* BOM Matching - collapsible */}
          {bomData && bomData.ingredientsCount > 0 && (
            <>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between">
                    <span className="flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      Link BOM to Inventory Items
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <BOMMatchingManager locationId={locationId} />
                </CollapsibleContent>
              </Collapsible>
              
              {/* Link Menu Items to QU */}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between">
                    <span className="flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      Link Menu Items to QU Products
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <BOMMenuItemMatcher locationId={locationId} />
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </CardContent>
      </Card>

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
                        <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-muted/50 rounded text-sm group">
                          <span className="truncate flex-1">{item.name}</span>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {item.pack_quantity_override && (
                              <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                                {item.pack_quantity_override}/case
                              </span>
                            )}
                            {item.pack_size && <span className="text-xs">{item.pack_size}</span>}
                            {item.cost_per_unit && (
                              <span className="text-xs text-primary">${item.cost_per_unit.toFixed(2)}</span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => openEditDialog(item)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
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

      {/* Edit Item Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Pack Quantity</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-4">
              <p className="text-sm font-medium">{editingItem.name}</p>
              
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
                    Leave empty to use PFG value. Set this if PFG's pack size doesn't match the smallest unit you count.
                  </p>
                </div>
              </div>
              
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
                  onClick={saveOverride}
                  disabled={updateOverrideMutation.isPending}
                >
                  {updateOverrideMutation.isPending ? (
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
    </>
  );
};

export default InventoryItemsManager;
