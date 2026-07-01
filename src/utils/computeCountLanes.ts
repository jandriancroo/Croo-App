/**
 * Single source of truth for "which counting lanes does the count screen show
 * for this item, with which labels and per-tier costs."
 *
 * Used by BOTH:
 *   • InventoryCountSession.tsx — the real count screen (lane visibility +
 *     labels are derived from this; the interactive steppers stay in the
 *     session component because they depend on live state/handlers).
 *   • CountLanesPreview.tsx     — the read-only preview rendered next to each
 *     pending pack-config in BrandPackConfigApprovals.
 *
 * The whole point is that the approval-screen preview is provably what the
 * count screen will show. If you change a rule here, both screens move in
 * lockstep — no drift, no lying preview.
 *
 * Lens-driven default: when a per-location lens is active AND an approved
 * brand_pack_config exists with a real case tier (count_units_per_case > 1),
 * the case lane reflects the lens — not stale local pack_quantity. This is the
 * Toilet Seat Covers fix: a local pack_quantity=1 must NOT suppress the Cases
 * lane when the approved config is 1/250.
 */

import { isLensValid, type PackConfigLens } from "./getEffectivePackQty";
import { resolveItemPackShape, atomicUnitToken, type PackShapeLens } from "./resolveItemPackShape";

export type CountByMode =
  | "inherit"
  | "cases_and_units"
  | "cases_only"
  | "units_only";

export interface LaneItemInput {
  is_recipe?: boolean | null;
  /** Local pack_quantity (raw, pre-override). Legacy default path. */
  pack_quantity?: number | null;
  /** Optional per-location override (legacy default path). */
  _rawPackQuantityOverride?: number | null;
  _rawPackQuantity?: number | null;
  inner_pack_quantity?: number | null;
  /** Local label override for the middle lane (e.g. "sleeve" → "Sleeves"). */
  inner_pack_label?: string | null;
  /** The atomic unit (ea, oz, lb…). Used in subtitles. */
  unit?: string | null;
  /** Vendor case cost — drives per-pack / per-unit cost badges. */
  cost_per_unit?: number | null;
  /** Per-item override; 'inherit' (default) follows the lens/local rules. */
  count_by?: CountByMode | null;
}

export interface ComputeCountLanesArgs {
  item: LaneItemInput;
  lens?: PackConfigLens | null;
  /**
   * When false, the lens slot is ignored entirely (legacy local-only path).
   * Mirrors the `lensEnabledForLocation === true && item.brand_item_id` gate
   * in InventoryCountSession.
   */
  lensEnabled?: boolean;
}

export interface CountLanes {
  /** Recipe items render a single stepper, not the three-lane grid. */
  isRecipe: boolean;
  showCases: boolean;
  showInnerPacks: boolean;
  showUnits: boolean;
  /** Display label for each visible lane. */
  casesLabel: string;
  /** Singular noun used for the cases-lane sublabel ("case" or override like "jug"). */
  casesNounToken: string;
  innerLabel: string;
  /** Small subtitle under the inner label: e.g. "(12 ea/sleeve)". */
  innerSubLabel: string | null;
  unitsLabel: string;
  unitsSubLabel: string | null;
  /** Effective pack qty driving Cases-lane math (lens wins when valid). */
  packQty: number;
  /** Inner pack qty (units per inner pack). 0/null = no inner tier. */
  innerPackQty: number | null;
  /** Cost badges. null when not computable. */
  costPerCase: number | null;
  costPerPack: number | null;
  costPerUnit: number | null;
  /** Lowercased atomic unit token (e.g. "lb", "oz") for human-readable sublabels. null when unit is generic (ea/case/etc). */
  unitToken: string | null;
  /** Singular noun for the inner-pack tier (e.g. "bottle", "sleeve", "pk"). null when no inner tier. */
  innerNounToken: string | null;
  /** Which signal drove case-lane visibility — useful for debugging/UX. */
  caseTierSource: "lens" | "local" | "recipe";
}

const titleCase = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);

const pluralizeLabel = (raw: string): string => {
  const s = raw.trim();
  if (!s) return "Packs";
  // Light, safe pluralization — covers the packaging nouns we surface
  // (sleeve, bag, box, pack, case). Returns Title Case.
  const lower = s.toLowerCase();
  if (lower.endsWith("s")) return titleCase(lower);
  if (lower.endsWith("x") || lower.endsWith("ch") || lower.endsWith("sh")) {
    return titleCase(lower) + "es";
  }
  return titleCase(lower) + "s";
};

/**
 * Resolve the inner-lane label, in priority order:
 *   1. local inner_pack_label override (e.g. store admin typed "sleeve")
 *   2. lens.inner_type (e.g. approved brand_pack_config says inner_type="sleeve")
 *   3. fallback "Packs"
 */
const resolveInnerLabel = (
  innerPackLabel: string | null | undefined,
  lensInnerType: string | null | undefined,
): string => {
  const candidate = (innerPackLabel ?? "").trim() || (lensInnerType ?? "").trim();
  if (!candidate) return "Packs";
  return pluralizeLabel(candidate);
};

