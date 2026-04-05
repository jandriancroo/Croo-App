import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Link2, Search, Loader2, CheckCircle2, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InlineLinkToExistingProps {
  draft: {
    id: string;
    product_name: string;
    brand_id: string;
    item_number?: string | null;
    pa_item_id?: string | null;
    match_keywords?: string[];
    vendor_source?: string | null;
  };
  onLinked: () => void;
}

/** Simple word-overlap fuzzy score: fraction of draft words found in candidate */
function fuzzyScore(draftName: string, candidateName: string): number {
  const draftWords = draftName.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const candidateStr = candidateName.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  if (draftWords.length === 0) return 0;
  let hits = 0;
  for (const w of draftWords) {
    if (w.length < 2) continue; // skip tiny words
    if (candidateStr.includes(w)) hits++;
  }
  return hits / draftWords.length;
}

export default function InlineLinkToExisting({ draft, onLinked }: InlineLinkToExistingProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [userTyped, setUserTyped] = useState(false);
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

  // Auto fuzzy matches ranked by score
  const autoMatches = useMemo(() => {
    if (liveItems.length === 0) return [];
    return liveItems
      .map(item => ({ ...item, score: fuzzyScore(draft.product_name, item.product_name) }))
      .filter(item => item.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [liveItems, draft.product_name]);

  // When user types, filter full list
  const searchFiltered = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return liveItems.filter(item =>
      item.product_name.toLowerCase().includes(q)
    );
  }, [liveItems, search]);

  const displayItems = userTyped && search.trim() ? searchFiltered : autoMatches;
  const isAutoMode = !userTyped || !search.trim();

  const handleLink = async (targetId: string, targetName: string) => {
    setLinking(true);
    try {
      // Step 1: Copy vendor IDs to brand_vendor_mappings on the target live item
      const vendorMappingsToAdd: { vendor: string; vendor_item_id: string }[] = [];

      // If draft has a PFG item_number, add as a PFG mapping
      if (draft.item_number) {
        vendorMappingsToAdd.push({ vendor: 'pfg', vendor_item_id: draft.item_number });
      }

      // If draft has a PA item ID, add as a PA mapping
      if (draft.pa_item_id) {
        vendorMappingsToAdd.push({ vendor: 'produce_alliance', vendor_item_id: draft.pa_item_id });
      }

      // Insert vendor mappings (skip duplicates)
      for (const mapping of vendorMappingsToAdd) {
        // Check if mapping already exists
        const { data: existing } = await supabase
          .from("brand_vendor_mappings")
          .select("id")
          .eq("brand_template_id", targetId)
          .eq("vendor", mapping.vendor)
          .eq("vendor_item_id", mapping.vendor_item_id)
          .maybeSingle();

        if (!existing) {
          const { error: mapErr } = await supabase
            .from("brand_vendor_mappings")
            .insert({
              brand_template_id: targetId,
              vendor: mapping.vendor,
              vendor_item_id: mapping.vendor_item_id,
            });
          if (mapErr) console.error("Vendor mapping insert error:", mapErr);
        }
      }

      // Step 2: Re-point any invoice items and staging rows to the live item
      const { error: relinkErr } = await supabase
        .from("vendor_invoice_items")
        .update({ matched_template_id: targetId, match_status: "matched" })
        .eq("matched_template_id", draft.id);
      if (relinkErr) throw relinkErr;

      await supabase
        .from("brand_inventory_staging")
        .update({ matched_template_id: targetId, status: "matched" })
        .eq("matched_template_id", draft.id);

      // Step 3: Delete the draft template
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

      {isAutoMode && autoMatches.length > 0 && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          Suggested matches — or type to search
        </p>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search all live items..."
          value={search}
          onChange={e => { setSearch(e.target.value); setUserTyped(true); }}
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
            {displayItems.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-4">
                {search ? "No matching items" : "No fuzzy matches found — type to search"}
              </p>
            ) : (
              displayItems.map((item: any) => (
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