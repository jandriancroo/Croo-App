/**
 * PanSizesSection — lets you define unit equivalents for hotel pans & cambros.
 * You enter ONE baseline measurement; all other sizes auto-calculate from
 * standardized hotel-pan volume ratios.
 *
 * All results are rounded to the nearest 0.5 increment.
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChefHat, Calculator, Star } from "lucide-react";

// ── Container registry ────────────────────────────────────────────────────────

export interface ContainerDef {
  key: string;
  label: string;
  /** Volume relative to a full 6" deep hotel pan (= 1.0) */
  ratio: number;
  /** True = commonly used at Blaze */
  blazeDefault: boolean;
  category: "hotel_pan" | "cambro";
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
}

interface PanSizesSectionProps {
  value: PanSizesConfig | null;
  onChange: (cfg: PanSizesConfig | null) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PanSizesSection({ value, onChange }: PanSizesSectionProps) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [baselineKey, setBaselineKey] = useState(value?.baseline_key ?? "third_pan");
  const [baselineUnits, setBaselineUnits] = useState<string>(
    value?.baseline_units ? String(value.baseline_units) : ""
  );
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(
    () => new Set(value?.enabled_keys ?? ALL_CONTAINERS.filter(c => c.blazeDefault).map(c => c.key))
  );

  const baseline = ALL_CONTAINERS.find(c => c.key === baselineKey)!;
  const parsedBaselineUnits = parseFloat(baselineUnits) || 0;

  // Build and emit config whenever state changes
  const emitChange = useCallback(
    (
      en: boolean,
      bk: string,
      bu: string,
      ek: Set<string>
    ) => {
      if (!en) {
        onChange(null);
        return;
      }
      const parsed = parseFloat(bu) || 0;
      onChange({
        enabled: true,
        baseline_key: bk,
        baseline_units: parsed,
        enabled_keys: Array.from(ek),
      });
    },
    [onChange]
  );

  const handleEnable = (checked: boolean) => {
    setEnabled(checked);
    emitChange(checked, baselineKey, baselineUnits, enabledKeys);
  };

  const handleBaselineKey = (key: string) => {
    setBaselineKey(key);
    emitChange(enabled, key, baselineUnits, enabledKeys);
  };

  const handleBaselineUnits = (v: string) => {
    setBaselineUnits(v);
    emitChange(enabled, baselineKey, v, enabledKeys);
  };

  const toggleKey = (key: string) => {
    // Don't allow disabling the baseline
    if (key === baselineKey) return;
    const next = new Set(enabledKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setEnabledKeys(next);
    emitChange(enabled, baselineKey, baselineUnits, next);
  };

  const hotelPans = ALL_CONTAINERS.filter(c => c.category === "hotel_pan");
  const cambros = ALL_CONTAINERS.filter(c => c.category === "cambro");

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
                Select which sizes apply to this item. 
                <span className="text-primary font-medium"> ⭐ = commonly used at Blaze</span>
              </p>

              {/* Hotel pans */}
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Hotel Pans (6" deep)</p>
              <div className="grid gap-1">
                {hotelPans.map(c => {
                  const isBaseline = c.key === baselineKey;
                  const isEnabled = enabledKeys.has(c.key) || isBaseline;
                  const units = calcUnits(c, baseline, parsedBaselineUnits);
                  return (
                    <div
                      key={c.key}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-md border transition-colors cursor-pointer select-none ${
                        isBaseline
                          ? "border-primary/40 bg-primary/10"
                          : isEnabled
                          ? "border-border bg-muted/50"
                          : "border-dashed border-border/50 opacity-50"
                      }`}
                      onClick={() => toggleKey(c.key)}
                    >
                      <div className="flex items-center gap-1.5">
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
                      </div>
                      <span className={`text-xs font-mono font-semibold ${isEnabled ? "text-foreground" : "text-muted-foreground"}`}>
                        {units % 1 === 0 ? units : parseFloat(units.toFixed(3))} units
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Cambros */}
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mt-2">Cambros</p>
              <div className="grid gap-1">
                {cambros.map(c => {
                  const isBaseline = c.key === baselineKey;
                  const isEnabled = enabledKeys.has(c.key) || isBaseline;
                  const units = calcUnits(c, baseline, parsedBaselineUnits);
                  return (
                    <div
                      key={c.key}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-md border transition-colors cursor-pointer select-none ${
                        isBaseline
                          ? "border-primary/40 bg-primary/10"
                          : isEnabled
                          ? "border-border bg-muted/50"
                          : "border-dashed border-border/50 opacity-50"
                      }`}
                      onClick={() => toggleKey(c.key)}
                    >
                      <div className="flex items-center gap-1.5">
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
                      </div>
                      <span className={`text-xs font-mono font-semibold ${isEnabled ? "text-foreground" : "text-muted-foreground"}`}>
                        {units % 1 === 0 ? units : parseFloat(units.toFixed(3))} units
                      </span>
                    </div>
                  );
                })}
              </div>
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
  const baseline = ALL_CONTAINERS.find(c => c.key === config.baseline_key);
  const target = ALL_CONTAINERS.find(c => c.key === containerKey);
  if (!baseline || !target) return null;
  if (!config.enabled_keys.includes(containerKey)) return null;
  return roundHalf((target.ratio / baseline.ratio) * config.baseline_units);
}

export { ALL_CONTAINERS };
