import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Link2, Search, Loader2, CheckCircle2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LinkDraftToExistingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: {
    id: string;
    product_name: string;
    brand_id: string;
    item_number?: string | null;
    match_keywords?: string[];
    vendor_source?: string | null;
  };
  onLinked: () => void;
}

export default function LinkDraftToExistingDialog({
  open, onOpenChange, draft, onLinked,
}: LinkDraftToExistingDialogProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [liveItems, setLiveItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [fetched, setFetched] = useState(false);

  const fetchLiveItems = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("brand_inventory_templates")
      .select("id, product_name, category, item_number, match_keywords")
      .eq("brand_id", draft.brand_id)
      .eq("status", "live")
      .eq("is_recipe", false)
      .order("product_name");
    setLiveItems(data || []);
    setFetched(true);
    setLoading(false);
  };

  const handleOpen = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (isOpen && !fetched) fetchLiveItems();
    if (!isOpen) {
      setSearch("");
      setFetched(false);
    }
  };

  const filtered = liveItems.filter(item =>
    item.product_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleLink = async (targetId: string) => {
    setLinking(true);
    try {
      // 1. Get the target template's current match_keywords
      const { data: target } = await supabase
        .from("brand_inventory_templates")
        .select("match_keywords")
        .eq("id", targetId)
        .single();

      const existingKeywords: string[] = target?.match_keywords || [];
      const newKeywords = new Set(existingKeywords);

      // Add draft's product name as a keyword
      newKeywords.add(draft.product_name.toLowerCase().trim());

      // Add draft's item_number if it has one
      if (draft.item_number) {
        newKeywords.add(draft.item_number.toLowerCase().trim());
      }

      // Add draft's existing match_keywords
      if (draft.match_keywords) {
        draft.match_keywords.forEach(kw => newKeywords.add(kw.toLowerCase().trim()));
      }

      // 2. Update target template with merged keywords
      const { error: updateErr } = await supabase
        .from("brand_inventory_templates")
        .update({
          match_keywords: Array.from(newKeywords),
          updated_at: new Date().toISOString(),
        })
        .eq("id", targetId);
      if (updateErr) throw updateErr;

      // 3. Re-link any vendor_invoice_items pointing to the draft
      const { error: relinkErr } = await supabase
        .from("vendor_invoice_items")
        .update({ matched_template_id: targetId, match_status: "matched" })
        .eq("matched_template_id", draft.id);
      if (relinkErr) throw relinkErr;

      // 4. Re-link any brand_inventory_staging pointing to the draft
      await supabase
        .from("brand_inventory_staging")
        .update({ matched_template_id: targetId, status: "matched" })
        .eq("matched_template_id", draft.id);

      // 5. Delete the draft template
      const { error: deleteErr } = await supabase
        .from("brand_inventory_templates")
        .delete()
        .eq("id", draft.id);
      if (deleteErr) throw deleteErr;

      toast.success(`Linked "${draft.product_name}" → existing item. Draft removed.`);
      queryClient.invalidateQueries({ queryKey: ["brand-templates"] });
      queryClient.invalidateQueries({ queryKey: ["brand-inventory-templates"] });
      onLinked();
      handleOpen(false);
    } catch (err: any) {
      console.error("Link draft error:", err);
      toast.error("Failed to link: " + (err.message || "Unknown error"));
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Link to Existing Item
          </DialogTitle>
          <DialogDescription className="text-xs">
            "{draft.product_name}" will become an alias on the selected item. The draft will be removed.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search live items..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="h-[280px] -mx-2">
            <div className="px-2 space-y-0.5">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {search ? "No matching items" : "No live items found"}
                </p>
              ) : (
                filtered.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={linking}
                    className="w-full flex items-center gap-2 py-2 px-2.5 text-sm hover:bg-muted/50 rounded-md transition-colors text-left disabled:opacity-50"
                    onClick={() => handleLink(item.id)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="truncate flex-1 font-medium">{item.product_name}</span>
                    {item.category && (
                      <span className="text-[10px] text-muted-foreground shrink-0">{item.category}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        )}

        {linking && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Merging and cleaning up...
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
