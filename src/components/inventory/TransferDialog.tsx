import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, X, ArrowRight, Loader2, Package, Minus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useInventoryTransfers, TransferItem } from "@/hooks/useInventoryTransfers";
import { useLocation } from "@/hooks/useLocation";
import { Textarea } from "@/components/ui/textarea";

interface TransferDialogProps {
  open: boolean;
  onClose: () => void;
  locationId: string;
}

export default function TransferDialog({ open, onClose, locationId }: TransferDialogProps) {
  const { user } = useAuth();
  const { locations } = useLocation();
  const { sendTransfer } = useInventoryTransfers(locationId);
  const [toLocationId, setToLocationId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<(TransferItem & { name: string; packQty: number })[]>([]);
  const [notes, setNotes] = useState("");

  // Other locations (exclude current)
  const otherLocations = useMemo(
    () => locations.filter(l => l.id !== locationId),
    [locations, locationId]
  );

  // Fetch inventory items for this location
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory-items-for-transfer", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, common_name, cost_per_unit, blended_price, pack_quantity, count_units_per_case, category")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const filteredItems = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return inventoryItems
      .filter(i => {
        const displayName = i.common_name || i.name;
        return displayName.toLowerCase().includes(q);
      })
      .slice(0, 15);
  }, [search, inventoryItems]);

  const addItem = (item: typeof inventoryItems[0]) => {
    if (items.find(i => i.item_id === item.id)) return;
    const cost = item.blended_price ?? item.cost_per_unit ?? 0;
    setItems(prev => [
      ...prev,
      {
        item_id: item.id,
        quantity: 1,
        unit_type: "case" as const,
        cost_per_unit: Number(cost),
        name: item.common_name || item.name,
        packQty: item.count_units_per_case || item.pack_quantity || 1,
      },
    ]);
    setSearch("");
  };

  const updateItem = (idx: number, updates: Partial<TransferItem>) => {
    setItems(prev => prev.map((item, i) => (i === idx ? { ...item, ...updates } : item)));
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async () => {
    if (!toLocationId || items.length === 0 || !user?.id) return;
    await sendTransfer.mutateAsync({
      toLocationId,
      items: items.map(({ item_id, quantity, unit_type, cost_per_unit }) => ({
        item_id,
        quantity,
        unit_type,
        cost_per_unit,
      })),
      notes: notes || undefined,
      userId: user.id,
    });
    // Reset
    setItems([]);
    setToLocationId("");
    setNotes("");
    setSearch("");
    onClose();
  };

  const totalCost = items.reduce((sum, item) => {
    // cost_per_unit is the case-level cost from the DB (blended_price or cost_per_unit)
    // For cases: qty * case cost. For units: qty * (case cost / packQty)
    const unitCost = item.unit_type === "case" 
      ? (item.cost_per_unit || 0) 
      : (item.cost_per_unit || 0) / Math.max(item.packQty, 1);
    return sum + item.quantity * unitCost;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Transfer Inventory
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Destination location */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Transfer To</label>
            <Select value={toLocationId} onValueChange={setToLocationId}>
              <SelectTrigger>
                <SelectValue placeholder="Select location..." />
              </SelectTrigger>
              <SelectContent>
                {otherLocations.map(loc => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Item search */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Add Items</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {/* Search results */}
            {filteredItems.length > 0 && (
              <div className="mt-1 border rounded-lg bg-card max-h-40 overflow-y-auto divide-y">
                {filteredItems.map(item => {
                  const already = items.some(i => i.item_id === item.id);
                  return (
                    <button
                      key={item.id}
                      className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-muted/50 disabled:opacity-40"
                      onClick={() => addItem(item)}
                      disabled={already}
                    >
                      <div>
                        <p className="text-sm font-medium">{item.common_name || item.name}</p>
                        <p className="text-[10px] text-muted-foreground">{item.category}</p>
                      </div>
                      {already ? (
                        <Badge variant="secondary" className="text-[10px]">Added</Badge>
                      ) : (
                        <Plus className="h-4 w-4 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {items.length} item{items.length !== 1 ? "s" : ""} to transfer
              </p>
              {items.map((item, idx) => (
                <div key={item.item_id} className="p-2.5 rounded-lg bg-muted/40 border border-border/40">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium truncate flex-1">{item.name}</p>
                    <button onClick={() => removeItem(idx)} className="ml-2 text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border rounded-md bg-background">
                      <button
                        className="px-2 py-1 hover:bg-muted"
                        onClick={() => updateItem(idx, { quantity: Math.max(0.5, item.quantity - (item.unit_type === "case" ? 1 : 1)) })}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={e => updateItem(idx, { quantity: Math.max(0, Number(e.target.value)) })}
                        className="w-16 text-center border-0 h-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        className="px-2 py-1 hover:bg-muted"
                        onClick={() => updateItem(idx, { quantity: item.quantity + (item.unit_type === "case" ? 1 : 1) })}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <Select
                      value={item.unit_type}
                      onValueChange={(v: "unit" | "case") => updateItem(idx, { unit_type: v })}
                    >
                      <SelectTrigger className="w-24 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="case">Cases</SelectItem>
                        <SelectItem value="unit">Units</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}

              {/* Total cost estimate */}
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-xs text-muted-foreground">Est. Value</span>
                <span className="text-sm font-semibold">${totalCost.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label>
            <Textarea
              placeholder="e.g. Running low on dough at Hemet..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>

          {/* Send button */}
          <Button
            className="w-full gap-2"
            disabled={!toLocationId || items.length === 0 || sendTransfer.isPending}
            onClick={handleSend}
          >
            {sendTransfer.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Send Transfer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
