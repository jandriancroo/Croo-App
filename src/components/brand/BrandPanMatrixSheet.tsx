/**
 * BrandPanMatrixSheet — A sheet that shows a mini spreadsheet of pan configurations
 * for selected brand inventory templates. Allows quick visual review and toggle
 * of pan sizes across multiple items at once.
 *
 * Each numeric pan cell is INLINE EDITABLE:
 *   - Empty / no override → auto-calculated from baseline ratio (normal weight)
 *   - Typed override → bold + dot indicator, stored in pan_overrides JSON
 *   - Clear value → reverts to auto
 *
 * Brand pan_overrides changes auto-propagate to all linked location inventory_items
 * via DB trigger (trg_propagate_pan_sizes). No deploy step needed.
 */

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
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

  /** Currently-edited cell: `${templateId}::${panKey}` or null */
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const { data: templates } = useQuery({
    queryKey: ["brand-pan-matrix", brandId, ids],
    queryFn: async () => {
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("brand_inventory_templates")
        .select("id, product_name, category, pan_baseline_key, pan_enabled_keys, pan_overrides, pan_units_per_unit, pan_units_per_lb, is_weight_based, is_recipe, recipe_yield_unit, count_unit, pack_override_inner_type, pack_override_inner_qty")
        .in("id", ids)
        .order("category")
        .order("product_name");
      if (error) throw error;
      return data;
    },
    enabled: open && ids.length > 0,
  });

  /**
   * Fetch a representative pack_size for each template from any linked
   * location inventory_item. Used as fallback when the brand template has no
   * count_unit/pack_override_* set (very common — most catalog rows).
   */
  const { data: packSizeByTemplateId } = useQuery({
    queryKey: ["brand-pan-matrix-packsizes", brandId, ids],
    queryFn: async () => {
      if (ids.length === 0) return {} as Record<string, string>;
      const { data, error } = await supabase
        .from("inventory_items")
        .select("brand_item_id, pack_size")
        .in("brand_item_id", ids)
        .not("pack_size", "is", null);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((r: any) => {
        if (r.brand_item_id && r.pack_size && !map[r.brand_item_id]) {
          map[r.brand_item_id] = String(r.pack_size);
        }
      });
      return map;
    },
    enabled: open && ids.length > 0,
  });

  /**
   * Friendly singular label for a vendor pack inner-unit code.
   * "LB" → "lb", "OZ" → "oz", "CN" → "can", "EA" → "ea", "GAL" → "gal",
   * "BAG" → "bag", "PCH"/"POUCH" → "pouch", "JAR" → "jar", "BTL" → "bottle".
   */
  const friendlyInnerUnit = (raw: string | null | undefined): string => {
    if (!raw) return "";
    const u = String(raw).trim().toUpperCase();
    const map: Record<string, string> = {
      LB: "lb", LBS: "lb", POUND: "lb", POUNDS: "lb",
      OZ: "oz", OUNCE: "oz", OUNCES: "oz",
      CN: "can", CAN: "can",
      EA: "ea", EACH: "ea",
      GAL: "gal", GALLON: "gal",
      QT: "qt", QUART: "qt",
      PT: "pt", PINT: "pt",
      BAG: "bag", BG: "bag",
      PCH: "pouch", POUCH: "pouch",
      JAR: "jar", JR: "jar",
      BTL: "bottle", BOTTLE: "bottle",
      BX: "box", BOX: "box",
      CT: "ct", COUNT: "ct",
      KG: "kg",
      L: "l", LT: "l", LTR: "l", LITER: "l", LITRE: "l",
      ML: "ml",
    };
    return map[u] ?? u.toLowerCase();
  };

  /**
   * Parse pack_size strings like "2/5 LB", "6/1 LB", "4/1 GAL", "6/#10 CN"
   * → returns the inner unit code ("LB", "GAL", "CN", …) or "".
   * Falls back gracefully on weird formats.
   */
  const parsePackSizeInnerUnit = (packSize: string | null | undefined): string => {
    if (!packSize) return "";
    // grab the trailing alpha token
    const m = String(packSize).trim().match(/([A-Za-z]+)\s*$/);
    return m?.[1] ?? "";
  };

  /**
   * Display unit for a row's baseline.
   *  - Prep recipes → recipe_yield_unit (qt for sauce, lb for prepped dough, ea for dough balls)
   *  - Vendor items on weight basis → "lb"
   *  - Vendor items on count basis → in priority: count_unit → pack_override_inner_type
   *    → parsed pack_size inner unit → "ea"
   */
  const getBaselineUnitLabel = useCallback((tmpl: any, isWeight: boolean): string => {
    if (tmpl.is_recipe) {
      const yu = String(tmpl.recipe_yield_unit ?? "").trim().toLowerCase();
      return yu || (isWeight ? "lb" : "ea");
    }
    if (isWeight) return "lb";
    const cu = String(tmpl.count_unit ?? "").trim().toLowerCase();
    if (cu) return cu;
    const pot = friendlyInnerUnit(tmpl.pack_override_inner_type);
    if (pot) return pot;
    const fromPack = friendlyInnerUnit(parsePackSizeInnerUnit(packSizeByTemplateId?.[tmpl.id]));
    if (fromPack) return fromPack;
    return "ea";
  }, [packSizeByTemplateId]);

  /**
   * Per-row local override for the basis pill, used ONLY when the row has no
   * saved baseline yet (both pan_units_per_lb and pan_units_per_unit are null).
   * Lets the user toggle the pill freely without hitting the DB or re-rendering
   * the whole sheet. Once they enter a number, commitBaselineEdit writes to the
   * matching column based on this local choice.
   */
  const [pendingBasis, setPendingBasis] = useState<Record<string, "weight" | "count">>({});

  /**
   * Flip baseline basis between "weight" (lb) and "count" (count_unit/yield_unit).
   * For rows WITH a saved value: writes to DB, clearing the value (it's almost
   * always wrong on the new basis). For rows with NO saved value: just flips
   * the local pendingBasis so the UI updates instantly with no flicker.
   */
  const toggleBaselineBasis = useMutation({
    mutationFn: async ({ templateId, currentPerLb }: {
      templateId: string;
      currentPerUnit: number | null;
      currentPerLb: number | null;
    }) => {
      const nowOnLb = currentPerLb != null;
      // Flip side: clear both, set is_weight_based to match new basis.
      // New basis = opposite of current. lb→each means is_weight_based=false.
      const patch = nowOnLb
        ? { pan_units_per_unit: null, pan_units_per_lb: null, is_weight_based: false, pan_overrides: null }
        : { pan_units_per_unit: null, pan_units_per_lb: null, is_weight_based: true, pan_overrides: null };
      const { error } = await supabase
        .from("brand_inventory_templates")
        .update({ ...patch, updated_at: new Date().toISOString() } as any)
        .eq("id", templateId);
      if (error) throw error;
      return nowOnLb ? "each" : "lb";
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-pan-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["brand-templates", brandId] });
      // No toast, no auto-open. The pill label flips when the query refetches.
    },
    onError: () => toast.error("Failed to switch basis"),
  });

  /**
   * Save a new baseline number on the current basis (each or lb).
   * Used when user types into the special "__baseline__" cell after a flip,
   * or when they tap the baseline number to revise it directly.
   */
  const setBaseline = useMutation({
    mutationFn: async ({ templateId, value, isWeightBased }: {
      templateId: string;
      value: number;
      isWeightBased: boolean;
    }) => {
      const patch = isWeightBased
        ? { pan_units_per_lb: value, pan_units_per_unit: null }
        : { pan_units_per_unit: value, pan_units_per_lb: null };
      const { error } = await supabase
        .from("brand_inventory_templates")
        .update({ ...patch, updated_at: new Date().toISOString() } as any)
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-pan-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["brand-templates", brandId] });
      toast.success("Baseline saved — pushed to locations");
    },
    onError: () => toast.error("Failed to save baseline"),
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

  /**
   * Set or clear a per-pan numeric override.
   * Pass null to clear (revert to auto-calc).
   */
  const setOverride = useMutation({
    mutationFn: async ({ templateId, panKey, value, currentOverrides }: {
      templateId: string;
      panKey: string;
      value: number | null;
      currentOverrides: Record<string, number> | null;
    }) => {
      const next = { ...(currentOverrides ?? {}) };
      if (value == null) {
        delete next[panKey];
      } else {
        next[panKey] = value;
      }
      const isEmpty = Object.keys(next).length === 0;
      const { error } = await supabase
        .from("brand_inventory_templates")
        .update({
          pan_overrides: (isEmpty ? null : next) as any,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["brand-pan-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["brand-templates", brandId] });
      toast.success(vars.value == null ? "Reverted to auto" : "Override saved — pushed to locations");
    },
    onError: () => toast.error("Failed to save override"),
  });

  const getUnitsForContainer = useCallback((template: any, container: ContainerDef): { value: number | null; isOverride: boolean } => {
    const baselineKey = template.pan_baseline_key;
    const baselineContainer = ALL_CONTAINERS.find(c => c.key === baselineKey);
    const unitsPerUnit = template.pan_units_per_unit;
    const unitsPerLb = template.pan_units_per_lb;

    if (!baselineContainer || (unitsPerUnit == null && unitsPerLb == null)) return { value: null, isOverride: false };

    const baselineValue = unitsPerUnit ?? unitsPerLb;

    // Check overrides first
    const overrides = template.pan_overrides as Record<string, number> | null;
    if (overrides?.[container.key] != null) return { value: overrides[container.key], isOverride: true };

    return { value: calcUnits(container, baselineContainer, baselineValue!), isOverride: false };
  }, []);

  const commitEdit = useCallback((templateId: string, panKey: string, currentOverrides: Record<string, number> | null) => {
    const trimmed = editValue.trim();
    if (trimmed === "") {
      // Clear override → revert to auto
      if (currentOverrides?.[panKey] != null) {
        setOverride.mutate({ templateId, panKey, value: null, currentOverrides });
      }
    } else {
      const num = parseFloat(trimmed);
      if (!isNaN(num) && num >= 0) {
        // Only persist if it actually changed
        if (currentOverrides?.[panKey] !== num) {
          setOverride.mutate({ templateId, panKey, value: num, currentOverrides });
        }
      } else {
        toast.error("Enter a valid number");
      }
    }
    setEditingCell(null);
    setEditValue("");
  }, [editValue, setOverride]);

  const startEdit = useCallback((templateId: string, panKey: string, currentValue: number | null) => {
    setEditingCell(`${templateId}::${panKey}`);
    setEditValue(currentValue != null ? String(currentValue) : "");
  }, []);

  const commitBaselineEdit = useCallback((templateId: string, isWeightBased: boolean) => {
    const trimmed = editValue.trim();
    if (trimmed === "") {
      setEditingCell(null);
      setEditValue("");
      return;
    }

    const num = parseFloat(trimmed);
    if (!isNaN(num) && num >= 0) {
      setBaseline.mutate({
        templateId,
        value: num,
        isWeightBased,
      });
      setEditingCell(null);
      setEditValue("");
      return;
    }

    toast.error("Enter a valid number");
  }, [editValue, setBaseline]);

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
                  <th key={col.key} className="text-center px-1.5 py-2 font-medium text-muted-foreground min-w-[64px] whitespace-nowrap">
                    <span className="text-[10px]">{col.label.replace(/ \(.*\)/, '')}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((tmpl: any, idx) => {
                const enabledKeys = tmpl.pan_enabled_keys ?? [];
                const baselineKey = tmpl.pan_baseline_key;
                const hasBaseline = !!(tmpl.pan_units_per_unit || tmpl.pan_units_per_lb);
                const baselineContainer = ALL_CONTAINERS.find(c => c.key === baselineKey);
                const overrides = (tmpl.pan_overrides as Record<string, number> | null) ?? null;

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

                    {/* Baseline info cell — tap to edit number, shift+tap (or right-click) to flip basis (vendor rows only) */}
                    {(() => {
                      const baselineCellId = `${tmpl.id}::__baseline__`;
                      const isEditingBaseline = editingCell === baselineCellId;
                      const recipeYieldUnit = String(tmpl.recipe_yield_unit ?? "").trim().toLowerCase();
                      // Prep recipes are locked to their recipe yield unit (qt for sauce, lb for prepped dough, ea for dough balls).
                      // Vendor items can flip between lb (weight) and their native count_unit (pouch/can/bag/ea).
                      const isPrepRecipe = !!tmpl.is_recipe;
                      const allowBasisFlip = !isPrepRecipe;
                      // For prep recipes: weight-based ONLY when yield unit is literally "lb".
                      // Everything else (qt, gal, ea, …) stores in pan_units_per_unit so the label = yield unit.
                      const recipeIsWeight = isPrepRecipe && recipeYieldUnit === "lb";
                      const hasSavedValue = tmpl.pan_units_per_lb != null || tmpl.pan_units_per_unit != null;
                      const localPending = pendingBasis[tmpl.id];
                      const currentIsWeight = isPrepRecipe
                        ? recipeIsWeight
                        : tmpl.pan_units_per_lb != null
                        ? true
                        : tmpl.pan_units_per_unit != null
                        ? false
                        : localPending != null
                        ? localPending === "weight"
                        : !!tmpl.is_weight_based;
                      const baselineValue = tmpl.pan_units_per_unit ?? tmpl.pan_units_per_lb;
                      const unitLabel = getBaselineUnitLabel(tmpl, currentIsWeight);

                      if (isEditingBaseline) {
                        return (
                          <td className="text-center px-0.5 py-1 bg-primary/5 ring-1 ring-inset ring-primary/40">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[9px] text-muted-foreground">
                                {baselineContainer?.label.replace(/ \(.*\)/, '') ?? baselineKey}
                              </span>
                              <input
                                ref={inputRef}
                                type="number"
                                step="any"
                                min="0"
                                inputMode="decimal"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                 onBlur={() => commitBaselineEdit(tmpl.id, currentIsWeight)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                     commitBaselineEdit(tmpl.id, currentIsWeight);
                                  } else if (e.key === "Escape") {
                                    setEditingCell(null);
                                    setEditValue("");
                                  }
                                }}
                                placeholder={unitLabel}
                                className="w-14 text-center font-mono text-[11px] bg-background border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                              <span className="text-[8px] text-muted-foreground">
                                {unitLabel} / pan
                              </span>
                            </div>
                          </td>
                        );
                      }

                      const flipBasis = () => {
                        // No saved value yet → flip locally, no DB write, no flicker.
                        if (!hasSavedValue) {
                          setPendingBasis(prev => ({
                            ...prev,
                            [tmpl.id]: currentIsWeight ? "count" : "weight",
                          }));
                          return;
                        }
                        // Has a saved value → must clear & rewrite to switch columns.
                        toggleBaselineBasis.mutate({
                          templateId: tmpl.id,
                          currentPerUnit: tmpl.pan_units_per_unit ?? null,
                          currentPerLb: tmpl.pan_units_per_lb ?? null,
                        });
                      };

                      return (
                        <td
                          className="text-center px-1.5 py-2 cursor-pointer hover:bg-muted/60 active:bg-muted"
                          onClick={(e) => {
                            // Shift+tap → flip basis (vendor rows only)
                            if (e.shiftKey && allowBasisFlip) {
                              flipBasis();
                              return;
                            }
                            // Default tap → edit baseline number on current basis
                            setEditingCell(baselineCellId);
                            setEditValue(baselineValue != null ? String(baselineValue) : "");
                          }}
                          onContextMenu={(e) => {
                            if (!allowBasisFlip) return;
                            e.preventDefault();
                            flipBasis();
                          }}
                          title={
                            allowBasisFlip
                              ? `Tap to edit baseline · Tap the ${unitLabel} pill to switch basis`
                              : `Prep recipe — locked to ${unitLabel} (recipe yield unit)`
                          }
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {baselineContainer?.label.replace(/ \(.*\)/, '') ?? baselineKey ?? "—"}
                            </span>
                            {hasBaseline ? (
                              <span className="font-mono font-semibold text-[11px] text-primary">
                                {baselineValue != null && (baselineValue % 1 === 0 ? baselineValue : Number(baselineValue).toFixed(2))}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60 text-[10px] italic leading-none">
                                tap to set
                              </span>
                            )}
                            {allowBasisFlip ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  flipBasis();
                                }}
                                className="mt-0.5 text-[9px] font-mono px-1.5 py-0 rounded-full border border-border bg-muted/50 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                                title={`Tap to switch between lb and ${getBaselineUnitLabel(tmpl, false)}`}
                              >
                                {unitLabel} ⇄
                              </button>
                            ) : (
                              <span
                                className="mt-0.5 text-[9px] font-mono px-1.5 py-0 rounded-full border border-border bg-muted/40 text-muted-foreground"
                                title={`Locked to ${unitLabel} (recipe yield unit)`}
                              >
                                {unitLabel}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })()}

                    {PAN_COLUMNS.map(col => {
                      const isEnabled = enabledKeys.includes(col.key);
                      const isBaseline = baselineKey === col.key;
                      const cellId = `${tmpl.id}::${col.key}`;
                      const isEditing = editingCell === cellId;
                      const { value: units, isOverride } = hasBaseline
                        ? getUnitsForContainer(tmpl, col)
                        : { value: null, isOverride: false };

                      if (!hasBaseline) {
                        return (
                          <td key={col.key} className="text-center px-1.5 py-2">
                            <span className="text-muted-foreground/30">—</span>
                          </td>
                        );
                      }

                      // Disabled cell: tap to enable
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

                      // Editing: render input
                      if (isEditing) {
                        return (
                          <td key={col.key} className="text-center px-0.5 py-1 bg-primary/5 ring-1 ring-inset ring-primary/40">
                            <input
                              ref={inputRef}
                              type="number"
                              step="any"
                              min="0"
                              inputMode="decimal"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => commitEdit(tmpl.id, col.key, overrides)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitEdit(tmpl.id, col.key, overrides);
                                } else if (e.key === "Escape") {
                                  setEditingCell(null);
                                  setEditValue("");
                                }
                              }}
                              placeholder="auto"
                              className="w-full text-center font-mono text-[11px] bg-background border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </td>
                        );
                      }

                      // Enabled cell: shows units, click to edit (baseline shows star but is also editable for overrides)
                      return (
                        <td
                          key={col.key}
                          className={`text-center px-1.5 py-2 cursor-pointer hover:bg-muted/50 active:bg-muted relative ${
                            isBaseline ? "bg-primary/10 ring-1 ring-inset ring-primary/20" : ""
                          }`}
                          onClick={(e) => {
                            // Long-press / right-click on enabled non-baseline → toggle off
                            // Default click → start edit
                            if (e.shiftKey && !isBaseline) {
                              togglePanKey.mutate({
                                templateId: tmpl.id,
                                panKey: col.key,
                                currentKeys: enabledKeys,
                              });
                              return;
                            }
                            startEdit(tmpl.id, col.key, units);
                          }}
                          onContextMenu={(e) => {
                            if (isBaseline) return;
                            e.preventDefault();
                            togglePanKey.mutate({
                              templateId: tmpl.id,
                              panKey: col.key,
                              currentKeys: enabledKeys,
                            });
                          }}
                          title={isOverride ? "Manual override (click to edit, clear to revert)" : "Auto-calculated (click to override)"}
                        >
                          <div className="flex flex-col items-center gap-0">
                            {isBaseline && <Star className="h-2.5 w-2.5 text-primary fill-primary" />}
                            <span className={`font-mono text-[11px] ${
                              isBaseline ? "text-primary font-semibold" :
                              isOverride ? "text-foreground font-bold" : "text-foreground font-semibold"
                            }`}>
                              {units != null ? (units % 1 === 0 ? units : units.toFixed(2)) : "?"}
                              {units != null && (
                                <span className="text-[8px] text-muted-foreground ml-0.5">
                                  {getBaselineUnitLabel(tmpl, tmpl.pan_units_per_lb != null)}
                                </span>
                              )}
                            </span>
                            {isOverride && !isBaseline && (
                              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                            )}
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
        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground px-4 py-2 border-t border-border shrink-0">
          <span className="flex items-center gap-1">
            <Star className="h-2.5 w-2.5 text-primary fill-primary" /> Baseline
          </span>
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/50 text-lg leading-none">○</span> Tap to enable
          </span>
          <span className="flex items-center gap-1">
            <span className="relative inline-block w-3 h-3">
              <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            Manual override (clear to revert to auto)
          </span>
          <span className="flex items-center gap-1">
            Tap a number to override · Shift+tap to disable · Tap baseline cell to switch ea ↔ lb
          </span>
        </div>
      </SheetContent>
    </Sheet>
  );
}
