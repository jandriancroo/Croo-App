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
import { MapPin, Package, Loader2, Pencil, FlaskConical, EyeOff, Eye, AlertTriangle, ArrowRightLeft, ChevronDown } from "lucide-react";
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
import PanSizesSection from "./PanSizesSection";
import type { PanSizesConfig } from "./PanSizesSection";
import ExportToMasterDialog from "./ExportToMasterDialog";
import DeployToLocationDialog from "./DeployToLocationDialog";
import BulkPanSizeDialog from "./BulkPanSizeDialog";
import { fetchRecipeCosts } from "@/utils/recipeCostCalculation";

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
  cost_per_unit: number | null;
  unit: string | null;
  pack_size: string | null;
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
  const [panSizesConfig, setPanSizesConfig] = useState<PanSizesConfig | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [linkTargetItemId, setLinkTargetItemId] = useState<string>("");
  const [showExportMaster, setShowExportMaster] = useState(false);
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showBulkPanDialog, setShowBulkPanDialog] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Get brand ID for this location
  const { data: brandInfo } = useQuery({
    queryKey: ["location-brand", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("organization_id, organizations(brand_id)")
        .eq("id", locationId)
        .single();
      if (error) throw error;
      return (data?.organizations as any)?.brand_id as string | null;
    },
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

  // Fetch hidden items
  const { data: hiddenItems } = useQuery({
    queryKey: ["inventory-items-hidden", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select(`
          *,
          storage_location:inventory_locations(name)
        `)
        .eq("location_id", locationId)
        .eq("user_hidden", true)
        .order("name");
      
      if (error) throw error;
      return data;
    }
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

  // Unhide item mutation (also clears linked_item_id and blended_price)
  const unhideItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({ user_hidden: false, is_active: true, linked_item_id: null, blended_price: null } as any)
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item restored");
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items-hidden", locationId] });
    },
    onError: () => {
      toast.error("Failed to restore item");
    }
  });

  // Update pack quantity override mutation
  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, override, category, common_name, storage_location_id, pan_sizes }: { itemId: string; override: number | null; category: string | null; common_name: string | null; storage_location_id: string | null; pan_sizes: PanSizesConfig | null }) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({ pack_quantity_override: override, category, common_name, storage_location_id, pan_sizes: pan_sizes as any } as any)
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
    setLinkTargetItemId("");
    setEditingItem({
      id: item.id,
      name: item.name,
      pack_quantity: item.pack_quantity,
      pack_quantity_override: item.pack_quantity_override,
      category: item.category,
      common_name: item.common_name || null,
      storage_location_id: item.storage_location_id || null,
      cost_per_unit: item.cost_per_unit ? Number(item.cost_per_unit) : null,
      unit: item.unit || null,
      pack_size: item.pack_size || null,
    });
    setOverrideValue(item.pack_quantity_override?.toString() || "");
    setCategoryValue(item.category || "");
    setUseCommonName(!!item.common_name);
    setCommonNameValue(item.common_name || "");
    setStorageLocationValue(item.storage_location_id || "");
    setPanSizesConfig(item.pan_sizes ? (item.pan_sizes as PanSizesConfig) : null);
  };

  const saveItem = () => {
    if (!editingItem) return;
    const override = overrideValue.trim() === "" ? null : parseInt(overrideValue);
    const category = categoryValue || null;
    const common_name = useCommonName && commonNameValue.trim() ? commonNameValue.trim() : null;
    const storage_location_id = storageLocationValue || null;
    updateItemMutation.mutate({ itemId: editingItem.id, override, category, common_name, storage_location_id, pan_sizes: panSizesConfig });
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
            .select("id, name, unit, storage_location_id, cost_per_unit, image_url, user_hidden")
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
            is_active: (existing as any)?.user_hidden ? false : true,
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

      {/* Brand Master Catalog */}
      {brandInfo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              Brand Master Catalog
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Export pan sizes & common names to the brand catalog, or deploy from it to other locations.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowExportMaster(true)}>
                Export to Master
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowDeployDialog(true)}>
                Deploy to Location
              </Button>
            </div>
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
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              Items ({items?.length || 0})
            </CardTitle>
            <div className="flex items-center gap-2">
              {selectedItemIds.size > 0 && (
                <Button size="sm" variant="default" onClick={() => setShowBulkPanDialog(true)}>
                  Pan Sizes ({selectedItemIds.size})
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { setEditRecipeId(null); setShowRecipeDialog(true); }}>
                <FlaskConical className="h-4 w-4 mr-1" />
                Recipe
              </Button>
            </div>
          </div>
          {/* Select all / clear */}
          {items && items.length > 0 && (
            <div className="flex items-center gap-3 mt-2">
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  const allNonRecipe = items.filter(i => !i.is_recipe).map(i => i.id);
                  setSelectedItemIds(new Set(allNonRecipe));
                }}
              >
                Select all
              </button>
              {selectedItemIds.size > 0 && (
                <button
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => setSelectedItemIds(new Set())}
                >
                  Clear ({selectedItemIds.size})
                </button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {items && items.length > 0 ? (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
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
                            {(item as any).countable === false && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                                Not counted
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            {item.recipe_yield_qty && item.recipe_yield_unit && (
                              <span className="text-xs">
                                yields {item.recipe_yield_qty} {item.recipe_yield_unit}
                              </span>
                            )}
                            {(() => {
                              const displayCost = item.cost_per_unit ? Number(item.cost_per_unit) : recipeCosts?.get(item.id) ?? null;
                              if (displayCost == null || displayCost <= 0) return null;
                              const yieldQty = item.recipe_yield_qty || 0;
                              const yieldUnit = item.recipe_yield_unit || "ea";
                              if (yieldQty > 1) {
                                const perUnit = displayCost / yieldQty;
                                return <span className="text-xs text-primary">${perUnit.toFixed(2)}/{yieldUnit}</span>;
                              }
                              return <span className="text-xs text-primary">${displayCost.toFixed(2)}/ea</span>;
                            })()}
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

              {/* Regular items grouped by storage location — collapsible */}
              {storageLocations?.map((loc) => {
                const locItems = items.filter(i => i.storage_location_id === loc.id && !i.is_recipe);
                if (locItems.length === 0) return null;
                const isCollapsed = collapsedSections.has(loc.id);
                const allSelected = locItems.every(i => selectedItemIds.has(i.id));
                const someSelected = locItems.some(i => selectedItemIds.has(i.id));
                const panCount = locItems.filter(i => (i as any).pan_sizes?.enabled).length;
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
                      <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={allSelected ? true : someSelected ? "indeterminate" : false}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedItemIds);
                            if (checked) {
                              locItems.forEach(i => next.add(i.id));
                            } else {
                              locItems.forEach(i => next.delete(i.id));
                            }
                            setSelectedItemIds(next);
                          }}
                          className="h-4 w-4"
                        />
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                      <span className="text-sm font-medium flex-1">{loc.name}</span>
                      <span className="text-xs text-muted-foreground">{locItems.length} items</span>
                      {panCount > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {panCount} pans
                        </Badge>
                      )}
                    </button>
                    {!isCollapsed && (
                      <div className="grid gap-0.5 p-1">
                        {locItems.map((item) => {
                          const isSelected = selectedItemIds.has(item.id);
                          return (
                            <div key={item.id} className={`flex items-center justify-between py-1.5 px-2 rounded text-sm group ${isSelected ? 'bg-primary/10' : 'bg-background hover:bg-muted/30'}`}>
                              <div className="flex items-center gap-2 truncate flex-1">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    const next = new Set(selectedItemIds);
                                    if (checked) next.add(item.id); else next.delete(item.id);
                                    setSelectedItemIds(next);
                                  }}
                                  className="h-3.5 w-3.5 flex-shrink-0"
                                />
                                <span className="truncate">{(item as any).common_name || item.name}</span>
                                {(item as any).common_name && (
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[100px]" title={item.name}>
                                    ({item.name})
                                  </span>
                                )}
                                {(item as any).pan_sizes?.enabled && (
                                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 flex-shrink-0">
                                    Pans
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
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unassigned items */}
              {(() => {
                const unassigned = items.filter(i => !i.storage_location_id && !i.is_recipe);
                if (unassigned.length === 0) return null;
                const isCollapsed = collapsedSections.has("__unassigned__");
                const allSelected = unassigned.every(i => selectedItemIds.has(i.id));
                const someSelected = unassigned.some(i => selectedItemIds.has(i.id));
                return (
                  <div className="border border-amber-500/30 rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 transition-colors text-left"
                      onClick={() => {
                        const next = new Set(collapsedSections);
                        if (isCollapsed) next.delete("__unassigned__"); else next.add("__unassigned__");
                        setCollapsedSections(next);
                      }}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={allSelected ? true : someSelected ? "indeterminate" : false}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedItemIds);
                            if (checked) {
                              unassigned.forEach(i => next.add(i.id));
                            } else {
                              unassigned.forEach(i => next.delete(i.id));
                            }
                            setSelectedItemIds(next);
                          }}
                          className="h-4 w-4"
                        />
                      </div>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                      <MapPin className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-sm font-medium flex-1">Unassigned</span>
                      <span className="text-xs text-muted-foreground">{unassigned.length} items</span>
                    </button>
                    {!isCollapsed && (
                      <div className="grid gap-0.5 p-1">
                        {unassigned.map((item) => {
                          const isSelected = selectedItemIds.has(item.id);
                          return (
                            <div key={item.id} className={`flex items-center justify-between py-1.5 px-2 rounded text-sm group ${isSelected ? 'bg-primary/10' : 'bg-background hover:bg-muted/30'}`}>
                              <div className="flex items-center gap-2 truncate flex-1">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    const next = new Set(selectedItemIds);
                                    if (checked) next.add(item.id); else next.delete(item.id);
                                    setSelectedItemIds(next);
                                  }}
                                  className="h-3.5 w-3.5 flex-shrink-0"
                                />
                                <span className="truncate">{(item as any).common_name || item.name}</span>
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
                          );
                        })}
                      </div>
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
        </CardContent>
      </Card>

      {/* Hidden / Inactive Items */}
      {hiddenItems && hiddenItems.length > 0 && (
        <Card>
          <CardHeader className="cursor-pointer py-3" onClick={() => setShowInactive(!showInactive)}>
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              <EyeOff className="h-4 w-4" />
              Hidden Items ({hiddenItems.length})
              <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${showInactive ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
          {showInactive && (
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground mb-3">
                These items are hidden from counts and won't reappear after syncing. Tap restore to bring them back.
              </p>
              <div className="grid gap-1 max-h-[300px] overflow-y-auto">
                {hiddenItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-1.5 px-2 bg-muted/30 rounded text-sm">
                    <div className="flex items-center gap-2 truncate flex-1">
                      <EyeOff className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="truncate text-muted-foreground">{(item as any).common_name || item.name}</span>
                      {item.vendor_source && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                          {item.vendor_source === 'produce_alliance' ? 'PA' : item.vendor_source === 'pfg' ? 'PFG' : item.vendor_source}
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2 text-primary"
                      onClick={() => unhideItemMutation.mutate(item.id)}
                      disabled={unhideItemMutation.isPending}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>

      {/* Edit Item Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
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

              {/* Pan Sizes */}
              <PanSizesSection
                value={panSizesConfig}
                onChange={setPanSizesConfig}
                costPerUnit={editingItem.cost_per_unit ? Number(editingItem.cost_per_unit) : null}
                unitLabel={editingItem.unit || 'case'}
                packSize={editingItem.pack_size || null}
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

              {/* Show linked hidden items (reverse lookup) */}
              {hiddenItems && hiddenItems.filter(h => (h as any).linked_item_id === editingItem?.id).length > 0 && (
                <div className="space-y-1 border-t pt-3">
                  <Label className="text-xs font-medium">Linked Hidden Items</Label>
                  <div className="space-y-1">
                    {hiddenItems.filter(h => (h as any).linked_item_id === editingItem?.id).map(h => (
                      <div key={h.id} className="flex items-center gap-2 text-sm bg-muted/50 rounded px-2 py-1.5">
                        <EyeOff className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{(h as any).common_name || h.name}</span>
                        {h.cost_per_unit && (
                          <span className="text-xs text-primary ml-auto">${Number(h.cost_per_unit).toFixed(2)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Prices from these items are blended into this item on sync.
                  </p>
                </div>
              )}

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
                      <option key={i.id} value={i.id}>{(i as any).common_name || i.name}</option>
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

      {/* Brand Master Catalog Dialogs */}
      {brandInfo && (
        <>
          <ExportToMasterDialog
            open={showExportMaster}
            onOpenChange={setShowExportMaster}
            locationId={locationId}
            brandId={brandInfo}
          />
          <DeployToLocationDialog
            open={showDeployDialog}
            onOpenChange={setShowDeployDialog}
            brandId={brandInfo}
            sourceLocationId={locationId}
          />
        </>
      )}

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
    </>
  );
};

export default InventoryItemsManager;
