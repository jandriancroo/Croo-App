import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, TrendingUp, Loader2, ChevronDown, ChevronRight, Truck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMenuPricing } from "./useMenuPricing";
import MenuPricingRow from "./MenuPricingRow";

interface MenuPricingCardProps {
  locationId: string;
}

type GroupKey = "md_pizza" | "lg_pizza" | "half_pizza" | "detroit" | "salads" | "sides" | "catering" | "drinks" | "other";

const GROUP_LABELS: Record<GroupKey, string> = {
  md_pizza: '11" Pizzas',
  lg_pizza: '14" Pizzas',
  half_pizza: "Half Pizzas",
  detroit: "Detroit Pizzas",
  salads: "Salads",
  sides: "Sides & Extras",
  catering: "Catering",
  drinks: "Drinks",
  other: "Other",
};

function classifyItem(name: string, catalogSection: string | null): GroupKey {
  if (catalogSection && catalogSection in GROUP_LABELS) return catalogSection as GroupKey;
  const lower = name.toLowerCase();
  if (lower.includes("detroit")) return "detroit";
  if (lower.includes("salad")) return "salads";
  if (lower.includes("half ")) return "half_pizza";
  if (lower.includes("large") || lower.includes("lg ") || lower.includes("14")) return "lg_pizza";
  if (lower.includes("drink") || lower.includes("juice") || lower.includes("water") || lower.includes("lemonade") || lower.includes("tea") || lower.includes("beer") || lower.includes("wine") || lower.includes("bubbles") || lower.includes("pellegrino") || lower.includes("fountain") || lower.includes("izze") || lower.includes("aranciata") || lower.includes("limonata") || lower.includes("orchard")) return "drinks";
  if (lower.includes("cheesy bread") || lower.includes("meatball") || lower.includes("brownie") || lower.includes("cookie") || lower.includes("s'more") || lower.includes("cinnamon") || lower.includes("fold") || lower.includes("sandwich") || lower.includes("garlic & sausage")) return "sides";
  if (lower.includes("catering") || lower.includes("cat -") || lower.includes("boxed lunch")) return "catering";
  return "md_pizza";
}

