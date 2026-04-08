import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link2, Link2Off, X, Search, Wifi, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { PosItem } from "./usePosMapping";

interface PosLinkIndicatorProps {
  blueprintId: string;
  blueprintName: string;
  blueprintCategory?: string; // "mi" | "core" | "base"
  mapping: { groupId: string; posItems: string[]; mappingType?: string; reconciliationGroup?: string | null } | undefined;
  posItems: PosItem[];
  onLink: (blueprintId: string, blueprintName: string, posItemNames: string[], mappingType?: string, reconciliationGroup?: string | null) => void;
  onUnlink: (blueprintId: string) => void;
  onUpdateMeta?: (blueprintId: string, mappingType: string, reconciliationGroup: string | null) => void;
  isLinking: boolean;
  locationId?: string;
}

/** Auto-detect mapping type based on blueprint category */
function inferMappingType(category?: string): string {
  if (category === "core") return "variety_mod";
  if (category === "base") return "generic_parent";
  return "direct"; // MI defaults to direct, user can change to named_parent
}

/** Fuzzy score: how well does a POS item name match the blueprint name */
function matchScore(posName: string, blueprintName: string): number {
  const pos = posName.toLowerCase();
  const bp = blueprintName.toLowerCase();
  
  if (pos === bp) return 100;
  if (pos.includes(bp) || bp.includes(pos)) return 80;
  
  const posWords = pos.split(/[\s\-–]+/).filter(w => w.length > 1);
  const bpWords = bp.split(/[\s\-–]+/).filter(w => w.length > 1);
  const commonWords = posWords.filter(w => bpWords.some(bw => bw.includes(w) || w.includes(bw)));
  if (commonWords.length > 0) {
    return 20 + (commonWords.length / Math.max(posWords.length, bpWords.length)) * 60;
  }
  
  return 0;
}

