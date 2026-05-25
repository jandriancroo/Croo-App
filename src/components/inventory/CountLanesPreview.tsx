/**
 * Read-only visual mirror of the count-screen lane grid.
 *
 * Renders the SAME visible structure (Cases / inner-pack / Units lanes, with
 * disabled "0" steppers) used by InventoryCountSession. Lane visibility,
 * labels, and per-tier costs are NOT decided here — they come from
 * computeCountLanes(), the single source of truth that the real count screen
 * also calls. This guarantees the preview can't drift from production.
 *
 * Layout matches lines 2113-2266 of InventoryCountSession.tsx exactly.
 */
import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";
import type { CountLanes } from "@/utils/computeCountLanes";

const fmt = (v: number | null): string =>
  v == null ? "—" : `$${v.toFixed(v < 1 ? 4 : 2)}`;

export function CountLanesPreview({
  lanes,
  itemName,
}: {
  lanes: CountLanes;
  itemName?: string | null;
}) {
  // Recipe: single stepper, mirrors lines 2114-2149
  if (lanes.isRecipe) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background p-3">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
          Count-screen preview{itemName ? ` · ${itemName}` : ""}
        </p>
        <div className="max-w-xs mx-auto">
          <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider text-center">
            {lanes.casesLabel}
          </p>
          <FakeStepper />
        </div>
      </div>
    );
  }

  const visibleLaneCount =
    (lanes.showCases ? 1 : 0) +
    (lanes.showInnerPacks ? 1 : 0) +
    (lanes.showUnits ? 1 : 0);

  return (
    <div className="rounded-md border border-dashed border-border bg-background p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">
          Count-screen preview{itemName ? ` · ${itemName}` : ""}
        </p>
        <p className="text-[9px] text-muted-foreground">
          source: {lanes.caseTierSource}
          {" · "}
          {fmt(lanes.costPerCase)}/cs
          {lanes.costPerPack != null && ` · ${fmt(lanes.costPerPack)}/pk`}
          {lanes.costPerUnit != null && ` · ${fmt(lanes.costPerUnit)}/u`}
        </p>
      </div>

      {visibleLaneCount === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No lanes will render (count_by hides everything).
        </p>
      ) : (
        <div
          className={cn(
            "grid gap-2",
            visibleLaneCount === 3
              ? "grid-cols-3"
              : visibleLaneCount === 2
              ? "grid-cols-2"
              : "grid-cols-1",
          )}
        >
          {lanes.showCases && (
            <Lane label={lanes.casesLabel} sub={`(${lanes.packQty} ${lanes.innerPackQty ? "units total" : "ea"}/case)`} />
          )}
          {lanes.showInnerPacks && (
            <Lane label={lanes.innerLabel} sub={lanes.innerSubLabel ?? undefined} />
          )}
          {lanes.showUnits && (
            <Lane label={lanes.unitsLabel} sub={lanes.unitsSubLabel ?? undefined} />
          )}
        </div>
      )}
    </div>
  );
}

function Lane({ label, sub }: { label: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground font-semibold mb-1.5 uppercase tracking-wider">
        {label}
        {sub && (
          <span className="ml-1 normal-case tracking-normal">{sub}</span>
        )}
      </p>
      <FakeStepper />
    </div>
  );
}

function FakeStepper() {
  return (
    <div className="flex items-center rounded-lg overflow-hidden border border-foreground/20 opacity-70 select-none">
      <div className="h-9 w-9 flex items-center justify-center text-muted-foreground border-r border-inherit flex-shrink-0">
        <Minus className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="flex-1 text-center text-xl font-bold text-muted-foreground tabular-nums bg-transparent w-0">
        0
      </div>
      <div className="h-9 w-9 flex items-center justify-center text-muted-foreground border-l border-inherit flex-shrink-0">
        <Plus className="h-4 w-4" strokeWidth={2} />
      </div>
    </div>
  );
}
