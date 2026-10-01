import { DateTime } from "luxon";
import { DollarSign, Package } from "lucide-react";
import { resolveItemPackShape } from "@/utils/resolveItemPackShape";
import { isLensValid } from "@/utils/getEffectivePackQty";

const fmtMoney = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2).replace(/(\.\d\d)\d*?0+$/, "$1")}`;

function relDate(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const d = iso.length <= 10
    ? DateTime.fromFormat(iso, "yyyy-MM-dd", { zone: tz })
    : DateTime.fromISO(iso, { zone: tz });
  if (!d.isValid) return null;
  const today = DateTime.now().setZone(tz).startOf("day");
  const days = Math.round(today.diff(d.startOf("day"), "days").days);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return d.toFormat(d.year === today.year ? "LLL d" : "LLL d, yyyy");
}

const SOURCE_LABEL: Record<string, string> = {
  master: "Order guide",
  order_guide: "Order guide",
  order: "Order",
  invoice: "Invoice",
  manual: "Entered by hand",
};

export function ItemPriceLine({ item, timezone }: { item: any; timezone: string }) {
  const cost = item?.cost_per_unit != null ? Number(item.cost_per_unit) : null;
  const unit = item?.is_recipe
    ? (item.recipe_yield_qty ? `${Number(item.recipe_yield_qty)} ${item.recipe_yield_unit ?? ""}`.trim() : "batch")
    : (item?.unit || "case");
  let source: string;
  if (item?.is_recipe) {
    const when = relDate(item.cost_computed_at, timezone);
    source = item.cost_status === "no_recipe"
      ? "Recipe · no recipe on file"
      : item.cost_status === "incomplete"
        ? `Recipe · missing prices, last good cost kept${when ? ` · ${when}` : ""}`
        : `Recipe · calculated nightly${when ? ` · ${when}` : ""}`;
  } else {
    const label = item?.price_source ? (SOURCE_LABEL[item.price_source] ?? item.price_source) : null;
    const when = relDate(item?.price_source_date, timezone);
    source = label ? `${label}${when ? ` · ${when}` : ""}` : "Source unknown";
  }
  const unpriced = cost == null || !(cost > 0);
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-2">
      <DollarSign className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
      <div className="min-w-0 text-xs">
        {unpriced ? (
          <p className="font-medium text-destructive">No price yet — this item counts as $0</p>
        ) : (
          <p className="font-medium text-foreground">
            {fmtMoney(cost!)} <span className="text-muted-foreground font-normal">per {unit}</span>
          </p>
        )}
        <p className="text-muted-foreground">{source}</p>
      </div>
    </div>
  );
}

export function ItemPackLine({ item, lensEnabled, lensMap, loading }: {
  item: any; lensEnabled: boolean; lensMap: Map<string, any> | undefined; loading: boolean;
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading pack…</p>;
  }
  const lens = lensEnabled && item?.brand_item_id ? lensMap?.get(item.brand_item_id) ?? null : null;
  const shape = resolveItemPackShape({
    pack_quantity: item?.pack_quantity ?? null,
    inner_pack_quantity: item?.inner_pack_quantity ?? null,
    inner_pack_label: item?.inner_pack_label ?? null,
    unit: item?.unit ?? null,
    cost_per_unit: item?.cost_per_unit ?? null,
  }, lens);

  let why: string;
  if (shape.source === "lens" && isLensValid(lens)) why = "brand pack config";
  else if (item?.pack_quantity_override != null && Number(item.pack_quantity_override) > 0) why = "store override (being retired)";
  else if (item?.pack_quantity != null && Number(item.pack_quantity) > 0) why = item?.is_recipe ? "store pack field" : "vendor pack";
  else why = "no pack set — counted one at a time";

  const ignoredOverride = shape.source === "lens" && item?.pack_quantity_override != null && Number(item.pack_quantity_override) > 0
    ? `store override ${Number(item.pack_quantity_override)} is not used (being retired)`
    : null;
  const unitWord = shape.unit && shape.unit !== "cs" && shape.unit !== "case" ? shape.unit : "units";
  const container = shape.outerLabel ?? "case";
  const main = shape.innerPackQty
    ? `${shape.packQty} ${shape.innerLabel ?? "pack"}s × ${shape.innerPackQty} ${unitWord} per ${container} (${+(shape.packQty * shape.innerPackQty).toFixed(2)} total)`
    : `${shape.packQty} ${unitWord} per ${container}`;

  return (
    <div className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
      <Package className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
      <div className="min-w-0 text-xs">
        <p className="font-medium text-foreground">Pack at this store: {main}</p>
        <p className="text-muted-foreground">
          {why}{item?.pack_size ? ` · vendor pack ${item.pack_size}` : ""}
        </p>
        {ignoredOverride && <p className="text-muted-foreground">{ignoredOverride}</p>}
      </div>
    </div>
  );
}
