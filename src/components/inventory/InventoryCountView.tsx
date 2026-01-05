import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DollarSign, Package, History, User, Clock, FileText } from "lucide-react";
import { format } from "date-fns";

interface InventoryCountViewProps {
  countId: string;
  locationId: string;
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

interface EditRecord {
  id: string;
  count_item_id: string;
  previous_quantity: number;
  new_quantity: number;
  reason: string | null;
  edited_at: string;
  edited_by_profile: { full_name: string } | null;
  item_name?: string;
}

const InventoryCountView = ({ countId, locationId }: InventoryCountViewProps) => {
  // Fetch count items with item details
  const { data: countItems, isLoading } = useQuery({
    queryKey: ["inventory-count-items-view", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_count_items")
        .select(`
          id,
          item_id,
          quantity,
          item:inventory_items(
            name,
            unit,
            cost_per_unit,
            pack_quantity,
            pack_size,
            item_number,
            storage_location:inventory_locations(name)
          )
        `)
        .eq("count_id", countId);
      
      if (error) throw error;
      return data as unknown as CountItem[];
    }
  });

  // Fetch edit history
  const { data: editHistory } = useQuery({
    queryKey: ["inventory-count-edits", countId],
    queryFn: async () => {
      // First get the count item IDs for this count
      const { data: countItemIds, error: itemError } = await supabase
        .from("inventory_count_items")
        .select("id, item:inventory_items(name)")
        .eq("count_id", countId);
      
      if (itemError) throw itemError;
      
      const ids = countItemIds?.map(ci => ci.id) || [];
      if (ids.length === 0) return [];
      
      const { data, error } = await supabase
        .from("inventory_count_edits")
        .select(`
          id,
          count_item_id,
          previous_quantity,
          new_quantity,
          reason,
          edited_at,
          edited_by_profile:profiles(full_name)
        `)
        .in("count_item_id", ids)
        .order("edited_at", { ascending: false });
      
      if (error) throw error;
      
      // Map item names to edits
      const itemNameMap = new Map(countItemIds?.map(ci => [ci.id, (ci.item as any)?.name || "Unknown"]) || []);
      
      return (data || []).map(edit => ({
        ...edit,
        item_name: itemNameMap.get(edit.count_item_id) || "Unknown"
      })) as EditRecord[];
    }
  });

  // Group items by storage location
  const itemsByLocation = countItems?.reduce((acc, item) => {
    const locationName = item.item?.storage_location?.name || "Uncategorized";
    if (!acc[locationName]) {
      acc[locationName] = [];
    }
    acc[locationName].push(item);
    return acc;
  }, {} as Record<string, CountItem[]>) || {};

  // Calculate totals
  const totalValue = countItems?.reduce((sum, item) => {
    return sum + (item.quantity * ((item.item?.cost_per_unit || 0) / (item.item?.pack_quantity || 1)));
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
    <div className="space-y-4">
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
              <p className="text-2xl font-bold">{editHistory?.length || 0}</p>
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
          <Accordion type="multiple" defaultValue={Object.keys(itemsByLocation)} className="w-full">
            {Object.entries(itemsByLocation).map(([locationName, items]) => {
              const locationTotal = items.reduce((sum, item) => {
                return sum + (item.quantity * ((item.item?.cost_per_unit || 0) / (item.item?.pack_quantity || 1)));
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
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-4">Item</TableHead>
                            <TableHead className="text-right">Cases</TableHead>
                            <TableHead className="text-right">Units</TableHead>
                            <TableHead className="text-right">Total Qty</TableHead>
                            <TableHead className="text-right pr-4">Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item) => {
                            const packQty = item.item?.pack_quantity || 1;
                            const cases = Math.floor(item.quantity / packQty);
                            const units = item.quantity % packQty;
                            const value = item.quantity * ((item.item?.cost_per_unit || 0) / packQty);
                            
                            return (
                              <TableRow key={item.id}>
                                <TableCell className="pl-4">
                                  <div>
                                    <p className="font-medium">{item.item?.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {item.item?.item_number && `#${item.item.item_number} · `}
                                      {item.item?.pack_size}
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono">{cases}</TableCell>
                                <TableCell className="text-right font-mono">{units}</TableCell>
                                <TableCell className="text-right font-mono">{item.quantity}</TableCell>
                                <TableCell className="text-right pr-4 font-medium text-primary">
                                  {formatCurrency(value)}
                                </TableCell>
                              </TableRow>
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

      {/* Edit History */}
      {editHistory && editHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              Change History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-64">
              <div className="divide-y divide-border">
                {editHistory.map((edit) => (
                  <div key={edit.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">{edit.item_name}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <User className="h-3 w-3" />
                          <span>{edit.edited_by_profile?.full_name || "Unknown"}</span>
                          <span>•</span>
                          <Clock className="h-3 w-3" />
                          <span>{format(new Date(edit.edited_at), "MMM d, yyyy 'at' h:mm a")}</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <Badge variant="outline" className="font-mono">
                          {edit.previous_quantity} → {edit.new_quantity}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {edit.new_quantity > edit.previous_quantity ? '+' : ''}{edit.new_quantity - edit.previous_quantity} units
                        </p>
                      </div>
                    </div>
                    {edit.reason && (
                      <div className="flex items-start gap-2 text-sm bg-muted/50 rounded-md p-2">
                        <FileText className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>{edit.reason}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default InventoryCountView;