const MenuPricingCard = ({ locationId }: MenuPricingCardProps) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [show3pd, setShow3pd] = useState(false);
  const [fillUpcharge, setFillUpcharge] = useState("");
  const [fillFee, setFillFee] = useState("");
  const [theoTarget, setTheoTarget] = useState(30);
  const [priceSource, setPriceSource] = useState<"manual" | "qu">("manual");
  const { items, isLoading, upsertPrice, bulkUpsert3pd } = useMenuPricing(locationId, priceSource);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  };

  const grouped = useMemo(() => {
    const groups = new Map<GroupKey, typeof items>();
    const order: GroupKey[] = ["md_pizza", "lg_pizza", "half_pizza", "detroit", "salads", "sides", "catering", "drinks", "other"];
    for (const key of order) groups.set(key, []);
    for (const item of items) {
      const key = classifyItem(item.name, item.catalog_section);
      groups.get(key)!.push(item);
    }
    return order.filter(k => (groups.get(k)?.length || 0) > 0).map(k => {
      const groupItems = groups.get(k)!;
      const priced = groupItems.filter(i => i.foodCostPct !== null);
      const avgFc = priced.length > 0
        ? priced.reduce((s, i) => s + (i.foodCostPct || 0), 0) / priced.length
        : null;
      const priced3pd = groupItems.filter(i => i.tpdFoodCostPct !== null);
      const avg3pdFc = priced3pd.length > 0
        ? priced3pd.reduce((s, i) => s + (i.tpdFoodCostPct || 0), 0) / priced3pd.length
        : null;
      return { key: k, label: GROUP_LABELS[k], items: groupItems, avgFc, avg3pdFc };
    });
  }, [items]);

  const pricedItems = items.filter(i => i.menuPrice !== null && i.menuPrice > 0);
  const avgFoodCost = pricedItems.length > 0
    ? pricedItems.reduce((sum, i) => sum + (i.foodCostPct || 0), 0) / pricedItems.length
    : null;

  const getFcColor = (pct: number | null) => {
    if (pct === null) return "text-muted-foreground";
    if (pct <= theoTarget) return "text-emerald-600 dark:text-emerald-400";
    return "text-destructive";
  };

  const hasQuPrices = items.some(i => i.quPrice !== null);

  const gridCols = show3pd
    ? "grid-cols-[1fr_55px_55px_55px_45px_45px_45px_55px_45px]"
    : "grid-cols-[1fr_62px_62px_62px_52px]";

  const handleFillAll = () => {
    const payload: { upchargePct?: number; feePct?: number } = {};
    const u = parseFloat(fillUpcharge);
    const f = parseFloat(fillFee);
    if (!isNaN(u) && u >= 0) payload.upchargePct = u;
    if (!isNaN(f) && f >= 0) payload.feePct = f;
    if (Object.keys(payload).length > 0) {
      bulkUpsert3pd(payload);
      setFillUpcharge("");
      setFillFee("");
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-wrap">
        <DollarSign className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">Menu Pricing</span>
        <Badge variant="secondary" className="text-xs tabular-nums">
          {items.length} items
        </Badge>
        {avgFoodCost !== null && (
          <Badge
            variant={avgFoodCost <= theoTarget ? "default" : "outline"}
            className="text-[10px] gap-1 tabular-nums"
          >
            <TrendingUp className="h-3 w-3" />
            {avgFoodCost.toFixed(1)}% avg
          </Badge>
        )}
        <div className="flex items-center gap-1 border border-border rounded-md px-1.5 py-0.5 bg-muted/30">
          <Sparkles className="h-3 w-3 text-primary" />
          <span className="text-[10px] font-semibold text-muted-foreground">Target</span>
          <input
            type="number"
            step="1"
            min="1"
            max="100"
            className="w-10 text-right text-[10px] bg-background border border-primary/30 rounded px-1 py-0 tabular-nums focus:outline-none focus:ring-1 focus:ring-primary text-foreground font-semibold"
            value={theoTarget}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v > 0) setTheoTarget(v);
            }}
          />
          <span className="text-[10px] text-muted-foreground">%</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {pricedItems.length > 0 && (
            <Badge variant="outline" className="text-[10px] tabular-nums">
              {pricedItems.length}/{items.length} priced
            </Badge>
          )}
          <Button
            variant={show3pd ? "default" : "outline"}
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => setShow3pd(!show3pd)}
          >
            <Truck className="h-3 w-3" />
            3PD
          </Button>
        </div>
      </div>

      {/* Fill-all bar for 3PD */}
      {show3pd && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Fill All:</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Upcharge</span>
            <input
              type="number" step="1" min="0" placeholder="%"
              className="w-14 text-right text-xs bg-background border border-border rounded px-1.5 py-0.5 tabular-nums focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              value={fillUpcharge}
              onChange={(e) => setFillUpcharge(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Fee</span>
            <input
              type="number" step="1" min="0" placeholder="%"
              className="w-14 text-right text-xs bg-background border border-border rounded px-1.5 py-0.5 tabular-nums focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              value={fillFee}
              onChange={(e) => setFillFee(e.target.value)}
            />
          </div>
          <Button size="sm" className="h-6 text-[10px] px-3" onClick={handleFillAll}>
            Apply
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No menu item recipes found. Import recipes from the Brand Catalog first.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {/* Header */}
          <div className={cn("grid items-center gap-0.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold bg-muted/30", gridCols)}>
            <span>Item</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Price</span>
            <span className="text-right">FC%</span>
            {show3pd && (
              <>
                <span className="text-right">↑%</span>
                <span className="text-right">Fee%</span>
                <span className="text-right">3PD $</span>
                <span className="text-right">3PD FC</span>
              </>
            )}
          </div>

          {grouped.map(group => (
            <div key={group.key}>
              <button
                type="button"
                className={cn("w-full flex items-center gap-1.5 px-3 py-1.5 bg-muted/20 hover:bg-muted/40 transition-colors", gridCols.replace("grid-cols-", ""))}
                onClick={() => toggleGroup(group.key)}
              >
                {collapsedGroups.has(group.key)
                  ? <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                }
                <span className="text-[11px] font-semibold text-muted-foreground">{group.label}</span>
                <span className="text-[10px] text-muted-foreground/60">({group.items.length})</span>
                <span className="ml-auto flex items-center gap-2">
                  {group.avgFc !== null && (
                    <span className={cn("text-[10px] font-semibold tabular-nums", getFcColor(group.avgFc))}>
                      {group.avgFc.toFixed(1)}%
                    </span>
                  )}
                  {show3pd && group.avg3pdFc !== null && (
                    <span className={cn("text-[10px] font-semibold tabular-nums", getFcColor(group.avg3pdFc))}>
                      3PD {group.avg3pdFc.toFixed(1)}%
                    </span>
                  )}
                </span>
              </button>
              {!collapsedGroups.has(group.key) && group.items.map(item => (
                <MenuPricingRow
                  key={item.id}
                  item={item}
                  show3pd={show3pd}
                  theoTarget={theoTarget}
                  onPriceChange={(id, price) => upsertPrice({ blueprintId: id, price })}
                  on3pdChange={(id, field, value) =>
                    upsertPrice({
                      blueprintId: id,
                      ...(field === "upcharge" ? { tpdUpchargePct: value } : { tpdFeePct: value }),
                    })
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default MenuPricingCard;
