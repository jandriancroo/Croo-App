import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Camera, AlertTriangle, ChevronsUpDown, Check, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_CONTAINERS, getPanUnits, type PanSizesConfig } from "@/components/inventory/PanSizesSection";

interface WasteLogFormProps {
  onSave: (data: WasteLogData) => Promise<void>;
  isSaving: boolean;
}

export interface WasteLogData {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  reason: string;
  photoFile: File;
  estimatedCost: number | null;
}

interface InventoryItemRow {
  id: string;
  name: string;
  unit: string | null;
  count_unit: string | null;
  count_units_per_case: number | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  cost_per_unit: number | null;
  blended_price: number | null;
  pan_sizes: PanSizesConfig | null;
}

export function WasteLogForm({ onSave, isSaving }: WasteLogFormProps) {
  const { currentLocation } = useAppLocation();
  const [selectedItemId, setSelectedItemId] = useState("");
  const [caseCount, setCaseCount] = useState("");
  const [packCount, setPackCount] = useState("");
  const [unitCount, setUnitCount] = useState("");
  const [panCounts, setPanCounts] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: items } = useQuery({
    queryKey: ["inventory-items-waste", currentLocation?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, unit, count_unit, count_units_per_case, pack_quantity, pack_quantity_override, cost_per_unit, blended_price, pan_sizes")
        .eq("location_id", currentLocation!.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as unknown as InventoryItemRow[];
    },
    enabled: !!currentLocation?.id,
  });

  const selectedItem = items?.find((i) => i.id === selectedItemId);

  const unitLabel = selectedItem?.count_unit || selectedItem?.unit || "units";
  
  // Packs per case (e.g., 6 bags per case)
  const packsPerCase = useMemo(() => {
    if (!selectedItem) return null;
    const pq = selectedItem.pack_quantity_override || selectedItem.pack_quantity || null;
    // Only show packs row if there's a meaningful pack level AND a different count_unit
    // i.e., pack_quantity represents inner containers (bags), count_units_per_case represents total count_units (oz)
    if (!pq || pq <= 1) return null;
    const cupc = selectedItem.count_units_per_case;
    // If count_units_per_case exists and differs from pack_quantity, there's a real pack level
    if (cupc && cupc !== pq) return pq;
    return null;
  }, [selectedItem]);

  // Count units per case (e.g., 480 oz per case)  
  const countUnitsPerCase = useMemo(() => {
    if (!selectedItem) return 1;
    return selectedItem.count_units_per_case || selectedItem.pack_quantity_override || selectedItem.pack_quantity || 1;
  }, [selectedItem]);

  // Count units per pack (e.g., 80 oz per bag)
  const countUnitsPerPack = useMemo(() => {
    if (!packsPerCase) return null;
    return countUnitsPerCase / packsPerCase;
  }, [countUnitsPerCase, packsPerCase]);

  const caseCost = useMemo(() => {
    if (!selectedItem) return 0;
    return selectedItem.blended_price ?? selectedItem.cost_per_unit ?? 0;
  }, [selectedItem]);

  const costPerCountUnit = caseCost / countUnitsPerCase;

  // Pan data from item's pan_sizes config
  const enabledPans = useMemo(() => {
    if (!selectedItem?.pan_sizes?.enabled) return [];
    return (selectedItem.pan_sizes.enabled_keys || [])
      .map(key => {
        const container = ALL_CONTAINERS.find(c => c.key === key);
        if (!container) return null;
        const units = getPanUnits(selectedItem.pan_sizes!, key);
        return { key, label: container.label, unitsEach: units };
      })
      .filter(Boolean) as { key: string; label: string; unitsEach: number | null }[];
  }, [selectedItem]);

  // Calculate total quantity in count_units (e.g., oz)
  const totalUnits = useMemo(() => {
    const cases = parseFloat(caseCount) || 0;
    const packs = parseFloat(packCount) || 0;
    const units = parseFloat(unitCount) || 0;
    const panUnits = Object.entries(panCounts).reduce((sum, [key, qty]) => {
      if (!selectedItem?.pan_sizes) return sum;
      const unitsEach = getPanUnits(selectedItem.pan_sizes, key);
      return sum + (unitsEach ?? 0) * qty;
    }, 0);
    const packUnits = packsPerCase && countUnitsPerPack ? packs * countUnitsPerPack : 0;
    return Math.round((cases * countUnitsPerCase + packUnits + units + panUnits) * 100) / 100;
  }, [caseCount, packCount, unitCount, panCounts, countUnitsPerCase, countUnitsPerPack, packsPerCase, selectedItem]);

  const estimatedCost = useMemo(() => {
    if (!selectedItem || totalUnits <= 0 || !caseCost) return null;
    return totalUnits * costPerCountUnit;
  }, [selectedItem, totalUnits, caseCost, costPerCountUnit]);

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const updatePanCount = (key: string, delta: number) => {
    setPanCounts(prev => ({
      ...prev,
      [key]: Math.max(0, Math.round(((prev[key] || 0) + delta) * 2) / 2),
    }));
  };

  const canSubmit = selectedItemId && totalUnits > 0 && reason && photoFile && !isSaving;

  const handleSubmit = () => {
    if (!canSubmit || !selectedItem || !photoFile) return;

    // Build descriptive unit string
    const parts: string[] = [];
    const cases = parseFloat(caseCount) || 0;
    const packs = parseFloat(packCount) || 0;
    const units = parseFloat(unitCount) || 0;
    if (cases > 0) parts.push(`${cases} case${cases !== 1 ? 's' : ''}`);
    if (packs > 0 && packsPerCase) parts.push(`${packs} unit${packs !== 1 ? 's' : ''}`);
    if (units > 0) parts.push(`${units} ${unitLabel}`);
    Object.entries(panCounts).forEach(([key, qty]) => {
      if (qty > 0) {
        const container = ALL_CONTAINERS.find(c => c.key === key);
        if (container) parts.push(`${qty} ${container.label}`);
      }
    });
    const displayUnit = parts.length > 0 ? parts.join(' + ') + ` (${totalUnits} ${unitLabel} total)` : `${totalUnits} ${unitLabel}`;

    onSave({
      itemId: selectedItemId,
      itemName: selectedItem.name,
      quantity: totalUnits,
      unit: displayUnit,
      reason,
      photoFile,
      estimatedCost,
    });
  };

  const resetForm = () => {
    setCaseCount("");
    setUnitCount("");
    setPanCounts({});
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Log Waste</h2>

      {/* Searchable item selector */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">Item</label>
        <Popover open={itemPickerOpen} onOpenChange={setItemPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={itemPickerOpen}
              className="w-full justify-between font-normal"
            >
              {selectedItem
                ? `${selectedItem.name} (${unitLabel})`
                : "Search items..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search items..." />
              <CommandList className="max-h-60">
                <CommandEmpty>No items found.</CommandEmpty>
                <CommandGroup>
                  {items?.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.name}
                      onSelect={() => {
                        setSelectedItemId(item.id);
                        setItemPickerOpen(false);
                        resetForm();
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedItemId === item.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {item.name} ({item.count_unit || item.unit || "ea"})
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Quantity section — mirrors counting session */}
      {selectedItem && (
        <div className="space-y-3">
          <label className="text-sm font-medium block">Quantity wasted</label>

          {/* Cases + Units row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Cases
                <span className="text-muted-foreground/60 ml-1">({unitsPerCase} {unitLabel}/cs)</span>
              </label>
              <Input
                type="number"
                inputMode="decimal"
                value={caseCount}
                onChange={(e) => setCaseCount(e.target.value)}
                placeholder="0"
                min="0"
                step="any"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Units <span className="text-muted-foreground/60">({unitLabel})</span>
              </label>
              <Input
                type="number"
                inputMode="decimal"
                value={unitCount}
                onChange={(e) => setUnitCount(e.target.value)}
                placeholder="0"
                min="0"
                step="any"
              />
            </div>
          </div>

          {/* Pan / Cambro rows */}
          {enabledPans.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-2">
                Pan / Cambro
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {enabledPans.map(({ key, label, unitsEach }) => {
                  const qty = panCounts[key] || 0;
                  return (
                    <div key={key} className="text-center">
                      <p className="text-[9px] text-muted-foreground font-medium mb-1 truncate">
                        {label}
                        {unitsEach != null && (
                          <span className="text-muted-foreground/60"> ({unitsEach})</span>
                        )}
                      </p>
                      <div className="flex items-center bg-background rounded-md border border-foreground/15 overflow-hidden">
                        <button
                          type="button"
                          className="h-8 w-8 flex items-center justify-center text-muted-foreground active:bg-muted transition-colors flex-shrink-0"
                          onClick={() => updatePanCount(key, -0.5)}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={qty || ""}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setPanCounts(prev => ({
                              ...prev,
                              [key]: isNaN(v) ? 0 : Math.max(0, v),
                            }));
                          }}
                          placeholder="0"
                          className="flex-1 text-center text-sm font-bold bg-transparent outline-none w-0"
                        />
                        <button
                          type="button"
                          className="h-8 w-8 flex items-center justify-center text-muted-foreground active:bg-muted transition-colors flex-shrink-0"
                          onClick={() => updatePanCount(key, 0.5)}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Running total */}
          {totalUnits > 0 && (
            <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
              <span className="text-muted-foreground">Total: </span>
              <span className="font-semibold">{totalUnits} {unitLabel}</span>
            </div>
          )}
        </div>
      )}

      {/* Reason */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">
          Why did this happen? <span className="text-destructive">*</span>
        </label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Dropped pan, expired product, equipment failure..."
          rows={3}
        />
      </div>

      {/* Photo */}
      <div>
        <label className="text-sm font-medium mb-1.5 block">
          Photo of waste <span className="text-destructive">*</span>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoCapture}
        />
        {photoPreview ? (
          <div className="relative">
            <img
              src={photoPreview}
              alt="Waste preview"
              className="w-full h-48 rounded-lg object-cover"
            />
            <Button
              variant="secondary"
              size="sm"
              className="absolute bottom-2 right-2"
              onClick={() => fileInputRef.current?.click()}
            >
              Retake
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full h-32 flex-col gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="h-6 w-6" />
            <span className="text-sm">Take Photo</span>
          </Button>
        )}
      </div>

      {/* Estimated cost preview */}
      {estimatedCost != null && estimatedCost > 0 && (
        <div className="bg-destructive/10 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium">
            Estimated loss: ${estimatedCost.toFixed(2)}
          </span>
        </div>
      )}

      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {isSaving ? "Submitting..." : "Submit Waste Log"}
      </Button>
    </div>
  );
}
