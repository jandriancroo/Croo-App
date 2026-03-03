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
import { Link2, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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

  // Load current config when sheet opens
  useEffect(() => {
    if (!open || !itemId || !storageLocationId) return;
    setLoaded(false);
    
    supabase
      .from("inventory_item_locations")
      .select("count_by, pack_quantity_override")
      .eq("item_id", itemId)
      .eq("storage_location_id", storageLocationId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCountBy(data.count_by || "inherit");
          setPackQtyOverride(data.pack_quantity_override?.toString() || "");
        } else {
          setCountBy("inherit");
          setPackQtyOverride("");
        }
        setLoaded(true);
      });
  }, [open, itemId, storageLocationId]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const override = packQtyOverride.trim() === "" ? null : parseInt(packQtyOverride);
      
      const { error } = await supabase
        .from("inventory_item_locations")
        .update({
          count_by: countBy,
          pack_quantity_override: override,
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[60vh] rounded-t-2xl pb-safe">
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
