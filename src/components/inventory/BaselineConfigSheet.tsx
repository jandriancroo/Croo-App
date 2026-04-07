/**
 * BaselineConfigSheet — Bottom sheet for configuring an item's pan baseline
 * from the Matrix view. Lets you pick a baseline container and set units.
 */
import { useState, useEffect, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ALL_CONTAINERS, type PanSizesConfig, type ContainerDef } from "./PanSizesSection";

interface BaselineConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: {
    id: string;
    name: string;
    pan_sizes: PanSizesConfig | null;
    pack_quantity?: number | null;
    pack_quantity_override?: number | null;
    cost_per_unit?: number | null;
    blended_price?: number | null;
  } | null;
  locationId: string;
  /** Which pan key was tapped (pre-selects baseline) */
  tappedPanKey?: string | null;
}

const roundHalf = (v: number): number => Math.round(v * 100) / 100;

const calcUnits = (container: ContainerDef, baseline: ContainerDef, baselineUnits: number): number => {
  if (baselineUnits <= 0) return 0;
  return roundHalf((container.ratio / baseline.ratio) * baselineUnits);
};

export default function BaselineConfigSheet({
  open,
  onOpenChange,
  item,
  locationId,
  tappedPanKey,
}: BaselineConfigSheetProps) {
  const queryClient = useQueryClient();
  const [baselineKey, setBaselineKey] = useState("third_pan");
  const [baselineUnits, setBaselineUnits] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Reset state when item/sheet changes
  useEffect(() => {
    if (!open || !item) return;
    const config = item.pan_sizes;
    if (config?.enabled) {
      setBaselineKey(config.baseline_key);
      setBaselineUnits(config.baseline_units > 0 ? String(config.baseline_units) : "");
    } else {
      // First time setup — use tapped key or default
      setBaselineKey(tappedPanKey || "third_pan");
      setBaselineUnits("");
    }
  }, [open, item?.id, tappedPanKey]);

  const displayName = item?.name || "";
  const baselineContainer = ALL_CONTAINERS.find(c => c.key === baselineKey);
  const unitsNum = parseFloat(baselineUnits) || 0;

  // Preview calculated values for other containers
  const preview = useMemo(() => {
    if (!baselineContainer || unitsNum <= 0) return [];
    return ALL_CONTAINERS
      .filter(c => c.key !== baselineKey && (c.blazeDefault || ["full_pan", "half_pan", "dough_box"].includes(c.key)))
      .map(c => ({
        key: c.key,
        label: c.label,
        units: calcUnits(c, baselineContainer, unitsNum),
      }));
  }, [baselineKey, unitsNum, baselineContainer]);

  const handleSave = async () => {
    if (!item || unitsNum <= 0) {
      toast.error("Enter a valid number of units");
      return;
    }
    setIsSaving(true);
    try {
      const existing = item.pan_sizes;
      const newConfig: PanSizesConfig = {
        enabled: true,
        baseline_key: baselineKey,
        baseline_units: unitsNum,
        enabled_keys: existing?.enabled_keys?.length
          ? Array.from(new Set([...existing.enabled_keys, baselineKey]))
          : [baselineKey],
        overrides: existing?.overrides || {},
      };

      const { error } = await supabase
        .from("inventory_items")
        .update({ pan_sizes: newConfig as any })
        .eq("id", item.id);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      toast.success("Baseline saved");
      onOpenChange(false);
    } catch {
      toast.error("Failed to save baseline");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl pb-safe">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <Star className="h-4 w-4 text-orange-500" />
            Baseline Setup
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 pt-2">
          {/* Item name */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{displayName}</span>
            {item?.pan_sizes?.enabled && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400 flex-shrink-0">
                Configured
              </Badge>
            )}
          </div>

          {/* Baseline container selector */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Baseline Container</Label>
            <Select value={baselineKey} onValueChange={setBaselineKey}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_CONTAINERS.map(c => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              The reference container — all other sizes calculate from this
            </p>
          </div>

          {/* Baseline units */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Units per {baselineContainer?.label || "container"}
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={baselineUnits}
              onChange={e => setBaselineUnits(e.target.value)}
              placeholder="e.g. 12"
              className="h-9 text-sm text-base"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              How many individual units fit in one {baselineContainer?.label?.toLowerCase() || "container"}?
            </p>
          </div>

          {/* Preview of calculated values */}
          {preview.length > 0 && unitsNum > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Calculated from baseline</Label>
              <div className="grid grid-cols-2 gap-1">
                {preview.map(p => (
                  <div key={p.key} className="flex items-center justify-between px-2 py-1 bg-muted/50 rounded text-xs">
                    <span className="text-muted-foreground">{p.label}</span>
                    <span className="font-mono font-semibold">{p.units}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save */}
          <Button onClick={handleSave} disabled={isSaving || unitsNum <= 0} className="w-full">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Baseline
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
