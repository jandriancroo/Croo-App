import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Package, History, User, Clock, ChevronDown, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import VarianceReport from "./VarianceReport";



interface InventoryCountViewProps {
  countId: string;
  locationId: string;
  periodEndDate?: string;
}

interface CountItem {
  id: string;
  item_id: string;
  quantity: number;
  item: {
    name: string;
    unit: string;
    cost_per_unit: number | null;
    pack_quantity: number | null;
    pack_size: string | null;
    item_number: string | null;
    storage_location: { name: string } | null;
  };
}

interface AuditEdit {
  id: string;
  item_id: string;
  old_qty: number;
  new_qty: number;
  logged_at: string;
  userName: string;
}

const InventoryCountView = ({ countId, locationId, periodEndDate }: InventoryCountViewProps) => {
  // Fetch storage locations in order
  const { data: storageLocations } = useQuery({
    queryKey: ["inventory-storage-locations-view", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("id, name, display_order")
        .eq("location_id", locationId)
        .order("display_order");
      
      if (error) throw error;
      return data;
    }
  });

  // Fetch count items with item details including display_order
  const { data: countItems, isLoading } = useQuery({
    queryKey: ["inventory-count-items-view", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_count_items")
        .select(`
          id,
          item_id,
          quantity,
          entered_cases,
          entered_units,
          storage_location_id,
          count_storage_location:inventory_locations(name, display_order),
          item:inventory_items(
            name,
            name,
            unit,
            cost_per_unit,
            pack_quantity,
            pack_quantity_override,
            pack_size,
            item_number,
            display_order,
            is_recipe,
            storage_location_id,
            storage_location:inventory_locations(name, display_order)
          )
        `)
        .eq("count_id", countId);
      
      if (error) throw error;
      return data as unknown as (CountItem & { 
        storage_location_id: string | null;
        count_storage_location: { name: string; display_order: number } | null;
        item: CountItem['item'] & { display_order: number; storage_location_id: string; storage_location: { name: string; display_order: number } | null } 
      })[];
    }
  });

  // Fetch junction table display_order for shortcuts (unified ordering)
  const { data: junctionOrders } = useQuery({
    queryKey: ["inventory-item-location-orders-view", countId],
    queryFn: async () => {
      const itemIds = countItems?.map(ci => ci.item_id) || [];
      if (itemIds.length === 0) return [];
      const { data, error } = await supabase
        .from("inventory_item_locations")
        .select("item_id, storage_location_id, display_order")
        .in("item_id", itemIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!countItems && countItems.length > 0,
  });

  // Fetch edit history from audit log, grouped by item_id
  const { data: editHistory } = useQuery({
    queryKey: ["inventory-count-audit-edits", countId],
    queryFn: async (): Promise<Map<string, AuditEdit[]>> => {
      const { data, error } = await supabase
        .from("inventory_count_audit_log")
        .select("id, logged_at, user_id, details")
        .eq("count_id", countId)
        .eq("table_name", "inventory_count_items")
        .eq("operation", "UPDATE")
        .order("logged_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!data || data.length === 0) return new Map();

      // Filter to only qty changes
      const qtyChanges = (data as any[]).filter(d => 
        d.details?.old_qty !== undefined && d.details?.new_qty !== undefined && d.details.old_qty !== d.details.new_qty
      );

      // Fetch user profiles
      const userIds = [...new Set(qtyChanges.filter(d => d.user_id).map(d => d.user_id))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        for (const p of profiles || []) {
          profileMap[p.id] = p.full_name || "Unknown";
        }
      }

      // Group by item_id
      const editsByItemId = new Map<string, AuditEdit[]>();
      for (const entry of qtyChanges) {
        const itemId = entry.details?.item_id;
        if (!itemId) continue;
        const edits = editsByItemId.get(itemId) || [];
        edits.push({
          id: entry.id,
          item_id: itemId,
          old_qty: entry.details.old_qty,
          new_qty: entry.details.new_qty,
          logged_at: entry.logged_at,
          userName: entry.user_id ? (profileMap[entry.user_id] || "Unknown") : "System",
        });
        editsByItemId.set(itemId, edits);
      }

      return editsByItemId;
    }
  });

  // Helper to get item value using stored cost_per_unit
  // cost_per_unit is per case, pack_quantity is units per case
  const getItemValue = (item: CountItem) => {
    const overrideQty = (item.item as any)?.pack_quantity_override;
    const baseQty = item.item?.pack_quantity || 1;
    const packQty = overrideQty ?? baseQty;
    return item.quantity * ((item.item?.cost_per_unit || 0) / Math.max(packQty, 1));
  };

  // Build junction order map: "itemId|storLocId" -> display_order
  const junctionOrderMap = new Map<string, number>();
  (junctionOrders || []).forEach((jo: any) => {
    if (typeof jo.display_order === 'number') {
      junctionOrderMap.set(`${jo.item_id}|${jo.storage_location_id}`, jo.display_order);
    }
  });

  // Group items by storage location, maintaining display_order
  const itemsByLocation = countItems?.reduce((acc, item) => {
    // Prefer the count item's own storage location (for multi-location items)
    // Fall back to the item's primary storage location
    const locationName = (item as any).count_storage_location?.name 
      || item.item?.storage_location?.name 
      || "Uncategorized";
    const locationOrder = (item as any).count_storage_location?.display_order 
      ?? (item.item as any)?.storage_location?.display_order 
      ?? 999;
    if (!acc[locationName]) {
      acc[locationName] = { items: [], order: locationOrder };
    }
    acc[locationName].items.push(item);
    return acc;
  }, {} as Record<string, { items: CountItem[]; order: number }>) || {};

  // Sort locations by display_order and items within each location using unified ordering
  // Shortcuts use junction table display_order; primary items use item display_order
  const sortedLocations = Object.entries(itemsByLocation)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([name, data]) => ({
      name,
      items: data.items.sort((a, b) => {
        const aStorLocId = (a as any).storage_location_id || (a.item as any)?.storage_location_id;
        const bStorLocId = (b as any).storage_location_id || (b.item as any)?.storage_location_id;
        const aIsShortcut = aStorLocId && aStorLocId !== (a.item as any)?.storage_location_id;
        const bIsShortcut = bStorLocId && bStorLocId !== (b.item as any)?.storage_location_id;
        const aOrder = aIsShortcut 
          ? (junctionOrderMap.get(`${a.item_id}|${aStorLocId}`) ?? 9999)
          : ((a.item as any)?.display_order ?? 0);
        const bOrder = bIsShortcut
          ? (junctionOrderMap.get(`${b.item_id}|${bStorLocId}`) ?? 9999)
          : ((b.item as any)?.display_order ?? 0);
        return aOrder - bOrder;
      })
    }));

  // Calculate totals
  const totalValue = countItems?.reduce((sum, item) => {
    return sum + getItemValue(item);
  }, 0) || 0;

  const totalItems = countItems?.length || 0;
  const countedItems = countItems?.filter(i => i.quantity > 0).length || 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="items" className="space-y-4">
      <TabsList className="w-full">
        <TabsTrigger value="items" className="flex-1 gap-1.5">
          <Package className="h-4 w-4" />
          Count
        </TabsTrigger>
        <TabsTrigger value="variance" className="flex-1 gap-1.5">
          <BarChart3 className="h-4 w-4" />
          Actual vs Theo
        </TabsTrigger>
      </TabsList>

      <TabsContent value="items" className="space-y-4">
        {/* Edit history now shown inline on highlighted item rows */}
        {/* Summary Card */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-sm mb-1">
                  <Package className="h-4 w-4" />
                  Items
                </div>
                <p className="text-2xl font-bold">{countedItems}/{totalItems}</p>
              </div>
              <div>
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-sm mb-1">
                  <DollarSign className="h-4 w-4" />
                  Total Value
                </div>
                <p className="text-2xl font-bold text-primary">{formatCurrency(totalValue)}</p>
              </div>
              <div>
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-sm mb-1">
                  <History className="h-4 w-4" />
                  Edits
                </div>
                <p className="text-2xl font-bold">{editHistory ? Array.from(editHistory.values()).reduce((sum, edits) => sum + edits.length, 0) : 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Items Table by Location */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Counted Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Accordion type="multiple" defaultValue={sortedLocations.map(l => l.name)} className="w-full">
              {sortedLocations.map(({ name: locationName, items }) => {
                const locationTotal = items.reduce((sum, item) => {
                  return sum + getItemValue(item);
                }, 0);
                
                return (
                  <AccordionItem value={locationName} key={locationName}>
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <span className="font-medium">{locationName}</span>
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary">{items.length} items</Badge>
                          <span className="text-sm text-primary font-medium">{formatCurrency(locationTotal)}</span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-0">
                      <div className="w-full overflow-hidden">
                        <Table className="table-fixed w-full">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-3 w-[40%]">Item</TableHead>
                              <TableHead className="text-right w-[22%] px-1">Counted</TableHead>
                              <TableHead className="text-right w-[13%] px-1">Qty</TableHead>
                              <TableHead className="text-right pr-4 w-[25%]">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((item) => {
                              const hasEnteredValues = (item as any).entered_cases != null || (item as any).entered_units != null;
                              let cases: number;
                              let units: number;
                              if (hasEnteredValues) {
                                cases = (item as any).entered_cases ?? 0;
                                units = (item as any).entered_units ?? 0;
                              } else {
                                const packQty = (item.item as any)?.pack_quantity_override ?? (item.item?.pack_quantity || null);
                                const hasPackQty = packQty != null && packQty > 1;
                                cases = hasPackQty ? Math.floor(item.quantity / packQty) : 0;
                                units = hasPackQty ? Math.round((item.quantity % packQty) * 100) / 100 : item.quantity;
                              }
                              const value = getItemValue(item);
                              const itemEdits = editHistory?.get(item.item_id) || [];
                              const hasEdits = itemEdits.length > 0;
                              
                              const smartParts: string[] = [];
                              if (cases > 0) smartParts.push(`${cases} cs`);
                              if (units > 0) smartParts.push(`${units % 1 === 0 ? units : units.toFixed(1)} ea`);
                              if (smartParts.length === 0 && item.quantity === 0) smartParts.push("0");
                              if (smartParts.length === 0) smartParts.push(`${item.quantity} ea`);
                              const smartSummary = smartParts.join(", ");
                              
                              return (
                                <Collapsible key={item.id} asChild>
                                  <>
                                    <TableRow className={hasEdits ? "cursor-pointer bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/60 dark:hover:bg-amber-950/30 border-l-2 border-l-amber-400" : ""}>
                                      <TableCell className="pl-3">
                                        <div className="flex items-center gap-2">
                                          {hasEdits && (
                                            <CollapsibleTrigger asChild>
                                              <button className="p-0.5 hover:bg-muted rounded">
                                                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                                              </button>
                                            </CollapsibleTrigger>
                                          )}
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-1">
                                              <p className="font-medium truncate text-sm">{item.item?.name}</p>
                                              {hasEdits && (
                                                <Badge variant="outline" className="text-xs py-0 px-1 flex-shrink-0">
                                                  <History className="h-3 w-3" />
                                                  {itemEdits.length}
                                                </Badge>
                                              )}
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate">
                                              {item.item?.item_number && `#${item.item.item_number} · `}
                                              {item.item?.pack_size}
                                            </p>
                                          </div>
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right font-mono text-sm px-1">{smartSummary}</TableCell>
                                      <TableCell className="text-right font-mono text-sm px-1">{item.quantity}</TableCell>
                                      <TableCell className="text-right pr-4 font-medium text-primary text-sm truncate">
                                        {formatCurrency(value)}
                                      </TableCell>
                                    </TableRow>
                                    {hasEdits && (
                                      <CollapsibleContent asChild>
                                        <TableRow className="bg-muted/30">
                                          <TableCell colSpan={5} className="p-0">
                                            <div className="py-2 px-4 space-y-2">
                                              {itemEdits.map((edit) => (
                                                <div key={edit.id} className="flex items-center justify-between text-sm border-l-2 border-amber-400/60 pl-3 py-1">
                                                  <div className="flex items-center gap-3 text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                      <User className="h-3 w-3" />
                                                      {edit.userName}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                      <Clock className="h-3 w-3" />
                                                      {format(new Date(edit.logged_at), "MMM d 'at' h:mm a")}
                                                    </span>
                                                  </div>
                                                  <Badge variant="outline" className="font-mono text-xs">
                                                    <span className="text-destructive">{edit.old_qty}</span>
                                                    {" → "}
                                                    <span className="text-emerald-600">{edit.new_qty}</span>
                                                  </Badge>
                                                </div>
                                              ))}
                                            </div>
                                          </TableCell>
                                        </TableRow>
                                      </CollapsibleContent>
                                    )}
                                  </>
                                </Collapsible>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="variance">
        {periodEndDate ? (
          <VarianceReport
            countId={countId}
            locationId={locationId}
            periodEndDate={periodEndDate}
          />
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              Period end date not available for this count.
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
};

export default InventoryCountView;
