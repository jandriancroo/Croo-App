import { useState, useRef, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MenuPricingItem } from "./useMenuPricing";
import { getCleanDisplayName } from "../recipe-catalog/utils";

interface MenuPricingRowProps {
  item: MenuPricingItem;
  onPriceChange: (blueprintId: string, price: number) => void;
}

const MenuPricingRow = ({ item, onPriceChange }: MenuPricingRowProps) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const displayName = getCleanDisplayName(item.name);

  const commitPrice = () => {
    const val = parseFloat(draft);
    if (!isNaN(val) && val >= 0) {
      onPriceChange(item.id, val);
    }
    setEditing(false);
  };

  const getFoodCostColor = (pct: number | null) => {
    if (pct === null) return "text-muted-foreground";
    if (pct <= 28) return "text-emerald-600 dark:text-emerald-400";
    if (pct <= 33) return "text-amber-600 dark:text-amber-400";
    return "text-destructive";
  };

  return (
    <div className="grid grid-cols-[1fr_80px_80px_70px] items-center gap-1 px-3 py-2 border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors text-sm">
      {/* Name */}
      <div className="truncate font-medium flex items-center gap-1 text-foreground">
        {displayName}
        {item.isPartial && <AlertCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />}
      </div>

      {/* Recipe Cost (read-only) */}
      <div className="text-right tabular-nums text-emerald-600 dark:text-emerald-400 text-xs">
        ${item.recipeCost.toFixed(2)}
      </div>

      {/* Menu Price (editable) */}
      <div className="text-right">
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            step="0.01"
            min="0"
            className="w-full text-right text-xs bg-background border border-primary/40 rounded px-1.5 py-0.5 tabular-nums focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitPrice();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={cn(
              "w-full text-right text-xs tabular-nums rounded px-1.5 py-0.5 transition-colors",
              item.menuPrice !== null
                ? "text-foreground hover:bg-muted/60"
                : "text-muted-foreground/50 hover:bg-muted/60 italic"
            )}
            onClick={() => {
              setDraft(item.menuPrice?.toFixed(2) || "");
              setEditing(true);
            }}
          >
            {item.menuPrice !== null ? `$${item.menuPrice.toFixed(2)}` : "—"}
          </button>
        )}
      </div>

      {/* Food Cost % */}
      <div className={cn("text-right tabular-nums text-xs font-semibold", getFoodCostColor(item.foodCostPct))}>
        {item.foodCostPct !== null ? `${item.foodCostPct.toFixed(1)}%` : "—"}
      </div>
    </div>
  );
};

export default MenuPricingRow;
