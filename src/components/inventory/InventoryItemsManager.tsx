import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MapPin, Package, Loader2, Pencil, FlaskConical, EyeOff, AlertTriangle, ArrowRightLeft } from "lucide-react";
import pfgLogo from "@/assets/pfg-logo.png";
import paLogo from "@/assets/pa-logo.png";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import InventoryScheduleSettings from "./InventoryScheduleSettings";
import ProductGroupsManager from "./ProductGroupsManager";
import UsageRateMapping from "./UsageRateMapping";
import RecipeBuilderDialog from "./RecipeBuilderDialog";
import RemapItemDialog from "./RemapItemDialog";

interface InventoryItemsManagerProps {
  locationId: string;
}

interface EditingItem {
  id: string;
  name: string;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  category: string | null;
  common_name: string | null;
  storage_location_id: string | null;
}

const INVENTORY_CATEGORIES = [
  "Dough", "Sauce", "Cheese", "Meat", "Veggie", "Dry Goods", "Beverages", "Paper Goods", "Cleaning", "Other"
];

interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}


const InventoryItemsManager = ({ locationId }: InventoryItemsManagerProps) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPaSyncing, setIsPaSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [paProgress, setPaProgress] = useState<SyncProgress | null>(null);
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [overrideValue, setOverrideValue] = useState("");
  const [showRecipeDialog, setShowRecipeDialog] = useState(false);
  const [editRecipeId, setEditRecipeId] = useState<string | null>(null);
  const [categoryValue, setCategoryValue] = useState<string>("");
  const [useCommonName, setUseCommonName] = useState(false);
  const [commonNameValue, setCommonNameValue] = useState("");
  const [storageLocationValue, setStorageLocationValue] = useState<string>("");
  const [remapItem, setRemapItem] = useState<any>(null);
  

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


  // Deactivate item mutation
  const deactivateItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({ is_active: false })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item deactivated");
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      setEditingItem(null);
    },
    onError: () => {
      toast.error("Failed to deactivate item");
    }
  });

  // Update pack quantity override mutation
  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, override, category, common_name, storage_location_id }: { itemId: string; override: number | null; category: string | null; common_name: string | null; storage_location_id: string | null }) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({ pack_quantity_override: override, category, common_name, storage_location_id } as any)
        .eq("id", itemId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item updated");
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      setEditingItem(null);
    },
    onError: () => {
      toast.error("Failed to save");
    }
  });

  const openEditDialog = (item: any) => {
    setEditingItem({
      id: item.id,
      name: item.name,
      pack_quantity: item.pack_quantity,
      pack_quantity_override: item.pack_quantity_override,
      category: item.category,
      common_name: item.common_name || null,
      storage_location_id: item.storage_location_id || null
    });
    setOverrideValue(item.pack_quantity_override?.toString() || "");
    setCategoryValue(item.category || "");
    setUseCommonName(!!item.common_name);
    setCommonNameValue(item.common_name || "");
    setStorageLocationValue(item.storage_location_id || "");
  };

  const saveItem = () => {
    if (!editingItem) return;
    const override = overrideValue.trim() === "" ? null : parseInt(overrideValue);
    const category = categoryValue || null;
    const common_name = useCommonName && commonNameValue.trim() ? commonNameValue.trim() : null;
    const storage_location_id = storageLocationValue || null;
    updateItemMutation.mutate({ itemId: editingItem.id, override, category, common_name, storage_location_id });
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
          
          // Use existing image if present, otherwise use PFG image, 
          // otherwise check cross-location for same item_number, otherwise leave null for AI generation
          const hasExistingImage = existing?.image_url;
          const hasPfgImage = product.imageUrl;
          let imageUrl = hasExistingImage || hasPfgImage || null;
          let needsAiImage = !imageUrl;
          
          // Check if another location already has an AI-generated image for this item
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
            is_active: true,
            last_synced_at: new Date().toISOString()
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
        if (item.qubeyond_item_id && !syncedProductIds.has(String(item.qubeyond_item_id)) && (item as any).remap_status !== 'needs_remap') {
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
        items_synced: itemsAdded + itemsUpdated,
        orders_processed: 0,
        triggered_by: (await supabase.auth.getUser()).data.user?.id || null,
      });

      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["last-pfg-sync", locationId] });

      // Also sync PFG orders in background (for COGS)
      supabase.functions.invoke("pfg-service?action=sync_orders", {
        body: { locationId }
      }).catch(console.warn);
      
      const messages = [];
      if (locationsAdded > 0) messages.push(`${locationsAdded} locations`);
      if (itemsAdded > 0) messages.push(`${itemsAdded} items`);
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

      const itemCount = data?.itemsSynced || data?.items_synced || 0;
      if (itemCount > 0) {
        toast.success(`Synced ${itemCount} items from Produce Alliance`);
      } else {
        toast.info("Already in sync with Produce Alliance");
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
      {/* Schedule Settings */}
      <InventoryScheduleSettings locationId={locationId} />

      {/* Sync Buttons - side by side */}
      {(pfgIntegration || paIntegration) && (
        <div className="grid grid-cols-2 gap-3">
          {pfgIntegration && (
            <Card>
              <CardContent className="pt-4 pb-4">
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
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground truncate">{progress.phase}</p>
                    <Progress value={progress.current} className="h-1.5" />
                  </div>
                )}
                {!progress && lastPfgSync?.completed_at && (
                  <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                    Last synced {formatSyncTime(lastPfgSync.completed_at)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {paIntegration && (
            <Card>
              <CardContent className="pt-4 pb-4">
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
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-muted-foreground truncate">{paProgress.phase}</p>
                    <Progress value={paProgress.current} className="h-1.5" />
                  </div>
                )}
                {!paProgress && lastPaSync?.completed_at && (
                  <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                    Last synced {formatSyncTime(lastPaSync.completed_at)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Product Groups */}
      <ProductGroupsManager locationId={locationId} />

      {/* Usage Rate Mappings */}
      <UsageRateMapping locationId={locationId} />

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
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              Items ({items?.length || 0})
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => { setEditRecipeId(null); setShowRecipeDialog(true); }}>
              <FlaskConical className="h-4 w-4 mr-1" />
              Create Recipe
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {items && items.length > 0 ? (
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {/* Items needing remap */}
              {(() => {
                const remapItems = items.filter(i => (i as any).remap_status === 'needs_remap' && !i.is_recipe);
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
                            <span className="truncate">{(item as any).common_name || item.name}</span>
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
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
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
              })()}

              {/* Recipe items */}
              {(() => {
                const recipeItems = items.filter(i => i.is_recipe);
                if (recipeItems.length === 0) return null;
                return (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                      <FlaskConical className="h-3.5 w-3.5" />
                      Prep Recipes
                    </h4>
                    <div className="grid gap-1">
                      {recipeItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-muted/50 rounded text-sm group">
                          <div className="flex items-center gap-2 truncate flex-1">
                            <span className="truncate">{item.name}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                              <FlaskConical className="h-2.5 w-2.5 mr-0.5" />
                              Recipe
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {item.recipe_yield_qty && item.recipe_yield_unit && (
                              <span className="text-xs">
                                yields {item.recipe_yield_qty} {item.recipe_yield_unit}
                              </span>
                            )}
                            {item.cost_per_unit && (
                              <span className="text-xs text-primary">${Number(item.cost_per_unit).toFixed(2)}/batch</span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => { setEditRecipeId(item.id); setShowRecipeDialog(true); }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Regular items grouped by storage location */}
              {storageLocations?.map((loc) => {
                const locItems = items.filter(i => i.storage_location_id === loc.id && !i.is_recipe);
                if (locItems.length === 0) return null;
                return (
                  <div key={loc.id}>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">{loc.name}</h4>
                    <div className="grid gap-1">
                      {locItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-muted/50 rounded text-sm group">
                          <div className="flex items-center gap-2 truncate flex-1">
                            <span className="truncate">{(item as any).common_name || item.name}</span>
                            {(item as any).common_name && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={item.name}>
                                ({item.name})
                              </span>
                            )}
                            {(item as any).remap_status === 'needs_remap' && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                                Remap
                              </Badge>
                            )}
                            {item.category && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                                {item.category}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {item.pack_quantity_override && (
                              <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                                {item.pack_quantity_override}/case
                              </span>
                            )}
                            <span className="text-xs">{item.pack_size || item.unit || 'ea'}</span>
                            {item.cost_per_unit && (
                              <span className="text-xs text-primary">${Number(item.cost_per_unit).toFixed(2)}</span>
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

              {/* Unassigned items (no storage location) */}
              {(() => {
                const unassigned = items.filter(i => !i.storage_location_id && !i.is_recipe);
                if (unassigned.length === 0) return null;
                return (
                  <div>
                    <h4 className="text-sm font-medium text-amber-500 mb-2 flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      Unassigned ({unassigned.length})
                    </h4>
                    <div className="grid gap-1">
                      {unassigned.map((item) => (
                        <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-amber-500/10 border border-amber-500/20 rounded text-sm group">
                          <div className="flex items-center gap-2 truncate flex-1">
                            <span className="truncate">{(item as any).common_name || item.name}</span>
                            {(item as any).common_name && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={item.name}>
                                ({item.name})
                              </span>
                            )}
                            {item.vendor_source && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                                {item.vendor_source === 'produce_alliance' ? 'PA' : item.vendor_source}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="text-xs">{item.pack_size || item.unit || 'ea'}</span>
                            {item.cost_per_unit && (
                              <span className="text-xs text-primary">${Number(item.cost_per_unit).toFixed(2)}</span>
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
              })()}
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
            <DialogTitle className="text-base">Edit Item</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-4">
              <p className="text-sm font-medium">{editingItem.name}</p>

              {/* Storage Location selector */}
              <div className="space-y-1">
                <Label htmlFor="storage-location">Storage Location</Label>
                <select
                  id="storage-location"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={storageLocationValue}
                  onChange={(e) => setStorageLocationValue(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {storageLocations?.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Which storage area this item belongs to
                </p>
              </div>

              {/* Category selector */}
              <div className="space-y-1">
                <Label htmlFor="category">Category</Label>
                <select
                  id="category"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={categoryValue}
                  onChange={(e) => setCategoryValue(e.target.value)}
                >
                  <option value="">No category</option>
                  {INVENTORY_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Used to group items in variance reports
                </p>
              </div>

              {/* Common Name */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="use-common-name"
                    checked={useCommonName}
                    onCheckedChange={(checked) => {
                      setUseCommonName(!!checked);
                      if (!checked) setCommonNameValue("");
                    }}
                  />
                  <Label htmlFor="use-common-name" className="text-sm cursor-pointer">
                    Use common name
                  </Label>
                </div>
                {useCommonName && (
                  <div className="space-y-1">
                    <Input
                      id="common-name"
                      placeholder="e.g., Sausage, Mozzarella, Pepperoni"
                      value={commonNameValue}
                      onChange={(e) => setCommonNameValue(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      A simple name shown instead of the vendor item name
                    </p>
                  </div>
                )}
              </div>

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
                onClick={() => editingItem && deactivateItemMutation.mutate(editingItem.id)}
                disabled={deactivateItemMutation.isPending}
              >
                <EyeOff className="h-4 w-4 mr-1" />
                {deactivateItemMutation.isPending ? "Deactivating..." : "Deactivate Item"}
              </Button>

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

      {/* Recipe Builder Dialog */}
      <RecipeBuilderDialog
        open={showRecipeDialog}
        onOpenChange={setShowRecipeDialog}
        locationId={locationId}
        editRecipeId={editRecipeId}
      />

      {/* Remap Item Dialog */}
      <RemapItemDialog
        open={!!remapItem}
        onOpenChange={(open) => !open && setRemapItem(null)}
        item={remapItem}
        locationId={locationId}
        bidGuideHeaderId={(pfgIntegration?.credentials as any)?.bid_guide_header_id || ""}
        customerId={(pfgIntegration?.credentials as any)?.customer_id || ""}
      />
    </>
  );
};

export default InventoryItemsManager;
