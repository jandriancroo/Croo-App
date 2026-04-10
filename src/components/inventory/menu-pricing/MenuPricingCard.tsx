import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, Loader2 } from "lucide-react";
import { useMenuPricing } from "./useMenuPricing";
import MenuPricingRow from "./MenuPricingRow";
import { getCleanDisplayName } from "../recipe-catalog/utils";
import { getSizeFromName } from "../recipe-catalog/utils";

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
  const { items, isLoading, upsertPrice } = useMenuPricing(locationId);

  const grouped = useMemo(() => {
    const groups = new Map<GroupKey, typeof items>();
    const order: GroupKey[] = ["md_pizza", "lg_pizza", "half_pizza", "detroit", "salads", "sides", "catering", "drinks", "other"];
    for (const key of order) groups.set(key, []);
    for (const item of items) {
      const key = classifyItem(item.name, item.catalog_section);
      groups.get(key)!.push(item);
    }
    return order.filter(k => (groups.get(k)?.length || 0) > 0).map(k => ({
      key: k,
      label: GROUP_LABELS[k],
      items: groups.get(k)!,
    }));
  }, [items]);

  // Summary stats
  const pricedItems = items.filter(i => i.menuPrice !== null && i.menuPrice > 0);
  const avgFoodCost = pricedItems.length > 0
    ? pricedItems.reduce((sum, i) => sum + (i.foodCostPct || 0), 0) / pricedItems.length
    : null;

  return (
    <Card>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <DollarSign className="h-4 w-4 text-emerald-600" />
        <span className="font-semibold text-sm">Menu Pricing</span>
        <Badge variant="secondary" className="text-xs tabular-nums">
          {items.length} items
        </Badge>
        {avgFoodCost !== null && (
          <Badge
            variant={avgFoodCost <= 30 ? "default" : "outline"}
            className="text-[10px] gap-1 tabular-nums ml-auto"
          >
            <TrendingUp className="h-3 w-3" />
            {avgFoodCost.toFixed(1)}% avg
          </Badge>
        )}
        {pricedItems.length > 0 && (
          <Badge variant="outline" className="text-[10px] tabular-nums">
            {pricedItems.length}/{items.length} priced
          </Badge>
        )}
      </div>

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
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_80px_80px_70px] items-center gap-1 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold bg-muted/30">
            <span>Item</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Price</span>
            <span className="text-right">FC%</span>
          </div>

          {grouped.map(group => (
            <div key={group.key}>
              <div className="px-3 py-1.5 bg-muted/20">
                <span className="text-[11px] font-semibold text-muted-foreground">{group.label}</span>
                <span className="text-[10px] text-muted-foreground/60 ml-2">({group.items.length})</span>
              </div>
              {group.items.map(item => (
                <MenuPricingRow
                  key={item.id}
                  item={item}
                  onPriceChange={(id, price) => upsertPrice({ blueprintId: id, price })}
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
