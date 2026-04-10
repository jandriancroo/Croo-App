import { useState, useRef, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MenuPricingItem } from "./useMenuPricing";
import { getCleanDisplayName } from "../recipe-catalog/utils";

interface MenuPricingRowProps {
  item: MenuPricingItem;
  show3pd: boolean;
  theoTarget: number;
  priceSource: "manual" | "qu";
  onPriceChange: (blueprintId: string, price: number) => void;
  on3pdChange: (blueprintId: string, field: "upcharge" | "fee", value: number) => void;
}

type EditField = "price" | "upcharge" | "fee" | null;

const MenuPricingRow = ({ item, show3pd, theoTarget, onPriceChange, on3pdChange }: MenuPricingRowProps) => {
  const [editField, setEditField] = useState<EditField>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editField]);

  const displayName = getCleanDisplayName(item.name);

  const commit = () => {
    const val = parseFloat(draft);
    if (!isNaN(val) && val >= 0) {
      if (editField === "price") onPriceChange(item.id, val);
      if (editField === "upcharge") on3pdChange(item.id, "upcharge", val);
      if (editField === "fee") on3pdChange(item.id, "fee", val);
    }
    setEditField(null);
  };

  const getFoodCostColor = (pct: number | null) => {
    if (pct === null) return "text-muted-foreground";
    if (pct <= theoTarget) return "text-emerald-600 dark:text-emerald-400";
    return "text-destructive";
  };

  const renderEditableCell = (
    field: EditField,
    value: number | null,
    format: "dollar" | "pct",
    placeholder = "—"
  ) => {
    if (editField === field) {
      return (
        <input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0"
          className="w-full text-right text-xs bg-background border border-primary/40 rounded px-1.5 py-0.5 tabular-nums focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditField(null);
          }}
        />
      );
    }
    return (
      <button
        type="button"
        className={cn(
          "w-full text-right text-xs tabular-nums rounded px-1.5 py-0.5 transition-colors bg-primary/[0.06] hover:bg-primary/[0.12] border border-dashed border-primary/20",
          value !== null
            ? "text-foreground"
            : "text-muted-foreground/50 italic"
        )}
        onClick={() => {
          setDraft(value?.toFixed(format === "dollar" ? 2 : 1) || "");
          setEditField(field);
        }}
      >
        {value !== null
          ? format === "dollar" ? `$${value.toFixed(2)}` : `${value.toFixed(1)}%`
          : placeholder}
      </button>
    );
  };

  const gridCols = show3pd
    ? "grid-cols-[1fr_55px_55px_55px_45px_45px_45px_55px_45px]"
    : "grid-cols-[1fr_62px_62px_62px_52px]";

  return (
    <div className={cn("grid items-center gap-0.5 px-3 py-1.5 border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors text-sm", gridCols)}>
      <div className="truncate font-medium flex items-center gap-1 text-foreground text-xs">
        {displayName}
        {item.isPartial && <AlertCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />}
      </div>

      <div className="text-right tabular-nums text-emerald-600 dark:text-emerald-400 text-xs">
        ${item.recipeCost.toFixed(2)}
      </div>

      <div className="text-right">
        {renderEditableCell("price", item.menuPrice, "dollar")}
      </div>

      <div className="text-right tabular-nums text-xs text-muted-foreground">
        {item.quPrice !== null ? `$${item.quPrice.toFixed(2)}` : "—"}
      </div>

      <div className={cn("text-right tabular-nums text-xs font-semibold", getFoodCostColor(item.foodCostPct))}>
        {item.foodCostPct !== null ? `${item.foodCostPct.toFixed(1)}%` : "—"}
      </div>

      {show3pd && (
        <>
          <div className="text-right">
            {renderEditableCell("upcharge", item.tpdUpchargePct, "pct")}
          </div>
          <div className="text-right">
            {renderEditableCell("fee", item.tpdFeePct, "pct")}
          </div>
          <div className="text-right tabular-nums text-xs text-foreground">
            {item.tpdPrice !== null ? `$${item.tpdPrice.toFixed(2)}` : "—"}
          </div>
          <div className={cn("text-right tabular-nums text-xs font-semibold", getFoodCostColor(item.tpdFoodCostPct))}>
            {item.tpdFoodCostPct !== null ? `${item.tpdFoodCostPct.toFixed(1)}%` : "—"}
          </div>
        </>
      )}
    </div>
  );
};

export default MenuPricingRow;
