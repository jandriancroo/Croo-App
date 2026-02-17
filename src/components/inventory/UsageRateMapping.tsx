import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Link2, Loader2, Check, X, Pencil, Search } from "lucide-react";
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
  storage_location: { name: string } | null;
}

const UsageRateMapping = ({ locationId }: UsageRateMappingProps) => {
  const queryClient = useQueryClient();
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [editRateValue, setEditRateValue] = useState("");
  const [addingForItem, setAddingForItem] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

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

  // Fetch inventory items (include pack quantities for conversion)
  const { data: items } = useQuery({
    queryKey: ["inventory-items-usage", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, unit, pack_size, pack_quantity, pack_quantity_override, storage_location:inventory_locations(name)")
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

  // Update rate — user enters individual units, we convert to cases for storage
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

  /** Get the effective pack quantity (override > PFG > null) */
  const getPackQuantity = (itemId: string): number | null => {
    const item = getItem(itemId);
    if (!item) return null;
    return item.pack_quantity_override ?? item.pack_quantity ?? null;
  };

  /** Convert DB rate (cases/unit sold) → display rate (individual units/unit sold) */
  const casesToUnits = (caseRate: number, packQty: number | null): number => {
    if (!packQty || packQty <= 0) return caseRate;
    return Math.round(caseRate * packQty * 100) / 100;
  };

  /** Convert display rate (individual units/unit sold) → DB rate (cases/unit sold) */
  const unitsToCases = (unitRate: number, packQty: number | null): number => {
    if (!packQty || packQty <= 0) return unitRate;
    return Math.round((unitRate / packQty) * 10000) / 10000;
  };

  /** 
   * Parse the sub-unit from pack_size (e.g., "24/20 OZ" → "oz", "6/3 LB" → "lb", "2/5 LB" → "lb")
   * Falls back to "ea" if not parseable 
   */
  const getUnitLabel = (itemId: string): string => {
    const item = getItem(itemId);
    if (!item?.pack_size) return "ea";
    // pack_size format: "COUNT/SIZE UNIT" e.g. "24/20 OZ", "6/3 LB", "1/1000 CT"
    const match = item.pack_size.match(/\d+\/[\d.]+ (.+)/i);
    if (match) {
      const unit = match[1].trim().toLowerCase();
      // Map common PFG abbreviations to friendly labels
      const unitMap: Record<string, string> = {
        'oz': 'oz',
        'lb': 'lb',
        'ga': 'gal',
        'ct': 'ea',
        'ml': 'ml',
        'lt': 'L',
      };
      return unitMap[unit] || unit;
    }
    return "ea";
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
            Add product groups first (above) before mapping items
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Usage Rate Mappings
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Link inventory items to product groups. Enter how many individual units you use per 1 item sold. Rates auto-calculate from counts, or set manually.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
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
              const packQty = getPackQuantity(itemId);
              const unitLabel = getUnitLabel(itemId);

              return (
                <div key={itemId} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{getItemName(itemId)}</p>
                    {packQty && packQty > 1 && (
                      <span className="text-[10px] text-muted-foreground">
                        ({packQty} {unitLabel}/cs)
                      </span>
                    )}
                  </div>
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
                              placeholder="e.g. 1"
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
                                  const caseVal = unitsToCases(displayVal, packQty);
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
                                {casesToUnits(rate.usage_rate, packQty)} {unitLabel}/sold
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
                              // Convert stored case rate to display units
                              const displayVal = rate.usage_rate !== null
                                ? casesToUnits(rate.usage_rate, packQty).toString()
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
      </CardContent>
    </Card>
  );
};

export default UsageRateMapping;