export function computeCountLanes({
  item,
  lens,
  lensEnabled = true,
}: ComputeCountLanesArgs): CountLanes {
  const isRecipe = !!item.is_recipe;

  // Single unified resolution — snapshot > lens > local.
  // computeCountLanes is called pre-snapshot (live count screen) and never
  // sees pack_quantity_at_count, so the resolver effectively chooses between
  // lens (when valid + enabled) and local.
  const effectiveLens: PackShapeLens | null =
    lensEnabled && isLensValid(lens) ? (lens as PackShapeLens) : null;
  const shape = resolveItemPackShape(item as any, effectiveLens);

  const innerPackQty = shape.innerPackQty;
  const showInnerPacks = !isRecipe && innerPackQty != null && innerPackQty > 0;

  // Cost badges — derived from the resolved shape.
  const caseCost = Number(shape.costPerCase ?? 0) || 0;
  const packsPerCase = shape.packQty;
  const unitsPerPack = innerPackQty ?? 0;
  const hasInner = unitsPerPack > 0;
  const totalUnits = hasInner ? packsPerCase * unitsPerPack : packsPerCase;
  const costPerCase = caseCost > 0 ? caseCost : null;
  const costPerPack =
    hasInner && caseCost > 0 && packsPerCase > 0
      ? caseCost / packsPerCase
      : null;
  const costPerUnit =
    caseCost > 0 && totalUnits > 0 ? caseCost / totalUnits : null;

  // Recipe path: single lane, exit early.
  if (isRecipe) {
    return {
      isRecipe: true,
      showCases: true,
      showInnerPacks: false,
      showUnits: false,
      casesLabel: `Count (${item.unit ?? "ea"})`,
      casesNounToken: "case",
      innerLabel: "",
      innerSubLabel: null,
      unitsLabel: "",
      unitsSubLabel: null,
      packQty: 1,
      innerPackQty: null,
      costPerCase,
      costPerPack: null,
      costPerUnit,
      unitToken: null,
      innerNounToken: null,
      caseTierSource: "recipe",
    };
  }

  const countBy: CountByMode = (item.count_by ?? "inherit") as CountByMode;
  const lensApplies = effectiveLens != null;
  const lensHasCaseTier =
    lensApplies && Number(effectiveLens!.count_units_per_case ?? 0) > 1;
  const localTrueSingleUnit =
    shape.packQty <= 1 && (innerPackQty == null || innerPackQty <= 1);
  const isTrueSingleUnit = lensApplies ? !lensHasCaseTier : localTrueSingleUnit;

  let showCases =
    countBy === "inherit" ||
    countBy === "cases_and_units" ||
    countBy === "cases_only";
  let showUnits =
    countBy === "inherit" ||
    countBy === "cases_and_units" ||
    countBy === "units_only";
  if (isTrueSingleUnit && countBy === "inherit") {
    showCases = false;
    showUnits = true;
  }
  // Apply persisted per-lane overrides from the pack config (approver toggles).
  // These win over the resolver's default visibility so "Counters see" on the
  // approval screen is authoritative on the count screen.
  let showInnerPacksFinal = showInnerPacks;
  if (effectiveLens) {
    if (effectiveLens.show_cases != null) showCases = !!effectiveLens.show_cases;
    if (effectiveLens.show_inner_packs != null) {
      showInnerPacksFinal = showInnerPacksFinal && !!effectiveLens.show_inner_packs;
    }
    if (effectiveLens.show_common_unit != null) showUnits = !!effectiveLens.show_common_unit;
  }

  const innerLabelRaw = shape.innerLabel ?? "";
  const innerLabel = innerLabelRaw ? pluralizeLabel(innerLabelRaw) : "Packs";
  const innerNounSingular = innerLabelRaw || "pack";

  const commonUnitToken = atomicUnitToken(shape.unit);
  const innerNounToken = (() => {
    const n = innerNounSingular.trim().toLowerCase();
    if (!n || n === "pack") return "pk";
    return n;
  })();
  const innerSubLabel = showInnerPacks
    ? commonUnitToken
      ? innerNounToken === commonUnitToken
        ? `(${innerPackQty} ${commonUnitToken})`
        : `(${innerPackQty} ${commonUnitToken}/${innerNounToken})`
      : `(${innerPackQty}/${innerNounToken})`
    : null;

  // Cases-lane label precedence:
  //   1. shape.outerLabel (lens-driven, e.g. "bag" → "Bags")
  //   2. local inner_pack_label override when there's no inner tier
  //   3. "Cases"
  const localLabelOverride = (item.inner_pack_label ?? "").trim();
  const outerOverride = (shape.outerLabel ?? "").trim();
  // Suppress "case" as an outer noun — it's the generic default and would
  // render "Cases" twice in the multi-leg branch anyway.
  const outerIsGeneric = outerOverride.toLowerCase() === "case" || outerOverride.toLowerCase() === "cases";
  const casesLabel = outerOverride && !outerIsGeneric
    ? pluralizeLabel(outerOverride)
    : (!showInnerPacks && localLabelOverride
        ? pluralizeLabel(localLabelOverride)
        : "Cases");
  const casesNounToken = outerOverride && !outerIsGeneric
    ? outerOverride.toLowerCase()
    : (!showInnerPacks && localLabelOverride
        ? localLabelOverride.toLowerCase()
        : "case");

  return {
    isRecipe: false,
    showCases,
    showInnerPacks: showInnerPacksFinal,
    showUnits,
    casesLabel,
    casesNounToken,
    innerLabel,
    innerSubLabel,
    unitsLabel: "Units",
    unitsSubLabel: commonUnitToken ? `(${commonUnitToken})` : "(ea)",
    packQty: shape.packQty,
    innerPackQty,
    costPerCase,
    costPerPack,
    costPerUnit,
    unitToken: commonUnitToken,
    innerNounToken: showInnerPacksFinal ? innerNounToken : null,
    caseTierSource: lensApplies ? "lens" : "local",
  };
}
