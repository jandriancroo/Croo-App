import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link2, Link2Off, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PosItem } from "./usePosMapping";

interface PosLinkIndicatorProps {
  blueprintId: string;
  blueprintName: string;
  mapping: { groupId: string; posItems: string[] } | undefined;
  posItems: PosItem[];
  onLink: (blueprintId: string, blueprintName: string, posItemNames: string[]) => void;
  onUnlink: (blueprintId: string) => void;
  isLinking: boolean;
}

/** Fuzzy score: how well does a POS item name match the blueprint name */
function matchScore(posName: string, blueprintName: string): number {
  const pos = posName.toLowerCase();
  const bp = blueprintName.toLowerCase();
  
  // Exact match
  if (pos === bp) return 100;
  
  // One contains the other
  if (pos.includes(bp) || bp.includes(pos)) return 80;
  
  // Word overlap
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
  mapping,
  posItems,
  onLink,
  onUnlink,
  isLinking,
}: PosLinkIndicatorProps) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

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

  const handleSelect = (posItemName: string) => {
    onLink(blueprintId, blueprintName, [posItemName]);
    setIsPickerOpen(false);
    setSearch("");
  };

  if (isPickerOpen) {
    return (
      <div className="w-full bg-muted/30 border border-border rounded-md p-2 mt-1 mb-1" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1 mb-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <Input
            placeholder="Search POS items..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs"
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => { setIsPickerOpen(false); setSearch(""); }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="max-h-[200px] overflow-y-auto space-y-0.5">
          {sortedPosItems.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No POS items found</p>
          )}
          {sortedPosItems.slice(0, 40).map(p => (
            <button
              key={p.name}
              type="button"
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-primary/10 transition-colors text-left",
                p.score >= 60 && "bg-emerald-500/5 border border-emerald-500/20"
              )}
              onClick={() => handleSelect(p.name)}
            >
              <span className="truncate flex-1">{p.name}</span>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{p.category}</span>
              {p.score >= 60 && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-600 border-emerald-500/30 flex-shrink-0">
                  match
                </Badge>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition-colors",
        isMapped
          ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
          : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (isMapped) {
          // Show current mapping, allow unlink
          if (confirm(`Unlink "${mapping.posItems[0]}" from this recipe?`)) {
            onUnlink(blueprintId);
          }
        } else {
          setIsPickerOpen(true);
        }
      }}
      title={isMapped ? `POS: ${mapping.posItems.join(", ")}` : "No POS mapping — tap to link"}
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
  );
};

export default PosLinkIndicator;
