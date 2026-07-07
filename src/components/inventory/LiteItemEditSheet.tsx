import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface LiteEditableItem {
  id: string;
  name: string;
  category: string | null;
  pack_size: string | null;
  common_label: string | null;
  storage_id: string | null;
  is_active: boolean;
  unit: string | null;
  cost_per_unit: number | null;
  vendor_name_normalized: string | null;
  item_number: string | null;
  count_mode: "single" | "case_and_unit" | null;
  case_qty: number | null;
  unit_label: string | null;
  cost_per_inner_unit: number | null;
}

interface Storage {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: LiteEditableItem | null;
  locationId: string;
  storages: Storage[];
  categorySuggestions: string[];
  /** Distinct common_labels used at this location, feeds the dropdown. */
  commonLabelSuggestions?: string[];
}

const UNASSIGNED = "__unassigned__";

/**
 * Best-effort parse of vendor pack strings into a case_qty + inner-unit label
 * suggestion. This is NEVER auto-saved — it only pre-fills the fields when the
 * operator explicitly turns dual counting on. Handles common shapes like
 * "6/1 LB", "24/12 OZ", "4 / 1 GA".
 */
function suggestFromPackSize(pack: string | null | undefined): {
  case_qty: number | null;
  unit_label: string | null;
} {
  if (!pack) return { case_qty: null, unit_label: null };
  const m = pack.trim().match(/^(\d+)\s*\/\s*(.+?)\s*$/);
  if (!m) return { case_qty: null, unit_label: null };
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return { case_qty: null, unit_label: null };
  const label = m[2].replace(/\s+/g, " ").trim();
  return { case_qty: n, unit_label: label || null };
}