const PosLinkIndicator = ({
  blueprintId,
  blueprintName,
  blueprintCategory,
  mapping,
  posItems,
  onLink,
  onUnlink,
  onUpdateMeta,
  isLinking: _isLinking,
  locationId,
}: PosLinkIndicatorProps) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [quSearchMode, setQuSearchMode] = useState(false);
  const [quItems, setQuItems] = useState<{ name: string; category: string; quantity: number }[]>([]);
  const [quLoading, setQuLoading] = useState(false);
  const [quError, setQuError] = useState<string | null>(null);

  const isMapped = !!mapping && mapping.posItems.length > 0;

  const sortedPosItems = useMemo(() => {
    const scored = posItems.map(p => ({
      ...p,
      score: matchScore(p.name, blueprintName),
    }));

    const searchValue = search.trim().toLowerCase();
    if (!searchValue) {
      return scored.sort((a, b) => b.score - a.score);
    }

    return scored
      .map(p => ({
        ...p,
        searchScore: Math.max(
          matchScore(p.name, searchValue),
          matchScore(`${p.name} ${p.category}`, searchValue)
        ),
      }))
      .filter(p => {
        const combined = `${p.name} ${p.category}`.toLowerCase();
        return combined.includes(searchValue) || p.searchScore >= 50;
      })
      .sort((a, b) => {
        if (b.searchScore !== a.searchScore) return b.searchScore - a.searchScore;
        return b.score - a.score;
      });
  }, [posItems, blueprintName, search]);

  const filteredQuItems = useMemo(() => {
    if (!quSearchMode || quItems.length === 0) return [];
    const searchValue = search.trim().toLowerCase();
    if (!searchValue) return quItems;
    return quItems.filter(
      (i) => i.name.toLowerCase().includes(searchValue) || i.category.toLowerCase().includes(searchValue)
    );
  }, [quItems, search, quSearchMode]);

  const handleSearchQU = async () => {
    if (!locationId) return;
    setQuLoading(true);
    setQuError(null);
    setQuSearchMode(true);

    try {
      // Resolve all brand locations for cross-location QU search
      const { resolveBrandId } = await import("@/utils/resolveBrandId");
      const brandId = await resolveBrandId(locationId);

      let locationIds = [locationId];
      if (brandId) {
        const { data: orgs } = await supabase.from("organizations").select("id").eq("brand_id", brandId);
        if (orgs?.length) {
          const { data: locs } = await supabase.from("locations").select("id").in("organization_id", orgs.map(o => o.id));
          if (locs?.length) locationIds = locs.map(l => l.id);
        }
      }

      // Search all locations in parallel
      const results = await Promise.all(
        locationIds.map(async (locId) => {
          const { data, error } = await supabase.functions.invoke("pos-search", {
            body: { locationId: locId, search: search.trim() || undefined, daysBack: 90 },
          });
          if (error || data?.error) return [];
          return (data?.items || []) as { name: string; category: string; quantity: number }[];
        })
      );

      // Deduplicate by item name, sum quantities
      const merged = new Map<string, { name: string; category: string; quantity: number }>();
      for (const items of results) {
        for (const item of items) {
          const existing = merged.get(item.name);
          if (existing) {
            existing.quantity += item.quantity;
          } else {
            merged.set(item.name, { ...item });
          }
        }
      }
      setQuItems(Array.from(merged.values()));
    } catch (err: any) {
      console.error("QU search error:", err);
      setQuError(err.message || "Search failed");
    } finally {
      setQuLoading(false);
    }
  };

  const handleSelect = (posItemName: string) => {
    const mt = inferMappingType(blueprintCategory);
    onLink(blueprintId, blueprintName, [posItemName], mt, null);
    setIsPickerOpen(false);
    setSearch("");
    setQuSearchMode(false);
    setQuItems([]);
    setQuError(null);
  };

  const handleClose = () => {
    setIsPickerOpen(false);
    setSearch("");
    setQuSearchMode(false);
    setQuItems([]);
    setQuError(null);
  };

  if (isPickerOpen) {
    const displayItems = quSearchMode ? filteredQuItems : sortedPosItems;

    return (
      <div className="w-full bg-muted/30 border border-border rounded-md p-2 mt-1 mb-1" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1 mb-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <Input
            placeholder={quSearchMode ? "Filter QU results..." : "Search POS items..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs"
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Mode toggle */}
        {quSearchMode && (
          <button
            type="button"
            className="text-[10px] text-primary underline mb-1.5 block"
            onClick={() => { setQuSearchMode(false); setQuItems([]); setQuError(null); }}
          >
            ← Back to local list
          </button>
        )}

        <div className="max-h-[200px] overflow-y-auto space-y-0.5">
          {quLoading && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching QU...
            </div>
          )}

          {quError && (
            <p className="text-xs text-destructive text-center py-2">{quError}</p>
          )}

          {!quLoading && !quError && displayItems.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              {quSearchMode ? "No items found in QU" : "No POS items found"}
            </p>
          )}

          {!quLoading && !quError && displayItems.map((p: any) => (
            <button
              key={p.name}
              type="button"
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-primary/10 transition-colors text-left",
                !quSearchMode && p.score >= 60 && "bg-emerald-500/5 border border-emerald-500/20"
              )}
              onClick={() => handleSelect(p.name)}
            >
              <span className="truncate flex-1">{p.name}</span>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{p.category}</span>
              {quSearchMode && p.quantity != null && (
                <span className="text-[9px] text-muted-foreground flex-shrink-0">
                  {Math.round(p.quantity)} sold
                </span>
              )}
              {!quSearchMode && p.score >= 60 && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-600 border-emerald-500/30 flex-shrink-0">
                  match
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Search QU button — only show when in local mode */}
        {!quSearchMode && locationId && (
          <button
            type="button"
            className="w-full flex items-center justify-center gap-1.5 mt-2 py-1.5 text-[11px] text-primary hover:bg-primary/5 rounded border border-dashed border-primary/30 transition-colors"
            onClick={handleSearchQU}
            disabled={quLoading}
          >
            <Wifi className="h-3 w-3" />
            Search QU Live
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 flex items-center gap-0.5">
      {/* Reconciliation group badge */}
      {isMapped && mapping.reconciliationGroup && (
        <span className="text-[9px] px-1 py-0 rounded bg-purple-500/10 text-purple-600 mr-0.5">
          {mapping.reconciliationGroup}
        </span>
      )}
      <button
        type="button"
        className={cn(
          "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition-colors",
          isMapped
            ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
            : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (isMapped) {
            if (confirm(`Unlink "${mapping.posItems[0]}" from this recipe?`)) {
              onUnlink(blueprintId);
            }
          } else {
            setIsPickerOpen(true);
          }
        }}
        title={isMapped 
          ? `POS: ${mapping.posItems.join(", ")} (${mapping.mappingType || "direct"})` 
          : "No POS mapping — tap to link"}
      >
        {isMapped ? (
          <>
            <Link2 className="h-3 w-3" />
            <span className="max-w-[80px] truncate">{mapping.posItems[0]}</span>
          </>
        ) : (
          <>
            <Link2Off className="h-3 w-3" />
            <span>POS</span>
          </>
        )}
      </button>
      {/* Reconciliation group setter — show on mapped items without a group */}
      {isMapped && !mapping.reconciliationGroup && onUpdateMeta && (
        <button
          type="button"
          className="text-[9px] px-1 py-0.5 rounded border border-dashed border-muted-foreground/30 text-muted-foreground hover:bg-muted/50 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            const group = prompt("Reconciliation group name (e.g., 'salads'):");
            if (group && group.trim()) {
              onUpdateMeta(blueprintId, mapping.mappingType || inferMappingType(blueprintCategory), group.trim().toLowerCase());
            }
          }}
          title="Set reconciliation group"
        >
          + group
        </button>
      )}
    </div>
  );
};

export default PosLinkIndicator;
