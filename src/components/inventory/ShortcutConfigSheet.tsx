/**
 * ShortcutConfigSheet — Configure per-shortcut overrides:
 * count_by, pan_enabled_keys, pack_quantity_override
 */
import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Link2, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PanSizesConfig } from "./PanSizesSection";

// Minimal container label map (matches PanSizesSection ALL_CONTAINERS)
const CONTAINER_LABELS: Record<string, string> = {
  full_pan: "Full Pan",
  two_thirds: "2/3 Pan",
  half_pan: "Half Pan",
  third_pan: "1/3 Pan",
  quarter_pan: "1/4 Pan",
  sixth_pan: "1/6 Pan",
  ninth_pan: "1/9 Pan",
  cambro_22qt: "22qt Cambro",
  cambro_12qt: "12qt Cambro",
  cambro_8qt: "8qt Cambro",
  cambro_4qt: "4qt Cambro",
  dough_tray_full: "Full Dough Tray",
  dough_tray_half: "Half Dough Tray",
  dough_box: "Dough Box",
};

interface ShortcutConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  itemName: string;
  storageLocationId: string;
  storageLocationName: string;
  locationId: string;
}

export default function ShortcutConfigSheet({
  open,
  onOpenChange,
  itemId,
  itemName,
  storageLocationId,
  storageLocationName,
  locationId,
}: ShortcutConfigSheetProps) {
  const queryClient = useQueryClient();
  const [countBy, setCountBy] = useState("inherit");
  const [packQtyOverride, setPackQtyOverride] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Pan config from item
  const [itemPanConfig, setItemPanConfig] = useState<PanSizesConfig | null>(null);
  // Per-shortcut pan override: null = inherit from item, string[] = custom selection
  const [panOverrideMode, setPanOverrideMode] = useState<"inherit" | "custom">("inherit");
  const [panEnabledKeys, setPanEnabledKeys] = useState<Set<string>>(new Set());

  // Load current config when sheet opens
  useEffect(() => {
    if (!open || !itemId || !storageLocationId) return;
    setLoaded(false);
    
    Promise.all([
      supabase
        .from("inventory_item_locations")
        .select("count_by, pack_quantity_override, pan_enabled_keys")
        .eq("item_id", itemId)
        .eq("storage_location_id", storageLocationId)
        .maybeSingle(),
      supabase
        .from("inventory_items")
        .select("pan_sizes")
        .eq("id", itemId)
        .maybeSingle(),
    ]).then(([shortcutRes, itemRes]) => {
      const shortcut = shortcutRes.data;
      if (shortcut) {
        setCountBy(shortcut.count_by || "inherit");
        setPackQtyOverride(shortcut.pack_quantity_override?.toString() || "");
        if (shortcut.pan_enabled_keys && shortcut.pan_enabled_keys.length > 0) {
          setPanOverrideMode("custom");
          setPanEnabledKeys(new Set(shortcut.pan_enabled_keys));
        } else {
          setPanOverrideMode("inherit");
          setPanEnabledKeys(new Set());
        }
      } else {
        setCountBy("inherit");
        setPackQtyOverride("");
        setPanOverrideMode("inherit");
        setPanEnabledKeys(new Set());
      }

      const panSizes = itemRes.data?.pan_sizes as unknown as PanSizesConfig | null;
      setItemPanConfig(panSizes?.enabled ? panSizes : null);
      
      setLoaded(true);
    });
  }, [open, itemId, storageLocationId]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const override = packQtyOverride.trim() === "" ? null : parseInt(packQtyOverride);
      const panKeys = panOverrideMode === "custom" && panEnabledKeys.size > 0
        ? Array.from(panEnabledKeys)
        : null;
      
      const { error } = await supabase
        .from("inventory_item_locations")
        .update({
          count_by: countBy,
          pack_quantity_override: override,
          pan_enabled_keys: panKeys,
        })
        .eq("item_id", itemId)
        .eq("storage_location_id", storageLocationId);
      
      if (error) throw error;
      
      toast.success("Shortcut updated");
      queryClient.invalidateQueries({ queryKey: ["inventory-item-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      onOpenChange(false);
    } catch {
      toast.error("Failed to update shortcut");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("inventory_item_locations")
        .delete()
        .eq("item_id", itemId)
        .eq("storage_location_id", storageLocationId);
      
      if (error) throw error;
      
      toast.success("Shortcut removed");
      queryClient.invalidateQueries({ queryKey: ["inventory-item-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      onOpenChange(false);
    } catch {
      toast.error("Failed to remove shortcut");
    } finally {
      setIsDeleting(false);
    }
  };

  const togglePanKey = (key: string) => {
    setPanEnabledKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Available pan keys from item config
  const availablePanKeys = itemPanConfig?.enabled_keys || [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[75vh] rounded-t-2xl pb-safe overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-orange-500" />
            Shortcut Settings
          </SheetTitle>
        </SheetHeader>

        {!loaded ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Item info */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{itemName}</span>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400 flex-shrink-0">
                → {storageLocationName}
              </Badge>
            </div>

            {/* Count by */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Count by</Label>
              <Select value={countBy} onValueChange={setCountBy}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit (default)</SelectItem>
                  <SelectItem value="cases_and_units">Cases & Units</SelectItem>
                  <SelectItem value="cases_only">Cases only</SelectItem>
                  <SelectItem value="units_only">Units only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Controls which inputs appear when counting this item at this location
              </p>
            </div>

            {/* Pan options — only show if item has pans configured */}
            {itemPanConfig && availablePanKeys.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Pan sizes</Label>
                <Select value={panOverrideMode} onValueChange={(v) => {
                  setPanOverrideMode(v as "inherit" | "custom");
                  if (v === "inherit") setPanEnabledKeys(new Set());
                  else setPanEnabledKeys(new Set(availablePanKeys));
                }}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit from item ({availablePanKeys.length} pans)</SelectItem>
                    <SelectItem value="custom">Custom for this location</SelectItem>
                  </SelectContent>
                </Select>

                {panOverrideMode === "custom" && (
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    {availablePanKeys.map(key => (
                      <label
                        key={key}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border/40 bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors"
                      >
                        <Checkbox
                          checked={panEnabledKeys.has(key)}
                          onCheckedChange={() => togglePanKey(key)}
                        />
                        <span className="text-xs font-medium truncate">
                          {CONTAINER_LABELS[key] || key}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Choose which pan sizes appear when counting at this location
                </p>
              </div>
            )}

            {/* Pack qty override */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Pack quantity override</Label>
              <Input
                type="number"
                value={packQtyOverride}
                onChange={e => setPackQtyOverride(e.target.value)}
                placeholder="Use default"
                className="h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Override how many units per case at this location (blank = use item default)
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Button onClick={handleSave} disabled={isSaving} className="flex-1">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save
              </Button>
              <Button
                variant="destructive"
                size="icon"
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-shrink-0"
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
