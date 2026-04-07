/**
 * UnitMatrixView — Spreadsheet-like grid for validating all item units, 
 * pan sizes, and pricing at a glance. Horizontally scrollable with frozen item name column.
 * Cells are tappable to toggle enabled/disabled pan sizes per item.
 */

import { useState, useMemo, useCallback, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, Filter } from "lucide-react";
import { ALL_CONTAINERS, type PanSizesConfig, getPanUnits } from "./PanSizesSection";
import BaselineConfigSheet from "./BaselineConfigSheet";

interface UnitMatrixViewProps {
  locationId: string;
}

/** The unit columns we show in the matrix */
const UNIT_COLUMNS = [
  { key: "case", label: "Case", description: "Full vendor case", toggleable: false },
  { key: "unit", label: "Unit", description: "Individual unit from case", toggleable: false },
  { key: "oz", label: "oz", description: "Ounces (weight)", toggleable: false },
  ...ALL_CONTAINERS
    .filter(c => c.blazeDefault || ["full_pan", "half_pan", "dough_box"].includes(c.key))
    .map(c => ({ key: `pan_${c.key}`, label: c.label, description: c.description, toggleable: true })),
];

const CATEGORY_COLORS: Record<string, string> = {
  Dough: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Sauce: "bg-red-500/10 text-red-700 dark:text-red-400",
  Cheese: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  Meat: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  Veggie: "bg-green-500/10 text-green-700 dark:text-green-400",
  Condiments: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  Desserts: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  Beverages: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  "Dry Goods": "bg-stone-500/10 text-stone-700 dark:text-stone-400",
  "Paper Goods": "bg-slate-500/10 text-slate-700 dark:text-slate-400",
  Cleaning: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  Other: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
};

