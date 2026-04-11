import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ChevronDown, X } from "lucide-react";
import type { PosMappingEntry } from "./usePosMapping";

interface UnmappedPosBannerProps {
  locationId: string;
  brandId?: string;
  mappedBlueprints: Map<string, PosMappingEntry>;
}

interface UnmappedItem {
  name: string;
  category: string;
  totalQty: number;
}

const UnmappedPosBanner = ({ locationId, brandId, mappedBlueprints }: UnmappedPosBannerProps) => {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Get all mapped POS item names (lowercase for comparison)
  const mappedPosNames = useMemo(() => {
    const names = new Set<string>();
    for (const entry of mappedBlueprints.values()) {
      for (const posItem of entry.posItems) {
        names.add(posItem.toLowerCase().trim());
      }
    }
    return names;
  }, [mappedBlueprints]);

  // Fetch excluded categories from brand
  const { data: excludedCats } = useQuery({
    queryKey: ["brand-excluded-cats", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data } = await supabase
        .from("brands")
        .select("pos_excluded_categories, pos_included_overrides")
        .eq("id", brandId!)
        .maybeSingle();
      return {
        excluded: (data?.pos_excluded_categories || []).map((c: string) => c.toLowerCase()),
        overrides: ((data as any)?.pos_included_overrides || []).map((c: string) => c.toLowerCase()),
      };
    },
  });

  // Fetch last 7 days product_mix across brand locations
  const { data: unmappedItems } = useQuery({
    queryKey: ["unmapped-pos-items", locationId, brandId, Array.from(mappedPosNames).join(",")],
    queryFn: async () => {
      // Get all brand location IDs
      let locationIds = [locationId];
      if (brandId) {
        const { data: orgs } = await supabase
          .from("organizations")
          .select("id")
          .eq("brand_id", brandId);
        if (orgs?.length) {
          const { data: locs } = await supabase
            .from("locations")
            .select("id")
            .in("organization_id", orgs.map(o => o.id));
          if (locs?.length) locationIds = locs.map(l => l.id);
        }
      }

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const startDate = sevenDaysAgo.toISOString().split("T")[0];

      const allRows: any[] = [];
      for (const locId of locationIds) {
        const { data } = await supabase
          .from("sales_cache")
          .select("product_mix")
          .eq("location_id", locId)
          .gte("sale_date", startDate)
          .not("product_mix", "is", null);
        if (data?.length) allRows.push(...data);
      }

      // Aggregate quantities by item name
      const itemMap = new Map<string, { category: string; totalQty: number }>();
      for (const row of allRows) {
        const mix = row.product_mix as any[];
        if (!Array.isArray(mix)) continue;
        for (const item of mix) {
          if (!item.itemName) continue;
          const key = item.itemName.toLowerCase().trim();
          const existing = itemMap.get(key);
          const qty = Number(item.quantity) || 0;
          if (existing) {
            existing.totalQty += qty;
          } else {
            itemMap.set(key, { category: item.category || "Unknown", totalQty: qty });
          }
        }
      }

      return itemMap;
    },
    enabled: mappedPosNames.size >= 0, // always run
  });

  // Compute unmapped list
  const unmapped = useMemo(() => {
    if (!unmappedItems) return [];
    const excluded = excludedCats?.excluded || [];
    const overrides = excludedCats?.overrides || [];

    const result: UnmappedItem[] = [];
    for (const [key, val] of unmappedItems.entries()) {
      // Skip if already mapped
      if (mappedPosNames.has(key)) continue;

      // Skip excluded categories (unless overridden)
      const catLower = val.category.toLowerCase();
      if (excluded.includes(catLower) && !overrides.includes(key)) continue;

      // Only show items with meaningful volume (>= 3 sold in 7 days)
      if (val.totalQty < 3) continue;

      result.push({ name: key, category: val.category, totalQty: val.totalQty });
    }

    return result.sort((a, b) => b.totalQty - a.totalQty);
  }, [unmappedItems, mappedPosNames, excludedCats]);

  if (dismissed || unmapped.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 mb-3">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <button
          className="flex-1 text-left text-sm font-medium text-amber-200 flex items-center gap-1.5"
          onClick={() => setExpanded(!expanded)}
        >
          <span>
            {unmapped.length} POS item{unmapped.length !== 1 ? "s" : ""} selling without a recipe
          </span>
          <span className="text-[11px] text-amber-400/70 font-normal">(7d)</span>
          <ChevronDown className={`h-3.5 w-3.5 text-amber-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-amber-500/20 transition-colors"
        >
          <X className="h-3.5 w-3.5 text-amber-400/60" />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-1 max-h-60 overflow-y-auto">
          {unmapped.map(item => (
            <div
              key={item.name}
              className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-amber-500/5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-foreground font-medium truncate">{item.name}</span>
                <span className="text-muted-foreground text-[10px] shrink-0">{item.category}</span>
              </div>
              <span className="text-amber-400 tabular-nums text-[11px] shrink-0 ml-2">
                {item.totalQty} sold
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UnmappedPosBanner;
