import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Link2, Loader2, Check, X, Pencil, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";

interface UsageRateMappingProps {
  locationId: string;
}

interface UsageRate {
  id: string;
  inventory_item_id: string;
  product_group_id: string;
  usage_rate: number | null;
  rate_unit: string;
  manual_override: boolean;
  calculated_from_period_start: string | null;
  calculated_from_period_end: string | null;
  last_calculated_at: string | null;
}

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  pack_size: string | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  count_unit: string | null;
  count_units_per_case: number | null;
  cost_per_unit: number | null;
  is_recipe: boolean | null;
  storage_location: { name: string } | null;
}

const TO_OZ_MAP: Record<string, number> = {
  oz: 1, qt: 32, lb: 16, gal: 128, ml: 0.033814, cups: 8, ea: 1, tbsp: 0.5, tsp: 0.1667,
};

/** Parse pack_size like "2/5 LB", "6/5#", "25#" → { count, size, unit } */
const parsePackSize = (packSize: string | null): { count: number; size: number; unit: string } | null => {
  if (!packSize) return null;
  // Handle # as LB: "6/5#" → count=6, size=5, unit=LB
  const poundSlash = packSize.match(/^(\d+)\/([\d.]+)\s*#$/);
  if (poundSlash) return { count: parseInt(poundSlash[1]), size: parseFloat(poundSlash[2]), unit: "LB" };
  // Standalone pound: "25#" → count=1, size=25, unit=LB
  const poundStandalone = packSize.match(/^([\d.]+)\s*#$/);
  if (poundStandalone) return { count: 1, size: parseFloat(poundStandalone[1]), unit: "LB" };
  // Standard: "2/5 LB", "1/5 GA"
  const match = packSize.match(/^(\d+)\/([\d.]+)\s*(.+)$/i);
  if (!match) return null;
  return { count: parseInt(match[1]), size: parseFloat(match[2]), unit: match[3].trim().toUpperCase() };
};

/** Get smart unit options based on pack_size unit type, with auto-calculated units per case */
const getSmartUnitOptions = (item: InventoryItem): { unit: string; unitsPerCase: number; label: string }[] => {
  // For recipe items, use the saved count_unit/count_units_per_case (set from yield)
  if (item.is_recipe && item.count_unit && item.count_units_per_case) {
    const yieldUnit = item.count_unit;
    const yieldQty = item.count_units_per_case;
    const options = [
      { unit: yieldUnit, unitsPerCase: yieldQty, label: `${yieldUnit} (${yieldQty}/batch)` },
    ];
    // Add oz conversion if yield isn't already oz
    if (yieldUnit !== "oz" && TO_OZ_MAP[yieldUnit]) {
      const totalOz = yieldQty * TO_OZ_MAP[yieldUnit];
      options.push({ unit: "oz", unitsPerCase: Math.round(totalOz * 100) / 100, label: `oz (${Math.round(totalOz)}/batch)` });
    }
    return options;
  }

  const parsed = parsePackSize(item.pack_size);
  if (!parsed) return [{ unit: "ea", unitsPerCase: item.pack_quantity || 1, label: `ea (${item.pack_quantity || 1}/cs)` }];

  const totalRaw = parsed.count * parsed.size;
  const options: { unit: string; unitsPerCase: number; label: string }[] = [];

  switch (parsed.unit) {
    case "LB":
      options.push({ unit: "oz", unitsPerCase: Math.round(totalRaw * 16 * 100) / 100, label: `oz (${Math.round(totalRaw * 16)}/cs)` });
      options.push({ unit: "lb", unitsPerCase: totalRaw, label: `lb (${totalRaw}/cs)` });
      break;
    case "OZ":
      options.push({ unit: "oz", unitsPerCase: Math.round(totalRaw * 100) / 100, label: `oz (${Math.round(totalRaw)}/cs)` });
      if (totalRaw >= 16) {
        options.push({ unit: "lb", unitsPerCase: Math.round(totalRaw / 16 * 100) / 100, label: `lb (${Math.round(totalRaw / 16 * 100) / 100}/cs)` });
      }
      break;
    case "GA":
      options.push({ unit: "oz", unitsPerCase: Math.round(totalRaw * 128), label: `oz (${Math.round(totalRaw * 128)}/cs)` });
      options.push({ unit: "gal", unitsPerCase: totalRaw, label: `gal (${totalRaw}/cs)` });
      break;
    case "CT":
      options.push({ unit: "ea", unitsPerCase: totalRaw, label: `ea (${totalRaw}/cs)` });
      options.push({ unit: "cs", unitsPerCase: 1, label: `cs (1/cs)` });
      break;
    case "KG":
      options.push({ unit: "oz", unitsPerCase: Math.round(totalRaw * 35.274 * 100) / 100, label: `oz (${Math.round(totalRaw * 35.274)}/cs)` });
      options.push({ unit: "lb", unitsPerCase: Math.round(totalRaw * 2.205 * 100) / 100, label: `lb (${Math.round(totalRaw * 2.205 * 100) / 100}/cs)` });
      break;
    default:
      options.push({ unit: "ea", unitsPerCase: parsed.count * parsed.size, label: `ea (${parsed.count * parsed.size}/cs)` });
      break;
  }

  return options;
};

const UsageRateMapping = ({ locationId }: UsageRateMappingProps) => {
  const queryClient = useQueryClient();
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [editRateValue, setEditRateValue] = useState("");
  const [addingForItem, setAddingForItem] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUnitItemId, setEditingUnitItemId] = useState<string | null>(null);
  const [editCountUnit, setEditCountUnit] = useState("");
  const [editUnitsPerCase, setEditUnitsPerCase] = useState("");

  // Fetch product groups
  const { data: groups } = useQuery({
    queryKey: ["inventory-product-groups", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_product_groups")
        .select("*")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data;
    },
  });

  // Fetch inventory items (include pack quantities + count unit for conversion)
  const { data: items } = useQuery({
    queryKey: ["inventory-items-usage", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, unit, pack_size, pack_quantity, pack_quantity_override, count_unit, count_units_per_case, cost_per_unit, is_recipe, storage_location:inventory_locations(name)")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as InventoryItem[];
    },
  });

  // Fetch existing usage rates
  const { data: usageRates, isLoading } = useQuery({
    queryKey: ["inventory-usage-rates", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_usage_rates")
        .select("*")
        .eq("location_id", locationId);
      if (error) throw error;
      return data as UsageRate[];
    },
  });

  // Add mapping
  const addMutation = useMutation({
    mutationFn: async ({ itemId, groupId }: { itemId: string; groupId: string }) => {
      const { error } = await supabase
        .from("inventory_usage_rates")
        .insert({
          location_id: locationId,
          inventory_item_id: itemId,
          product_group_id: groupId,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-usage-rates", locationId] });
      toast.success("Item linked to group");
      setAddingForItem(null);
      setSelectedGroup("");
    },
    onError: (err: any) => {
      if (err?.message?.includes("duplicate")) {
        toast.error("This item is already linked to that group");
      } else {
        toast.error("Failed to add mapping");
      }
    },
  });

  // Update rate — user enters in count_unit, we convert to cases for storage
  const updateRateMutation = useMutation({
    mutationFn: async ({ id, rate }: { id: string; rate: number | null }) => {
      const { error } = await supabase
        .from("inventory_usage_rates")
        .update({
          usage_rate: rate,
          manual_override: rate !== null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-usage-rates", locationId] });
      toast.success("Rate updated");
      setEditingRateId(null);
    },
    onError: () => toast.error("Failed to update rate"),
  });

  // Update count unit on item
  const updateCountUnitMutation = useMutation({
    mutationFn: async ({ itemId, countUnit, unitsPerCase }: { itemId: string; countUnit: string; unitsPerCase: number }) => {
      const { error } = await supabase
        .from("inventory_items")
        .update({
          count_unit: countUnit,
          count_units_per_case: unitsPerCase,
        })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items-usage", locationId] });
      toast.success("Count unit saved");
      setEditingUnitItemId(null);
    },
    onError: () => toast.error("Failed to save count unit"),
  });

  // Delete mapping
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("inventory_usage_rates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-usage-rates", locationId] });
      toast.success("Mapping removed");
    },
    onError: () => toast.error("Failed to remove mapping"),
  });

  const getGroupName = (groupId: string) =>
    groups?.find((g) => g.id === groupId)?.name || "Unknown";

  const getItemName = (itemId: string) =>
    items?.find((i) => i.id === itemId)?.name || "Unknown";

  const getItem = (itemId: string) =>
    items?.find((i) => i.id === itemId);

  /** Get count_units_per_case for conversion. If not set, fall back to pack_quantity logic */
  const getUnitsPerCase = (itemId: string): number | null => {
    const item = getItem(itemId);
    if (!item) return null;
    // Prefer explicit count_units_per_case
    if (item.count_units_per_case && item.count_units_per_case > 0) {
      return item.count_units_per_case;
    }
    // Fallback to pack_quantity
    return item.pack_quantity_override ?? item.pack_quantity ?? null;
  };

  /** Get the display unit label */
  const getUnitLabel = (itemId: string): string => {
    const item = getItem(itemId);
    // If custom count_unit is set, use it
    if (item?.count_unit) return item.count_unit;
    // Fallback: parse from pack_size
    if (item?.pack_size) {
      const match = item.pack_size.match(/\d+\/[\d.]+ (.+)/i);
      if (match) {
        const unit = match[1].trim().toLowerCase();
        const unitMap: Record<string, string> = { 'oz': 'oz', 'lb': 'lb', 'ga': 'gal', 'ct': 'ea', 'ml': 'ml', 'lt': 'L' };
        return unitMap[unit] || unit;
      }
    }
    return "ea";
  };

  /** Convert DB rate (cases/unit sold) → display rate (count_unit/unit sold) */
  const casesToDisplay = (caseRate: number, itemId: string): number => {
    const upc = getUnitsPerCase(itemId);
    if (!upc || upc <= 0) return caseRate;
    return Math.round(caseRate * upc * 100) / 100;
  };

  /** Convert display rate (count_unit/unit sold) → DB rate (cases/unit sold) */
  const displayToCases = (displayRate: number, itemId: string): number => {
    const upc = getUnitsPerCase(itemId);
    if (!upc || upc <= 0) return displayRate;
    return displayRate / upc;
  };

  // Group rates by item
  const ratesByItem = new Map<string, UsageRate[]>();
  usageRates?.forEach((rate) => {
    const existing = ratesByItem.get(rate.inventory_item_id) || [];
    existing.push(rate);
    ratesByItem.set(rate.inventory_item_id, existing);
  });

  // Items with mappings
  const mappedItemIds = new Set(usageRates?.map((r) => r.inventory_item_id) || []);
  const unmappedItems = items?.filter((i) => !mappedItemIds.has(i.id)) || [];

  // Filter by search
  const lowerSearch = searchQuery.toLowerCase().trim();
  const filteredMappedEntries = lowerSearch
    ? Array.from(ratesByItem.entries()).filter(([itemId]) =>
        getItemName(itemId).toLowerCase().includes(lowerSearch)
      )
    : Array.from(ratesByItem.entries());
  const filteredUnmapped = lowerSearch
    ? unmappedItems.filter((i) => i.name.toLowerCase().includes(lowerSearch))
    : unmappedItems;

  if (!groups || groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground text-center">
            Add POS mappings first (above) before linking items
          </p>
        </CardContent>
      </Card>
    );
  }

  const openUnitEditor = (itemId: string) => {
    setEditingUnitItemId(itemId);
    setEditCountUnit("");
    setEditUnitsPerCase("");
  };

  const saveCountUnit = () => {
    if (!editingUnitItemId || !editCountUnit.trim() || !editUnitsPerCase.trim()) {
      toast.error("Enter both unit name and units per case");
      return;
    }
    updateCountUnitMutation.mutate({
      itemId: editingUnitItemId,
      countUnit: editCountUnit.trim().toLowerCase(),
      unitsPerCase: parseFloat(editUnitsPerCase),
    });
  };

  return (
    <Card>
      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Link2 className="h-4 w-4" />
            Usage Rate Mappings
          </div>
          <p className="text-xs text-muted-foreground">
            Link items to POS mappings and enter how much of each item goes into one unit sold (e.g., 8 oz of mozz per large pizza).
          </p>
        </div>
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
        ) : (
          <div className="max-h-[500px] overflow-y-auto space-y-4 pr-1">
            {/* Existing mappings grouped by item */}
            {filteredMappedEntries.map(([itemId, rates]) => {
              const unitLabel = getUnitLabel(itemId);
              const item = getItem(itemId);
              const hasCustomUnit = !!item?.count_unit && !!item?.count_units_per_case;
              const upc = getUnitsPerCase(itemId);
              const costPerUnit = (item?.cost_per_unit && upc && upc > 0)
                ? (item.cost_per_unit / upc)
                : null;

              return (
                <div key={itemId} className="border rounded-lg p-3 space-y-2">
                  {/* Item header with unit config */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{getItemName(itemId)}</p>
                      {hasCustomUnit ? (
                        <span className="text-[10px] text-muted-foreground">
                          ({item!.count_units_per_case} {item!.count_unit}/cs)
                        </span>
                      ) : (
                        <span className="text-[10px] text-destructive">
                          ⚠ Set unit
                        </span>
                      )}
                      {costPerUnit !== null && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          ${costPerUnit.toFixed(2)}/{unitLabel}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => openUnitEditor(itemId)}
                      title="Configure counting unit"
                    >
                      <Settings2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Inline unit selector — auto-derived from pack_size */}
                  {editingUnitItemId === itemId && (() => {
                    const smartOptions = getSmartUnitOptions(item!);
                    return (
                      <div className="flex items-center gap-2 pl-3 py-1.5 bg-muted/50 rounded flex-wrap">
                        <span className="text-xs text-muted-foreground">Count in:</span>
                        {smartOptions.map((opt) => (
                          <Button
                            key={opt.unit}
                            variant={editCountUnit === opt.unit ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-xs px-3"
                            onClick={() => {
                              setEditCountUnit(opt.unit);
                              setEditUnitsPerCase(opt.unitsPerCase.toString());
                            }}
                          >
                            {opt.label}
                          </Button>
                        ))}
                        {editCountUnit && (
                          <>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={saveCountUnit}
                              disabled={updateCountUnitMutation.isPending}>
                              {updateCountUnitMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-green-600" />}
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingUnitItemId(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })()}

                  {/* Rate rows per product group */}
                  {rates.map((rate) => (
                    <div key={rate.id} className="flex items-center justify-between gap-2 pl-3">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {getGroupName(rate.product_group_id)}
                        </Badge>
                        {editingRateId === rate.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              step="0.01"
                              className="h-7 w-20 text-xs"
                              value={editRateValue}
                              onChange={(e) => setEditRateValue(e.target.value)}
                              autoFocus
                              placeholder="e.g. 8"
                            />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {unitLabel}/sold
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => {
                                if (editRateValue.trim() === "") {
                                  updateRateMutation.mutate({ id: rate.id, rate: null });
                                } else {
                                  const displayVal = parseFloat(editRateValue);
                                  const caseVal = displayToCases(displayVal, itemId);
                                  updateRateMutation.mutate({ id: rate.id, rate: caseVal });
                                }
                              }}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setEditingRateId(null)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            {rate.usage_rate !== null ? (
                              <span className="text-xs font-mono">
                                {casesToDisplay(rate.usage_rate, itemId)} {unitLabel}/sold
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">
                                No rate yet
                              </span>
                            )}
                            {rate.manual_override && (
                              <Badge variant="secondary" className="text-[10px] px-1">Manual</Badge>
                            )}
                            {rate.last_calculated_at && !rate.manual_override && (
                              <Badge variant="secondary" className="text-[10px] px-1">Auto</Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {editingRateId !== rate.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditingRateId(rate.id);
                              const displayVal = rate.usage_rate !== null
                                ? casesToDisplay(rate.usage_rate, itemId).toString()
                                : "";
                              setEditRateValue(displayVal);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(rate.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Add another group to this item */}
                  {addingForItem === itemId ? (
                    <div className="flex items-center gap-2 pl-3">
                      <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                        <SelectTrigger className="h-8 text-xs w-40">
                          <SelectValue placeholder="Select group" />
                        </SelectTrigger>
                        <SelectContent>
                          {groups
                            ?.filter((g) => !rates.some((r) => r.product_group_id === g.id))
                            .map((g) => (
                              <SelectItem key={g.id} value={g.id} className="text-xs">
                                {g.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        disabled={!selectedGroup || addMutation.isPending}
                        onClick={() => addMutation.mutate({ itemId, groupId: selectedGroup })}
                      >
                        {addMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => { setAddingForItem(null); setSelectedGroup(""); }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 ml-3"
                      onClick={() => setAddingForItem(itemId)}
                    >
                      + Add group
                    </Button>
                  )}
                </div>
              );
            })}

            {/* Unmapped items */}
            {filteredUnmapped.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Unmapped Items ({filteredUnmapped.length})
                </p>
                <div className="space-y-1">
                  {filteredUnmapped.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                      <span className="text-sm truncate">{item.name}</span>
                      {addingForItem === item.id ? (
                        <div className="flex items-center gap-2">
                          <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                            <SelectTrigger className="h-7 text-xs w-36">
                              <SelectValue placeholder="Select group" />
                            </SelectTrigger>
                            <SelectContent>
                              {groups?.map((g) => (
                                <SelectItem key={g.id} value={g.id} className="text-xs">
                                  {g.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            disabled={!selectedGroup || addMutation.isPending}
                            onClick={() => addMutation.mutate({ itemId: item.id, groupId: selectedGroup })}
                          >
                            {addMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs px-2"
                            onClick={() => { setAddingForItem(null); setSelectedGroup(""); }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => { setAddingForItem(item.id); setSelectedGroup(""); }}
                        >
                          <Link2 className="h-3 w-3 mr-1" />
                          Link
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredMappedEntries.length === 0 && filteredUnmapped.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {lowerSearch ? "No items match your search" : "No inventory items found. Sync from PFG first."}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default UsageRateMapping;
