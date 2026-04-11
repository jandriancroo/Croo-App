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

  // Get all mapped POS item names — exact match (lowercase for case-insensitive only)
  const mappedPosNames = useMemo(() => {
    const names = new Set<string>();
    for (const entry of mappedBlueprints.values()) {
      for (const posItem of entry.posItems) {
        names.add(posItem.toLowerCase().trim());
      }
    }
    return names;
  }, [mappedBlueprints]);

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

      // Aggregate by exact item name (case-insensitive key, preserve display name)
      const itemMap = new Map<string, { displayName: string; category: string; totalQty: number }>();
      for (const row of allRows) {
        const mix = row.product_mix as any[];
        if (!Array.isArray(mix)) continue;
        for (const item of mix) {
          if (!item.itemName) continue;
          const key = item.itemName.toLowerCase().trim();
          const qty = Number(item.quantity) || 0;
          const existing = itemMap.get(key);
          if (existing) {
            existing.totalQty += qty;
          } else {
            itemMap.set(key, { displayName: item.itemName, category: item.category || "Unknown", totalQty: qty });
          }
        }
      }

      return itemMap;
    },
    enabled: mappedPosNames.size >= 0,
  });

  // Compute unmapped list, grouped by category
  const { unmapped, categoryGroups } = useMemo(() => {
    if (!unmappedItems) return { unmapped: [], categoryGroups: new Map<string, UnmappedItem[]>() };
    const excluded = excludedCats?.excluded || [];
    const overrides = excludedCats?.overrides || [];

    const result: UnmappedItem[] = [];
    for (const [key, val] of unmappedItems.entries()) {
      // Exact match against mapped POS items
      if (mappedPosNames.has(key)) continue;
      const catLower = val.category.toLowerCase();
      if (excluded.includes(catLower) && !overrides.includes(key)) continue;
      if (val.totalQty < 3) continue;
      result.push({ name: val.displayName, category: val.category, totalQty: val.totalQty });
    }

    result.sort((a, b) => b.totalQty - a.totalQty);

    const groups = new Map<string, UnmappedItem[]>();
    for (const item of result) {
      const cat = item.category;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }

    return { unmapped: result, categoryGroups: groups };
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
        <div className="px-3 pb-3 space-y-2 max-h-72 overflow-y-auto">
          {Array.from(categoryGroups.entries())
            .sort(([, a], [, b]) => {
              const totalA = a.reduce((s, i) => s + i.totalQty, 0);
              const totalB = b.reduce((s, i) => s + i.totalQty, 0);
              return totalB - totalA;
            })
            .map(([cat, items]) => (
              <div key={cat}>
                <div className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider px-1 mb-1">
                  {cat}
                  <span className="ml-1.5 text-amber-400/50 font-normal normal-case">
                    ({items.length})
                  </span>
                </div>
                <div className="space-y-0.5">
                  {items.map(item => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-amber-500/5"
                    >
                      <span className="text-foreground truncate">{item.name}</span>
                      <span className="text-amber-400 tabular-nums text-[11px] shrink-0 ml-2">
                        {item.totalQty}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default UnmappedPosBanner;
