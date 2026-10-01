import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { money, useBrandPriceOutliers } from "./useBrandRecipes";

/** Brand-wide list of ingredient prices that are far off the typical store price. View only. */
const PriceOutliersCard = ({ brandId }: { brandId: string }) => {
  const { data, isLoading } = useBrandPriceOutliers(brandId);
  const rows = data || [];

  return (
    <Card>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-2 px-4 py-3 text-left">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="font-semibold text-sm">Price outliers</span>
            <Badge variant={rows.length ? "destructive" : "secondary"} className="text-xs tabular-nums">
              {isLoading ? "…" : rows.length}
            </Badge>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              Store price more than 50% off the typical price, or not priceable
            </span>
            <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y divide-border border-t border-border max-h-[420px] overflow-y-auto">
            {rows.map((o, i) => (
              <div key={i} className="px-4 py-2 text-xs flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{o.ingredient_name} ⚠️</span>
                <span className="text-muted-foreground">{o.store}</span>
                {o.problem ? (
                  <span className="text-destructive">{o.problem.replace(o.ingredient_name, "").trim() || "can't price"}</span>
                ) : (
                  <span className="tabular-nums">
                    {money(o.store_unit_price)}/{o.unit_label} vs typical {money(o.median_unit_price)}/{o.unit_label}
                  </span>
                )}
                <span className="basis-full text-[10px] text-muted-foreground truncate">
                  Used in: {o.recipes.join(", ")}
                </span>
              </div>
            ))}
            {!isLoading && rows.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted-foreground">No outliers.</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default PriceOutliersCard;
