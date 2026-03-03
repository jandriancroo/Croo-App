/**
 * UnitMatrixView — Spreadsheet-like grid for validating all item units, 
 * pan sizes, and pricing at a glance. Horizontally scrollable with frozen item name column.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Check, AlertTriangle, Filter } from "lucide-react";
import { ALL_CONTAINERS, type PanSizesConfig, getPanUnits } from "./PanSizesSection";

interface UnitMatrixViewProps {
  locationId: string;
}

/** The unit columns we show in the matrix */
const UNIT_COLUMNS = [
  { key: "case", label: "Case", description: "Full vendor case" },
  { key: "unit", label: "Unit", description: "Individual unit from case" },
  { key: "oz", label: "oz", description: "Ounces (weight)" },
  ...ALL_CONTAINERS
    .filter(c => c.blazeDefault || ["full_pan", "half_pan", "dough_box"].includes(c.key))
    .map(c => ({ key: `pan_${c.key}`, label: c.label, description: c.description })),
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

/** Parse pack_size string to extract weight in oz. E.g. "6/5 LB" → 30 oz per unit = 480 oz per case */
function parsePackSizeOz(packSize: string | null, packQuantity: number | null): { ozPerUnit: number | null; ozPerCase: number | null } {
  if (!packSize) return { ozPerUnit: null, ozPerCase: null };
  
  // Match patterns like "6/5 LB", "4/3 LB", "2/.8 GA", "32/2.75 OZ", "1/5 GA", "4#", "2.5#"
  const match = packSize.match(/(?:(\d+)\/)?([\d.]+)\s*(LB|OZ|GA|#|KG)/i);
  if (!match) return { ozPerUnit: null, ozPerCase: null };
  
  const countInPack = match[1] ? parseFloat(match[1]) : 1;
  const amount = parseFloat(match[2]);
  const unit = match[3].toUpperCase();
  
  let ozPerSubUnit = 0;
  switch (unit) {
    case "LB":
    case "#":
      ozPerSubUnit = amount * 16;
      break;
    case "OZ":
      ozPerSubUnit = amount;
      break;
    case "GA":
      ozPerSubUnit = amount * 128; // 1 gallon = 128 oz
      break;
    case "KG":
      ozPerSubUnit = amount * 35.274;
      break;
    default:
      return { ozPerUnit: null, ozPerCase: null };
  }
  
  const ozPerUnit = ozPerSubUnit; // oz per individual sub-unit
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
  const { ozPerUnit, ozPerCase } = parsePackSizeOz(item.pack_size, packQty);
  
  // Case column
  cells["case"] = {
    qty: 1,
    cost: cost,
    enabled: true, // Cases always relevant for vendor items
  };
  
  // Unit column (individual items from a case)
  cells["unit"] = {
    qty: packQty,
    cost: cost && packQty > 0 ? cost / packQty : null,
    enabled: packQty > 1,
  };
  
  // Oz column
  cells["oz"] = {
    qty: ozPerCase,
    cost: ozPerCase && cost ? cost / ozPerCase : null,
    enabled: ozPerCase != null && ozPerCase > 0,
  };
  
  // Pan columns
  for (const container of ALL_CONTAINERS) {
    const colKey = `pan_${container.key}`;
    // Check if this column exists in our UNIT_COLUMNS
    if (!UNIT_COLUMNS.find(c => c.key === colKey)) continue;
    
    if (panConfig?.enabled) {
      const units = getPanUnits(panConfig, container.key);
      const isEnabled = panConfig.enabled_keys.includes(container.key);
      const isBaseline = panConfig.baseline_key === container.key;
      
      // Cost per pan: if we know cost per individual unit and pan units
      let panCost: number | null = null;
      if (units != null && cost != null && packQty > 0) {
        const costPerIndividualUnit = cost / packQty;
        panCost = costPerIndividualUnit * units;
      }
      
      cells[colKey] = {
        qty: units,
        cost: panCost,
        enabled: isEnabled,
        isBaseline,
      };
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

  // Get unique categories
  const categories = useMemo(() => {
    if (!items) return [];
    const cats = new Set(items.map(i => i.category).filter(Boolean));
    return Array.from(cats).sort() as string[];
  }, [items]);

  // Filter items
  const filteredItems = useMemo(() => {
    if (!items) return [];
    return items.filter(item => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const name = ((item as any).common_name || item.name).toLowerCase();
        return name.includes(q);
      }
      return true;
    });
  }, [items, categoryFilter, searchQuery]);

  // Compute cell values for all items
  const matrixData = useMemo(() => {
    return filteredItems.map(item => ({
      item,
      cells: computeCellValues(item),
    }));
  }, [filteredItems]);

  // Columns to actually render (only ones used by UNIT_COLUMNS)
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
          {filteredItems.length} items
        </span>
      </div>

      {/* Matrix grid */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            {/* Header */}
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="sticky left-0 z-10 bg-muted/90 backdrop-blur-sm text-left px-3 py-2 font-semibold min-w-[180px] max-w-[220px]">
                  Item
                </th>
                <th className="text-left px-2 py-2 font-medium text-muted-foreground min-w-[70px]">
                  Cat
                </th>
                {visibleColumns.map(col => (
                  <th key={col.key} className="text-center px-1.5 py-2 font-medium text-muted-foreground min-w-[80px] whitespace-nowrap">
                    <span className="text-[10px]">{col.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixData.map(({ item, cells }, idx) => {
                const displayName = (item as any).common_name || item.name;
                const hasIssue = !item.cost_per_unit && !item.blended_price;
                
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                      idx % 2 === 0 ? "" : "bg-muted/10"
                    }`}
                  >
                    {/* Frozen item name */}
                    <td className="sticky left-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-1.5 font-medium truncate max-w-[220px]">
                      <div className="flex items-center gap-1.5">
                        {hasIssue && <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" />}
                        <span className="truncate" title={displayName}>{displayName}</span>
                      </div>
                    </td>
                    
                    {/* Category badge */}
                    <td className="px-2 py-1.5">
                      {item.category && (
                        <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.Other}`}>
                          {item.category}
                        </span>
                      )}
                    </td>
                    
                    {/* Unit columns */}
                    {visibleColumns.map(col => {
                      const cell = cells[col.key];
                      if (!cell) return <td key={col.key} className="px-1.5 py-1.5 text-center">—</td>;
                      
                      const { qty, cost, enabled, isBaseline } = cell;
                      
                      if (!enabled) {
                        return (
                          <td key={col.key} className="px-1.5 py-1.5 text-center">
                            <span className="text-muted-foreground/30">—</span>
                          </td>
                        );
                      }
                      
                      return (
                        <td
                          key={col.key}
                          className={`px-1.5 py-1.5 text-center ${
                            isBaseline ? "bg-primary/5" : ""
                          }`}
                        >
                          <div className="flex flex-col items-center gap-0">
                            {qty != null ? (
                              <span className={`font-mono font-semibold text-[11px] ${
                                isBaseline ? "text-primary" : "text-foreground"
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
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-1">
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
          <span className="text-muted-foreground/30">—</span> = disabled
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 text-destructive" /> = missing price
        </span>
      </div>
    </div>
  );
}
