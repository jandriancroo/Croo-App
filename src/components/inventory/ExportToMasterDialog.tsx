/**
 * ExportToMasterDialog — exports current location's configured items
 * (with pan sizes + common names) to brand-level master templates.
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
import { Loader2, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";

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

  // Pattern: "6/5 LB" or "6/5LB" or "4/3#" → multi-unit packs
  const multiMatch = s.match(/^(\d+)\s*\/\s*([\d.]+)\s*(LB|#|KG|OZ)?/);
  if (multiMatch) {
    const weight = parseFloat(multiMatch[2]);
    if (!isNaN(weight) && weight > 0) return weight;
  }

  // Pattern: "2#" or "5 LB" → single unit by weight
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
  brand: string | null;
}

export default function ExportToMasterDialog({ open, onOpenChange, locationId, brandId }: ExportToMasterDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch items with pan_sizes configured
  const { data: items, isLoading } = useQuery({
    queryKey: ["export-master-items", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, common_name, pack_size, pack_quantity, pan_sizes, category, vendor_source, item_number, brand")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .not("pan_sizes", "is", null)
        .order("name");
      if (error) throw error;
      return (data as ItemForExport[]).filter(i => i.pan_sizes?.enabled);
    },
    enabled: open,
  });

  // Fetch existing templates to show which are already exported
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

  const exportMutation = useMutation({
    mutationFn: async (itemIds: string[]) => {
      if (!items || !user) throw new Error("Missing data");

      const templates = itemIds.map(id => {
        const item = items.find(i => i.id === id)!;
        const panCfg = item.pan_sizes as any;
        const perUnitWeight = parsePerUnitWeight(item.pack_size);
        const weightBased = isWeightBased(item.pack_size);
        const packQty = item.pack_quantity || 1;

        // Calculate pan_units_per_lb or pan_units_per_unit
        // panCfg.baseline_units = fraction of case that fills baseline pan
        // Per unit (bag): baseline_units * pack_quantity
        // Per lb: (baseline_units * pack_quantity) / weight_per_unit
        const perUnit = panCfg.baseline_units * packQty;

        let panUnitsPerLb: number | null = null;
        let panUnitsPerUnit: number | null = null;

        if (weightBased && perUnitWeight && perUnitWeight > 0) {
          panUnitsPerLb = perUnit / perUnitWeight;
        } else {
          panUnitsPerUnit = perUnit;
        }

        const productName = item.common_name || item.name;
        const keywords = generateKeywords(item.name, item.common_name, item.item_number, item.brand);

        return {
          brand_id: brandId,
          product_name: productName,
          common_name: item.common_name,
          pan_baseline_key: panCfg.baseline_key,
          pan_units_per_lb: panUnitsPerLb,
          pan_enabled_keys: panCfg.enabled_keys,
          is_weight_based: weightBased,
          pan_units_per_unit: weightBased ? null : panUnitsPerUnit,
          match_keywords: keywords,
          category: item.category,
          source_item_id: item.id,
          source_location_id: locationId,
          created_by: user.id,
        };
      });

      const { error } = await supabase
        .from("brand_inventory_templates")
        .upsert(templates, { onConflict: "brand_id,product_name" });
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
          Export configured items to the brand-level master catalog. 
          These can then be deployed to other locations with auto-adjusted conversions.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !items?.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No items with pan sizes configured yet.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between py-1">
              <button onClick={toggleAll} className="text-xs text-primary font-medium">
                {selectedIds.size === items.filter(i => !existingSourceIds.has(i.id)).length ? "Deselect All" : "Select All New"}
              </button>
              <span className="text-xs text-muted-foreground">
                {items.length} items configured
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
              {items.map(item => {
                const alreadyExported = existingSourceIds.has(item.id);
                const perUnitWeight = parsePerUnitWeight(item.pack_size);
                const weightBased = isWeightBased(item.pack_size);

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
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {item.category && (
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">
                            {item.category}
                          </Badge>
                        )}
                        {weightBased ? (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                            {perUnitWeight ? `${perUnitWeight} lb/unit` : "weight"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">count-based</Badge>
                        )}
                        {!weightBased && (
                          <span className="flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
                            <span className="text-[9px] text-amber-600">manual review at deploy</span>
                          </span>
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
  
  // Add item number as-is (exact match identifier, e.g. PFG item codes)
  if (itemNumber) {
    const cleanNum = itemNumber.trim().toLowerCase();
    if (cleanNum.length > 0) words.add(cleanNum);
  }
  
  return Array.from(words);
}
