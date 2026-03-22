/**
 * ExportToMasterDialog — exports current location's configured items
 * (with pan sizes, common names, storage locations, usage rates, POS mappings, categories)
 * to brand-level master templates.
 * Stores weight-based conversions so they adapt to different pack sizes at other locations.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";

interface ExportToMasterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  brandId: string;
}

/** Parse per-unit weight from pack_size strings like "6/5 LB", "4/3#", "2#" */
function parsePerUnitWeight(packSize: string | null): number | null {
  if (!packSize) return null;
  const s = packSize.trim().toUpperCase();
  const multiMatch = s.match(/^(\d+)\s*\/\s*([\d.]+)\s*(LB|#|KG|OZ)?/);
  if (multiMatch) {
    const weight = parseFloat(multiMatch[2]);
    if (!isNaN(weight) && weight > 0) return weight;
  }
  const singleMatch = s.match(/^([\d.]+)\s*(#|LB|KG|OZ)$/);
  if (singleMatch) {
    const weight = parseFloat(singleMatch[1]);
    if (!isNaN(weight) && weight > 0) return weight;
  }
  return null;
}

/** Determine if item is weight-based from pack_size */
function isWeightBased(packSize: string | null): boolean {
  if (!packSize) return false;
  const s = packSize.toUpperCase();
  return s.includes('LB') || s.includes('#') || s.includes('KG') || s.includes('OZ');
}

/** Generate match keywords from item name, common name, item number, and brand */
function generateKeywords(name: string, commonName: string | null, itemNumber: string | null, brand: string | null): string[] {
  const words = new Set<string>();
  const addWords = (s: string) => {
    s.toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2)
      .filter(w => !["pack", "case", "cut", "bulk", "baby", "flat", "leaf"].includes(w))
      .forEach(w => words.add(w));
  };
  addWords(name);
  if (commonName) addWords(commonName);
  if (brand) addWords(brand);
  if (itemNumber) {
    const cleanNum = itemNumber.trim().toLowerCase();
    if (cleanNum.length > 0) words.add(cleanNum);
  }
  return Array.from(words);
}

interface ItemForExport {
  id: string;
  name: string;
  common_name: string | null;
  pack_size: string | null;
  pack_quantity: number | null;
  pan_sizes: any;
  category: string | null;
  vendor_source: string | null;
  item_number: string | null;
  pa_item_id: string | null;
  brand: string | null;
  storage_location_id: string | null;
  is_recipe: boolean;
  recipe_yield_qty: number | null;
  recipe_yield_unit: string | null;
}

export default function ExportToMasterDialog({ open, onOpenChange, locationId, brandId }: ExportToMasterDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch all active items (not just pan-configured ones anymore)
  const { data: items, isLoading } = useQuery({
    queryKey: ["export-master-items", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, common_name, pack_size, pack_quantity, pan_sizes, category, vendor_source, item_number, pa_item_id, brand, storage_location_id, is_recipe, recipe_yield_qty, recipe_yield_unit")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as ItemForExport[];
    },
    enabled: open,
  });

  // Fetch shortcut assignments for all items at this location
  const { data: itemShortcuts } = useQuery({
    queryKey: ["export-shortcuts", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_item_locations" as any)
        .select("item_id, storage_location_id")
        .eq("location_id", locationId);
      if (error) throw error;
      return (data || []) as unknown as { item_id: string; storage_location_id: string }[];
    },
    enabled: open,
  });

  // Fetch storage locations to resolve names
  const { data: storageLocations } = useQuery({
    queryKey: ["storage-locations-export", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("id, name")
        .eq("location_id", locationId);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Usage rates removed — recipes are now the source of truth

  // Fetch product groups for this location
  const { data: productGroups } = useQuery({
    queryKey: ["product-groups-export", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_product_groups")
        .select("id, name, pos_categories, pos_items")
        .eq("location_id", locationId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch recipe ingredients for recipe items at this location
  const { data: recipeIngredients } = useQuery({
    queryKey: ["recipe-ingredients-export", locationId],
    queryFn: async () => {
      // Only fetch recipe ingredients for items at this location
      const recipeItemIds = items?.filter(i => i.is_recipe).map(i => i.id) || [];
      if (recipeItemIds.length === 0) return [];
      const { data, error } = await supabase
        .from("inventory_recipe_ingredients")
        .select("recipe_item_id, ingredient_item_id, quantity, unit")
        .in("recipe_item_id", recipeItemIds);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch existing templates
  const { data: existingTemplates } = useQuery({
    queryKey: ["brand-templates", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_inventory_templates")
        .select("id, product_name, source_item_id")
        .eq("brand_id", brandId);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const existingSourceIds = new Set(existingTemplates?.map(t => t.source_item_id).filter(Boolean) ?? []);
  const storageMap = new Map(storageLocations?.map(l => [l.id, l.name]) ?? []);
  // Usage rate multi-map removed — recipes are source of truth
  const groupMap = new Map(productGroups?.map(g => [g.id, g]) ?? []);

  // Build shortcut map: item_id → array of storage location names (excluding primary)
  const shortcutMap = new Map<string, string[]>();
  if (itemShortcuts && storageLocations) {
    for (const s of itemShortcuts) {
      const locName = storageMap.get(s.storage_location_id);
      if (locName) {
        const existing = shortcutMap.get(s.item_id) || [];
        existing.push(locName);
        shortcutMap.set(s.item_id, existing);
      }
    }
  }

  const exportMutation = useMutation({
    mutationFn: async (itemIds: string[]) => {
      if (!items || !user) throw new Error("Missing data");

      const templates = itemIds.map(id => {
        const item = items.find(i => i.id === id)!;
        const panCfg = item.pan_sizes as any;
        const perUnitWeight = parsePerUnitWeight(item.pack_size);
        const weightBased = isWeightBased(item.pack_size);
        const packQty = item.pack_quantity || 1;
        const productName = item.common_name || item.name;
        const keywords = generateKeywords(item.name, item.common_name, item.item_number, item.brand);

        // Pan size calculations (only if configured)
        let panUnitsPerLb: number | null = null;
        let panUnitsPerUnit: number | null = null;
        let panBaselineKey: string = 'full';
        let panEnabledKeys: string[] = [];
        let panOverrides: any = null;

        if (panCfg?.enabled) {
          panBaselineKey = panCfg.baseline_key || 'full';
          panEnabledKeys = panCfg.enabled_keys || [];
          panOverrides = panCfg.overrides || null;
          const perUnit = (panCfg.baseline_units || 0) * packQty;
          if (weightBased && perUnitWeight && perUnitWeight > 0) {
            panUnitsPerLb = perUnit / perUnitWeight;
          } else {
            panUnitsPerUnit = perUnit;
          }
        }

        // Storage location name
        const storageLocationName = item.storage_location_id
          ? storageMap.get(item.storage_location_id) || null
          : null;

         // Usage rate mappings removed — recipes are source of truth

        // Shortcut locations (secondary storage)
        const shortcutLocationNames = shortcutMap.get(item.id) || [];

        // Recipe data
        const recipeIngredientsData = item.is_recipe && recipeIngredients
          ? recipeIngredients
              .filter(ri => ri.recipe_item_id === item.id)
              .map(ri => {
                const ingItem = items.find(i => i.id === ri.ingredient_item_id);
                return {
                  ingredient_name: ingItem ? (ingItem.common_name || ingItem.name) : 'Unknown',
                  ingredient_item_number: ingItem?.item_number || null,
                  ingredient_pa_item_id: ingItem?.pa_item_id || null,
                  ingredient_vendor_source: ingItem?.vendor_source || null,
                  quantity: ri.quantity,
                  unit: ri.unit,
                };
              })
          : [];

        return {
          brand_id: brandId,
          product_name: productName,
          common_name: item.common_name,
          category: item.category,
          pan_baseline_key: panBaselineKey,
          pan_units_per_lb: panUnitsPerLb,
          pan_units_per_unit: weightBased ? null : panUnitsPerUnit,
          pan_enabled_keys: panEnabledKeys,
          pan_overrides: panOverrides,
          is_weight_based: weightBased,
          match_keywords: keywords,
          storage_location_name: storageLocationName,
          shortcut_location_names: shortcutLocationNames,
          // Usage rates removed — recipes are source of truth
          usage_rate: null,
          usage_rate_unit: null,
          usage_rate_manual_override: false,
          product_group_name: null,
          product_group_pos_categories: null,
          product_group_pos_items: null,
          usage_rate_mappings: [],
          source_item_id: item.id,
          source_location_id: locationId,
          created_by: user.id,
          is_recipe: item.is_recipe || false,
          recipe_yield_qty: item.recipe_yield_qty,
          recipe_yield_unit: item.recipe_yield_unit,
          recipe_ingredients: recipeIngredientsData,
          vendor_source: item.vendor_source,
          item_number: item.item_number,
          pa_item_id: item.pa_item_id,
        };
      });

      // Deduplicate by product_name
      const deduped = new Map<string, typeof templates[0]>();
      for (const t of templates) {
        deduped.set(t.product_name, t);
      }
      const uniqueTemplates = Array.from(deduped.values());

      const { error } = await supabase
        .from("brand_inventory_templates")
        .upsert(uniqueTemplates as any, { onConflict: "brand_id,product_name" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Exported to master catalog");
      queryClient.invalidateQueries({ queryKey: ["brand-templates"] });
      queryClient.invalidateQueries({ queryKey: ["export-master-items"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error("Export failed: " + err.message);
    },
  });

  const toggleAll = () => {
    if (!items) return;
    const unexported = items.filter(i => !existingSourceIds.has(i.id));
    if (selectedIds.size === unexported.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unexported.map(i => i.id)));
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  /** Count how many data points an item has configured */
  const getFeatureBadges = (item: ItemForExport) => {
    const badges: string[] = [];
    if (item.pan_sizes?.enabled) badges.push("Pan Sizes");
    if (item.common_name) badges.push("Common Name");
    if (item.category) badges.push("Category");
    if (item.storage_location_id && storageMap.has(item.storage_location_id)) badges.push("Storage");
    const shortcuts = shortcutMap.get(item.id);
    if (shortcuts && shortcuts.length > 0) badges.push(`${shortcuts.length} Shortcut${shortcuts.length > 1 ? 's' : ''}`);
    const itemRates = usageMultiMap.get(item.id);
    if (itemRates?.length) badges.push(`${itemRates.length} Rate${itemRates.length > 1 ? 's' : ''}`);
    const hasGroup = itemRates?.some(r => r.product_group_id && groupMap.has(r.product_group_id));
    if (hasGroup) badges.push("POS Mapping");
    return badges;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Export to Master Catalog
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Export items with their full configuration (pan sizes, common names, storage locations, 
          usage rates, POS mappings, categories) to the brand-level master catalog.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !items?.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No active items found.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between py-1">
              <button onClick={toggleAll} className="text-xs text-primary font-medium">
                {selectedIds.size === items.filter(i => !existingSourceIds.has(i.id)).length ? "Deselect All" : "Select All New"}
              </button>
              <span className="text-xs text-muted-foreground">
                {items.length} items total
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
              {items.map(item => {
                const alreadyExported = existingSourceIds.has(item.id);
                const badges = getFeatureBadges(item);

                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-md border transition-colors ${
                      alreadyExported 
                        ? "border-border/50 bg-muted/30 opacity-60" 
                        : selectedIds.has(item.id) 
                          ? "border-primary/40 bg-primary/5" 
                          : "border-border"
                    }`}
                    onClick={() => !alreadyExported && toggle(item.id)}
                  >
                    <Checkbox
                      checked={alreadyExported || selectedIds.has(item.id)}
                      disabled={alreadyExported}
                      className="h-3.5 w-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {item.common_name || item.name}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {badges.map(b => (
                          <Badge key={b} variant="secondary" className="text-[9px] px-1 py-0 h-3.5">
                            {b}
                          </Badge>
                        ))}
                        {badges.length === 0 && (
                          <span className="text-[9px] text-muted-foreground">No config</span>
                        )}
                        {alreadyExported && (
                          <span className="flex items-center gap-0.5">
                            <CheckCircle2 className="h-2.5 w-2.5 text-green-500" />
                            <span className="text-[9px] text-green-600">exported</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              onClick={() => exportMutation.mutate(Array.from(selectedIds))}
              disabled={selectedIds.size === 0 || exportMutation.isPending}
              className="w-full"
            >
              {exportMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Export {selectedIds.size} Item{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