export default function LiteItemEditSheet({
  open,
  onOpenChange,
  item,
  locationId,
  storages,
  categorySuggestions,
  commonLabelSuggestions = [],
}: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [packSize, setPackSize] = useState("");
  const [commonLabel, setCommonLabel] = useState("");
  const [storageId, setStorageId] = useState<string>(UNASSIGNED);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Dual counting state
  const [dualMode, setDualMode] = useState(false);
  const [caseQty, setCaseQty] = useState<string>("");
  const [unitLabel, setUnitLabel] = useState<string>("");
  const [innerCost, setInnerCost] = useState<string>("");

  useEffect(() => {
    if (!item) return;
    setName(item.name ?? "");
    setCategory(item.category ?? "");
    setPackSize(item.pack_size ?? "");
    setCommonLabel(item.common_label ?? "");
    setStorageId(item.storage_id ?? UNASSIGNED);
    setIsActive(item.is_active);

    const isDual = item.count_mode === "case_and_unit";
    setDualMode(isDual);
    setCaseQty(item.case_qty != null ? String(item.case_qty) : "");
    setUnitLabel(item.unit_label ?? "");
    setInnerCost(item.cost_per_inner_unit != null ? String(item.cost_per_inner_unit) : "");
  }, [item]);

  // When operator flips the toggle ON and fields are empty, pre-fill from pack_size
  // suggestion. Never touches saved data until Save is clicked.
  const handleToggleDual = (next: boolean) => {
    setDualMode(next);
    if (next && !caseQty && !unitLabel) {
      const s = suggestFromPackSize(packSize || item?.pack_size);
      if (s.case_qty) setCaseQty(String(s.case_qty));
      if (s.unit_label) setUnitLabel(s.unit_label);
    }
  };

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0;

  const caseQtyNum = caseQty.trim() === "" ? null : Number(caseQty);
  const innerCostNum = innerCost.trim() === "" ? null : Number(innerCost);
  const dualValid =
    !dualMode ||
    (caseQtyNum != null &&
      Number.isFinite(caseQtyNum) &&
      caseQtyNum > 0 &&
      unitLabel.trim().length > 0 &&
      (innerCostNum == null || (Number.isFinite(innerCostNum) && innerCostNum >= 0)));

  const currentMode: "single" | "case_and_unit" =
    item?.count_mode === "case_and_unit" ? "case_and_unit" : "single";
  const nextMode: "single" | "case_and_unit" = dualMode ? "case_and_unit" : "single";

  const dirty = useMemo(() => {
    if (!item) return false;
    return (
      trimmedName !== (item.name ?? "").trim() ||
      (category.trim() || null) !== (item.category ?? null) ||
      (packSize.trim() || null) !== (item.pack_size ?? null) ||
      (commonLabel.trim() || null) !== (item.common_label ?? null) ||
      (storageId === UNASSIGNED ? null : storageId) !== item.storage_id ||
      isActive !== item.is_active ||
      nextMode !== currentMode ||
      (caseQtyNum ?? null) !== (item.case_qty ?? null) ||
      (unitLabel.trim() || null) !== (item.unit_label ?? null) ||
      (innerCostNum ?? null) !== (item.cost_per_inner_unit ?? null)
    );
  }, [
    item,
    trimmedName,
    category,
    packSize,
    commonLabel,
    storageId,
    isActive,
    nextMode,
    currentMode,
    caseQtyNum,
    unitLabel,
    innerCostNum,
  ]);

  const canSave = nameValid && dualValid && dirty && !saving;

  const handleSave = async () => {
    if (!item || !canSave) return;
    setSaving(true);
    const payload: Record<string, any> = {
      name: trimmedName,
      category: category.trim() || null,
      pack_size: packSize.trim() || null,
      common_label: commonLabel.trim() || null,
      storage_id: storageId === UNASSIGNED ? null : storageId,
      is_active: isActive,
      count_mode: nextMode,
      case_qty: dualMode ? caseQtyNum : null,
      unit_label: dualMode ? unitLabel.trim() || null : null,
      cost_per_inner_unit: dualMode ? innerCostNum : null,
    };
    const { error } = await supabase
      .from("lite_inventory_items" as any)
      .update(payload)
      .eq("id", item.id);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save item", { description: error.message });
      return;
    }
    qc.invalidateQueries({ queryKey: ["lite-inventory-items", locationId] });
    qc.invalidateQueries({ queryKey: ["lite-inventory-items-count", locationId] });
    toast.success("Item updated");
    onOpenChange(false);
  };

  const listId = `lite-cat-suggestions-${item?.id ?? "new"}`;

  // Derived preview cost for the inner unit when operator hasn't overridden.
  const derivedInnerCost =
    dualMode &&
    caseQtyNum &&
    caseQtyNum > 0 &&
    item?.cost_per_unit != null
      ? Number(item.cost_per_unit) / caseQtyNum
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Edit item</SheetTitle>
          <SheetDescription className="text-xs">
            {item?.vendor_name_normalized || "Unknown vendor"}
            {item?.item_number ? ` • #${item.item_number}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="lite-item-name" className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="lite-item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Item name"
            />
            {!nameValid && (
              <p className="text-[11px] text-destructive">Name is required.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lite-item-category" className="text-xs">
              Category
            </Label>
            <Input
              id="lite-item-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={80}
              placeholder="e.g. Produce, Dairy"
              list={listId}
            />
            <datalist id={listId}>
              {categorySuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lite-item-pack" className="text-xs">
              Pack size
            </Label>
            <Input
              id="lite-item-pack"
              value={packSize}
              onChange={(e) => setPackSize(e.target.value)}
              maxLength={60}
              placeholder='e.g. 6/32 oz'
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Storage</Label>
            <Select value={storageId} onValueChange={setStorageId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {storages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Counting method ─────────────────────────────────────────── */}
          <div className="rounded-lg border border-border/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="pr-3">
                <Label htmlFor="lite-dual-mode" className="text-sm">
                  Count by case + unit
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Off by default. Turn on for items you break open — e.g. a case of
                  6×1 LB packs where you want to count both full cases and loose packs.
                </p>
              </div>
              <Switch
                id="lite-dual-mode"
                checked={dualMode}
                onCheckedChange={handleToggleDual}
              />
            </div>

            {dualMode && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="lite-case-qty" className="text-xs">
                      Units per case <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="lite-case-qty"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={caseQty}
                      onChange={(e) => setCaseQty(e.target.value)}
                      placeholder="e.g. 6"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lite-unit-label" className="text-xs">
                      Unit label <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="lite-unit-label"
                      value={unitLabel}
                      onChange={(e) => setUnitLabel(e.target.value)}
                      maxLength={40}
                      placeholder="e.g. 1 LB Pack"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="lite-inner-cost" className="text-xs">
                    Cost per inner unit (optional)
                  </Label>
                  <Input
                    id="lite-inner-cost"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.0001"
                    value={innerCost}
                    onChange={(e) => setInnerCost(e.target.value)}
                    placeholder={
                      derivedInnerCost != null
                        ? `Defaults to $${derivedInnerCost.toFixed(4)}`
                        : "Leave blank to derive from case cost"
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    If blank, we use case cost ÷ units per case at count time.
                  </p>
                </div>

                {!dualValid && (
                  <p className="text-[11px] text-destructive">
                    Units per case and unit label are both required.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <div>
              <Label htmlFor="lite-item-active" className="text-sm">
                Active
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Archived items are hidden from counts.
              </p>
            </div>
            <Switch
              id="lite-item-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          {item?.cost_per_unit != null && (
            <div className="text-[11px] text-muted-foreground">
              Cost ${Number(item.cost_per_unit).toFixed(2)} per {item.unit || "unit"} — pulled from invoices, not editable here.
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-2 justify-end sticky bottom-0 bg-background pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
