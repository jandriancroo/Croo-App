/**
 * PanSizesSection — lets you define unit equivalents for hotel pans & cambros.
 * You enter ONE baseline measurement; all other sizes auto-calculate from
 * standardized hotel-pan volume ratios.
 *
 * All results are rounded to the nearest 0.5 increment.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChefHat, Calculator, Star, DollarSign } from "lucide-react";

// ── Container registry ────────────────────────────────────────────────────────

export interface ContainerDef {
  key: string;
  label: string;
  /** Volume relative to a full 6" deep hotel pan (= 1.0) */
  ratio: number;
  /** True = commonly used at Blaze */
  blazeDefault: boolean;
  category: "hotel_pan" | "cambro" | "dough_tray";
  description: string;
}

// Standard hotel pan volumes (6" deep) relative to full pan = 1.0
// Source: industry-standard foodservice pan volume ratios
const ALL_CONTAINERS: ContainerDef[] = [
  // ── Hotel Pans (6" deep) ──────────────────────────────────────────────────
  { key: "full_pan",    label: "Full Pan (1/1)",   ratio: 1,        blazeDefault: false, category: "hotel_pan", description: "Full 6\" hotel pan" },
  { key: "two_thirds",  label: "2/3 Pan",          ratio: 0.667,    blazeDefault: true,  category: "hotel_pan", description: "2/3 size hotel pan" },
  { key: "half_pan",    label: "Half Pan (1/2)",   ratio: 0.5,      blazeDefault: false, category: "hotel_pan", description: "Half 6\" hotel pan" },
  { key: "third_pan",   label: "Third Pan (1/3)",  ratio: 0.333,    blazeDefault: true,  category: "hotel_pan", description: "Third 6\" hotel pan" },
  { key: "quarter_pan", label: "Quarter Pan (1/4)",ratio: 0.25,     blazeDefault: true,  category: "hotel_pan", description: "Quarter 6\" hotel pan" },
  { key: "sixth_pan",   label: "Sixth Pan (1/6)",  ratio: 0.167,    blazeDefault: true,  category: "hotel_pan", description: "Sixth 6\" hotel pan" },
  { key: "ninth_pan",   label: "Ninth Pan (1/9)",  ratio: 0.111,    blazeDefault: false, category: "hotel_pan", description: "Ninth 6\" hotel pan" },
  // ── Cambros ──────────────────────────────────────────────────────────────
  // 22 qt cambro filled to 16 pts (as specified by user).
  // 16 pints = 8 quarts. Relative to full pan (approx 20 qt for 6" deep full pan):
  // 8 qt / 20 qt ≈ 0.40
  { key: "cambro_22qt", label: "22 qt Cambro (to 16 qt)", ratio: 0.80, blazeDefault: true, category: "cambro", description: "22 qt cambro filled to 16 quarts" },
  { key: "cambro_12qt", label: "12 qt Cambro",   ratio: 0.60,    blazeDefault: false, category: "cambro", description: "12 qt cambro (full)" },
  { key: "cambro_8qt",  label: "8 qt Cambro",    ratio: 0.40,    blazeDefault: false, category: "cambro", description: "8 qt cambro (full)" },
  { key: "cambro_4qt",  label: "4 qt Cambro",    ratio: 0.20,    blazeDefault: false, category: "cambro", description: "4 qt cambro (full)" },
  // ── Dough Trays / Sheet Pans ──────────────────────────────────────────
  // Dough trays vary per store — baseline is set per-item
  { key: "dough_tray_full",  label: "Full Dough Tray",    ratio: 1.0,   blazeDefault: false, category: "dough_tray", description: "Full-size 18x26 dough proofing tray" },
  { key: "dough_tray_half",  label: "Half Dough Tray",    ratio: 0.5,   blazeDefault: false, category: "dough_tray", description: "Half-size dough tray" },
  { key: "dough_box",        label: "Dough Box",          ratio: 1.2,   blazeDefault: false, category: "dough_tray", description: "Deep 18x26x6 dough proofing box" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Round to 2 decimal places for clean display */
const roundHalf = (v: number): number => Math.round(v * 100) / 100;

/** Calculate units for a container given the baseline container's units */
const calcUnits = (container: ContainerDef, baseline: ContainerDef, baselineUnits: number): number => {
  if (baselineUnits <= 0) return 0;
  return roundHalf((container.ratio / baseline.ratio) * baselineUnits);
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PanSizesConfig {
  enabled: boolean;
  baseline_key: string;
  baseline_units: number;
  /** Which container keys are shown/enabled for this item */
  enabled_keys: string[];
  /** Manual overrides: container_key → units (overrides auto-calc) */
  overrides?: Record<string, number>;
}

interface PanSizesSectionProps {
  value: PanSizesConfig | null;
  onChange: (cfg: PanSizesConfig | null) => void;
  /** Cost per case/unit from vendor */
  costPerUnit?: number | null;
  /** Unit label like "case", "bag", "lb" */
  unitLabel?: string | null;
  /** Pack size label like "6/5 LB" */
  packSize?: string | null;
  /** How many individual units per case (to derive per-unit price) */
  packQuantity?: number | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PanSizesSection({ value, onChange, costPerUnit, unitLabel, packSize, packQuantity }: PanSizesSectionProps) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [baselineKey, setBaselineKey] = useState(value?.baseline_key ?? "third_pan");
  const [baselineUnits, setBaselineUnits] = useState<string>(
    value?.baseline_units ? String(value.baseline_units) : ""
  );
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(
    () => {
      const keys = new Set(value?.enabled_keys ?? ALL_CONTAINERS.filter(c => c.blazeDefault).map(c => c.key));
      // Always include the baseline key
      if (value?.baseline_key) keys.add(value.baseline_key);
      return keys;
    }
  );
  const [overrides, setOverrides] = useState<Record<string, number>>(value?.overrides ?? {});
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Sync internal state when the value prop changes (e.g. switching items in a dialog)
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    setEnabled(value?.enabled ?? false);
    setBaselineKey(value?.baseline_key ?? "third_pan");
    setBaselineUnits(value?.baseline_units ? String(value.baseline_units) : "");
    const keys = new Set(value?.enabled_keys ?? ALL_CONTAINERS.filter(c => c.blazeDefault).map(c => c.key));
    if (value?.baseline_key) keys.add(value.baseline_key);
    setEnabledKeys(keys);
    setOverrides(value?.overrides ?? {});
    setEditingKey(null);
  }, [value]);

  /**
   * Map legacy / external baseline_key values to current ALL_CONTAINERS keys.
   * Old data in the wild (374+ items) had `"full"`, `"each"`, `"unit"` —
   * these would silently break the dialog before this normalization.
   */
  const normalizeBaselineKey = (k: string): string => {
    if (!k) return "third_pan";
    const map: Record<string, string> = {
      full: "full_pan",
      half: "half_pan",
      third: "third_pan",
      quarter: "quarter_pan",
      sixth: "sixth_pan",
      ninth: "ninth_pan",
      each: "third_pan", // not a pan; map to default and let user pick a real pan
      unit: "third_pan",
    };
    if (ALL_CONTAINERS.some(c => c.key === k)) return k;
    return map[k] ?? "third_pan";
  };
  const safeBaselineKey = normalizeBaselineKey(baselineKey);
  const baseline = ALL_CONTAINERS.find(c => c.key === safeBaselineKey) ?? ALL_CONTAINERS.find(c => c.key === "third_pan")!;
  const parsedBaselineUnits = parseFloat(baselineUnits) || 0;

  // Build and emit config whenever state changes
  const emitChange = useCallback(
    (
      en: boolean,
      bk: string,
      bu: string,
      ek: Set<string>,
      ov: Record<string, number>
    ) => {
      if (!en) {
        onChange(null);
        return;
      }
      const parsed = parseFloat(bu) || 0;
      const cleanOverrides = Object.fromEntries(
        Object.entries(ov).filter(([k]) => ek.has(k) && k !== bk)
      );
      // Always include the baseline key in enabled_keys
      const finalKeys = new Set(ek);
      finalKeys.add(bk);
      onChange({
        enabled: true,
        baseline_key: bk,
        baseline_units: parsed,
        enabled_keys: Array.from(finalKeys),
        overrides: Object.keys(cleanOverrides).length > 0 ? cleanOverrides : undefined,
      });
    },
    [onChange]
  );

  const handleEnable = (checked: boolean) => {
    setEnabled(checked);
    emitChange(checked, baselineKey, baselineUnits, enabledKeys, overrides);
  };

  const handleBaselineKey = (key: string) => {
    setBaselineKey(key);
    emitChange(enabled, key, baselineUnits, enabledKeys, overrides);
  };

  const handleBaselineUnits = (v: string) => {
    setBaselineUnits(v);
    emitChange(enabled, baselineKey, v, enabledKeys, overrides);
  };

  const toggleKey = (key: string) => {
    // Don't allow disabling the baseline
    if (key === baselineKey) return;
    const next = new Set(enabledKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setEnabledKeys(next);
    emitChange(enabled, baselineKey, baselineUnits, next, overrides);
  };

  const handleOverride = (key: string, val: number | null) => {
    const next = { ...overrides };
    if (val === null) {
      delete next[key];
    } else {
      next[key] = val;
    }
    setOverrides(next);
    emitChange(enabled, baselineKey, baselineUnits, enabledKeys, next);
  };

  const hotelPans = ALL_CONTAINERS.filter(c => c.category === "hotel_pan");
  const cambros = ALL_CONTAINERS.filter(c => c.category === "cambro");
  const doughTrays = ALL_CONTAINERS.filter(c => c.category === "dough_tray");

  return (
    <div className="space-y-3">
      {/* Toggle */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="pan-sizes-enable"
          checked={enabled}
          onCheckedChange={(v) => handleEnable(!!v)}
        />
        <Label htmlFor="pan-sizes-enable" className="text-sm cursor-pointer flex items-center gap-1.5">
          <ChefHat className="h-3.5 w-3.5 text-muted-foreground" />
          Enable pan / cambro sizes
        </Label>
      </div>

      {enabled && (
        <div className="space-y-4 border border-border rounded-lg p-3 bg-muted/30">
          {/* Pricing info banner */}
          {costPerUnit != null && costPerUnit > 0 && (() => {
            const perUnit = (packQuantity && packQuantity > 1) ? costPerUnit / packQuantity : costPerUnit;
            const isCase = packQuantity != null && packQuantity > 1;
            return (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-primary/5 border border-primary/20">
                <DollarSign className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                  {isCase && (
                    <span className="text-muted-foreground">
                      ${costPerUnit.toFixed(2)}/{unitLabel || 'cs'}
                    </span>
                  )}
                  <span className="font-medium text-foreground">
                    ${perUnit.toFixed(2)}/unit
                  </span>
                  {packSize && (
                    <span className="text-muted-foreground">({packSize})</span>
                  )}
                </div>
              </div>
            );
          })()}
          {/* Baseline picker */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Calculator className="h-3 w-3" />
              Baseline — which size do you know the count for?
            </Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              value={baselineKey}
              onChange={(e) => handleBaselineKey(e.target.value)}
            >
              <optgroup label="Hotel Pans (6&quot; deep)">
                {hotelPans.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </optgroup>
              <optgroup label="Cambros">
                {cambros.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </optgroup>
              <optgroup label="Dough Trays">
                {doughTrays.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Baseline units input */}
          <div className="space-y-1">
            <Label htmlFor="pan-baseline-units" className="text-xs text-muted-foreground">
              How many units fill a {baseline.label}?
            </Label>
            <Input
              id="pan-baseline-units"
              type="number"
              inputMode="decimal"
              placeholder="e.g. 48"
              className="h-8 text-sm"
              value={baselineUnits}
              onChange={(e) => handleBaselineUnits(e.target.value)}
            />
          </div>

          {/* Container grid */}
          {parsedBaselineUnits > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Select which sizes apply to this item. Tap a unit value to override it.
                <span className="text-primary font-medium"> ⭐ = commonly used at Blaze</span>
              </p>

              {[
                { title: 'Hotel Pans (6" deep)', items: hotelPans },
                { title: "Cambros", items: cambros },
                { title: "Dough Trays", items: doughTrays },
              ].map(({ title, items }) => (
                <div key={title}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-2">{title}</p>
                  <div className="grid gap-1 mt-1">
                    {items.map(c => {
                      const isBaseline = c.key === baselineKey;
                      const isEnabled = enabledKeys.has(c.key) || isBaseline;
                      const autoUnits = calcUnits(c, baseline, parsedBaselineUnits);
                      const hasOverride = c.key in overrides;
                      const displayUnits = hasOverride ? overrides[c.key] : autoUnits;
                      const isEditing = editingKey === c.key && isEnabled && !isBaseline;
                      return (
                        <div
                          key={c.key}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-md border transition-colors select-none ${
                            isBaseline
                              ? "border-primary/40 bg-primary/10"
                              : isEnabled
                              ? "border-border bg-muted/50"
                              : "border-dashed border-border/50 opacity-50 cursor-pointer"
                          }`}
                          onClick={() => { if (!isEnabled || isBaseline) toggleKey(c.key); }}
                        >
                          <div className="flex items-center gap-1.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); toggleKey(c.key); }}>
                            <Checkbox
                              checked={isEnabled}
                              onCheckedChange={() => toggleKey(c.key)}
                              disabled={isBaseline}
                              className="h-3.5 w-3.5"
                            />
                            <span className="text-xs font-medium">{c.label}</span>
                            {c.blazeDefault && (
                              <Star className="h-2.5 w-2.5 fill-primary text-primary" />
                            )}
                            {isBaseline && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">baseline</Badge>
                            )}
                            {hasOverride && !isBaseline && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">custom</Badge>
                            )}
                          </div>
                          {isEditing ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <Input
                                type="number"
                                inputMode="decimal"
                                className="h-6 w-16 text-xs font-mono text-right px-1"
                                defaultValue={displayUnits}
                                autoFocus
                                onBlur={(e) => {
                                  const val = parseFloat(e.target.value);
                                  if (!isNaN(val) && val > 0) {
                                    // If same as auto-calc, remove override
                                    if (Math.abs(val - autoUnits) < 0.001) {
                                      handleOverride(c.key, null);
                                    } else {
                                      handleOverride(c.key, roundHalf(val));
                                    }
                                  }
                                  setEditingKey(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                              />
                              <span className="text-[10px] text-muted-foreground">units</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5" onClick={(e) => {
                              e.stopPropagation();
                              if (isEnabled && !isBaseline) setEditingKey(c.key);
                            }}>
                              {costPerUnit != null && costPerUnit > 0 && isEnabled && displayUnits > 0 && (() => {
                                const perUnit = (packQuantity && packQuantity > 1) ? costPerUnit / packQuantity : costPerUnit;
                                const panCost = perUnit * displayUnits;
                                return (
                                  <span className="text-[10px] text-primary/70 font-mono">
                                    ${panCost.toFixed(2)}
                                  </span>
                                );
                              })()}
                              <span
                                className={`text-xs font-mono font-semibold cursor-pointer hover:underline ${
                                  isEnabled ? (hasOverride ? "text-primary" : "text-foreground") : "text-muted-foreground"
                                }`}
                              >
                                {displayUnits % 1 === 0 ? displayUnits : parseFloat(displayUnits.toFixed(3))} units
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {parsedBaselineUnits === 0 && (
            <p className="text-xs text-muted-foreground text-center py-1">
              Enter the baseline count above to see auto-calculated sizes.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Utility export — get unit count for a pan key given stored config ──────────
export function getPanUnits(config: PanSizesConfig, containerKey: string): number | null {
  if (!config.enabled || config.baseline_units <= 0) return null;
  if (!config.enabled_keys.includes(containerKey)) return null;
  // Check for manual override first
  if (config.overrides?.[containerKey] != null) {
    return config.overrides[containerKey];
  }
  const baseline = ALL_CONTAINERS.find(c => c.key === config.baseline_key);
  const target = ALL_CONTAINERS.find(c => c.key === containerKey);
  if (!baseline || !target) return null;
  return roundHalf((target.ratio / baseline.ratio) * config.baseline_units);
}

export { ALL_CONTAINERS };
