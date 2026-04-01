import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Link2, Search, Loader2, CheckCircle2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InlineLinkToExistingProps {
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

export default function InlineLinkToExisting({ draft, onLinked }: InlineLinkToExistingProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [liveItems, setLiveItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
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
      setLoading(false);
    };
    fetchLiveItems();
  }, [draft.brand_id]);

  const filtered = liveItems.filter(item =>
    item.product_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleLink = async (targetId: string, targetName: string) => {
    setLinking(true);
    try {
      const { data: target } = await supabase
        .from("brand_inventory_templates")
        .select("match_keywords")
        .eq("id", targetId)
        .single();

      const newKeywords = new Set<string>(target?.match_keywords || []);
      newKeywords.add(draft.product_name.toLowerCase().trim());
      if (draft.item_number) newKeywords.add(draft.item_number.toLowerCase().trim());
      if (draft.match_keywords) {
        draft.match_keywords.forEach(kw => newKeywords.add(kw.toLowerCase().trim()));
      }

      const { error: updateErr } = await supabase
        .from("brand_inventory_templates")
        .update({ match_keywords: Array.from(newKeywords), updated_at: new Date().toISOString() })
        .eq("id", targetId);
      if (updateErr) throw updateErr;

      const { error: relinkErr } = await supabase
        .from("vendor_invoice_items")
        .update({ matched_template_id: targetId, match_status: "matched" })
        .eq("matched_template_id", draft.id);
      if (relinkErr) throw relinkErr;

      await supabase
        .from("brand_inventory_staging")
        .update({ matched_template_id: targetId, status: "matched" })
        .eq("matched_template_id", draft.id);

      const { error: deleteErr } = await supabase
        .from("brand_inventory_templates")
        .delete()
        .eq("id", draft.id);
      if (deleteErr) throw deleteErr;

      toast.success(`Merged "${draft.product_name}" → "${targetName}"`);
      queryClient.invalidateQueries({ queryKey: ["brand-templates"] });
      queryClient.invalidateQueries({ queryKey: ["brand-inventory-templates"] });
      onLinked();
    } catch (err: any) {
      console.error("Link draft error:", err);
      toast.error("Failed to link: " + (err.message || "Unknown error"));
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <p className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />
        Link to Existing (merge duplicate)
      </p>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search live items..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ScrollArea className="h-[160px]">
          <div className="space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-4">
                {search ? "No matching items" : "No live items found"}
              </p>
            ) : (
              filtered.map(item => (
                <button
                  key={item.id}
                  type="button"
                  disabled={linking}
                  className="w-full flex items-center gap-2 py-1.5 px-2 text-xs hover:bg-muted/50 rounded-md transition-colors text-left disabled:opacity-50"
                  onClick={() => handleLink(item.id, item.product_name)}
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
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
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Merging...
        </div>
      )}
    </div>
  );
}
