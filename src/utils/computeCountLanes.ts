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
  const lensInnerQty = Number((lens as any)?.inner_qty ?? 0);
  const innerPackQty = item.inner_pack_quantity ?? (lensInnerQty > 0 ? lensInnerQty : null);
  const showInnerPacks =
    !isRecipe && innerPackQty != null && Number(innerPackQty) > 0;

  // Cost badges — mirror InventoryCountSession lines 2083-2106 exactly.
  const caseCost = Number(item.cost_per_unit ?? 0) || 0;
  const packsPerCase = Number(item.pack_quantity ?? 1) || 1;
  const unitsPerPack = Number(innerPackQty ?? 0) || 0;
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
      showCases: true, // The single-stepper grid uses the same "cases" slot.
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
      caseTierSource: "recipe",
    };
  }

  const countBy: CountByMode = (item.count_by ?? "inherit") as CountByMode;

  // Lens-driven case-tier visibility.
  const lensApplies = lensEnabled && isLensValid(lens);
  const lensHasCaseTier =
    lensApplies && Number(lens!.count_units_per_case ?? 0) > 1;

  // Legacy local signals (no-lens path).
  const rawPackQty =
    item._rawPackQuantityOverride ??
    item._rawPackQuantity ??
    item.pack_quantity ??
    1;
  const rawInnerPackQty = innerPackQty;
  const localTrueSingleUnit =
    Number(rawPackQty) <= 1 &&
    (!rawInnerPackQty || Number(rawInnerPackQty) <= 1);

  const isTrueSingleUnit = lensApplies
    ? !lensHasCaseTier
    : localTrueSingleUnit;

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

  // Effective packQty used for the Cases lane math.
  const effectivePackQty = lensApplies
    ? Number(lens!.count_units_per_case ?? 1) || 1
    : Number(rawPackQty) || 1;

  const lensOuterType =
    typeof (lens as any)?.outer_type === "string" ? (lens as any).outer_type : null;
  const innerLabel = resolveInnerLabel(item.inner_pack_label, lensOuterType);
  const innerNounSingular =
    (item.inner_pack_label ?? "").trim() ||
    (lensOuterType ?? "").trim() ||
    "pack";
  // The inner sublabel denominates "how many atomic units sit inside one
  // inner pack." When we know the common unit (e.g. lb) AND the inner noun
  // (e.g. bag), render the richer "(3 lb/bag)" form. Fall back to "(3/pk)"
  // when those hints are missing.
  const commonUnitToken = (() => {
    const u = (((lens as any)?.common_unit ?? item.unit) ?? "").trim();
    if (!u) return null;
    const lc = u.toLowerCase();
    if (lc === "ea" || lc === "each" || lc === "unit" || lc === "units" || lc === "cs" || lc === "case" || lc === "cases" || lc === "ct" || lc === "count") return null;
    return lc;
  })();
  const innerNounToken = (() => {
    const n = (innerNounSingular || "").trim().toLowerCase();
    if (!n || n === "pack") return "pk";
    return n;
  })();
  const innerSubLabel = showInnerPacks
    ? commonUnitToken
      ? innerNounToken === commonUnitToken
        // Noun and unit are the same (e.g. "lb" inside an "lb" inner) — avoid the
        // ugly "(4 lb/lb)" duplication and just show the quantity + unit.
        ? `(${innerPackQty} ${commonUnitToken})`
        : `(${innerPackQty} ${commonUnitToken}/${innerNounToken})`
      : `(${innerPackQty}/${innerNounToken})`
    : null;

  // When there's no inner-pack tier, the user's label override (e.g. "jug")
  // would otherwise be invisible — promote it onto the Cases lane.
  const labelOverride = (item.inner_pack_label ?? "").trim();
  const casesLabel = !showInnerPacks && labelOverride
    ? pluralizeLabel(labelOverride)
    : "Cases";
  const casesNounToken = !showInnerPacks && labelOverride
    ? labelOverride.toLowerCase()
    : "case";

  return {
    isRecipe: false,
    showCases,
    showInnerPacks,
    showUnits,
    casesLabel,
    casesNounToken,
    innerLabel,
    innerSubLabel,
    unitsLabel: (() => {
      const u = (item.unit ?? "").trim().toLowerCase();
      if (!u || u === "ea" || u === "each" || u === "unit" || u === "units" || u === "cs" || u === "case" || u === "cases" || u === "ct" || u === "count") return "Units";
      // Weight/volume atomic units render as their own plural (LBS, OZ, KG, ML, GAL…)
      return u.endsWith("s") ? u.toUpperCase() : `${u.toUpperCase()}S`;
    })(),
    unitsSubLabel: "(ea)",
    packQty: effectivePackQty,
    innerPackQty,
    costPerCase,
    costPerPack,
    costPerUnit,
    unitToken: commonUnitToken,
    caseTierSource: lensApplies ? "lens" : "local",
  };
}