/** Parse pack_size string to extract weight in oz */
function parsePackSizeOz(packSize: string | null, packQuantity: number | null): { ozPerUnit: number | null; ozPerCase: number | null } {
  if (!packSize) return { ozPerUnit: null, ozPerCase: null };
  
  const match = packSize.match(/(?:(\d+)\/)?([\d.]+)\s*(LB|OZ|GA|#|KG)/i);
  if (!match) return { ozPerUnit: null, ozPerCase: null };
  
  const countInPack = match[1] ? parseFloat(match[1]) : 1;
  const amount = parseFloat(match[2]);
  const unit = match[3].toUpperCase();
  
  let ozPerSubUnit = 0;
  switch (unit) {
    case "LB": case "#": ozPerSubUnit = amount * 16; break;
    case "OZ": ozPerSubUnit = amount; break;
    case "GA": ozPerSubUnit = amount * 128; break;
    case "KG": ozPerSubUnit = amount * 35.274; break;
    default: return { ozPerUnit: null, ozPerCase: null };
  }
  
  const ozPerUnit = ozPerSubUnit;
  const effectivePackQty = packQuantity || countInPack;
  const ozPerCase = ozPerUnit * effectivePackQty;
  
  return { ozPerUnit, ozPerCase };
}

interface CellValue {
  qty: number | null;
  cost: number | null;
  enabled: boolean;
  isBaseline?: boolean;
}

function computeCellValues(item: any): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {};
  const cost = item.blended_price ? Number(item.blended_price) : (item.cost_per_unit ? Number(item.cost_per_unit) : null);
  const packQty = item.pack_quantity_override || item.pack_quantity || 1;
  const panConfig = item.pan_sizes as PanSizesConfig | null;
  const { ozPerCase } = parsePackSizeOz(item.pack_size, packQty);
  
  cells["case"] = { qty: 1, cost: cost, enabled: true };
  cells["unit"] = { qty: packQty, cost: cost && packQty > 0 ? cost / packQty : null, enabled: packQty > 1 };
  cells["oz"] = { qty: ozPerCase, cost: ozPerCase && cost ? cost / ozPerCase : null, enabled: ozPerCase != null && ozPerCase > 0 };
  
  for (const container of ALL_CONTAINERS) {
    const colKey = `pan_${container.key}`;
    if (!UNIT_COLUMNS.find(c => c.key === colKey)) continue;
    
    if (panConfig?.enabled) {
      const units = getPanUnits(panConfig, container.key);
      const isEnabled = panConfig.enabled_keys.includes(container.key);
      const isBaseline = panConfig.baseline_key === container.key;
      
      let panCost: number | null = null;
      if (units != null && cost != null && packQty > 0) {
        panCost = (cost / packQty) * units;
      }
      
      cells[colKey] = { qty: units, cost: panCost, enabled: isEnabled, isBaseline };
    } else {
      cells[colKey] = { qty: null, cost: null, enabled: false };
    }
  }
  
  return cells;
}

export default function UnitMatrixView({ locationId }: UnitMatrixViewProps) {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [baselineSheetItem, setBaselineSheetItem] = useState<any | null>(null);
  const [baselineSheetPanKey, setBaselineSheetPanKey] = useState<string | null>(null);
  
  const { data: items, isLoading } = useQuery({
    queryKey: ["inventory-items", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .eq("user_hidden", false)
        .eq("is_recipe", false)
        .order("display_order");
      if (error) throw error;
      return data;
    },
  });

  // Toggle pan key mutation
  const togglePanKey = useMutation({
    mutationFn: async ({ itemId, panKey, currentConfig }: { itemId: string; panKey: string; currentConfig: PanSizesConfig | null }) => {
      if (!currentConfig?.enabled) {
        toast.error("Pan sizes not configured for this item");
        throw new Error("Pan sizes not enabled");
      }
      
      const newEnabledKeys = currentConfig.enabled_keys.includes(panKey)
        ? currentConfig.enabled_keys.filter(k => k !== panKey)
        : [...currentConfig.enabled_keys, panKey];
      
      const newConfig: PanSizesConfig = { ...currentConfig, enabled_keys: newEnabledKeys };
      
      const { error } = await supabase
        .from("inventory_items")
        .update({ pan_sizes: newConfig as any })
        .eq("id", itemId);
      if (error) throw error;
      return { itemId, newConfig };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
    },
    onError: (err: any) => {
      if (err.message !== "Pan sizes not enabled") {
        toast.error("Failed to update pan size");
      }
    },
  });

  // Set baseline mutation
  const setBaseline = useMutation({
    mutationFn: async ({ itemId, panKey, currentConfig }: { itemId: string; panKey: string; currentConfig: PanSizesConfig }) => {
      const newConfig: PanSizesConfig = { ...currentConfig, baseline_key: panKey };
      // Ensure the new baseline is in enabled_keys
      if (!newConfig.enabled_keys.includes(panKey)) {
        newConfig.enabled_keys = [...newConfig.enabled_keys, panKey];
      }
      
      const { error } = await supabase
        .from("inventory_items")
        .update({ pan_sizes: newConfig as any })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      toast.success("Baseline updated");
    },
    onError: () => {
      toast.error("Failed to update baseline");
    },
  });

  const handleCellTap = useCallback((itemId: string, colKey: string, item: any) => {
    const col = UNIT_COLUMNS.find(c => c.key === colKey);
    if (!col?.toggleable) return;
    
    const panKey = colKey.replace("pan_", "");
    const panConfig = item.pan_sizes as PanSizesConfig | null;
    
    // No pan config yet — open sheet to set up baseline
    if (!panConfig?.enabled) {
      setBaselineSheetPanKey(panKey);
      setBaselineSheetItem(item);
      return;
    }
    
    const isCurrentBaseline = panConfig.baseline_key === panKey;
    const isEnabled = panConfig.enabled_keys.includes(panKey);
    
    if (isCurrentBaseline && isEnabled) {
      // Tap baseline → open sheet to edit it
      setBaselineSheetPanKey(panKey);
      setBaselineSheetItem(item);
      return;
    }
    
    if (isEnabled) {
      // Enabled but not baseline — offer to set as baseline or disable
      const container = ALL_CONTAINERS.find(c => c.key === panKey);
      toast(`${container?.label || panKey}`, {
        description: "Set as baseline or disable?",
        action: {
          label: "Set Baseline",
          onClick: () => {
            setBaselineSheetPanKey(panKey);
            setBaselineSheetItem(item);
          },
        },
        cancel: {
          label: "Disable",
          onClick: () => togglePanKey.mutate({ itemId, panKey, currentConfig: panConfig }),
        },
        duration: 5000,
      });
      return;
    }
    
    // Not enabled — enable it
    togglePanKey.mutate({ itemId, panKey, currentConfig: panConfig });
  }, [togglePanKey]);

  const categories = useMemo(() => {
    if (!items) return [];
    const cats = new Set(items.map(i => i.category).filter(Boolean));
    return Array.from(cats).sort() as string[];
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    return items.filter(item => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const name = item.name.toLowerCase();
        return name.includes(q);
      }
      return true;
    });
  }, [items, categoryFilter, searchQuery]);

  const groupedData = useMemo(() => {
    const groups: { category: string; rows: { item: any; cells: Record<string, CellValue> }[] }[] = [];
    const catMap = new Map<string, { item: any; cells: Record<string, CellValue> }[]>();
    
    for (const item of filteredItems) {
      const cat = item.category || "Other";
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push({ item, cells: computeCellValues(item) });
    }
    
    // Sort categories alphabetically
    for (const [category, rows] of Array.from(catMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      groups.push({ category, rows });
    }
    return groups;
  }, [filteredItems]);

  const visibleColumns = UNIT_COLUMNS;

  if (isLoading) {
    return <div className="text-sm text-muted-foreground text-center py-8">Loading items...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search items..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-8 text-sm max-w-[200px]"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 w-auto text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredItems.length} items • tap pan cells to toggle
        </span>
      </div>

      {/* Matrix grid */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-20">
              <tr className="bg-muted/95 backdrop-blur-sm border-b border-border">
                <th className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm text-left px-2 py-2 font-semibold w-[130px] min-w-[130px] max-w-[130px]">
                  Item
                </th>
                {visibleColumns.map(col => (
                  <th key={col.key} className="text-center px-1 py-2 font-medium text-muted-foreground min-w-[64px] whitespace-nowrap">
                    <span className="text-[10px]">{col.label}</span>
                    {col.toggleable && <span className="text-[8px] block text-muted-foreground/50">tap to toggle</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedData.map(({ category, rows }) => (
                <>
                  {/* Category header row */}
                  <tr key={`cat-${category}`} className="bg-muted/40">
                    <td
                      colSpan={visibleColumns.length + 1}
                      className="sticky left-0 z-10 px-3 py-1.5"
                    >
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold ${CATEGORY_COLORS[category] || CATEGORY_COLORS.Other}`}>
                        {category}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-2">{rows.length} items</span>
                    </td>
                  </tr>
                  {rows.map(({ item, cells }, idx) => {
                    const displayName = item.name;
                    const hasIssue = !item.cost_per_unit && !item.blended_price;
                    
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                          idx % 2 === 0 ? "" : "bg-muted/10"
                        }`}
                      >
                        <td className="sticky left-0 z-10 bg-background/95 backdrop-blur-sm px-2 py-1.5 font-medium w-[130px] min-w-[130px] max-w-[130px]">
                          <div className="flex items-center gap-1 min-w-0">
                            {hasIssue && <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" />}
                            <span className="line-clamp-2 text-[11px] leading-tight break-words" title={displayName}>{displayName}</span>
                          </div>
                        </td>
                        
                        {visibleColumns.map(col => {
                          const cell = cells[col.key];
                          if (!cell) return <td key={col.key} className="px-1.5 py-1.5 text-center">—</td>;
                          
                          const { qty, cost, enabled, isBaseline } = cell;
                          const isToggleable = col.toggleable;
                          const panConfig = item.pan_sizes as unknown as PanSizesConfig | null;
                          const hasPanConfig = panConfig?.enabled;
                          
                          if (!enabled) {
                            return (
                              <td
                                key={col.key}
                                className={`px-1.5 py-1.5 text-center ${isToggleable && hasPanConfig ? 'cursor-pointer hover:bg-muted/50 active:bg-muted' : ''}`}
                                onClick={isToggleable ? () => handleCellTap(item.id, col.key, item) : undefined}
                              >
                                <span className="text-muted-foreground/50 text-lg leading-none">
                                  {isToggleable && hasPanConfig ? '○' : '—'}
                                </span>
                              </td>
                            );
                          }
                          
                          return (
                            <td
                              key={col.key}
                              className={`px-1.5 py-1.5 text-center ${
                                isBaseline ? "bg-orange-500/15 ring-1 ring-inset ring-orange-500/30" : ""
                              } ${isToggleable ? 'cursor-pointer hover:bg-muted/50 active:bg-muted' : ''}`}
                              onClick={isToggleable ? () => handleCellTap(item.id, col.key, item) : undefined}
                            >
                              <div className="flex flex-col items-center gap-0">
                                {qty != null ? (
                                  <span className={`font-mono font-semibold text-[11px] ${
                                    isBaseline ? "text-orange-500 font-bold" : "text-foreground"
                                  }`}>
                                    {qty % 1 === 0 ? qty : qty.toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">—</span>
                                )}
                                {cost != null && cost > 0 ? (
                                  <span className="text-[9px] text-muted-foreground font-mono">
                                    ${cost < 1 ? cost.toFixed(3) : cost.toFixed(2)}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground px-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-primary/10 border border-primary/30" /> Baseline
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono font-semibold text-foreground text-[11px]">48</span> = qty per case
        </span>
        <span className="flex items-center gap-1">
          <span className="font-mono text-muted-foreground text-[9px]">$0.72</span> = cost per unit
        </span>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground/50 text-lg leading-none">○</span> = disabled (tap to enable)
        </span>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground/30">—</span> = not available
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 text-destructive" /> = missing price
        </span>
      </div>

      <BaselineConfigSheet
        open={!!baselineSheetItem}
        onOpenChange={(open) => { if (!open) { setBaselineSheetItem(null); setBaselineSheetPanKey(null); } }}
        item={baselineSheetItem}
        locationId={locationId}
        tappedPanKey={baselineSheetPanKey}
      />
    </div>
  );
}
