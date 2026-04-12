/**
 * BrandPanMatrixSheet — A sheet that shows a mini spreadsheet of pan configurations
 * for selected brand inventory templates. Allows quick visual review and toggle
 * of pan sizes across multiple items at once.
 */

import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { ALL_CONTAINERS, type ContainerDef } from "@/components/inventory/PanSizesSection";

interface BrandPanMatrixSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: Set<string>;
  brandId: string;
}

/** The pan columns we show — Blaze defaults + full/half/dough_box */
const PAN_COLUMNS: ContainerDef[] = ALL_CONTAINERS.filter(
  c => c.blazeDefault || ["full_pan", "half_pan", "dough_box"].includes(c.key)
);

/** Round to nearest 0.5 */
const roundHalf = (v: number): number => Math.round(v * 100) / 100;

/** Compute units for a container from baseline */
function calcUnits(container: ContainerDef, baseline: ContainerDef, baselineUnits: number): number {
  if (baselineUnits <= 0) return 0;
  return roundHalf((container.ratio / baseline.ratio) * baselineUnits);
}

export default function BrandPanMatrixSheet({ open, onOpenChange, selectedIds, brandId }: BrandPanMatrixSheetProps) {
  const queryClient = useQueryClient();
  const ids = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const { data: templates } = useQuery({
    queryKey: ["brand-pan-matrix", brandId, ids],
    queryFn: async () => {
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("brand_inventory_templates")
        .select("id, product_name, category, pan_baseline_key, pan_enabled_keys, pan_overrides, pan_units_per_unit, pan_units_per_lb")
        .in("id", ids)
        .order("category")
        .order("product_name");
      if (error) throw error;
      return data;
    },
    enabled: open && ids.length > 0,
  });

  const togglePanKey = useMutation({
    mutationFn: async ({ templateId, panKey, currentKeys }: { templateId: string; panKey: string; currentKeys: string[] }) => {
      const newKeys = currentKeys.includes(panKey)
        ? currentKeys.filter(k => k !== panKey)
        : [...currentKeys, panKey];
      const { error } = await supabase
        .from("brand_inventory_templates")
        .update({ pan_enabled_keys: newKeys, updated_at: new Date().toISOString() } as any)
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-pan-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["brand-templates", brandId] });
    },
    onError: () => toast.error("Failed to update pan key"),
  });

  const getUnitsForContainer = useCallback((template: any, container: ContainerDef): number | null => {
    const baselineKey = template.pan_baseline_key;
    const baselineContainer = ALL_CONTAINERS.find(c => c.key === baselineKey);
    const unitsPerUnit = template.pan_units_per_unit;

    if (!baselineContainer || !unitsPerUnit) return null;

    // Check overrides first
    const overrides = template.pan_overrides as Record<string, number> | null;
    if (overrides?.[container.key] != null) return overrides[container.key];

    // Auto-calculate from baseline
    return calcUnits(container, baselineContainer, unitsPerUnit);
  }, []);

  const rows = templates ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[70vh] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border shrink-0">
          <SheetTitle className="text-sm flex items-center gap-2">
            Pan Matrix
            <Badge variant="secondary" className="text-[10px]">{rows.length} items</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/95 backdrop-blur-sm border-b border-border">
                <th className="sticky left-0 z-20 bg-muted/95 text-left px-3 py-2 font-semibold min-w-[160px] max-w-[200px]">
                  Item
                </th>
                <th className="text-center px-1.5 py-2 font-medium text-muted-foreground min-w-[56px]">
                  <span className="text-[10px]">Baseline</span>
                </th>
                {PAN_COLUMNS.map(col => (
                  <th key={col.key} className="text-center px-1.5 py-2 font-medium text-muted-foreground min-w-[56px] whitespace-nowrap">
                    <span className="text-[10px]">{col.label.replace(/ \(.*\)/, '')}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((tmpl, idx) => {
                const enabledKeys = tmpl.pan_enabled_keys ?? [];
                const baselineKey = tmpl.pan_baseline_key;
                const hasBaseline = !!tmpl.pan_units_per_unit;
                const baselineContainer = ALL_CONTAINERS.find(c => c.key === baselineKey);

                return (
                  <tr
                    key={tmpl.id}
                    className={`border-b border-border/50 ${idx % 2 ? "bg-muted/10" : ""}`}
                  >
                    <td className="sticky left-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2 font-medium min-w-[160px] max-w-[200px]">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] leading-tight line-clamp-2">{tmpl.product_name}</span>
                        {tmpl.category && (
                          <span className="text-[9px] text-muted-foreground">{tmpl.category}</span>
                        )}
                      </div>
                    </td>

                    {/* Baseline info cell */}
                    <td className="text-center px-1.5 py-2">
                      {hasBaseline ? (
                        <div className="flex flex-col items-center gap-0">
                          <span className="text-[10px] text-muted-foreground">
                            {baselineContainer?.label.replace(/ \(.*\)/, '') ?? baselineKey}
                          </span>
                          <span className="font-mono font-semibold text-[11px] text-primary">
                            {tmpl.pan_units_per_unit}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40 text-[10px]">—</span>
                      )}
                    </td>

                    {PAN_COLUMNS.map(col => {
                      const isEnabled = enabledKeys.includes(col.key);
                      const isBaseline = baselineKey === col.key;
                      const units = hasBaseline ? getUnitsForContainer(tmpl, col) : null;

                      if (!hasBaseline) {
                        return (
                          <td key={col.key} className="text-center px-1.5 py-2">
                            <span className="text-muted-foreground/30">—</span>
                          </td>
                        );
                      }

                      if (!isEnabled) {
                        return (
                          <td
                            key={col.key}
                            className="text-center px-1.5 py-2 cursor-pointer hover:bg-muted/50 active:bg-muted"
                            onClick={() => togglePanKey.mutate({
                              templateId: tmpl.id,
                              panKey: col.key,
                              currentKeys: enabledKeys,
                            })}
                          >
                            <span className="text-muted-foreground/50 text-lg leading-none">○</span>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={col.key}
                          className={`text-center px-1.5 py-2 cursor-pointer hover:bg-muted/50 active:bg-muted ${
                            isBaseline ? "bg-primary/10 ring-1 ring-inset ring-primary/20" : ""
                          }`}
                          onClick={() => {
                            if (isBaseline) return; // Don't disable baseline
                            togglePanKey.mutate({
                              templateId: tmpl.id,
                              panKey: col.key,
                              currentKeys: enabledKeys,
                            });
                          }}
                        >
                          <div className="flex flex-col items-center gap-0">
                            {isBaseline && <Star className="h-2.5 w-2.5 text-primary fill-primary" />}
                            <span className={`font-mono font-semibold text-[11px] ${
                              isBaseline ? "text-primary" : "text-foreground"
                            }`}>
                              {units != null ? (units % 1 === 0 ? units : units.toFixed(2)) : "?"}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={PAN_COLUMNS.length + 2} className="text-center py-8 text-muted-foreground text-sm">
                    No items selected
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-4 py-2 border-t border-border shrink-0">
          <span className="flex items-center gap-1">
            <Star className="h-2.5 w-2.5 text-primary fill-primary" /> Baseline
          </span>
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/50 text-lg leading-none">○</span> Disabled (tap to enable)
          </span>
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/30">—</span> No baseline set
          </span>
        </div>
      </SheetContent>
    </Sheet>
  );
}
