import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ArrowRightLeft, EyeOff, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface RemapItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: {
    id: string;
    name: string;
    qubeyond_item_id: string | null;
    item_number: string | null;
    brand: string | null;
    pack_size: string | null;
    storage_location_id: string | null;
    category: string | null;
    common_name: string | null;
  } | null;
  locationId: string;
  bidGuideHeaderId: string;
  customerId: string;
}

interface BidProduct {
  id: string;
  itemNumber: string;
  name: string;
  fullDescription: string;
  brand: string;
  packSize: string;
  packQuantity: number | null;
  unit: string;
  imageUrl: string | null;
  price: number | null;
  categoryName: string;
}

const RemapItemDialog = ({ open, onOpenChange, item, locationId, bidGuideHeaderId, customerId }: RemapItemDialogProps) => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<BidProduct[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isRemapping, setIsRemapping] = useState(false);

  const searchBidGuide = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setHasSearched(true);

    try {
      const { data, error } = await supabase.functions.invoke("pfg-service", {
        body: {
          locationId,
          action: "search_bid_guide",
          bidGuideHeaderId,
          customerId,
          searchQuery: searchQuery.trim(),
        }
      });

      if (error) throw error;
      setResults(data?.data?.products || []);
    } catch (err) {
      console.error("Bid guide search error:", err);
      toast.error("Failed to search bid guide");
    } finally {
      setIsSearching(false);
    }
  };

  const handleRemap = async (newProduct: BidProduct, mode: "update" | "replace") => {
    if (!item) return;
    setIsRemapping(true);

    try {
      const syncTimestamp = new Date().toISOString();

      if (mode === "update") {
        // If sync already created the target SKU, archive that duplicate first so we can preserve this item's history.
        const { data: conflictingItems, error: conflictLookupError } = await supabase
          .from("inventory_items")
          .select("id")
          .eq("location_id", locationId)
          .eq("is_active", true)
          .eq("qubeyond_item_id", newProduct.id)
          .neq("id", item.id);

        if (conflictLookupError) throw conflictLookupError;

        if ((conflictingItems || []).length > 0) {
          const conflictIds = (conflictingItems || []).map((row) => row.id);
          const { error: conflictArchiveError } = await supabase
            .from("inventory_items")
            .update({
              is_active: false,
              remap_status: "merged_duplicate",
              last_synced_at: syncTimestamp,
            } as any)
            .in("id", conflictIds);

          if (conflictArchiveError) throw conflictArchiveError;
        }

        // Update in place — swap PFG link, keep history
        const { data: updatedItem, error: updateError } = await supabase
          .from("inventory_items")
          .update({
            qubeyond_item_id: newProduct.id,
            item_number: newProduct.itemNumber,
            name: newProduct.name,
            brand: newProduct.brand,
            pack_size: newProduct.packSize,
            pack_quantity: newProduct.packQuantity,
            cost_per_unit: newProduct.price,
            image_url: newProduct.imageUrl,
            remap_status: "remapped",
            last_synced_at: syncTimestamp,
          } as any)
          .eq("id", item.id)
          .select("id")
          .maybeSingle();

        if (updateError) throw updateError;
        if (!updatedItem) throw new Error("Update in place could not be applied to this item.");

        toast.success(`Remapped "${item.common_name || item.name}" → "${newProduct.name}"`);
      } else {
        // Deactivate old + create new
        const { data: deactivatedItem, error: deactivateError } = await supabase
          .from("inventory_items")
          .update({ is_active: false, remap_status: "remapped" } as any)
          .eq("id", item.id)
          .select("id")
          .maybeSingle();

        if (deactivateError) throw deactivateError;
        if (!deactivatedItem) throw new Error("Could not archive the old item before replacement.");

        const { error: insertError } = await supabase
          .from("inventory_items")
          .insert({
            location_id: locationId,
            qubeyond_item_id: newProduct.id,
            item_number: newProduct.itemNumber,
            name: newProduct.name,
            brand: newProduct.brand,
            pack_size: newProduct.packSize,
            pack_quantity: newProduct.packQuantity,
            cost_per_unit: newProduct.price,
            unit: newProduct.unit?.toLowerCase() || "case",
            image_url: newProduct.imageUrl,
            storage_location_id: item.storage_location_id,
            category: item.category,
            common_name: item.common_name,
            is_active: true,
            vendor_source: "pfg",
            remap_status: null,
            last_synced_at: syncTimestamp,
          } as any);

        if (insertError) throw insertError;

        toast.success(`Replaced "${item.common_name || item.name}" with "${newProduct.name}"`);
      }

      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items-hidden", locationId] });
      onOpenChange(false);
      resetState();
    } catch (err) {
      console.error("Remap error:", err);
      toast.error("Failed to remap item");
    } finally {
      setIsRemapping(false);
    }
  };

  const resetState = () => {
    setSearchQuery("");
    setResults([]);
    setHasSearched(false);
  };

  // Auto-populate search with item name on open
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && item) {
      // Use common name or first two words of name as search seed
      const seed = item.common_name || item.name.split(" ").slice(0, 2).join(" ");
      setSearchQuery(seed);
      setResults([]);
      setHasSearched(false);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Remap Item
          </DialogTitle>
        </DialogHeader>

        {item && (
          <div className="flex flex-col gap-3 overflow-hidden">
            {/* Current item info */}
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <p className="text-xs font-medium text-destructive mb-1">Current Item (needs remap)</p>
              <p className="text-sm font-medium">{item.common_name || item.name}</p>
              {item.common_name && (
                <p className="text-xs text-muted-foreground">{item.name}</p>
              )}
              <div className="flex gap-2 mt-1">
                {item.brand && <Badge variant="outline" className="text-[10px]">{item.brand}</Badge>}
                {item.item_number && <Badge variant="outline" className="text-[10px]">#{item.item_number}</Badge>}
              </div>
            </div>

            {/* Search */}
            <div className="flex gap-2">
              <Input
                placeholder="Search All Bids guide..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchBidGuide()}
                className="flex-1"
              />
              <Button size="sm" onClick={searchBidGuide} disabled={isSearching || !searchQuery.trim()}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {/* Results */}
            <div className="overflow-y-auto flex-1 min-h-0 space-y-2">
              {isSearching && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {!isSearching && hasSearched && results.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No matches found. Try a different search term.
                </p>
              )}

              {!isSearching && results.map((product) => (
                <div key={product.id} className="border rounded-md p-3 space-y-2">
                  <div>
                    <p className="text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{product.fullDescription}</p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {product.brand && <Badge variant="outline" className="text-[10px]">{product.brand}</Badge>}
                      <Badge variant="outline" className="text-[10px]">#{product.itemNumber}</Badge>
                      {product.packSize && <Badge variant="secondary" className="text-[10px]">{product.packSize}</Badge>}
                      {product.price && <Badge variant="secondary" className="text-[10px]">${product.price.toFixed(2)}</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() => handleRemap(product, "update")}
                      disabled={isRemapping}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Update in Place
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() => handleRemap(product, "replace")}
                      disabled={isRemapping}
                    >
                      <EyeOff className="h-3 w-3 mr-1" />
                      Deactivate & Replace
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RemapItemDialog;
